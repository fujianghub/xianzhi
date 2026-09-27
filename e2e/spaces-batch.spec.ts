/** ADR-0021 空间批量管理（REQ-SPACE-010 ~ 012）：/spaces 多选 · Shift 连选 · 归档撤销 · 移到大类 · 删除确认计数 · 回收站批量永久删除。 */
import { type APIRequestContext, expect, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const post = async (req: APIRequestContext, url: string, data: Record<string, unknown>) => {
  const r = await req.post(url, { data, headers: sameSite })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()) as { id: string; slug: string }
}

test('REQ-SPACE-010 · 011 · 012 批量管理：Shift 连选 → 归档并撤销 → 移到大类 → 删除（计数确认）→ 回收站批量永久删除', async ({
  page,
  request,
}) => {
  const stamp = Date.now().toString(36)
  // 专用大类：分区里只有这几个空间，不依赖共用库里累积的数据
  const g = await post(request, '/api/v1/space-groups', { name: `批量 ${stamp}` })
  const g2 = await post(request, '/api/v1/space-groups', { name: `批量目标 ${stamp}` })
  const sp = []
  for (const n of ['A', 'B', 'C'])
    sp.push(
      await post(request, '/api/v1/spaces', {
        name: `批量 ${n} ${stamp}`,
        kind: 'project',
        groupId: g.id,
      }),
    )
  await createEntry(request, { kind: 'note', title: `批量记录 ${stamp}`, spaceId: sp[0]?.id })

  await page.goto('/spaces')
  const section = page.locator(`[data-testid="spaces-section"][data-group-id="${g.id}"]`)
  const card = (id?: string) => section.locator(`[data-testid="space-card"][data-space-id="${id}"]`)
  await expect(section.getByTestId('space-card')).toHaveCount(3)

  await page.getByTestId('spaces-batch-toggle').click()
  await expect(page.getByTestId('space-batch-bar')).toBeVisible()
  // 个人空间不可选
  await expect(page.getByTestId('spaces-personal').getByTestId('space-select')).toHaveCount(0)
  await card(sp[0]?.id).getByTestId('space-select').click()
  await card(sp[2]?.id)
    .getByTestId('space-select')
    .click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('space-batch-count')).toHaveText('已选 3 个')

  // 归档 → 分区清空；撤销 → 回来
  await page.getByTestId('space-batch-archive').click()
  await expect(section.getByTestId('space-card')).toHaveCount(0)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(section.getByTestId('space-card')).toHaveCount(3)

  // 移到另一个大类
  await section.getByTestId('spaces-select-section').click()
  await expect(page.getByTestId('space-batch-count')).toHaveText('已选 3 个')
  await page.getByTestId('space-batch-move').click()
  await page.locator(`[data-testid="space-batch-move-target"][data-group-id="${g2.id}"]`).click()
  const target = page.locator(`[data-testid="spaces-section"][data-group-id="${g2.id}"]`)
  await expect(target.getByTestId('space-card')).toHaveCount(3)
  await expect(page.getByTestId('space-batch-count')).toHaveText('已选 0 个')

  // 删除：确认弹层写明记录数
  await target.getByTestId('spaces-select-section').click()
  await page.getByTestId('space-batch-delete').click()
  const dialog = page.getByTestId('confirm-dialog')
  await expect(dialog).toContainText('删除 3 个空间')
  await expect(dialog).toContainText('1 条记录')
  await dialog.getByTestId('confirm-ok').click()
  await expect(target.getByTestId('space-card')).toHaveCount(0)

  // 回收站：勾选这三个 → 永久删除所选
  await page.goto('/trash?tab=spaces')
  for (const s of sp)
    await page
      .locator(`[data-testid="trash-row"][data-id="${s.id}"]`)
      .getByTestId('trash-select')
      .click()
  await expect(page.getByTestId('trash-batch-bar')).toContainText('已选 3 个')
  await page.getByTestId('trash-purge-many').click()
  await expect(dialog).toContainText('永久删除 3 个空间')
  await dialog.getByTestId('confirm-ok').click()
  for (const s of sp)
    await expect(page.locator(`[data-testid="trash-row"][data-id="${s.id}"]`)).toHaveCount(0)
  const left = await request.get('/api/v1/spaces?deleted=1&limit=200')
  const ids = ((await left.json()) as { items: { id: string }[] }).items.map((x) => x.id)
  for (const s of sp) expect(ids).not.toContain(s.id)
  // 收尾删掉本用例的两个大类：共用库里大类只增不减会撑高新建空间对话框（debug/2026-09-27-spaces-list-truncated-200）
  for (const id of [g.id, g2.id])
    expect(
      (await request.delete(`/api/v1/space-groups/${id}`, { headers: sameSite })).status(),
    ).toBe(204)
})
