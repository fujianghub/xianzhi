/** 认证与邀请（REQ-AUTH-001 · 003 · 004 · 006、REQ-NOTIF-009）。 */
import { expect, type Page, test } from '@playwright/test'
import {
  BASE,
  login,
  MEMBER,
  mailTo,
  OWNER,
  STATE,
  sameSite,
  solveCaptcha,
  totp,
} from './helpers.ts'

async function signOut(page: Page) {
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.waitForURL('**/login**')
}

test('REQ-AUTH-001 登录成功跳 /today；密码错误统一提示「邮箱或密码不正确」', async ({ page }) => {
  await login(page, { email: OWNER.email, password: 'wrong-password-000' })
  await expect(page.getByRole('alert')).toHaveText('邮箱或密码不正确')
  await page.getByLabel('密码', { exact: true }).fill(OWNER.password)
  await solveCaptcha(page) // 失败后旧题已被消费，换了新题（REQ-AUTH-016）
  await page.getByTestId('login-submit').click()
  await page.waitForURL('**/today')
  await expect(page.getByTestId('today')).toBeVisible()
})

test('REQ-AUTH-003 · REQ-NOTIF-009 邀请 → Mailpit 收到邀请邮件 → 设密码 → 登录；REQ-AUTH-004 再次打开提示已使用', async ({
  page,
  playwright,
  browser,
}) => {
  const owner = await playwright.request.newContext({ baseURL: BASE, storageState: STATE.owner })
  const email = `invitee-${Date.now()}@e2e.local`
  const r = await owner.post('/api/v1/workspace/invitations', {
    data: { email, role: 'member' },
    headers: sameSite,
  })
  expect(r.status()).toBe(201)
  const mail = await mailTo(owner, email)
  expect(mail.Subject).toContain('邀请你加入')
  const link = /http:\/\/localhost:3011\/invite\/[0-9a-f-]+/.exec(mail.Text)?.[0]
  expect(link).toBeTruthy()
  await page.goto(link as string)
  await expect(page.getByTestId('invite')).toContainText('成员')
  await page.getByLabel(/请输入收到邀请的邮箱/).fill(email)
  await page.getByLabel('显示名').fill('新成员')
  await page.getByLabel(/设置密码/).fill('invitee-password-1')
  await page.getByTestId('invite-accept').click()
  await page.waitForURL('**/today')
  await expect(page.getByTestId('app-shell')).toBeVisible()
  const again = await browser.newPage()
  await again.goto(link as string)
  await expect(again.getByTestId('invite-error')).toContainText('邀请已使用')
  await again.close()
  await owner.dispose()
})

test('REQ-AUTH-006 开启 2FA 后登录需 TOTP；恢复码一次性', async ({ page, playwright }) => {
  const owner = await playwright.request.newContext({ baseURL: BASE, storageState: STATE.owner })
  const email = `twofa-${Date.now()}@e2e.local`
  const password = 'twofa-password-1'
  const inv = await owner.post('/api/v1/workspace/invitations', {
    data: { email, role: 'member' },
    headers: sameSite,
  })
  const { id } = (await inv.json()) as { id: string }
  const anon = await playwright.request.newContext({ baseURL: BASE })
  expect(
    (
      await anon.post(`/api/v1/workspace/invitations/${id}/accept`, {
        data: { email, name: 'TwoFA', password },
        headers: sameSite,
      })
    ).status(),
  ).toBe(201)

  await login(page, { email, password })
  await page.waitForURL('**/today')
  await page.goto('/settings/security')
  await page.getByLabel('输入当前密码以确认').fill(password)
  await page.getByTestId('twofa-toggle').click()
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? ''
  expect(secret).toMatch(/^[A-Z2-7]+=*$/)
  await page.getByLabel('验证码').fill(totp(secret))
  await page.getByTestId('totp-verify').click()
  await expect(page.getByTestId('backup-codes').locator('li')).toHaveCount(10)
  const codes = (await page.getByTestId('backup-codes').locator('li').allTextContents()).map((c) =>
    c.trim(),
  )
  expect(codes).toHaveLength(10)

  await signOut(page)
  await login(page, { email, password })
  await page.waitForURL('**/login/2fa**')
  await page.getByLabel('验证码').fill(totp(secret))
  await page.getByTestId('twofa-submit').click()
  await page.waitForURL('**/today')

  // 恢复码：第一次可用，第二次失效
  for (const expectOk of [true, false]) {
    await signOut(page)
    await login(page, { email, password })
    await page.waitForURL('**/login/2fa**')
    await page.getByRole('button', { name: '改用恢复码' }).click()
    await page.getByLabel('恢复码').fill(codes[0] as string)
    await page.getByTestId('twofa-submit').click()
    if (expectOk) await page.waitForURL('**/today')
    else await expect(page.getByRole('alert')).toHaveText('验证码不正确')
  }
  await owner.dispose()
  await anon.dispose()
})

test('REQ-AUTH-008 魔法链接：已注册邮箱收到邮件，点击一次登录成功，再点失效', async ({
  page,
  browser,
  playwright,
}) => {
  const req = await playwright.request.newContext({ baseURL: BASE })
  const email = OWNER.email
  const since = Date.now()
  await page.goto('/login')
  await page.getByLabel('邮箱').fill(email)
  await page.getByRole('button', { name: '发送登录链接' }).click()
  await expect(page.getByRole('status')).toContainText('登录链接已发送')
  let link = ''
  for (let i = 0; i < 40 && !link; i++) {
    const r = (await (
      await req.get(
        `http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${email} subject:登录链接`)}`,
      )
    ).json()) as { messages: { ID: string; Created: string }[] }
    const m = r.messages.find((x) => new Date(x.Created).getTime() >= since - 1000)
    if (m)
      link =
        /https?:\/\/\S+/.exec(
          (
            (await (await req.get(`http://localhost:8025/api/v1/message/${m.ID}`)).json()) as {
              Text: string
            }
          ).Text,
        )?.[0] ?? ''
    else await page.waitForTimeout(250)
  }
  expect(link).toContain('/api/auth/magic-link/verify')
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(link)
  await p.waitForURL('**/today')
  await ctx.close()
  const ctx2 = await browser.newContext()
  const p2 = await ctx2.newPage()
  await p2.goto(link)
  await expect(p2).not.toHaveURL(/\/today$/)
  await ctx2.close()
  await req.dispose()
})

test('REQ-AUTH-007 注册通行密钥后可无密码登录（虚拟认证器）', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  await login(page, MEMBER)
  await page.waitForURL('**/today')
  await page.goto('/settings/security')
  await page.getByRole('button', { name: '添加通行密钥' }).click()
  await expect(
    page.locator('section').filter({ hasText: '通行密钥' }).locator('li'),
  ).not.toHaveText(['还没有通行密钥'])
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByRole('button', { name: '通行密钥' }).click()
  await page.waitForURL('**/today')
  expect((await (await page.request.get('/api/v1/me')).json()).email).toBe(MEMBER.email)
})
