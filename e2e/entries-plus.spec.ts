/**
 * ADR-0014 我的记录（REQ-ENTRY-012 ~ 015、REQ-TAG-004 · 006）：左栏 大类 → 空间 → 目录、⋯ 菜单（收藏 / 归档 / 删除撤销）、
 * 批量、Bug 看板、标签管理页与标签筛选。
 */
import { type APIRequestContext, expect, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
async function mkSpace(req: APIRequestContext) {
  const slug = `ep-${stamp()}`
  const groups = (await (await req.get('/api/v1/space-groups')).json()) as {
    items: { id: string; name: string }[]
  }
  const groupId = groups.items.find((g) => g.name === '产品开发')?.id ?? null
  const r = await req.post('/api/v1/spaces', {
    data: { name: `记录 ${slug}`, slug, kind: 'project', visibility: 'workspace', groupId },
    headers: sameSite,
  })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()) as { id: string; slug: string; name: string }
}

test('REQ-ENTRY-012 左栏：大类 → 空间 → 目录节点，只列该子树；卡片显示目录路径', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  const root = await createEntry(request, {
    kind: 'note',
    title: '设计文档',
    spaceId: s.id,
    parentId: null,
  })
  await createEntry(request, { kind: 'note', title: '登录页设计', spaceId: s.id, parentId: root })
  await createEntry(request, { kind: 'note', title: '目录外随笔', spaceId: s.id })
  await page.goto('/entries')
  const nav = page.getByTestId('entries-nav')
  const space = nav.locator(`[data-testid="entries-nav-space"][data-space-id="${s.id}"]`)
  await space.getByTestId('entries-nav-space-toggle').click()
  await space.getByRole('button', { name: '设计文档', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`under=${root}`))
  await expect(page.getByTestId('entries-title')).toHaveText('设计文档')
  const grid = page.getByTestId('entry-grid')
  await expect(grid.getByTestId('entry-card')).toHaveCount(2)
  await expect(grid).not.toContainText('目录外随笔')
  await expect(
    grid.getByTestId('entry-card').filter({ hasText: '登录页设计' }).getByTestId('entry-card-path'),
  ).toHaveText('设计文档')
  // 点空间本身 → 该空间全部
  await space.getByRole('button', { name: s.name, exact: true }).click()
  await expect(grid.getByTestId('entry-card')).toHaveCount(3)
})

test('REQ-ENTRY-014 ⋯ 菜单：收藏进「收藏」；归档后移出列表进「已归档」；删除可撤销', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  const title = `菜单测试 ${stamp()}`
  await createEntry(request, { kind: 'note', title, spaceId: s.id })
  await page.goto(`/entries?spaceId=${s.id}`)
  const card = () => page.getByTestId('entry-card').filter({ hasText: title })
  const wrap = () => page.locator('.group\\/card').filter({ hasText: title })
  await card().hover()
  await wrap().getByTestId('entry-menu').click()
  await page.getByTestId('entry-menu-favorite').click()
  await expect(card().getByTestId('entry-card-favorited')).toBeVisible()
  await page.getByTestId('entries-nav-favorite').click()
  await expect(card()).toBeVisible()

  await page.goto(`/entries?spaceId=${s.id}`)
  await card().hover()
  await wrap().getByTestId('entry-menu').click()
  await page.getByTestId('entry-menu-archive').click()
  await expect(card()).toHaveCount(0)
  await page.goto(`/entries?archived=1`)
  await expect(card()).toBeVisible()

  await card().hover()
  await wrap().getByTestId('entry-menu').click()
  await page.getByTestId('entry-menu-delete').click()
  await page.getByTestId('confirm-ok').click()
  await expect(card()).toHaveCount(0)
  // 鼠标留在 Toast 区域会让堆叠反复展开 / 收起，按钮一直「不稳定」
  await page.mouse.move(0, 0)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(card()).toBeVisible()
})

test('REQ-ENTRY-013 多选：选两篇批量归档', async ({ page, request }) => {
  const s = await mkSpace(request)
  for (const n of ['批一', '批二', '批三'])
    await createEntry(request, { kind: 'note', title: n, spaceId: s.id })
  await page.goto(`/entries?spaceId=${s.id}`)
  await page.getByTestId('entries-select-mode').click()
  const pick = (n: string) =>
    page.locator('.group\\/card').filter({ hasText: n }).getByTestId('entry-select')
  await pick('批一').click()
  await pick('批二').click()
  await expect(page.getByTestId('batch-count')).toContainText('2')
  await page.getByTestId('batch-archive').click()
  await expect(page.getByTestId('entry-card')).toHaveCount(1)
  await expect(page.getByTestId('entry-card')).toContainText('批三')
})

test('REQ-ENTRY-015 Bug 看板：拖到「已修复」列 = 改状态', async ({ page, request }) => {
  const s = await mkSpace(request)
  const id = await createEntry(request, {
    kind: 'bug',
    title: '看板里的 Bug',
    spaceId: s.id,
    fields: { severity: 'high', status: 'open' },
  })
  await page.goto(`/entries?spaceId=${s.id}&kind=bug&view=board`)
  const card = page
    .locator(`[data-testid="entry-board-card"][data-entry-id="${id}"]`)
    .getByTestId('entry-board-handle')
  const open = page.locator('[data-testid="entry-board-column"][data-status="open"]')
  const fixed = page.locator('[data-testid="entry-board-column"][data-status="fixed"]')
  await expect(open.locator(`[data-entry-id="${id}"]`)).toBeVisible()
  const a = await card.boundingBox()
  const b = await fixed.boundingBox()
  if (!a || !b) throw new Error('no box')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 30, a.y + 20, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 12 })
  await page.mouse.up()
  await expect(fixed.locator(`[data-entry-id="${id}"]`)).toBeVisible()
  await expect
    .poll(async () => {
      const r = await request.get(`/api/v1/entries/${id}`)
      return ((await r.json()) as { fields: { status: string } }).fields.status
    })
    .toBe('fixed')
})

test('REQ-TAG-004 · 006 标签管理页：新建选色、改名；记录页按标签多选筛选', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  const name = `标${stamp()}`
  await page.goto('/settings/tags')
  await page.getByTestId('tag-color').first().click()
  await page.locator('[data-color="purple"]').click()
  await page.getByTestId('tag-new-name').fill(name)
  await page.getByTestId('tag-new-name').press('Enter')
  const row = page.locator(`[data-testid="tag-row"][data-tag-name="${name}"]`)
  await expect(row).toBeVisible()
  const tags = (await (await request.get('/api/v1/tags')).json()) as {
    items: { id: string; name: string; color: string }[]
  }
  const tag = tags.items.find((x) => x.name === name)
  expect(tag?.color).toBe('purple')
  await createEntry(request, { kind: 'note', title: '带标签的', spaceId: s.id, tagIds: [tag?.id] })
  await createEntry(request, { kind: 'note', title: '不带标签的', spaceId: s.id })

  await page.goto(`/entries?spaceId=${s.id}`)
  await page.getByTestId('tag-filter').click()
  await page.getByTestId('tag-filter-list').getByRole('button', { name }).click()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/tag=/)
  await expect(page.getByTestId('entry-card')).toHaveCount(1)
  await expect(page.getByTestId('entry-card')).toContainText('带标签的')
})
