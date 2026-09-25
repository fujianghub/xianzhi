/** T1-002 空间列表 / 侧栏空间树 / 新建 Dialog（REQ-SPACE-001 · 004 · 005 · 008）。 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { BASE, login, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

interface S {
  id: string
  slug: string
  sortKey: string
  isMember: boolean
}
const listSpaces = async (req: APIRequestContext) =>
  ((await (await req.get('/api/v1/spaces?limit=200')).json()) as { items: S[] }).items
const createSpace = async (req: APIRequestContext, name: string) => {
  const r = await req.post('/api/v1/spaces', { data: { name, kind: 'project' }, headers: sameSite })
  expect(r.status()).toBe(201)
  return (await r.json()) as S
}

async function dragHandleTo(page: Page, fromId: string, toId: string) {
  const from = page.locator(`[data-testid="space-row"][data-space-id="${fromId}"]`)
  const to = page.locator(`[data-testid="space-row"][data-space-id="${toId}"]`)
  await from.hover()
  const h = await from.getByTestId('space-drag-handle').boundingBox()
  const t = await to.boundingBox()
  if (!h || !t) throw new Error('no box')
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 - 10, { steps: 4 }) // 超过 6px 激活
  await page.mouse.move(h.x + h.width / 2, t.y + t.height / 4, { steps: 12 })
  await page.mouse.up()
}

test('REQ-SPACE-005 侧栏拖动排序只发一条 PATCH 且仅一行 sort_key 变化；刷新后顺序保持', async ({
  page,
  request,
}) => {
  const req = request
  const stamp = Date.now().toString(36)
  await createSpace(req, `拖动 A ${stamp}`)
  await createSpace(req, `拖动 B ${stamp}`)
  const c = await createSpace(req, `拖动 C ${stamp}`)
  await page.goto('/today')
  // ADR-0012：新建分类默认「其他」分区
  const rows = page
    .locator('[data-testid="space-section"][data-group-id="none"]')
    .getByTestId('space-row')
  await expect(rows.last()).toHaveAttribute('data-space-id', c.id)
  const first = await rows.first().getAttribute('data-space-id')
  const before = new Map((await listSpaces(req)).map((s) => [s.id, s.sortKey]))
  const patches: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().includes('/api/v1/spaces/reorder'))
      patches.push(r.postData() ?? '')
  })
  const done = page.waitForResponse((r) => r.url().includes('/api/v1/spaces/reorder'))
  await dragHandleTo(page, c.id, first ?? '')
  expect((await done).status()).toBe(200)
  await expect(rows.first()).toHaveAttribute('data-space-id', c.id)
  await page.waitForTimeout(300)
  expect(patches).toHaveLength(1)
  expect(JSON.parse(patches[0] ?? '{}')).toEqual({ id: c.id, after: null })
  const after = await listSpaces(req)
  const changed = after.filter((s) => before.get(s.id) !== s.sortKey).map((s) => s.id)
  expect(changed).toEqual([c.id])
  await page.reload()
  await expect(rows.first()).toHaveAttribute('data-space-id', c.id)
})

test('REQ-SPACE-008 新建空间 Dialog：选色板 token 与图标 → 创建后进入空间页，侧栏出现该空间', async ({
  page,
  request,
}) => {
  const name = `新空间 ${Date.now().toString(36)}`
  await page.goto('/spaces')
  await page.getByTestId('spaces-new').click()
  const dlg = page.getByTestId('create-space-dialog')
  await dlg.getByTestId('space-name').fill(name)
  await dlg.getByText('学习', { exact: true }).click()
  await dlg.getByText('仅成员', { exact: true }).click()
  await dlg.getByText('绿', { exact: true }).click()
  await dlg.locator('label', { hasText: 'rocket' }).click()
  await dlg.getByTestId('create-space-submit').click()
  // ADR-0012：进入分类默认是概览页
  await expect(page).toHaveURL(/\/spaces\/[a-z0-9-]+\/home$/)
  await expect(page.getByTestId('kb-home').getByRole('heading', { level: 1 })).toHaveText(name)
  await expect(page.getByTestId('sidebar').getByText(name)).toBeVisible()
  const slug = new URL(page.url()).pathname.split('/').at(-2) ?? ''
  const s = (await (await request.get(`/api/v1/spaces/${slug}`)).json()) as Record<string, unknown>
  expect(s).toMatchObject({
    kind: 'learning',
    visibility: 'members',
    color: 'green',
    icon: 'rocket',
    myRole: 'admin',
  })
  // 重复 slug → 字段级错误，不关闭 Dialog
  await page.getByTestId('new-space').click()
  await dlg.getByTestId('space-name').fill('重复')
  await dlg.getByTestId('space-slug').fill(slug)
  await dlg.getByTestId('create-space-submit').click()
  await expect(dlg.getByRole('alert')).toContainText('slug 已被占用')
})

test('REQ-SPACE-004 卡片菜单归档 → 空间页显示只读横幅、归档区可见；取消归档恢复', async ({
  page,
  request,
}) => {
  const s = await createSpace(request, `归档 ${Date.now().toString(36)}`)
  await page.goto('/spaces')
  const card = page.locator(`[data-testid="space-card"][data-space-id="${s.id}"]`)
  await card.getByTestId('space-actions').click()
  await page.getByTestId('space-archive-toggle').click()
  await expect(card).toHaveCount(0)
  await page.getByTestId('spaces-archived-toggle').click()
  await expect(page).toHaveURL(/archived=1/)
  const archivedCard = page.getByTestId('spaces-archived').locator(`[data-space-id="${s.id}"]`)
  await expect(archivedCard).toBeVisible()
  await page.goto(`/spaces/${s.slug}`)
  await expect(page.getByTestId('space-archived-banner')).toBeVisible()
  await page.goto('/spaces?archived=1')
  await archivedCard.getByTestId('space-actions').click()
  await page.getByTestId('space-archive-toggle').click()
  await expect(
    page.getByTestId('spaces-page').locator(`[data-space-id="${s.id}"]`).first(),
  ).toBeVisible()
})

test('REQ-SPACE-002 不可见空间直链显示 404 页（全新普通成员）', async ({ browser, playwright }) => {
  // 注：seed 的 member 在 notify.spec 的所有权往返后会变成工作区 admin，这里另邀一个普通成员
  const owner = await playwright.request.newContext({ baseURL: BASE, storageState: STATE.owner })
  const stamp = Date.now().toString(36)
  const r = await owner.post('/api/v1/spaces', {
    data: { name: '私密', kind: 'work', visibility: 'members', slug: `secret-${stamp}` },
    headers: sameSite,
  })
  const { slug } = (await r.json()) as S
  const email = `space-m-${stamp}@e2e.local`
  const password = 'space-member-pass-1'
  const inv = await owner.post('/api/v1/workspace/invitations', {
    data: { email, role: 'member' },
    headers: sameSite,
  })
  const { id } = (await inv.json()) as { id: string }
  const anon = await playwright.request.newContext({ baseURL: BASE })
  expect(
    (
      await anon.post(`/api/v1/workspace/invitations/${id}/accept`, {
        data: { email, name: 'SpaceM', password },
        headers: sameSite,
      })
    ).status(),
  ).toBe(201)
  const ctx = await browser.newContext({ baseURL: BASE })
  const p = await ctx.newPage()
  await login(p, { email, password })
  await p.waitForURL('**/today')
  await expect(p.getByTestId('sidebar').getByText('私密')).toHaveCount(0)
  await p.goto(`/spaces/${slug}`)
  await expect(p.getByTestId('not-found')).toBeVisible()
  await ctx.close()
  await owner.dispose()
  await anon.dispose()
})
