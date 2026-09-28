/** ADR-0025 编辑器对齐简斋：吸顶工具栏、插入面板与表格网格、斜杠分组、颜色标记（REQ-EDITOR-024 · 025 · 026 · 031）。 */
import { expect, type Page, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const editor = (p: Page) => p.getByTestId('editor')

async function open(page: Page, title: string) {
  const id = await createEntry(page.request, { kind: 'note', title })
  await page.goto(`/entries/${id}`)
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'synced', {
    timeout: 15_000,
  })
  return id
}

test('REQ-EDITOR-024 工具栏：标题下拉、加粗、列表、清除格式（保留评论之外的标记全部去掉）、字数', async ({
  page,
}) => {
  // 宽屏 + 满栏：第一行格式按钮全部在行内（窄时收进「…」见 REQ-EDITOR-032）
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.request.patch('/api/v1/me/preferences', {
    data: { reading: { width: 'full' } },
    headers: sameSite,
  })
  await open(page, '工具栏示例')
  const bar = page.getByTestId('editor-toolbar')
  await editor(page).click()
  await page.keyboard.type('工具栏标题')
  await bar.getByTestId('tb-heading').click()
  await page.getByTestId('tb-heading-2').click()
  await expect(editor(page).locator('h2', { hasText: '工具栏标题' })).toBeVisible()
  await expect(bar.getByTestId('tb-heading')).toContainText('标题 2')

  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await bar.getByTestId('tb-bold').click()
  await page.keyboard.type('加粗文字')
  await expect(editor(page).locator('strong', { hasText: '加粗文字' })).toBeVisible()
  await expect(bar.getByTestId('tb-bold')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Shift+Home')
  await bar.getByTestId('tb-clear').click()
  await expect(editor(page).locator('strong')).toHaveCount(0)

  await bar.getByTestId('tb-bullet').click()
  await expect(editor(page).locator('ul li', { hasText: '加粗文字' })).toBeVisible()
  await expect(page.getByTestId('word-count')).toContainText('9')
})

test('REQ-EDITOR-025 插入面板：搜索、表格网格选 2×4、Mermaid 预设', async ({ page }) => {
  await open(page, '插入面板示例')
  await editor(page).click()
  await page.getByTestId('insert-open').click()
  const panel = page.getByTestId('insert-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-insert="table"]')).toBeVisible()
  await panel.locator('[data-insert="table"]').click()
  await page.getByTestId('table-grid-2-4').click()
  const table = editor(page).locator('table').first()
  await expect(table.locator('tr')).toHaveCount(2)
  await expect(table.locator('tr').first().locator('th')).toHaveCount(4)

  // 搜索过滤：只剩匹配项
  await page.keyboard.press('ControlOrMeta+End')
  await page.getByTestId('insert-open').click()
  await page.getByTestId('insert-search').fill('时序')
  await expect(panel.locator('[data-insert]')).toHaveCount(1)
  await panel.locator('[data-insert="mermaidSeq"]').click()
  await expect(editor(page).locator('[data-type="mermaid"], .xz-diagram').first()).toBeVisible()
})

test('REQ-EDITOR-026 斜杠菜单：空查询按分组列出全部并可滚动；有查询扁平最多 8 条', async ({
  page,
}) => {
  await open(page, '斜杠分组示例')
  await editor(page).click()
  await page.keyboard.type('/')
  const menu = page.getByTestId('slash-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('presentation').first()).toHaveText('基础')
  expect(await menu.getByRole('option').count()).toBeGreaterThan(20)
  // 键盘移到底：最后一项被滚进可视区
  await page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('option').last()).toBeInViewport()
  await page.keyboard.type('表')
  expect(await menu.getByRole('option').count()).toBeLessThanOrEqual(8)
  await expect(menu.getByRole('presentation')).toHaveCount(0)
})

test('REQ-EDITOR-031 文字色 / 背景色：工具栏与气泡条都只写色板 key，刷新后仍在', async ({
  page,
}) => {
  await open(page, '颜色示例')
  await editor(page).click()
  await page.keyboard.type('红色文字')
  await page.keyboard.press('Shift+Home')
  await page.getByTestId('tb-text-color').click()
  await page.getByTestId('color-text-red').click()
  const red = editor(page).locator('[data-text-color="red"]', { hasText: '红色文字' })
  await expect(red).toBeVisible()
  await expect(red).not.toHaveAttribute('style', /.+/)

  // 气泡条：内联色块，背景色
  await page.keyboard.press('Shift+Home')
  await page.getByTestId('bubble-menu').getByRole('button', { name: '背景颜色' }).click()
  await page.getByTestId('bubble-bg-green').click()
  await expect(editor(page).locator('mark[data-color="green"]')).toBeVisible()

  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'synced', {
    timeout: 15_000,
  })
  await page.waitForTimeout(500)
  await page.reload()
  await expect(editor(page).locator('[data-text-color="red"]')).toBeVisible()
  await expect(editor(page).locator('mark[data-color="green"]')).toBeVisible()
})
