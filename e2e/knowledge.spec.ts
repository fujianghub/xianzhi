/** ADR-0012 空间（REQ-KB-001 ~ 005、REQ-LINK-003 · 005）：大类分区、概览、类型表格、目录树、Bug ↔ 迭代关联。 */
import { type APIRequestContext, expect, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
async function kb(req: APIRequestContext, kind: 'project' | 'learning' = 'project') {
  const slug = `kb-${stamp()}`
  const r = await req.post('/api/v1/spaces', {
    data: { name: `空间 ${slug}`, slug, kind, visibility: 'workspace' },
    headers: sameSite,
  })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()) as { id: string; slug: string; name: string }
}

test('REQ-KB-001 · 002 空间列表按大类分区；在「生活」里新建 → 侧栏出现在该分区', async ({
  page,
}) => {
  await page.goto('/spaces')
  const sections = page.getByTestId('spaces-section')
  await expect(sections.first()).toContainText('产品开发')
  await expect(page.locator('[data-testid="spaces-section"]', { hasText: '衔枝' })).toContainText(
    '产品开发',
  )
  const life = page.locator('[data-testid="spaces-section"]', { hasText: '生活' })
  await life.getByTestId('spaces-new-here').click()
  const dlg = page.getByTestId('create-space-dialog')
  const name = `周末烘焙 ${stamp()}`
  await dlg.getByTestId('space-name').fill(name)
  await dlg.getByRole('button', { name: '创建' }).click()
  await expect(page).toHaveURL(/\/spaces\/[a-z0-9-]+\/home$/)
  await expect(page.getByTestId('kb-meta')).toContainText('生活')
  const side = page.locator('[data-testid="space-section"]', { hasText: '生活' })
  await expect(side.getByTestId('space-row').filter({ hasText: name })).toBeVisible()
})

