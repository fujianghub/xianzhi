/** ADR-0026：Ctrl+S 保存版本（REQ-COLLAB-017）、打标记（REQ-COLLAB-018）、目录自动编号与当前标题（REQ-READ-008）、满栏工具栏不遮挡（REQ-EDITOR-032）。 */
import { expect, type Page, test } from '@playwright/test'
import { createEntry, openReading, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const editor = (p: Page) => p.getByTestId('editor')
const pill = (p: Page) => p.getByTestId('status-pill')

test.beforeEach(async ({ request }) => {
  await request.patch('/api/v1/me/preferences', {
    data: { reading: { width: 'full', tocNumbers: true, tocDepth: 4 } },
    headers: sameSite,
  })
})

// 偏好在共享库里按人存：用例结束复位版心，免得影响后续用例（REQ-EDITOR-032 会改成窄）
test.afterEach(async ({ request }) => {
  await request.patch('/api/v1/me/preferences', {
    data: { reading: { width: 'full' } },
    headers: sameSite,
  })
})

async function open(page: Page, title: string) {
  const id = await createEntry(page.request, { kind: 'note', title })
  await page.goto(`/entries/${id}`)
  await expect(pill(page)).toHaveAttribute('data-status', 'synced', { timeout: 15_000 })
  return id
}

test('REQ-COLLAB-017 Ctrl+S 保存版本：提示「已保存版本 YYYYMMDD-HHmmss」，历史里出现同名版本；无改动再存提示没有新改动', async ({
  page,
}) => {
  await open(page, '保存版本')
  await editor(page).click()
  await page.keyboard.type('第一版')
  await page.keyboard.press('ControlOrMeta+s')
  const toast = page.getByText(/已保存版本 \d{8}-\d{6}/)
  await expect(toast).toBeVisible({ timeout: 10_000 })
  const name = ((await toast.textContent()) ?? '').match(/\d{8}-\d{6}/)?.[0] ?? ''
  await page.getByRole('tab', { name: '历史' }).click()
  const item = page.getByTestId('history-item').filter({ hasText: name })
  await expect(item).toHaveCount(1)
  // 文档栏显示「上次保存版本 刚刚」（ADR-0029）
  await expect(page.getByTestId('doc-last-saved')).toBeVisible()

  // 5s 节流后、无改动再存
  await page.waitForTimeout(5200)
  await page.getByTestId('save-version').click()
  await expect(page.getByText('没有新改动', { exact: false })).toBeVisible({ timeout: 10_000 })
})

test('REQ-COLLAB-018 给版本打标记：标记名显示在历史里、时间戳作副标题；可清除', async ({
  page,
}) => {
  await open(page, '打标记')
  await editor(page).click()
  await page.keyboard.type('要打标记的版本')
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByText(/已保存版本 \d{8}-\d{6}/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('tab', { name: '历史' }).click()
  const row = page.getByTestId('history-item').first()
  await row.hover()
  await page.getByTestId('history-tag').first().click()
  await page.getByTestId('history-tag-input').fill('发布前')
  await page.getByTestId('history-tag-save').click()
  const tagged = page.getByTestId('history-item').filter({ hasText: '发布前' })
  await expect(tagged).toHaveCount(1)
  await expect(tagged).toContainText(/\d{8}-\d{6}/)
  await page.getByTestId('history-tag').first().click()
  await page.getByTestId('history-tag-clear').click()
  await expect(page.getByTestId('history-item').filter({ hasText: '发布前' })).toHaveCount(0)
})

test('REQ-READ-008 右侧目录默认自动编号（跳级压缩），可关闭；滚动时高亮当前标题', async ({
  page,
}) => {
  await open(page, '目录编号')
  await editor(page).click()
  await page.keyboard.type('## 背景')
  await page.keyboard.press('Enter')
  for (let i = 0; i < 30; i++) await page.keyboard.press('Enter')
  await page.keyboard.type('### 细节')
  await page.keyboard.press('Enter')
  for (let i = 0; i < 30; i++) await page.keyboard.press('Enter')
  await page.keyboard.type('## 结论')
  const outline = page.getByTestId('outline')
  await expect(outline.getByTestId('outline-num')).toHaveText(['1', '1.1', '2'])
  // 滚到文末：当前标题 = 结论
  await page.keyboard.press('ControlOrMeta+End')
  await page.mouse.wheel(0, 4000)
  await expect(outline.locator('[data-active]')).toContainText('结论')
  // 回到顶部：当前标题 = 背景
  await page.mouse.wheel(0, -8000)
  await expect(outline.locator('[data-active]')).toContainText('背景')
  // 目录格式里关闭自动编号
  await openReading(page, 'toc')
  await page.getByTestId('reading-toc-numbers').click()
  await expect(outline.getByTestId('outline-num')).toHaveCount(0)
})

test('REQ-EDITOR-032 工具栏两行固定：第一行始终一行，放不下的收进「…」且可用；切换版心宽度时工具栏高度不变（ADR-0028）', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page, '两行工具栏')
  const bar = page.getByTestId('editor-toolbar')
  const row1 = page.getByTestId('editor-toolbar-edit')
  // 第一行只有一行高
  expect((await row1.boundingBox())?.height ?? 0).toBeLessThanOrEqual(40)
  const fullH = (await bar.boundingBox())?.height ?? 0
  // 1280 + 侧栏 + Aside：部分组收进「…」，其中的对齐可用
  await expect(page.getByTestId('tb-overflow')).toBeVisible()
  await editor(page).click()
  await page.keyboard.type('居中这一段')
  await page.getByTestId('tb-overflow').click()
  const menu = page.getByTestId('tb-overflow-menu')
  await expect(menu.locator('[data-overflow-group="align"]')).toBeVisible()
  await menu.getByTestId('tb-align-center').click()
  await expect(editor(page).locator('p', { hasText: '居中这一段' })).toHaveCSS(
    'text-align',
    'center',
  )
  // 换成窄版心：工具栏高度不变（仍两行），更多组收进「…」
  await request.patch('/api/v1/me/preferences', {
    data: { reading: { width: 'narrow' } },
    headers: sameSite,
  })
  await page.reload()
  await expect(pill(page)).toHaveAttribute('data-status', 'synced', { timeout: 15_000 })
  await expect(page.getByTestId('entry-page')).toHaveAttribute('data-width', 'narrow')
  await expect
    .poll(async () => Math.round((await bar.boundingBox())?.height ?? 0))
    .toBe(Math.round(fullH))
  expect((await row1.boundingBox())?.height ?? 0).toBeLessThanOrEqual(40)
})
