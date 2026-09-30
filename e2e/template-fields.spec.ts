/**
 * ADR-0039 模板元数据（REQ-TPL-016 · 017 · 018、REQ-ENTRY-032）：模板编辑页增 / 删 / 改模板属性、移除 / 恢复类型属性；
 * 用模板新建的记录带这些属性；回头改模板，已建记录跟着变。
 */
import { type APIRequestContext, expect, test } from '@playwright/test'
import { STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

interface Tpl {
  id: string
  name: string
  entryCount: number
  hiddenFields: string[]
  fieldDefs: { key: string; label: string; options?: { name: string }[] }[]
}
const findTpl = async (request: APIRequestContext, name: string) => {
  const list = (await (await request.get('/api/v1/templates')).json()) as { items: Tpl[] }
  return list.items.find((x) => x.name === name)
}

test('REQ-TPL-016 模板编辑页增删改模板属性、移除 / 恢复类型属性 → 用它新建的记录带这些属性；改模板后已建记录同步', async ({
  page,
  request,
}) => {
  const name = `缺陷登记 ${stamp()}`
  await page.goto('/settings/templates/new')
  await page.getByTestId('template-name').fill(name)
  await page.getByTestId('template-kind').selectOption('bug')

  // 类型属性：必填 / 进流转的不能移除；可省的可移除、可恢复
  const typeFields = page.getByTestId('template-type-fields')
  await expect(typeFields.getByTestId('template-field-remove-status')).toHaveCount(0)
  await typeFields.getByTestId('template-field-remove-module').click()
  await typeFields.getByTestId('template-field-remove-commit').click()
  await expect(typeFields.getByTestId('template-field-module')).toHaveCount(0)
  await expect(page.getByTestId('template-removed-fields')).toContainText('模块')
  await typeFields.getByTestId('template-field-restore-commit').click()
  await expect(typeFields.getByTestId('template-field-commit')).toBeVisible()

  // 模板属性：增两个（单选带预填 + 文本）
  const own = page.getByTestId('template-own-fields')
  await own.getByTestId('field-def-add').click()
  const ver = own.getByTestId('field-def-row').last()
  await ver.getByTestId('field-def-label').fill('影响版本')
  await ver.getByTestId('field-def-type').selectOption('select')
  await ver.getByTestId('field-option-name').first().fill('v1')
  await ver.getByTestId('field-option-add').click()
  await ver.getByTestId('field-option-name').last().fill('v2')
  await ver.getByTestId('template-own-preset').click()
  await page.locator('[data-testid^="field-editor-x"] [data-value="v1"]').click()
  await expect(ver.getByTestId('template-own-preset')).toContainText('v1')
  await own.getByTestId('field-def-add').click()
  await own.getByTestId('field-def-row').last().getByTestId('field-def-label').fill('复现率')
  await page.getByTestId('template-save').click()
  await expect(page).toHaveURL(/\/settings\/templates$/)

  // 查：列表行写明模板属性与移除的类型属性；接口里键是服务端生成的
  const row = page.getByTestId('template-row').filter({ hasText: name })
  await expect(row.getByTestId('template-meta-own')).toContainText('影响版本、复现率')
  await expect(row.getByTestId('template-meta-removed')).toContainText('模块')
  const tpl = await findTpl(request, name)
  expect(tpl?.hiddenFields).toEqual(['module'])
  const verKey = tpl?.fieldDefs.find((d) => d.label === '影响版本')?.key ?? ''
  const rateKey = tpl?.fieldDefs.find((d) => d.label === '复现率')?.key ?? ''
  expect(verKey).toMatch(/^x[A-Z]{6}$/)

  // 预览里列出属性
  await row.getByTestId('template-preview-open').click()
  const fields = page.getByTestId('template-preview-fields')
  await expect(fields.locator(`[data-field="${verKey}"]`)).toContainText('v1')
  await expect(fields.locator('[data-field="module"]')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // 用它新建：快速提 Bug 表单里没有被移除的「模块」；建出的记录带模板属性与预填
  await row.getByTestId('template-use-row').click()
  const dlg = page.getByTestId('new-entry-dialog')
  await expect(dlg.locator('#field-severity')).toBeVisible()
  await expect(dlg.locator('#field-module')).toHaveCount(0)
  await dlg.getByTestId('new-entry-title').fill(`登录闪退 ${stamp()}`)
  await dlg.getByTestId('new-entry-submit').click()
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]{36}/)
  const entryUrl = page.url()
  const entryId = entryUrl.split('/entries/')[1]?.split(/[?#]/)[0] ?? ''
  const props = page.getByTestId('entry-properties')
  await expect(props.getByTestId(`entry-prop-${verKey}`)).toContainText('v1')
  await props.getByTestId('entry-props-empty-toggle').click()
  await expect(props.getByTestId(`entry-prop-${rateKey}`)).toBeVisible()
  await expect(props.getByTestId('entry-prop-module')).toHaveCount(0)
  // 在记录上改模板属性的值
  await props.getByTestId(`entry-prop-${verKey}`).click()
  await page.getByTestId(`field-editor-${verKey}`).locator('[data-value="v2"]').click()
  await expect(props.getByTestId(`entry-prop-${verKey}`)).toContainText('v2')

  // 回模板：改选项名、删一个属性、恢复「模块」——有记录在用，保存前确认
  await page.goto(`/settings/templates/${tpl?.id}`)
  const own2 = page.getByTestId('template-own-fields')
  const ver2 = own2.locator(`[data-testid="field-def-row"][data-field-key="${verKey}"]`)
  await expect(ver2.getByTestId('field-def-type')).toBeDisabled()
  await ver2.getByTestId('field-option-name').last().fill('v2.0')
  await own2
    .locator(`[data-testid="field-def-row"][data-field-key="${rateKey}"]`)
    .getByTestId('field-def-remove')
    .click()
  await page.getByTestId('template-field-restore-module').click()
  await page.getByTestId('template-save').click()
  const confirm = page.getByTestId('confirm-dialog')
  await expect(confirm).toContainText('复现率')
  await confirm.getByTestId('confirm-ok').click()
  await expect(page).toHaveURL(/\/settings\/templates$/)

  // 已建记录：值跟着选项改名、被删的属性没了、「模块」回来了
  await page.goto(entryUrl)
  const props2 = page.getByTestId('entry-properties')
  await expect(props2.getByTestId(`entry-prop-${verKey}`)).toContainText('v2.0')
  await props2.getByTestId('entry-props-empty-toggle').click()
  await expect(props2.getByTestId('entry-prop-module')).toBeVisible()
  await expect(props2.getByTestId(`entry-prop-${rateKey}`)).toHaveCount(0)

  // 收尾：共享库不留数据
  await request.delete(`/api/v1/entries/${entryId}`, { headers: sameSite })
  await request.delete(`/api/v1/templates/${tpl?.id}`, { headers: sameSite })
})
