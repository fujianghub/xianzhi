/**
 * ADR-0059 皮肤：REQ-UI-059（生效 / 锁定日夜场 / 首帧缓存）、REQ-UI-060（设置画廊 / 顶栏退出 / 认证页不套）。
 * 用合成主题包（sharp 生成纯色图）经 CLI 安装到验证实例的 DATA_DIR（默认主仓 data/e2e，XZ_E2E_DATA_DIR 可覆盖）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { appearanceSaved, resetAppearance, STATE, setAppearancePref } from './helpers.ts'

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

test.afterEach(async ({ request }) => {
  await resetAppearance(request)
})

test('REQ-UI-059 选皮肤：data-skin 与样式表挂上、日夜场锁定为皮肤模式、玻璃预设移除；刷新首帧即生效', async ({
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

test('REQ-UI-060 设置画廊选 / 退皮肤；主题与玻璃强度随皮肤锁定；顶栏按钮退出皮肤', async ({
  page,
}) => {
  await page.goto('/settings')
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

  // 顶栏：变成「退出皮肤」
  const toggle = page.getByTestId('theme-toggle')
  await expect(toggle).toHaveAttribute('aria-label', '退出皮肤')
  saved = appearanceSaved(page)
  await toggle.click()
  await saved
  await expect(page.locator('html')).not.toHaveAttribute('data-skin', /.*/)
  await expect(page.locator('style#xz-skin')).toHaveCount(0)
  await expect(page.getByTestId('skin-card-none')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('profile-theme')).toBeEnabled()
})

test('REQ-UI-060 认证页不套皮肤', async ({ browser, request }) => {
  await setAppearancePref(request, { skin: ID })
  // 未登录上下文：本机缓存里有皮肤，登录页仍是原生外观
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const p = await ctx.newPage()
  await p.goto('/login')
  await p.evaluate(
    (id) =>
      localStorage.setItem('xz:skin', JSON.stringify({ id, mode: 'dark', rev: 'x', css: '' })),
    ID,
  )
  await p.reload()
  await expect(p.locator('html')).not.toHaveAttribute('data-skin', /.*/)
  await ctx.close()
})
