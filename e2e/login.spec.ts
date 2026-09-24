/** 登录页：拼图滑块（REQ-AUTH-016，ADR-0006）与未登录主题选择（REQ-UI-001）。 */
import { expect, type Page, test } from '@playwright/test'
import { OWNER, solveCaptcha } from './helpers.ts'

async function fill(page: Page) {
  await page.goto('/login')
  await page.getByLabel('邮箱').fill(OWNER.email)
  await page.getByLabel('密码', { exact: true }).fill(OWNER.password)
}

test('REQ-AUTH-016 未解开拼图不可提交；拖到错误位置提交提示失败并自动换题；随后正确拼图可登录', async ({
  page,
}) => {
  await fill(page)
  await expect(page.getByTestId('login-submit')).toBeDisabled()
  const box = page.getByTestId('captcha')
  await expect(box).toHaveAttribute('data-debug-x', /^\d+$/)
  const firstPiece = await page.getByTestId('captcha-piece').getAttribute('src')

  // 故意拖偏：答案 ±30px 以外
  const x = Number(await box.getAttribute('data-debug-x'))
  const handle = page.getByTestId('captcha-handle')
  const max = Number(await handle.getAttribute('aria-valuemax'))
  const hb = await handle.boundingBox()
  const tb = await handle.locator('..').boundingBox()
  if (!hb || !tb) throw new Error('no handle')
  const wrong = x > max / 2 ? x - 40 : x + 40
  await page.waitForTimeout(700)
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2 + (wrong / max) * (tb.width - hb.width), hb.y + 20, {
    steps: 8,
  })
  await page.mouse.up()
  await expect(page.getByTestId('login-submit')).toBeEnabled()
  await page.getByTestId('login-submit').click()
  await expect(page.getByRole('alert')).toHaveText('滑块验证未通过，请重新拼一次')
  await expect(page.getByTestId('captcha-piece')).not.toHaveAttribute('src', firstPiece ?? '')

  await solveCaptcha(page)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/today')
})

test('REQ-AUTH-016 键盘可完成拼图：Tab 到滑块，Shift+→ 与 → 调位，Enter 确认', async ({ page }) => {
  await fill(page)
  const box = page.getByTestId('captcha')
  await expect(box).toHaveAttribute('data-debug-x', /^\d+$/)
  const x = Number(await box.getAttribute('data-debug-x'))
  const handle = page.getByTestId('captcha-handle')
  await page.waitForTimeout(700)
  await handle.focus()
  for (let i = 0; i < Math.floor(x / 10); i++) await page.keyboard.press('Shift+ArrowRight')
  for (let i = 0; i < x % 10; i++) await page.keyboard.press('ArrowRight')
  await expect(handle).toHaveAttribute('aria-valuenow', String(x))
  await page.keyboard.press('Enter')
  await expect(box).toHaveAttribute('data-solved', 'true')
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/today')
})

test('REQ-UI-001 登录页默认跟随系统主题；未登录可在右上角切换并持久化', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/login')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByTestId('theme-menu').click()
  await page.getByTestId('theme-menu-light').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => localStorage.getItem('xz:theme'))).toBe('light')
  await page.getByTestId('theme-menu').click()
  await page.getByTestId('theme-menu-system').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => localStorage.getItem('xz:theme'))).toBeNull()
})
