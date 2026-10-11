/**
 * ADR-0059 · 0060 主题（代码里叫 skin）：REQ-UI-059（生效 / 锁定明暗 / 首帧缓存）、REQ-UI-062（设置 → 主题页 / 顶栏退出）、
 * REQ-UI-063（管理员设默认 / 恢复默认主题）、REQ-UI-064（登录页套工作区默认主题）。
 * 用合成主题包（sharp 生成纯色图）经 CLI 安装到验证实例的 DATA_DIR（默认主仓 data/e2e，XZ_E2E_DATA_DIR 可覆盖）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { appearanceSaved, resetAppearance, STATE, sameSite, setAppearancePref } from './helpers.ts'

const ID = 'e2e-skin'
const MAIN_ROOT = join(
  execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim(),
  '..',
)
const DATA_DIR = process.env.XZ_E2E_DATA_DIR ?? join(MAIN_ROOT, 'data/e2e')

test.use({ storageState: STATE.owner })
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const art = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: '#1d3557' },
  })
    .png()
    .toBuffer()
  const dir = join(DATA_DIR, 'skin-fixtures')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${ID}.codex-theme`)
  writeFileSync(
    file,
    JSON.stringify({
      format: 'codex-theme',
      manifest: {
        id: ID,
        displayName: 'E2E 夜航',
        version: '1.0.0',
        mode: 'dark',
        palette: { canvas: '#0b1728', text: '#e5edf8', accent: '#91d9f2' },
      },
      art: { filename: 'a.png', mimeType: 'image/png', base64: art.toString('base64') },
    }),
  )
  execFileSync('pnpm', ['-s', 'xz', 'skin', 'install', file, '--id', ID], {
    env: { ...process.env, DATA_DIR },
    stdio: 'pipe',
  })
})

/** 清掉工作区默认外观（共享库，用例前后都复位） */
const clearWorkspaceDefault = async (request: import('@playwright/test').APIRequestContext) => {
  const r = await request.patch('/api/v1/workspace', {
    data: { settings: { appearance: {} } },
    headers: sameSite,
  })
  expect(r.status()).toBe(200)
}

test.afterEach(async ({ request }) => {
  await resetAppearance(request)
  await clearWorkspaceDefault(request)
})

test('REQ-UI-059 选主题：data-skin 与样式表挂上、明暗锁定为主题模式、玻璃预设移除；刷新首帧即生效', async ({
  page,
  request,
}) => {
  await setAppearancePref(request, { theme: 'light', skin: ID })
  await page.goto('/tasks')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-skin', ID)
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(html).not.toHaveAttribute('data-glass', /.*/)
  await expect(page.locator('style#xz-skin')).toHaveCount(1)
  // 背景图层取自皮肤
  const bg = await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage)
  expect(bg).toContain(`/api/v1/skins/${ID}/art`)

  // 首帧：脚本执行前就已是皮肤（theme-init 读本机缓存）
  await page.reload()
  const first = await page.evaluate(() => document.documentElement.dataset.skin)
  expect(first).toBe(ID)
})

test('REQ-UI-062 设置 → 主题：画廊选 / 退主题；明暗与玻璃强度随主题锁定；顶栏按钮退出主题；个人页不再有外观项', async ({
  page,
}) => {
  await page.goto('/settings')
  await expect(page.getByTestId('profile-theme')).toHaveCount(0)
  await page.getByTestId('nav-theme').click()
  await expect(page).toHaveURL(/\/settings\/theme$/)
  const card = page.getByTestId(`skin-card-${ID}`)
  await expect(card).toBeVisible()
  await expect(card).toContainText('E2E 夜航')
  let saved = appearanceSaved(page)
  await card.click()
  await saved
  await expect(page.locator('html')).toHaveAttribute('data-skin', ID)
  await expect(card).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('profile-theme')).toBeDisabled()
  await expect(page.getByTestId('profile-glass')).toBeDisabled()

  const toggle = page.getByTestId('theme-toggle')
  await expect(toggle).toHaveAttribute('aria-label', '退出主题')
  saved = appearanceSaved(page)
  await toggle.click()
  await saved
  await expect(page.locator('html')).not.toHaveAttribute('data-skin', /.*/)
  await expect(page.locator('style#xz-skin')).toHaveCount(0)
  await expect(page.getByTestId('skin-card-none')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('profile-theme')).toBeEnabled()
  await expect(toggle).toHaveAttribute('aria-label', '切换明暗')
})

test('REQ-UI-063 管理员在卡片上设为默认：没选过的成员即用它；个人「恢复默认主题」回到工作区默认', async ({
  page,
  browser,
}) => {
  await page.goto('/settings/theme')
  const done = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/workspace') && r.request().method() === 'PATCH',
  )
  await page.getByTestId(`skin-set-default-${ID}`).click()
  expect((await done).status()).toBe(200)
  await expect(page.getByTestId(`skin-item-${ID}`).getByTestId('skin-default-badge')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-skin', ID)

  // 成员：没单独选过 → 默认主题；且看不到「设为默认」
  const ctx = await browser.newContext({ storageState: STATE.member })
  const m = await ctx.newPage()
  await resetAppearance(m.request)
  await m.goto('/settings/theme')
  await expect(m.locator('html')).toHaveAttribute('data-skin', ID)
  await expect(m.locator('[data-testid^="skin-set-default-"]')).toHaveCount(0)
  // 成员自己选「衔枝原生」盖过默认，再「恢复默认主题」
  let saved = appearanceSaved(m)
  await m.getByTestId('skin-card-none').click()
  await saved
  await expect(m.locator('html')).not.toHaveAttribute('data-skin', /.*/)
  saved = appearanceSaved(m)
  await m.getByTestId('skin-restore-default').click()
  await saved
  await expect(m.locator('html')).toHaveAttribute('data-skin', ID)
  await expect(m.getByTestId('skin-restore-default')).toHaveCount(0)
  await resetAppearance(m.request)
  await ctx.close()
})

test('REQ-UI-064 登录页套工作区默认主题；未设默认时为原生，且未登录读不到其它主题的图', async ({
  browser,
  request,
}) => {
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const p = await anon.newPage()
  await p.goto('/login')
  await expect(p.getByTestId('captcha')).toBeVisible()
  await expect(p.locator('html')).not.toHaveAttribute('data-skin', /.*/)
  expect((await p.request.get(`/api/v1/skins/${ID}/art`)).status()).toBe(401)

  const r = await request.patch('/api/v1/workspace', {
    data: { settings: { appearance: { skin: ID } } },
    headers: sameSite,
  })
  expect(r.status()).toBe(200)
  await p.reload()
  await expect(p.locator('html')).toHaveAttribute('data-skin', ID)
  await expect(p.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect((await p.request.get(`/api/v1/skins/${ID}/art`)).status()).toBe(200)
  // 首帧：再刷新时 theme-init 直接读 xz:skin-default
  await p.reload()
  expect(await p.evaluate(() => document.documentElement.dataset.skin)).toBe(ID)
  await anon.close()
})
