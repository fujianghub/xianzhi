/** 燕印、字体自托管、顶栏枝线与 Dialog 光晕下压（REQ-UI-024 · 025 · 027，ADR-0005）。 */
import { expect, test } from '@playwright/test'
import { BASE, STATE } from './helpers.ts'

test.describe('已登录', () => {
  test.use({ storageState: STATE.owner })

  test('REQ-UI-024 Sidebar 品牌位为燕印（侧栏改版后 42px）；favicon 为同形燕印', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/today')
    await expect(page.getByTestId('sidebar').locator('.xz-seal.xz-seal-md')).toBeVisible()
    const svg = await (await request.get(`${BASE}/favicon.svg`)).text()
    expect(svg).toContain('<title>Xianzhi</title>')
    expect(svg).not.toContain('Growing Interlude')
  })

  test('REQ-UI-027 滚动 > 8px 顶栏出现枝线，回顶消失；Dialog 打开时光晕层下压', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 600 })
    await page.goto('/today')
    const topbar = page.getByTestId('topbar')
    await expect(topbar).not.toHaveAttribute('data-scrolled', /.*/)
    await page.evaluate(() => {
      document.body.style.minHeight = '3000px'
      window.scrollTo(0, 120)
    })
    await expect(topbar).toHaveAttribute('data-scrolled', 'true')
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(topbar).not.toHaveAttribute('data-scrolled', /.*/)

    await page.keyboard.press('?')
    await expect(page.locator('html')).toHaveAttribute('data-dialog-open', /.*/)
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body, '::before').transform))
      .not.toBe('none')
  })
})

test('REQ-UI-024 REQ-UI-025 登录页燕印 lg；字体自托管且无外部字体请求', async ({ page }) => {
  const external: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'font' && !r.url().startsWith(BASE)) external.push(r.url())
  })
  await page.goto('/login')
  await expect(page.locator('.xz-seal.xz-seal-lg')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const families = await page.evaluate(() =>
    [...document.fonts].map((f) => f.family.replace(/"/g, '')),
  )
  expect(families).toContain('MiSans')
  expect(families).toContain('LXGW WenKai Screen')
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('26px "LXGW WenKai Screen"', '衔枝')))
    .toBe(true)
  expect(external).toEqual([])
})
