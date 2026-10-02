/**
 * ADR-0035 §A 就地管理（REQ-KB-011 ~ 013）：空间 / 大类 / 记录的改名、图标与颜色、归档、删除都在原处完成，不跳到别的页面。
 * 每个用例自建大类 / 空间 / 记录，不依赖共用库 xz_e2e 里累积的数据。
 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

/** ADR-0046：上一个菜单关闭后还在播退出动画（dur-fast），只认打开态的面板 */
const menuPanel = (page: Page) =>
  page.locator('[data-testid="space-menu-panel"][data-state="open"]')

const post = async (req: APIRequestContext, url: string, data: Record<string, unknown>) => {
  const r = await req.post(url, { data, headers: sameSite })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()) as { id: string; slug: string; name: string }
}

test('REQ-KB-011 空间就地管理：页头点标题改名 · 点图标改色 · ⋯ 归档 / 取消归档 · 侧栏右键删除后回到 /spaces 并可撤销', async ({
  page,
  request,
}) => {
  const stamp = Date.now().toString(36)
  const sp = await post(request, '/api/v1/spaces', { name: `就地 ${stamp}`, kind: 'project' })
  await page.goto(`/spaces/${sp.slug}/home`)
  const header = page.getByTestId('kb-header')

  // 改名：点标题 → 输入 → Enter
  const renamed = `就地改名 ${stamp}`
  await header.getByTestId('kb-title-edit').click()
  await header.getByTestId('kb-title-input').fill(renamed)
  await header.getByTestId('kb-title-input').press('Enter')
  await expect(header.getByRole('heading', { level: 1 })).toHaveText(renamed)
  const row = page
    .getByTestId('sidebar')
    .locator(`[data-testid="space-row"][data-space-id="${sp.id}"]`)
  await expect(row).toContainText(renamed)

  // 图标与颜色：点图标 → 选「绿」
  await header.getByTestId('kb-icon-edit').click()
  await page.getByText('绿', { exact: true }).click()
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/v1/spaces/${sp.id}`)).json()) as { color: string }).color,
    )
    .toBe('green')
  await page.keyboard.press('Escape')

  // 归档 / 取消归档：页头 ⋯，留在原页
  await header.getByTestId('space-menu').click()
  await menuPanel(page).getByTestId('space-archive-toggle').click()
  await expect(page.getByTestId('space-archived-banner')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/spaces/${sp.slug}/home$`))
  await header.getByTestId('space-menu').click()
  await menuPanel(page).getByTestId('space-archive-toggle').click()
  await expect(page.getByTestId('space-archived-banner')).toBeHidden()

  // 侧栏行右键 → 删除（计数确认）→ 回到 /spaces；撤销后回来
  await row.click({ button: 'right' })
  await expect(menuPanel(page)).toBeVisible()
  await menuPanel(page).getByTestId('space-menu-delete').click()
  await page.getByTestId('confirm-ok').click()
  await expect(page).toHaveURL(/\/spaces$/)
  await expect(row).toHaveCount(0)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(row).toContainText(renamed)
})

test('REQ-KB-012 大类就地管理：/spaces 分区标题 ⋯ 改名', async ({ page, request }) => {
  const stamp = Date.now().toString(36)
  const g = await post(request, '/api/v1/space-groups', { name: `分区 ${stamp}` })
  await post(request, '/api/v1/spaces', { name: `分区空间 ${stamp}`, kind: 'work', groupId: g.id })
  await page.goto('/spaces')
  const section = page.locator(`[data-testid="spaces-section"][data-group-id="${g.id}"]`)
  await section.locator('h2').hover()
  await section.getByTestId('group-menu').click()
  const name = page.getByTestId('group-menu-name')
  await name.fill(`分区改名 ${stamp}`)
  await name.press('Enter')
  await expect(section.locator('h2')).toHaveText(`分区改名 ${stamp}`)
})

test('REQ-KB-013 记录就地管理：目录行右键改名 · ⋯ 归档 · 删除可撤销；记录页删除后回到父页', async ({
  page,
  request,
}) => {
  const stamp = Date.now().toString(36)
  const sp = await post(request, '/api/v1/spaces', { name: `目录 ${stamp}`, kind: 'project' })
  const a = await createEntry(request, {
    kind: 'note',
    title: `父页 ${stamp}`,
    spaceId: sp.id,
    parentId: null,
  })
  const b = await createEntry(request, {
    kind: 'note',
    title: `子页 ${stamp}`,
    spaceId: sp.id,
    parentId: a,
  })
  const c = await createEntry(request, {
    kind: 'note',
    title: `待删 ${stamp}`,
    spaceId: sp.id,
    parentId: a,
  })

  await page.goto(`/spaces/${sp.slug}/tree`)
  const node = (id: string) => page.locator(`[data-testid="tree-row"][data-entry-id="${id}"]`)
  await expect(node(a)).toBeVisible()

  // 右键 → 改名
  await node(a).click({ button: 'right' })
  const input = page.getByTestId('entry-row-rename')
  await expect(input).toBeEnabled()
  await input.fill(`父页改名 ${stamp}`)
  await input.press('Enter')
  await expect(node(a)).toContainText(`父页改名 ${stamp}`)
  await page.keyboard.press('Escape')

  // ⋯ → 归档：离开目录
  await node(b).hover()
  await node(b).getByTestId('entry-row-menu').click()
  await page.getByTestId('entry-row-archive').click()
  await expect(node(b)).toHaveCount(0)

  // 记录页删除 → 回到父页；撤销恢复
  await page.goto(`/entries/${c}`)
  await page.getByTestId('entry-menu').click()
  await page.getByTestId('entry-menu-delete').click()
  await page.getByTestId('confirm-ok').click()
  await expect(page).toHaveURL(new RegExp(`/entries/${a}`))
  await page.getByRole('button', { name: '撤销' }).click()
  await expect.poll(async () => (await request.get(`/api/v1/entries/${c}`)).status()).toBe(200)
})
