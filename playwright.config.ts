/**
 * Playwright（05 §5）：验证实例 3011/8012/8013 + xz_e2e（`pnpm e2e` 先 scripts/e2e-db.ts 重建并 seed）。
 * 浏览器用本机 Google Chrome（channel: chrome）——镜像下载 Chrome for Testing 超时，见 debug/2026-09-23-playwright-system-chrome。
 */
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled', caret: 'hide' },
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  reporter: [['list'], ['./e2e/req-reporter.ts']],
  use: {
    baseURL: process.env.XZ_E2E_BASE ?? 'http://localhost:3011',
    channel: 'chrome',
    trace: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  webServer: {
    command: 'pnpm dev:verify',
    url: `${process.env.XZ_E2E_BASE ?? 'http://localhost:3011'}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      testIgnore: /(mobile\.spec|infra\.spec|auth\.setup)\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1280, height: 800 },
      },
      dependencies: ['setup'],
    },
    // 基础设施层（00「e2e（infra）」）：`pnpm e2e:infra` 单独运行，docker compose 起生产栈
    { name: 'infra', testMatch: /infra\.spec\.ts/ },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        channel: 'chrome',
      },
      dependencies: ['setup'],
    },
  ],
})
