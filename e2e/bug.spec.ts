/**
 * ADR-0033 Bug 跟踪（REQ-BUG-005 · 006 · 008 · 009 · 011 · 012）：分组 / 快速提 Bug、流转、统计视图、保存视图、查询块。
 * 每个用例自建空间，不依赖共享库里的累积数据；保存视图用例结束时删除自己建的视图。
 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
async function mkSpace(req: APIRequestContext) {
  const slug = `bug-${stamp()}`
  const r = await req.post('/api/v1/spaces', {
    data: { name: `Bug ${slug}`, slug, kind: 'project', visibility: 'workspace' },
    headers: sameSite,
  })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()) as { id: string; slug: string; name: string }
}
const bug = (req: APIRequestContext, spaceId: string, title: string, fields = {}) =>
  createEntry(req, {
    kind: 'bug',
    title,
    spaceId,
    fields: { status: 'new', severity: 'medium', ...fields },
  })
const fieldsOf = async (req: APIRequestContext, id: string) =>
  ((await (await req.get(`/api/v1/entries/${id}`)).json()) as { fields: Record<string, unknown> })
    .fields

test('REQ-BUG-005 表格按优先级分组；新建对话框对 Bug 只填优先级 / 严重度 / 模块，发现日期由服务端补', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  await bug(request, s.id, '崩溃', { priority: 'p0' })
  await bug(request, s.id, '错别字', { priority: 'p3' })
  await page.goto(`/entries?spaceId=${s.id}&kind=bug&group=priority`)
  const groups = page.getByTestId('entry-group')
  await expect(groups).toHaveCount(2)
  await expect(groups.first().locator('th')).toHaveAttribute('data-group', 'p0')
  await expect(groups.first()).toContainText('P0 紧急')

  await page.getByTestId('new-entry').click()
  const dlg = page.getByTestId('new-entry-dialog')
  const form = dlg.getByTestId('entry-fields')
  await expect(form.locator('#field-priority')).toBeVisible()
  await expect(form.locator('#field-severity')).toBeVisible()
  await expect(form.locator('#field-module')).toBeVisible()
  await expect(form.locator('#field-status')).toHaveCount(0)
  await expect(form.locator('#field-foundAt')).toHaveCount(0)
  await dlg.getByTestId('new-entry-title').fill('快速提的 Bug')
  await form.locator('#field-priority').selectOption('p1')
  await form.locator('#field-module').fill('登录')
  await dlg.getByTestId('new-entry-submit').click()
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]{36}/)
  const id = page.url().split('/entries/')[1]?.split(/[?#]/)[0] ?? ''
  const f = await fieldsOf(request, id)
  expect(f).toMatchObject({ status: 'new', priority: 'p1', module: '登录' })
  expect(String(f.foundAt)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test('REQ-BUG-006 属性栏改状态后「流转」出现该变化', async ({ page, request }) => {
  const s = await mkSpace(request)
  const id = await bug(request, s.id, '流转用例')
  await page.goto(`/entries/${id}`)
  const toggle = page.getByTestId('entry-fields-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page.locator('#field-status').selectOption('pending')
  await expect.poll(async () => (await fieldsOf(request, id)).status).toBe('pending')
  await page.getByTestId('entry-changes-toggle').click()
  const list = page.getByTestId('entry-changes')
  await expect(list.locator('[data-field="status"]').first()).toContainText('新建 → 待决策')
})

test('REQ-BUG-008 统计视图：概要、趋势悬停提示、点分布条回到列表并按该值筛选', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  await bug(request, s.id, 'A', { priority: 'p0' })
  await bug(request, s.id, 'B', { priority: 'p0', status: 'fixed' })
  await bug(request, s.id, 'C', { priority: 'p2' })
  await page.goto(`/entries?spaceId=${s.id}&kind=bug`)
  await page.getByTestId('view-stats').click()
  await expect(page).toHaveURL(/view=stats/)
  const stats = page.getByTestId('bug-stats')
  await expect(stats.getByTestId('bug-tile-total')).toContainText('3')
  await expect(stats.getByTestId('bug-tile-open')).toContainText('2')
  await expect(stats.getByTestId('bug-tile-p0Open')).toContainText('1')
  // 趋势：最后一桶（本周）可聚焦查看数值
  await stats.getByTestId('bug-trend-bucket').last().focus()
  await expect(stats.getByTestId('bug-trend-tip')).toContainText('3')
  await stats.getByTestId('bug-trend-table-toggle').click()
  await expect(stats.getByTestId('bug-trend-table')).toBeVisible()
  await stats.getByTestId('dist-priority').locator('li[data-key="p0"] button').click()
  await expect(page).toHaveURL(/priority%3Dp0|priority=p0/)
  await expect(page).not.toHaveURL(/view=stats/)
  await expect(page.getByTestId('entry-row')).toHaveCount(2)
})

test('REQ-BUG-009 保存视图：保存当前筛选，左栏点击即套用；可删除', async ({ page, request }) => {
  const s = await mkSpace(request)
  await bug(request, s.id, '视图里的 P0', { priority: 'p0' })
  await bug(request, s.id, '视图外的 P2', { priority: 'p2' })
  const name = `P0-${stamp()}`
  try {
    await page.goto(`/entries?spaceId=${s.id}&kind=bug&fields=priority%3Dp0`)
    await expect(page.getByTestId('entry-row')).toHaveCount(1)
    await page.getByTestId('save-view').click()
    const dlg = page.getByTestId('view-name-dialog')
    await dlg.getByTestId('view-name').fill(name)
    await dlg.getByRole('button', { name: '保存' }).click()
    const item = page.locator(`[data-testid="saved-view"][data-view-name="${name}"]`)
    await expect(item).toBeVisible()
    await expect(item).toHaveAttribute('aria-current', 'page')
    await page.goto('/entries')
    await page.locator(`[data-testid="saved-view"][data-view-name="${name}"]`).click()
    await expect(page).toHaveURL(new RegExp(`spaceId=${s.id}`))
    await expect(page.getByTestId('entry-row')).toHaveCount(1)
    await expect(page.getByTestId('entry-row')).toContainText('视图里的 P0')
    // 删除
    const row = page.locator('li', { has: page.locator(`[data-view-name="${name}"]`) })
    await row.hover()
    await row.getByTestId('saved-view-menu').click()
    await page.getByTestId('saved-view-delete').click()
    await page.getByTestId('confirm-ok').click()
    await expect(page.locator(`[data-testid="saved-view"][data-view-name="${name}"]`)).toHaveCount(
      0,
    )
  } finally {
    const all = (await (await request.get('/api/v1/entry-views')).json()) as {
      items: { id: string; name: string }[]
    }
    for (const v of all.items.filter((x) => x.name === name))
      await request.delete(`/api/v1/entry-views/${v.id}`, { headers: sameSite })
  }
})

async function openEntry(page: Page, id: string) {
  await page.goto(`/entries/${id}`)
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'synced', {
    timeout: 15_000,
  })
  await page.getByTestId('editor').click()
}
const bodyOf = async (req: APIRequestContext, id: string) =>
  JSON.stringify(
    ((await (await req.get(`/api/v1/entries/${id}?withBody=1`)).json()) as { pmJson: unknown })
      .pmJson,
  )

test('REQ-BUG-011 · 012 斜杠「查询」插入本空间未关闭 Bug 的查询块，可切计数；历史版本预览里只显示占位', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  await bug(request, s.id, '查询块里的 Bug', { priority: 'p1' })
  await bug(request, s.id, '已修的不列', { status: 'fixed' })
  await bug(request, s.id, '另一个未关闭', { status: 'pending' })
  const id = await createEntry(request, { kind: 'note', title: 'Bug 总览', spaceId: s.id })
  await openEntry(page, id)
  await page.keyboard.type('/查询')
  await page.keyboard.press('Enter')
  const block = page.getByTestId('editor').getByTestId('entry-query')
  await expect(block).toBeVisible()
  await expect(block.getByTestId('entry-row')).toHaveCount(2)
  await expect(block).toContainText('查询块里的 Bug')
  await expect(block).not.toContainText('已修的不列')
  await block.getByTestId('entry-query-view-count').click()
  await expect(block.getByTestId('entry-query-count')).toContainText('2')
  // 设置：标题写回属性
  await block.getByTestId('entry-query-settings').click()
  const dlg = page.getByTestId('entry-query-dialog')
  await dlg.getByTestId('entry-query-title-input').fill('未关闭总数')
  await dlg.getByTestId('entry-query-save').click()
  await expect(block.getByTestId('entry-query-title')).toHaveText('未关闭总数')
  await expect.poll(() => bodyOf(request, id), { timeout: 15_000 }).toContain('未关闭总数')

  // 历史版本预览：查询块只显示标题与链接卡（不请求实时数据）
  const mark = await request.post(`/api/v1/entries/${id}/snapshots`, {
    data: { label: '含查询块' },
    headers: sameSite,
  })
  expect(mark.status()).toBe(201)
  await page.getByTestId('aside-tab-history').click()
  await page.getByTestId('history-item').filter({ hasText: '含查询块' }).click()
  const snap = page.getByTestId('snapshot-preview').getByTestId('snapshot-doc')
  const placeholder = snap.getByTestId('entry-query')
  await expect(placeholder).toHaveAttribute('data-static', '')
  await expect(placeholder).toContainText('未关闭总数')
  await expect(placeholder.getByTestId('entry-row')).toHaveCount(0)
})
