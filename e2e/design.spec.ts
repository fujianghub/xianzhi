/** /design 画廊（REQ-UI-004）：member 404；admin 四页可见；截图基线差 ≤ 0.1%（日场固定）。 */
import { expect, test } from '@playwright/test'
import { STATE } from './helpers.ts'

test.describe('member', () => {
  test.use({ storageState: STATE.member })
  test('REQ-UI-004 member 访问 /design → 404', async ({ page }) => {
    await page.goto('/design')
    await expect(page.getByTestId('not-found')).toBeVisible()
    await expect(page.getByTestId('design')).toHaveCount(0)
  })
})

test.describe('admin', () => {
  test.use({ storageState: STATE.owner })
  for (const p of ['tokens', 'materials', 'depth', 'switch']) {
    test(`REQ-UI-004 admin 可见 /design ${p} 页，截图与基线差 ≤ 0.1%`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('xz:theme', 'light'))
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(`/design?page=${p}`)
      const g = page.getByTestId('design')
      await expect(g).toHaveAttribute('data-page', p)
      await page.evaluate(() => document.fonts.ready)
      await expect(g).toHaveScreenshot(`design-${p}.png`)
    })
  }
})
