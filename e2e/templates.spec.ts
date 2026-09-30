/** ADR-0011 记录模板（REQ-TPL-003 · 004 · 005）：新建对话框选模板、学习空间推荐、另存为模板与管理页、斜杠插入模板。 */
import { expect, type Page, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const editor = (p: Page) => p.getByTestId('editor')
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

test('REQ-TPL-003 学习空间里新建：学习模板带「推荐」；选「产品 Bug 修复与迭代」→ kind=Bug，正文为模板骨架', async ({
  page,
  request,
}) => {
  const slug = `learn-${stamp()}`
  const r = await request.post('/api/v1/spaces', {
    data: { name: `学习 ${slug}`, slug, kind: 'learning', visibility: 'workspace' },
    headers: sameSite,
  })
  expect(r.status(), await r.text()).toBe(201)
  await page.goto(`/spaces/${slug}/entries`)
  await expect(page.getByTestId('entries-page')).toBeVisible()
  await page.keyboard.press('e')
  const dlg = page.getByTestId('new-entry-dialog')
  const picker = dlg.getByTestId('template-picker')
  const plan = picker.locator('[data-template-id="builtin:learning-plan"]')
  await expect(plan).toContainText('推荐')
  await expect(picker.locator('[data-template-id="builtin:bug-fix"]')).not.toContainText('推荐')
  // 选开发模板：kind 跟着变
  await picker.locator('[data-template-id="builtin:bug-fix"]').click()
  await expect(dlg.locator('[data-kind="bug"]')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('new-entry-title').fill('登录按钮偶发无响应')
  await page.getByTestId('new-entry-submit').click()
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]{36}$/)
  await expect(editor(page).locator('h2', { hasText: '复现步骤' })).toBeVisible()
  await expect(editor(page).locator('h2', { hasText: '迭代跟进' })).toBeVisible()
  await expect(editor(page)).not.toContainText('{{date}}')
})

test('REQ-TPL-004 另存为模板 → 设置页可见、预览、用它新建、删除', async ({ page, request }) => {
  const id = await createEntry(request, {
    kind: 'plan',
    title: '我的 Rust 计划',
    fields: { status: 'active' },
    templateId: 'builtin:learning-plan',
  })
  await page.goto(`/entries/${id}?aside=props`)
  await expect(editor(page).locator('h2', { hasText: '里程碑' })).toBeVisible()
  const name = `个人计划模板 ${stamp()}`
  await page.getByTestId('save-as-template').click()
  await page.getByTestId('save-as-template-name').fill(name)
  await page.getByTestId('save-as-template-submit').click()
  await expect(page.getByText(`已存为模板「${name}」`)).toBeVisible()

  await page.goto('/settings/templates')
  const row = page
    .getByTestId('templates-personal')
    .getByTestId('template-row')
    .filter({ hasText: name })
  await expect(row).toHaveCount(1)
  await row.getByTestId('template-preview-open').click()
  const prev = page.getByTestId('template-preview')
  await expect(prev.getByTestId('template-doc').locator('h2', { hasText: '里程碑' })).toBeVisible()
  await prev.getByTestId('template-use').click()
  const dlg = page.getByTestId('new-entry-dialog')
  await expect(dlg.locator('[data-kind="plan"]')).toHaveAttribute('aria-checked', 'true')
  await expect(dlg.getByTestId('template-picker').locator('[aria-checked="true"]')).toContainText(
    name,
  )
  await page.keyboard.press('Escape')
  await row.getByTestId('template-delete').click()
  await page.getByTestId('confirm-ok').click()
  await expect(row).toHaveCount(0)
  // 内置模板在「内置」组；ADR-0038：所有者（本用例登录身份）可删，成员不可（API 用例 REQ-TPL-014）
  await expect(page.getByTestId('templates-builtin').getByTestId('template-row')).toHaveCount(6)
  await expect(page.getByTestId('templates-builtin').getByTestId('template-delete')).toHaveCount(6)
})

test('REQ-TPL-005 斜杠「模板」在光标处插入学习笔记，原内容保留', async ({ page, request }) => {
  const id = await createEntry(request, { kind: 'note', title: '插入模板用例' })
  await page.goto(`/entries/${id}`)
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'synced', {
    timeout: 15_000,
  })
  await editor(page).click()
  await page.keyboard.type('原有的一句话')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/模板')
  await page.keyboard.press('Enter')
  const dlg = page.getByTestId('template-insert')
  await dlg.locator('[data-template-id="builtin:study-note"]').click()
  await expect(dlg).toBeHidden()
  await expect(editor(page).locator('h2', { hasText: '核心概念' })).toBeVisible()
  await expect(editor(page)).toContainText('原有的一句话')
})

test('REQ-TPL-012 新建模板：正文区带吸顶格式工具栏（加粗可用），「+」插入面板不含图片 / 附件等依赖记录的项', async ({
  page,
}) => {
  await page.goto('/settings/templates/new')
  const paper = page.getByTestId('template-paper')
  await expect(paper.getByTestId('editor-toolbar')).toBeVisible()
  const body = page.getByTestId('template-editor')
  await body.click()
  await page.keyboard.type('模板正文')
  await page.keyboard.press('ControlOrMeta+a')
  await paper.getByTestId('tb-bold').click()
  await expect(body.locator('strong')).toHaveText('模板正文')
  await paper.getByTestId('insert-open').click()
  const panel = page.getByTestId('insert-panel')
  await expect(panel.locator('[data-insert="table"]')).toBeVisible()
  await expect(panel.locator('[data-insert="image"]')).toHaveCount(0)
  await expect(panel.locator('[data-insert="file"]')).toHaveCount(0)
  await expect(panel.locator('[data-insert="entryLink"]')).toHaveCount(0)
})

test('REQ-TPL-013 · 014 所有者改内置模板名 → 列表显示「已修改」，可恢复默认；删除后在「已删除的内置模板」里恢复', async ({
  page,
  request,
}) => {
  const id = 'builtin:reading-note'
  // 共用库 xz_e2e：无论成败都把该内置模板复原
  const cleanup = () => request.post(`/api/v1/templates/${id}/reset`, { headers: sameSite })
  try {
    await cleanup()
    await page.goto('/settings/templates')
    const row = page.locator(`[data-testid="template-row"][data-template-id="${id}"]`)
    const original = (await row.locator('span.truncate').first().textContent()) ?? ''
    await row.getByTestId('template-edit').click()
    await expect(page.getByTestId('template-form')).toBeVisible()
    const renamed = `读书卡 ${stamp()}`
    await page.getByTestId('template-name').fill(renamed)
    await page.getByTestId('template-save').click()
    await expect(page).toHaveURL(/\/settings\/templates$/)
    await expect(row).toContainText(renamed)
    await expect(row.getByTestId('template-customized')).toBeVisible()
    await row.getByTestId('template-reset').click()
    await expect(row).toContainText(original)
    await expect(row.getByTestId('template-customized')).toHaveCount(0)

    await row.getByTestId('template-delete').click()
    await page.getByTestId('confirm-ok').click()
    await expect(row).toHaveCount(0)
    await page
      .getByTestId('templates-deleted')
      .locator(`[data-testid="deleted-template-row"][data-template-id="${id}"]`)
      .getByTestId('template-restore')
      .click()
    await expect(row).toBeVisible()
  } finally {
    await cleanup()
  }
})
