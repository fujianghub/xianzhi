/** ADR-0022 合并空间（REQ-SPACE-015）：卡片 ⋯「合并到…」→ 选目标 → 预览计数与可见性警告 → 合并 → 源卡片消失、内容出现在目标目录。 */
import { type APIRequestContext, expect, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const post = async (req: APIRequestContext, url: string, data: Record<string, unknown>) => {
  const r = await req.post(url, { data, headers: sameSite })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()) as { id: string; slug: string }
}

test('REQ-SPACE-015 卡片菜单合并：预览写明记录 / 任务数并警告可见性扩大，合并后源空间进回收站、内容到目标目录', async ({
  page,
  request,
}) => {
  const stamp = Date.now().toString(36)
  const a = await post(request, '/api/v1/spaces', {
    name: `合并源 ${stamp}`,
    kind: 'project',
    visibility: 'members',
  })
  const b = await post(request, '/api/v1/spaces', {
    name: `合并目标 ${stamp}`,
    kind: 'project',
    visibility: 'workspace',
  })
  const e = await createEntry(request, {
    kind: 'note',
    title: `合并页 ${stamp}`,
    spaceId: a.id,
    parentId: null,
  })
  await post(request, '/api/v1/tasks', {
    title: `合并任务 ${stamp}`,
    spaceId: a.id,
    status: 'todo',
  })

  try {
    await page.goto('/spaces')
    const card = page.locator(`[data-testid="space-card"][data-space-id="${a.id}"]`)
    await card.getByTestId('space-actions').click()
    await page.getByTestId('space-merge').click()
    const dlg = page.getByTestId('merge-space-dialog')
    await expect(dlg).toBeVisible()
    // 不能选自己
    await expect(dlg.locator(`[data-testid="merge-target"][data-space-id="${a.id}"]`)).toHaveCount(
      0,
    )
    await expect(dlg.getByTestId('merge-confirm')).toBeDisabled()
    await dlg.locator(`[data-testid="merge-target"][data-space-id="${b.id}"]`).click()
    const preview = dlg.getByTestId('merge-preview')
    await expect(preview).toContainText('1 条记录、1 个任务')
    await expect(dlg.getByTestId('merge-visibility-warning')).toBeVisible()
    await dlg.getByTestId('merge-confirm').click()
    await expect(dlg).toBeHidden()
    await expect(card).toHaveCount(0)

    // 源空间在回收站；记录在目标目录
    const trash = await request.get('/api/v1/spaces?deleted=1&limit=200')
    expect(((await trash.json()) as { items: { id: string }[] }).items.map((s) => s.id)).toContain(
      a.id,
    )
    await page.getByRole('button', { name: '打开' }).click()
    await expect(page).toHaveURL(new RegExp(`/spaces/${b.slug}/home`))
    const tree = await request.get(`/api/v1/spaces/${b.id}/tree`)
    expect(((await tree.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toContain(e)
  } finally {
    // 收尾：两个空间都彻底删除，不在共用库里留数据
    await request.post('/api/v1/spaces/batch', {
      data: { op: 'delete', ids: [b.id] },
      headers: sameSite,
    })
    await request.post('/api/v1/spaces/batch', {
      data: { op: 'purge', ids: [a.id, b.id] },
      headers: sameSite,
    })
  }
})
