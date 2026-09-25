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
  // 内置模板在「内置」组、不可删
  await expect(page.getByTestId('templates-builtin').getByTestId('template-row')).toHaveCount(6)
  await expect(page.getByTestId('templates-builtin').getByTestId('template-delete')).toHaveCount(0)
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
