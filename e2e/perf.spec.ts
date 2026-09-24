/**
 * REQ-UI-015 生产构建首屏：从 dist/client 直接提供文件（不走 dev server），测首屏实际加载的 JS gzip 总量 ≤ 250 KB、LCP ≤ 2.5s。
 * API 一律回 401（登录页即首屏，不依赖后端）。Lighthouse ≥ 90 另需 Lighthouse，见 tasks 进度表。
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'

const DIST = 'dist/client'
const HOST = 'http://xz-prod.test'
const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

test('REQ-UI-015 生产构建首屏 JS gzip ≤ 250 KB，LCP ≤ 2.5s', async ({ page }) => {
  if (!existsSync(join(DIST, 'index.html'))) execSync('pnpm exec vite build', { stdio: 'inherit' })
  let jsGzip = 0
  await page.route(`${HOST}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/'))
      return route.fulfill({
        status: 401,
        contentType: 'application/problem+json',
        body: JSON.stringify({ status: 401, code: 'UNAUTHENTICATED' }),
      })
    const file = join(
      DIST,
      url.pathname === '/' || !extname(url.pathname) ? 'index.html' : url.pathname,
    )
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' })
    const body = readFileSync(file)
    if (extname(file) === '.js') jsGzip += gzipSync(body).length
    return route.fulfill({
      status: 200,
      contentType: TYPES[extname(file)] ?? 'application/octet-stream',
      body,
    })
  })
  await page.goto(`${HOST}/login`)
  await expect(page.getByTestId('login-form')).toBeVisible()
  const lcp = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let v = 0
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) v = e.startTime
        }).observe({ type: 'largest-contentful-paint', buffered: true })
        setTimeout(() => resolve(v), 500)
      }),
  )
  expect(jsGzip / 1024).toBeLessThanOrEqual(250)
  expect(lcp).toBeGreaterThan(0)
  expect(lcp).toBeLessThanOrEqual(2500)
})
