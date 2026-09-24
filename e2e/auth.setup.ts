import { test as setup } from '@playwright/test'
import { login, MEMBER, OWNER, STATE } from './helpers.ts'

setup('登录 owner 与 member 并保存会话', async ({ browser }) => {
  for (const [u, file] of [
    [OWNER, STATE.owner],
    [MEMBER, STATE.member],
  ] as const) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page, u)
    await page.waitForURL('**/today')
    await ctx.storageState({ path: file })
    await ctx.close()
  }
})
