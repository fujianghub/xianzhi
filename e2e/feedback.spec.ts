/** T1-031 状态胶囊形变 Toast（REQ-UI-008，e2e + visual）。 */
import { expect, type Page, test } from '@playwright/test'
import { BASE, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

async function triggerExport(page: Page) {
  const r = await page.request.post(`${BASE}/api/v1/exports`, {
    data: { scope: 'workspace', format: 'zip' },
    headers: sameSite,
  })
  expect(r.status()).toBe(202)
}

test('REQ-UI-008 导出完成后胶囊展开为 Toast，约 4s 后缩回为胶囊', async ({ page }) => {
  await page.goto('/today')
  await expect(page.getByTestId('status-pill')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__gi?.realtime?.status)).toBe('open')
  await triggerExport(page)
  const toast = page.getByTestId('toast')
  await expect(toast).toBeVisible({ timeout: 20_000 })
  await expect(toast).toContainText('导出')
  const shownAt = Date.now()
  await expect(page.getByTestId('status-pill')).toHaveCount(0)
  await expect(toast).toHaveCount(0, { timeout: 8_000 })
  const visibleFor = Date.now() - shownAt
  expect(visibleFor).toBeGreaterThan(3_000)
  await expect(page.getByTestId('status-pill')).toBeVisible()
})

test('REQ-UI-008 reduced-motion 下 Toast 无 layout 形变（只淡入）', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/design?page=components')
  await page.getByTestId('toast-ok').click()
  const toast = page.getByTestId('toast')
  await expect(toast).toBeVisible()
  // 形变由 transform（scale / translate）实现；reduced-motion 下出现过程中 transform 始终为 none
  const transforms = await toast.evaluate(async (el) => {
    const seen: string[] = []
    for (let i = 0; i < 10; i++) {
      seen.push(getComputedStyle(el).transform)
      await new Promise((r) => requestAnimationFrame(r))
    }
    return seen
  })
  expect(transforms.every((t) => t === 'none')).toBe(true)
})

test('REQ-UI-008 visual：胶囊 / 成功 Toast / 错误 Toast 三态截图', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('xz:theme', 'light'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/design?page=components')
  const host = page.getByTestId('status-pill-host')
  await expect(page.getByTestId('status-pill')).toBeVisible()
  await expect(host).toHaveScreenshot('toast-pill.png')
  await page.getByTestId('toast-ok').click()
  await expect(page.getByTestId('toast')).toBeVisible()
  await expect(host).toHaveScreenshot('toast-success.png')
  await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 8_000 })
  await page.getByTestId('toast-error').click()
  await expect(page.getByTestId('toast')).toHaveAttribute('role', 'alert')
  await expect(host).toHaveScreenshot('toast-error.png')
})
