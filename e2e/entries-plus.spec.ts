/**
 * ADR-0014 我的记录（REQ-ENTRY-012 ~ 015、REQ-TAG-004 · 006）：左栏 大类 → 空间 → 目录、⋯ 菜单（收藏 / 归档 / 删除撤销）、
 * 批量、Bug 看板、标签管理页与标签筛选。
 * ADR-0016（REQ-ENTRY-016 ~ 019、REQ-UI-038）：默认列表视图（状态 / 进度）、勾选批量改类型 / 状态 / 删除、自定义类型管理与筛选、侧栏「空间」可点样式。
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
  await page.goto('/entries?view=cards')
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
  await page.goto(`/entries?spaceId=${s.id}&view=cards`)
  const card = () => page.getByTestId('entry-card').filter({ hasText: title })
  const wrap = () => page.locator('.group\\/card').filter({ hasText: title })
  await card().hover()
  await wrap().getByTestId('entry-menu').click()
  await page.getByTestId('entry-menu-favorite').click()
  await expect(card().getByTestId('entry-card-favorited')).toBeVisible()
  await page.getByTestId('entries-nav-favorite').click()
  await expect(card()).toBeVisible()

  await page.goto(`/entries?spaceId=${s.id}&view=cards`)
  await card().hover()
  await wrap().getByTestId('entry-menu').click()
  await page.getByTestId('entry-menu-archive').click()
  await expect(card()).toHaveCount(0)
  await page.goto(`/entries?archived=1&view=cards`)
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
  await page.goto(`/entries?spaceId=${s.id}&view=cards`)
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
  await expect(page.getByTestId('entry-row')).toHaveCount(1)
  await expect(page.getByTestId('entry-row')).toContainText('带标签的')
  // 标签筛选旁有「管理标签」入口
  await page.getByTestId('manage-tags').click()
  await expect(page).toHaveURL(/\/settings\/tags$/)
})

test('REQ-ENTRY-016 · 017 默认列表：显示状态 / 进度；勾选两篇批量改类型、改状态，再批量删除', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  await createEntry(request, {
    kind: 'plan',
    title: '列表·计划',
    spaceId: s.id,
    fields: { status: 'active', progress: 40 },
  })
  await createEntry(request, { kind: 'note', title: '列表·随笔甲', spaceId: s.id })
  await createEntry(request, { kind: 'note', title: '列表·随笔乙', spaceId: s.id })
  await page.goto(`/entries?spaceId=${s.id}`)
  const table = page.getByTestId('entry-table')
  await expect(table).toBeVisible()
  await expect(page.getByTestId('view-table')).toHaveAttribute('aria-pressed', 'true')
  const row = (n: string) => page.getByTestId('entry-row').filter({ hasText: n })
  await expect(row('列表·计划').locator('[data-field="status"]')).toContainText('学习中')
  await expect(row('列表·计划').getByTestId('entry-progress')).toContainText('40%')

  // 勾选两篇随笔 → 批量条出现 → 改类型为 Bug
  await row('列表·随笔甲').getByTestId('entry-row-select').check()
  await row('列表·随笔乙').getByTestId('entry-row-select').check()
  const bar = page.getByTestId('entry-batch-bar')
  await expect(page.getByTestId('batch-count')).toContainText('2')
  await bar.getByTestId('batch-retype').click()
  await page.locator('[data-testid="batch-retype-target"][data-kind="bug"]').click()
  await expect(row('列表·随笔甲').locator('[data-field="status"]')).toContainText('待处理')
  await expect(row('列表·随笔乙').locator('[data-field="status"]')).toContainText('待处理')
  // 仍选中两篇：改状态为「已修复」
  await expect(page.getByTestId('batch-count')).toContainText('2')
  await bar.getByTestId('batch-status').click()
  await page.locator('[data-testid="batch-status-option"][data-status="fixed"]').click()
  await expect(row('列表·随笔甲').locator('[data-field="status"]')).toContainText('已修复')
  // 表头全选 → 删除（确认）
  await page.getByTestId('entry-select-all').check()
  await expect(page.getByTestId('batch-count')).toContainText('3')
  await bar.getByTestId('batch-delete').click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('entry-row')).toHaveCount(0)
})

test('REQ-ENTRY-018 · 019 自定义类型：管理页新建（色 + 状态）→ 记录页筛选 → 新建该类型记录 → 列表显示状态；隐藏内置类型', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  const name = `读书${stamp()}`.slice(0, 20)
  await page.goto(`/entries?spaceId=${s.id}`)
  await page.getByTestId('manage-types').click()
  await expect(page).toHaveURL(/\/settings\/types$/)
  await page.getByTestId('type-color').first().click()
  await page.locator('[data-color="purple"]').click()
  await page.getByTestId('type-new-name').fill(name)
  await page.getByTestId('type-new-statuses').fill('想读 在读 读完')
  await page.getByTestId('type-new-name').press('Enter')
  const row = page.locator(`[data-testid="type-row"][data-type-name="${name}"]`)
  await expect(row).toBeVisible()
  await expect(row.getByTestId('type-status-input')).toHaveCount(3)
  const types = (await (await request.get('/api/v1/entry-types')).json()) as {
    items: { id: string; name: string; color: string; statuses: string[] }[]
  }
  const ty = types.items.find((x) => x.name === name)
  expect(ty).toMatchObject({ color: 'purple', statuses: ['想读', '在读', '读完'] })

  // 记录页按该类型筛选，新建该类型记录（状态默认第一项）
  await page.goto(`/entries?spaceId=${s.id}`)
  await page.locator(`[data-kind-filter="${ty?.id}"]`).click()
  await expect(page).toHaveURL(new RegExp(`typeId=${ty?.id}`))
  await page.getByTestId('new-entry').click()
  const dlg = page.getByTestId('new-entry-dialog')
  await expect(dlg.locator(`[data-kind="${ty?.id}"]`)).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('new-entry-title').fill('《数据密集型应用系统设计》')
  await page.getByTestId('new-entry-submit').click()
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]{36}$/)
  await page.goto(`/entries?spaceId=${s.id}&typeId=${ty?.id}`)
  const r = page.getByTestId('entry-row').filter({ hasText: '数据密集型' })
  await expect(r.locator('[data-field="status"]')).toContainText('想读')

  // 管理页：状态改名「想读」→「待读」，记录同步
  await page.goto('/settings/types')
  await row.getByTestId('type-status-input').first().fill('待读')
  await row.getByTestId('type-status-save').click()
  await page.goto(`/entries?spaceId=${s.id}&typeId=${ty?.id}`)
  await expect(r.locator('[data-field="status"]')).toContainText('待读')

  // 隐藏内置类型「复盘」→ 记录页筛选条不再出现；再显示回来（共用库，复原）
  await page.goto('/settings/types')
  const review = page.locator('[data-testid="builtin-row"][data-kind="review"]')
  await review.getByTestId('builtin-toggle').click()
  await expect(review).toContainText('已隐藏')
  await page.goto('/entries')
  await expect(page.locator('[data-kind-filter="review"]')).toHaveCount(0)
  await page.goto('/settings/types')
  await review.getByTestId('builtin-toggle').click()
  await expect(review).not.toContainText('已隐藏')

  // 删除类型：记录转为随笔
  await row.getByTestId('type-delete').click()
  await page.getByTestId('confirm-ok').click()
  await expect(row).toHaveCount(0)
  await page.goto(`/entries?spaceId=${s.id}`)
  await expect(
    page.getByTestId('entry-row').filter({ hasText: '数据密集型' }).locator('[data-kind="note"]'),
  ).toBeVisible()
})

test('REQ-UI-038 侧栏「空间」标题可点：正文色、带箭头，与「我的视图」区分', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/entries')
  const heading = page.getByTestId('spaces-heading').first()
  await expect(heading).toBeVisible()
  const colors = await page.evaluate(() => {
    const h = document.querySelector('[data-testid="spaces-heading"]') as HTMLElement
    const label = document.querySelector('.xz-nav-label') as HTMLElement
    return { h: getComputedStyle(h).color, l: getComputedStyle(label).color }
  })
  expect(colors.h).not.toBe(colors.l)
  await expect(heading.locator('svg')).toHaveCount(1)
  await heading.click()
  await expect(page).toHaveURL(/\/spaces$/)
})