test('REQ-KB-003 产品空间概览：未关闭 Bug 按严重度计数；快捷「Bug」带出修复模板', async ({
  page,
  request,
}) => {
  const s = await kb(request)
  await createEntry(request, {
    kind: 'bug',
    title: '严重崩溃',
    spaceId: s.id,
    fields: { severity: 'critical', status: 'open' },
  })
  await createEntry(request, {
    kind: 'bug',
    title: '已修小问题',
    spaceId: s.id,
    fields: { severity: 'low', status: 'fixed' },
  })
  await page.goto(`/spaces/${s.slug}/home`)
  const bugs = page.getByTestId('kb-panel-bugs')
  await expect(bugs).toContainText('严重崩溃')
  await expect(bugs).not.toContainText('已修小问题')
  await expect(bugs.locator('[data-severity="critical"]')).toContainText('1')
  await page.getByTestId('kb-quick-bug').click()
  const dlg = page.getByTestId('new-entry-dialog')
  await expect(dlg.locator('[data-template-id="builtin:bug-fix"]')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(dlg.locator('[data-kind="bug"]')).toHaveAttribute('aria-checked', 'true')
})

test('REQ-KB-004 记录表格视图：只看 Bug 时按严重度过滤、列头排序', async ({ page, request }) => {
  const s = await kb(request)
  await createEntry(request, {
    kind: 'bug',
    title: 'B-高',
    spaceId: s.id,
    fields: { severity: 'high', status: 'open' },
  })
  await createEntry(request, {
    kind: 'bug',
    title: 'B-低',
    spaceId: s.id,
    fields: { severity: 'low', status: 'open' },
  })
  await createEntry(request, { kind: 'note', title: '随手记', spaceId: s.id })
  await page.goto(`/spaces/${s.slug}/entries?kind=bug&view=table`)
  const table = page.getByTestId('entry-table')
  await expect(table.getByTestId('entry-row')).toHaveCount(2)
  await expect(table).not.toContainText('随手记')
  await table.locator('[data-sort-key="f.severity"]').click()
  await expect(table.getByTestId('entry-row').first()).toContainText('B-低')
  await page.getByTestId('field-filter-severity').selectOption('high')
  await expect(page).toHaveURL(/fields=severity%3Dhigh|fields=severity=high/)
  await expect(table.getByTestId('entry-row')).toHaveCount(1)
  await expect(table).toContainText('B-高')
})

test('REQ-KB-005 目录：新建根页与子页、面包屑、缩进 / 取消缩进、其余记录加入目录', async ({
  page,
  request,
}) => {
  const s = await kb(request, 'learning')
  const loose = await createEntry(request, { kind: 'note', title: '零散笔记', spaceId: s.id })
  await page.goto(`/spaces/${s.slug}/tree`)
  await page.getByTestId('tree-new-root').click()
  await page.getByTestId('new-entry-title').fill('第一章')
  await page.getByTestId('new-entry-submit').click()
  await expect(page).toHaveURL(/\/entries\//)
  await page.goto(`/spaces/${s.slug}/tree`)
  const row = (title: string) => page.getByTestId('tree-row').filter({ hasText: title })
  await row('第一章').hover()
  await row('第一章').getByTestId('tree-new-child').click()
  await page.getByTestId('new-entry-title').fill('1.1 小节')
  await page.getByTestId('new-entry-submit').click()
  await expect(page.getByTestId('entry-breadcrumb')).toContainText('第一章')
  await page.goto(`/spaces/${s.slug}/tree`)
  await expect(row('1.1 小节')).toHaveAttribute('data-depth', '1')
  // 其余记录 → 加入目录（根级末尾）
  await page
    .locator(`[data-testid="unfiled-row"][data-entry-id="${loose}"]`)
    .getByTestId('unfiled-add')
    .click()
  await expect(row('零散笔记')).toHaveAttribute('data-depth', '0')
  // 缩进：零散笔记成为第一章的子页；再取消缩进回根级
  await row('零散笔记').hover()
  await row('零散笔记').getByTestId('tree-indent').click()
  await expect(row('零散笔记')).toHaveAttribute('data-depth', '1')
  await row('零散笔记').hover()
  await row('零散笔记').getByTestId('tree-outdent').click()
  await expect(row('零散笔记')).toHaveAttribute('data-depth', '0')
})

test('REQ-LINK-003 · 005 迭代「关联 Bug」→ Bug 页「修复于」显示该迭代', async ({
  page,
  request,
}) => {
  const s = await kb(request)
  const t = stamp()
  const bug = await createEntry(request, {
    kind: 'bug',
    title: `登录失败 ${t}`,
    spaceId: s.id,
    fields: { severity: 'high', status: 'open' },
  })
  const it = await createEntry(request, {
    kind: 'iteration',
    title: `第 40 周迭代 ${t}`,
    spaceId: s.id,
    fields: { periodStart: '2026-09-28', periodEnd: '2026-10-04' },
  })
  await page.goto(`/entries/${it}?aside=backlinks`)
  await page.getByTestId('link-add-bug').click()
  await page.getByTestId('entry-picker-input').fill(`登录失败 ${t}`)
  await page.getByRole('option', { name: new RegExp(`登录失败 ${t}`) }).click()
  await expect(page.getByTestId('relations-fixed-bugs')).toContainText(`登录失败 ${t}`)
  await page.goto(`/entries/${bug}?aside=backlinks`)
  await expect(page.getByTestId('relations-fixed-in')).toContainText(`第 40 周迭代 ${t}`)
  await expect(page.getByTestId('relations-backlinks')).toContainText('被解决于')
})

test('REQ-KB-007 · 006 个人空间概览 = 空间目录（大类 → 空间 → 目录树），展开空间才取目录；层级带引导线', async ({
  page,
  request,
}) => {
  const s = await kb(request)
  const root = await createEntry(request, {
    kind: 'note',
    title: '根页',
    spaceId: s.id,
    parentId: null,
  })
  await createEntry(request, { kind: 'note', title: '子页', spaceId: s.id, parentId: root })
  const me = (
    (await (await request.get('/api/v1/spaces?limit=200')).json()) as {
      items: { slug: string; isPersonal: boolean }[]
    }
  ).items.find((x) => x.isPersonal)
  await page.goto(`/spaces/${me?.slug}/home`)
  const dir = page.getByTestId('space-dir')
  await expect(dir.getByTestId('space-dir-group').first()).toContainText('产品开发')
  await expect(dir).toContainText('技术学习规划')
  await expect(page.getByTestId('kb-panel-bugs')).toHaveCount(0)
  const row = dir.locator(`[data-testid="space-dir-space"][data-space-id="${s.id}"]`)
  const tree = page.waitForResponse((r) => r.url().includes(`/api/v1/spaces/${s.id}/tree`))
  await row.getByTestId('space-dir-toggle').click()
  await tree
  const node = row.locator(`[data-testid="entries-nav-node"][data-entry-id="${root}"]`)
  await expect(node).toContainText('根页')
  // 折叠时行尾子项计数；根页位于第 2 级（大类 → 空间 → 根页）→ 2 条引导线
  await expect(node.locator('.xz-tree-count')).toHaveText('1')
  await expect(node.locator('.xz-guide')).toHaveCount(2)
  await node.getByRole('button', { name: '展开 根页' }).click()
  await expect(row.getByTestId('entries-nav-node').filter({ hasText: '子页' })).toBeVisible()
})
