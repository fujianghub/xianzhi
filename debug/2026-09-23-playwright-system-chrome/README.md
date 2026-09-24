# Playwright 下载 Chrome for Testing 超时，改用本机 Google Chrome

- 日期：2026-09-23
- 影响范围：e2e
- 严重度：medium
- 相关：T0-018 ~ T0-023 的 e2e

## 症状
`playwright install chromium`（含 `PLAYWRIGHT_DOWNLOAD_HOST=npmmirror`）报 `Request … timed out after 30000ms`；另提示 Rocky 9 非官方支持平台。

## 复现
`PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright pnpm exec playwright install chromium`

## 根因
Playwright 1.63 的 Chrome for Testing 路径在 npmmirror 的 `mirrors/playwright` 下不可用（`cdn.npmmirror.com/binaries/chrome-for-testing` 有但路径格式不同）。

## 修复
本机已装 `google-chrome`（149），`playwright.config.ts` 统一 `channel: 'chrome'`；GitHub runner 同样自带 google-chrome，CI 不需下载浏览器。

## 验证
`pnpm e2e` 23 例在系统 Chrome 下全绿。
