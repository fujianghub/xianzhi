/**
 * ADR-0039 模板元数据（REQ-TPL-016 · 017 · 018、REQ-ENTRY-032）：模板编辑页增 / 删 / 改模板属性、移除 / 恢复类型属性；
 * 用模板新建的记录带这些属性；回头改模板，已建记录跟着变。
 * ADR-0040（REQ-ENTRY-033）：记录页按模板属性筛选与分组。
 */
import { type APIRequestContext, expect, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

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

test('REQ-ENTRY-033 记录页：选中类型后可按模板属性筛选与分组', async ({ page, request }) => {
  const slug = `tf-${stamp()}`
  const sp = await request.post('/api/v1/spaces', {
    data: { name: `模板筛选 ${slug}`, slug, kind: 'project', visibility: 'workspace' },
    headers: sameSite,
  })
  expect(sp.status(), await sp.text()).toBe(201)
  const space = (await sp.json()) as { id: string }
  const tr = await request.post('/api/v1/templates', {
    data: {
      name: `周报 ${slug}`,
      kind: 'note',
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
      fieldDefs: [
        {
          label: `进展${slug}`,
          type: 'select',
          options: [
            { name: '顺利', color: 'green' },
            { name: '受阻', color: 'red' },
          ],
        },
      ],
    },
    headers: sameSite,
  })
  expect(tr.status(), await tr.text()).toBe(201)
  const tpl = (await tr.json()) as Tpl
  const key = tpl.fieldDefs[0]?.key ?? ''
  const mk = (title: string, fields: Record<string, unknown>) =>
    createEntry(request, { kind: 'note', title, spaceId: space.id, templateId: tpl.id, fields })
  const ids = [
    await mk('周报一', { [key]: '顺利' }),
    await mk('周报二', { [key]: '受阻' }),
    await mk('周报三', { [key]: '受阻' }),
    await mk('周报四', {}),
  ]

  // 没选类型：没有属性筛选；选中「随笔」后出现模板属性的筛选下拉
  await page.goto(`/spaces/${slug}/entries`)
  await expect(page.getByTestId('entry-row')).toHaveCount(4)
  await expect(page.getByTestId(`field-filter-${key}`)).toHaveCount(0)
  await page.locator('[data-kind-filter="note"]').click()
  const filter = page.getByTestId(`field-filter-${key}`)
  await expect(filter).toBeVisible()
  await filter.selectOption('受阻')
  await expect(page).toHaveURL(new RegExp(`fields=${key}`))
  await expect(page.getByTestId('entry-row')).toHaveCount(2)
  await expect(page.getByTestId('entry-table')).not.toContainText('周报一')
  await filter.selectOption('')
  await expect(page.getByTestId('entry-row')).toHaveCount(4)

  // 分组：按模板属性分三组（顺利 1 / 受阻 2 / 未填写 1），组序 = 选项顺序，缺值在最后
  await page.getByTestId('entries-group').selectOption(key)
  const groups = page.getByTestId('entry-group')
  await expect(groups).toHaveCount(3)
  await expect(groups.nth(0)).toContainText('顺利')
  await expect(groups.nth(0).getByTestId('entry-group-count')).toHaveText('1')
  await expect(groups.nth(1)).toContainText('受阻')
  await expect(groups.nth(1).getByTestId('entry-group-count')).toHaveText('2')
  await expect(groups.nth(2)).toContainText('未填写')

  // 刷新后筛选 / 分组仍在（选项不依赖已加载的行）
  await page.reload()
  await expect(page.getByTestId('entries-group')).toHaveValue(key)
  await expect(page.getByTestId('entry-group')).toHaveCount(3)

  for (const id of ids) await request.delete(`/api/v1/entries/${id}`, { headers: sameSite })
  await request.delete(`/api/v1/templates/${tpl.id}`, { headers: sameSite })
  await request.delete(`/api/v1/spaces/${space.id}`, { headers: sameSite })
})
