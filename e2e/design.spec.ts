/** 设计画廊（REQ-UI-004 · 039 · 040，ADR-0020）：member 404；admin 在设置内可见；截图基线差 ≤ 0.1%（日场固定）。 */
import { expect, test } from '@playwright/test'
import { STATE } from './helpers.ts'

test.describe('member', () => {
  test.use({ storageState: STATE.member })
  test('REQ-UI-004 REQ-UI-039 member 访问画廊 → 404，设置导航无入口', async ({ page }) => {
    await page.goto('/settings/design')
    await expect(page.getByTestId('not-found')).toBeVisible()
    await expect(page.getByTestId('design')).toHaveCount(0)
    await page.goto('/design')
    await expect(page.getByTestId('not-found')).toBeVisible()
    await page.goto('/settings')
    await expect(page.getByTestId('settings-nav')).toBeVisible()
    await expect(page.getByTestId('nav-design')).toHaveCount(0)
  })
})

test.describe('admin', () => {
  test.use({ storageState: STATE.owner })
  for (const p of ['tokens', 'materials', 'depth', 'switch']) {
    test(`REQ-UI-004 admin 可见画廊 ${p} 页，截图与基线差 ≤ 0.1%`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('xz:theme', 'light'))
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(`/settings/design?page=${p}`)
      const g = page.getByTestId('design')
      await expect(g).toHaveAttribute('data-page', p)
      await page.evaluate(() => document.fonts.ready)
      // 吸顶顶栏压在画廊上：通知未读数随库里数据变化，遮罩铃铛，基线不依赖累积数据
      await expect(g).toHaveScreenshot(`design-${p}.png`, { mask: [page.getByTestId('bell')] })
    })
  }

  test('REQ-UI-039 入口在设置「工作区」组，主侧栏无；旧 /design 带参数跳转', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByTestId('sidebar').getByRole('link', { name: '设计画廊' })).toHaveCount(0)
    await page.getByTestId('nav-design').click()
    await expect(page).toHaveURL(/\/settings\/design$/)
    await expect(page.getByTestId('design')).toHaveAttribute('data-page', 'tokens')
    await expect(page.getByTestId('nav-design')).toHaveAttribute('aria-current', 'page')

    await page.goto('/design?page=depth&theme=both')
    await expect(page).toHaveURL(/\/settings\/design\?.*page=depth/)
    await expect(page).toHaveURL(/theme=both/)
    await expect(page.getByTestId('design')).toHaveAttribute('data-page', 'depth')
    await expect(page.getByTestId('settings-nav')).toBeVisible()
  })

  test('REQ-UI-040 工具栏：主题并排、动效档位与降低透明度写进 URL，离开画廊恢复', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.removeItem('xz:motion'))
    await page.goto('/settings/design?page=materials')
    await expect(page.getByTestId('design-hint')).not.toBeEmpty()

    await page.getByTestId('design-theme-both').click()
    await expect(page).toHaveURL(/theme=both/)
    await expect(page.locator('[data-testid=design] [data-theme]')).toHaveCount(2)

    await page.getByTestId('design-motion-reduce').click()
    await expect(page).toHaveURL(/motion=reduce/)
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce')

    await page.getByTestId('design-theme-current').click()
    await page.getByLabel('模拟降低透明度').first().check()
    await expect(page).toHaveURL(/transparency=reduce/)
    const blur = await page
      .locator('[data-material=glass]')
      .first()
      .evaluate((el) => getComputedStyle(el).backdropFilter)
    expect(blur).toBe('none')

    // 离开画廊：两个临时覆盖都撤掉
    await page.getByTestId('settings-nav').getByRole('link').first().click()
    await expect(page.getByTestId('design')).toHaveCount(0)
    await expect(page.locator('html')).not.toHaveAttribute('data-motion', /.*/)
    await expect(page.locator('html')).not.toHaveAttribute('data-transparency', /.*/)
  })

  test('REQ-UI-040 Token 页对比度表按当前主题计算且达标；组件页含领域组件', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.goto(`/settings/design?page=tokens&theme=${theme}`)
      const row = page.locator('[data-testid=design-contrast] [data-pair="fg/bg"]')
      await expect(row).toHaveAttribute('data-ok', 'true')
      await expect(page.locator('[data-testid=design-contrast] [data-ok=false]')).toHaveCount(0)
    }
    await page.goto('/settings/design?page=components')
    const domain = page.getByTestId('design-domain')
    await expect(domain).toBeVisible()
    await expect(domain.locator('.xz-seal')).toHaveCount(3)
    await expect(domain.locator('.xz-guide').first()).toBeAttached()
  })
})
