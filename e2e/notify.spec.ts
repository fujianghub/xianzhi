/** 事件 → 通知 → SSE 铃铛（REQ-NOTIF-002）。owner 转让给 member 再由 member 转回：第二次转让的接收者含 owner。 */
import { expect, test } from '@playwright/test'
import { BASE, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

test('REQ-NOTIF-002 事件后 2s 内铃铛 +1', async ({ page, playwright }) => {
  const owner = await playwright.request.newContext({ baseURL: BASE, storageState: STATE.owner })
  const member = await playwright.request.newContext({ baseURL: BASE, storageState: STATE.member })
  const me = (await (await member.get('/api/v1/me')).json()) as { id: string }
  const ownerMe = (await (await owner.get('/api/v1/me')).json()) as { id: string }
  await page.goto('/today')
  const bell = page.getByTestId('bell-count')
  const before = Number((await bell.textContent({ timeout: 5000 }).catch(() => '0')) || '0')
  expect(
    (
      await owner.post('/api/v1/workspace/owner-transfer', {
        data: { toUserId: me.id },
        headers: sameSite,
      })
    ).status(),
  ).toBe(204)
  expect(
    (
      await member.post('/api/v1/workspace/owner-transfer', {
        data: { toUserId: ownerMe.id },
        headers: sameSite,
      })
    ).status(),
  ).toBe(204)
  await expect(bell).toHaveText(String(before + 1), { timeout: 2000 })
  // 转回后原 owner 之外的一方会留在 admin：复原 member 角色，免得影响后续依赖角色的用例
  await owner.patch(`/api/v1/workspace/members/${me.id}`, {
    data: { role: 'member' },
    headers: sameSite,
  })
  await owner.dispose()
  await member.dispose()
})
