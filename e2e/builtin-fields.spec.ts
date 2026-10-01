/**
 * ADR-0042 内置字段覆盖层（REQ-ENTRY-034 · 036）。
 * 覆盖是工作区级的、xz_e2e 各实例共用：只动没有别的用例断言的「产品优化」类型，用完在 finally 里复位。
 */
import { expect, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

test('REQ-ENTRY-034 · 036 设置里隐藏「衡量指标」、改「目标值」显示名 → 空间概览表格与属性栏随之变化，值保留', async ({
  page,
  request,
}) => {
  const slug = `bf-${stamp()}`
  const sp = await request.post('/api/v1/spaces', {
    data: { name: `字段 ${slug}`, slug, kind: 'project', visibility: 'workspace' },
    headers: sameSite,
  })
  expect(sp.status()).toBe(201)
  const space = (await sp.json()) as { id: string }
  const id = await createEntry(request, {
    spaceId: space.id,
    kind: 'optimize',
    title: `优化 ${slug}`,
    fields: { status: 'doing', metric: '首屏时间', target: '< 1s' },
  })
  const reset = () =>
    request.patch('/api/v1/entry-types/builtin/optimize', {
      data: { baseFields: null, fieldOrder: null },
      headers: sameSite,
    })
  try {
    await page.goto('/settings/types')
    const row = page.locator('[data-testid="builtin-row"][data-kind="optimize"]')
    await row.getByTestId('builtin-fields-toggle').click()
    const fields = row.getByTestId('builtin-fields')
    await fields
      .locator('[data-testid="builtin-field-row"][data-field="metric"]')
      .getByTestId('builtin-field-visibility')
      .click()
    await fields
      .locator('[data-testid="builtin-field-row"][data-field="target"]')
      .getByTestId('builtin-field-label')
      .fill('期望值')
    await fields.getByTestId('builtin-fields-save').click()
    await expect(
      fields.locator('[data-testid="builtin-field-row"][data-field="metric"]'),
    ).toHaveAttribute('data-hidden', '')

    // 空间概览：产品优化页签的表格没有「衡量指标」列，「目标值」列改叫「期望值」
    await page.goto(`/spaces/${slug}/home?type=optimize`)
    const section = page.getByTestId('kb-type-section')
    const table = section.getByTestId('entry-table')
    await expect(table.locator(`[data-entry-id="${id}"]`)).toBeVisible()
    await expect(table.locator('thead')).toContainText('期望值')
    await expect(table.locator('thead')).not.toContainText('衡量指标')
    await expect(table.locator('td[data-field="metric"]')).toHaveCount(0)

    // 属性栏：不再有衡量指标；值仍在库里
    await page.goto(`/entries/${id}`)
    const props = page.getByTestId('entry-properties')
    await expect(props.locator('[data-field="target"]')).toBeVisible()
    await expect(props.locator('[data-field="metric"]')).toHaveCount(0)
    const got = await request.get(`/api/v1/entries/${id}`)
    expect(((await got.json()) as { fields: Record<string, unknown> }).fields.metric).toBe(
      '首屏时间',
    )
  } finally {
    expect((await reset()).status()).toBe(200)
  }
  await page.goto(`/entries/${id}`)
  await expect(page.getByTestId('entry-properties').locator('[data-field="metric"]')).toBeVisible()
})
