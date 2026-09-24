/** REQ-NOTIF-003（浏览器侧）：第 4 个标签页挤掉最旧连接且被挤页面不重连；断开期间的帧在重连时按 lastEventId 补发。 */
import { expect, type Page, test } from '@playwright/test'
import { BASE, STATE, sameSite } from './helpers.ts'

type GiWindow = Window & {
  __gi?: { realtime?: { status: string; frames: number; close: () => void; reconnect: () => void } }
}
test.use({ storageState: STATE.owner })
const status = (p: Page) => p.evaluate(() => (window as GiWindow).__gi?.realtime?.status ?? null)

test('REQ-NOTIF-003 第 4 个标签页挤掉第 1 个（evicted 后不再重连）；断线重连带 lastEventId 补发期间的帧', async ({
  context,
  playwright,
}) => {
  const pages: Page[] = []
  for (let i = 0; i < 4; i++) {
    const p = await context.newPage()
    await p.goto('/today')
    await expect.poll(() => status(p)).toBe('open')
    pages.push(p)
  }
  const [first, second] = pages as [Page, Page, Page, Page]
  await expect.poll(() => status(first)).toBe('evicted')
  await first.waitForTimeout(2500) // 退避窗口内不应自行重连
  expect(await status(first)).toBe('evicted')
  for (const p of pages.slice(1)) expect(await status(p)).toBe('open')

  // 断线期间发生事件 → 重连时补发
  const owner = await playwright.request.newContext({ baseURL: BASE, storageState: STATE.owner })
  const member = await playwright.request.newContext({ baseURL: BASE, storageState: STATE.member })
  const memberId = ((await (await member.get('/api/v1/me')).json()) as { id: string }).id
  const ownerId = ((await (await owner.get('/api/v1/me')).json()) as { id: string }).id
  const bell = second.getByTestId('bell-count')
  const before = Number((await bell.textContent().catch(() => '0')) || '0')
  const framesBefore = await second.evaluate(() => (window as GiWindow).__gi?.realtime?.frames ?? 0)
  await second.evaluate(() => (window as GiWindow).__gi?.realtime?.close())
  expect(
    (
      await owner.post('/api/v1/workspace/owner-transfer', {
        data: { toUserId: memberId },
        headers: sameSite,
      })
    ).status(),
  ).toBe(204)
  expect(
    (
      await member.post('/api/v1/workspace/owner-transfer', {
        data: { toUserId: ownerId },
        headers: sameSite,
      })
    ).status(),
  ).toBe(204)
  await second.waitForTimeout(1500) // 期间帧进入服务端缓冲
  await second.evaluate(() => (window as GiWindow).__gi?.realtime?.reconnect())
  await expect
    .poll(() => second.evaluate(() => (window as GiWindow).__gi?.realtime?.frames ?? 0))
    .toBeGreaterThan(framesBefore)
  await expect(bell).toHaveText(String(before + 1))
  // 转回后原 owner 之外的一方会留在 admin：复原 member 角色，免得影响后续依赖角色的用例
  await owner.patch(`/api/v1/workspace/members/${memberId}`, {
    data: { role: 'member' },
    headers: sameSite,
  })
  await owner.dispose()
  await member.dispose()
})
