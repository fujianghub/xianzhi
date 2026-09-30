/**
 * ADR-0036 空间类型 · 字段定义（REQ-KB-014 · 015 · 016、REQ-ENTRY-027）与 ADR-0035 元数据配色（REQ-UI-044）。
 * 每个用例自建空间，不依赖共用库 xz_e2e 里累积的数据。
 */
import { type APIRequestContext, expect, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
async function mkSpace(req: APIRequestContext) {
  const slug = `st-${stamp()}`
  const r = await req.post('/api/v1/spaces', {
    data: { name: `类型 ${slug}`, slug, kind: 'project', visibility: 'workspace' },
    headers: sameSite,
  })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()) as { id: string; slug: string; name: string }
}

test('REQ-KB-014 · 015 · REQ-ENTRY-027 在空间里新建空间类型并加单选字段 → 成为首页页签，表格里就地改该字段', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  await page.goto(`/spaces/${s.slug}/home`)
  await page.getByTestId('kb-manage-types').click()
  const dlg = page.getByTestId('space-types-dialog')
  await dlg.getByTestId('space-type-new-name').fill('需求')
  await dlg.getByTestId('space-type-new-name').press('Enter')
  // 新类型自动启用、选中，右侧可编辑字段
  const item = dlg.locator('[data-testid="space-type-item"][data-enabled="1"]', { hasText: '需求' })
  await expect(item).toBeVisible()
  const editor = dlg.getByTestId('space-type-editor')
  await editor.getByTestId('field-def-add').click()
  const def = editor.getByTestId('field-def-row').last()
  await def.getByTestId('field-def-label').fill('阶段')
  await def.getByTestId('field-def-type').selectOption('select')
  await def.getByTestId('field-option-name').first().fill('设计')
  await def.getByTestId('field-option-add').click()
  await def.getByTestId('field-option-name').last().fill('上线')
  await editor.getByTestId('type-fields-save').click()
  await expect(page.getByText('已保存类型').first()).toBeVisible()

  const types = (await (await request.get('/api/v1/entry-types')).json()) as {
    items: { id: string; name: string; spaceId: string | null; fieldDefs: { key: string }[] }[]
  }
  const ty = types.items.find((x) => x.spaceId === s.id && x.name === '需求')
  const key = ty?.fieldDefs[0]?.key ?? ''
  expect(key).toMatch(/^x[A-Z]{6}$/)
  await page.keyboard.press('Escape')

  const id = await createEntry(request, {
    kind: 'custom',
    typeId: ty?.id,
    title: '登录页改版',
    spaceId: s.id,
  })
  await page.goto(`/spaces/${s.slug}/home?type=${ty?.id}`)
  await expect(page.getByTestId('kb-type-tabs').locator(`[data-key="${ty?.id}"]`)).toContainText(
    '1',
  )
  const row = page.getByTestId('kb-type-section').locator(`[data-entry-id="${id}"]`)
  await row.getByTestId(`cell-${key}`).click()
  await page.getByTestId(`field-editor-${key}`).locator('[data-value="上线"]').click()
  await expect
    .poll(async () => {
      const r = await request.get(`/api/v1/entries/${id}`)
      return ((await r.json()) as { fields: Record<string, unknown> }).fields[key]
    })
    .toBe('上线')
  // 同步到文档：记录页属性面板显示该值
  await page.goto(`/entries/${id}`)
  await expect(page.getByTestId(`entry-prop-${key}`)).toContainText('上线')
})

test('REQ-UI-044 属性面板配色：优先级 / 截止类日期带色调', async ({ page, request }) => {
  const s = await mkSpace(request)
  const past = '2020-01-01'
  const id = await createEntry(request, {
    kind: 'plan',
    title: '过期计划',
    spaceId: s.id,
    fields: { status: 'active', endDate: past, startDate: past },
  })
  await page.goto(`/entries/${id}`)
  const props = page.getByTestId('entry-properties')
  // 截止类日期已过期 → 红；起始类 → 青
  await expect(props.locator(`[data-field="endDate"] [data-tone]`)).toHaveAttribute(
    'data-tone',
    'red',
  )
  await expect(props.locator(`[data-field="startDate"] [data-tone]`)).toHaveAttribute(
    'data-tone',
    'cyan',
  )
  await expect(props.locator('[data-field="status"] [data-status="active"]')).toHaveClass(
    /xz-tone-orange/,
  )
})
