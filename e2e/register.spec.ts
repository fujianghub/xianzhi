/** ADR-0008 开放注册 + 待审批 + 用户名登录（REQ-AUTH-017 · 018 · 020）。 */
import { expect, test } from '@playwright/test'
import { STATE, solveCaptcha } from './helpers.ts'

test('REQ-AUTH-017 · 018 · 020 申请注册 → 待审批不能登录 → owner 批准 → 用户名登录', async ({
  browser,
}) => {
  const stamp = Date.now().toString(36)
  const u = {
    email: `reg-${stamp}@e2e.local`,
    username: `Reg_${stamp}`,
    name: `注册者${stamp}`,
    password: 'reg-pass-1',
  }
  const anon = await browser.newContext()
  const page = await anon.newPage()
  await page.goto('/login')
  await page.getByTestId('go-register').click()
  await expect(page).toHaveURL(/\/register/)
  await page.getByLabel('邮箱', { exact: true }).fill(u.email)
  await page.getByLabel('用户名', { exact: true }).fill(u.username)
  await page.getByLabel('显示名', { exact: true }).fill(u.name)
  await page.getByLabel(/设置密码/).fill(u.password)
  await solveCaptcha(page)
  await page.getByTestId('register-submit').click()
  await expect(page.getByText('申请已提交')).toBeVisible()

  // 待审批：用户名 + 正确密码 → 提示待审批
  await page.goto('/login')
  await page.getByLabel('邮箱或用户名').fill(u.username.toLowerCase())
  await page.getByLabel('密码', { exact: true }).fill(u.password)
  await solveCaptcha(page)
  await page.getByTestId('login-submit').click()
  await expect(page.getByRole('alert')).toContainText('等待管理员审批')

  // owner 批准
  const owner = await browser.newContext({ storageState: STATE.owner })
  const op = await owner.newPage()
  await op.goto('/settings/workspace/members?tab=requests')
  const row = op.getByTestId('join-request-row').filter({ hasText: u.email })
  await expect(row).toContainText(`@${u.username}`)
  await row.getByTestId('join-approve').click()
  await expect(row).toHaveCount(0)
  await owner.close()

  // 用户名（大写）登录成功
  await page.goto('/login')
  await page.getByLabel('邮箱或用户名').fill(u.username.toUpperCase())
  await page.getByLabel('密码', { exact: true }).fill(u.password)
  await solveCaptcha(page)
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/today')
  await anon.close()
})
