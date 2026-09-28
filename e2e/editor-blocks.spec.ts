/** ADR-0025 §3–§6 块级编辑（REQ-EDITOR-027 ~ 030）：块手柄菜单、表格工具条、代码块复制、提示块切换 / 取消。 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { createEntry, STATE } from './helpers.ts'

test.use({ storageState: STATE.owner })

const editor = (p: Page) => p.getByTestId('editor')

async function open(page: Page, request: APIRequestContext, title = '块编辑用例') {
  const id = await createEntry(request, { kind: 'note', title })
  await page.goto(`/entries/${id}`)
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'synced', {
    timeout: 15_000,
  })
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  return id
}

test('REQ-EDITOR-028 表格工具条：光标在表格内浮出；插入行 / 列、删除行、删除表格', async ({
  page,
  request,
}) => {
  await open(page, request)
  await page.keyboard.type('/表')
  await page.keyboard.press('Enter')
  const table = editor(page).locator('table')
  await expect(table.locator('tr')).toHaveCount(3)
  const menu = page.getByTestId('table-menu')
  await expect(menu).toBeVisible()
  await expect(menu).toHaveAttribute('role', 'toolbar')
  await menu.getByTestId('table-rowAfter').click()
  await expect(table.locator('tr')).toHaveCount(4)
  await menu.getByTestId('table-colAfter').click()
  await expect(table.locator('tr').first().locator('th, td')).toHaveCount(4)
  await menu.getByTestId('table-deleteRow').click()
  await expect(table.locator('tr')).toHaveCount(3)
  // 单个单元格时不能合并
  await expect(menu.getByTestId('table-merge')).toBeDisabled()
  await menu.getByTestId('table-deleteTable').click()
  await expect(editor(page).locator('table')).toHaveCount(0)
  await expect(menu).toBeHidden()
})

test('REQ-EDITOR-029 代码块头部：显示行数，复制按钮切到「已复制」', async ({ page, request }) => {
  await open(page, request)
  await page.keyboard.type('/代码')
  await page.keyboard.press('Enter')
  await page.keyboard.type('line one')
  await page.keyboard.press('Enter')
  await page.keyboard.type('line two')
  const block = editor(page).getByTestId('code-block')
  await expect(block.getByTestId('code-lines')).toContainText('2')
  const copy = block.getByTestId('code-copy')
  await copy.click()
  await expect(copy).toHaveAttribute('data-copied', 'true')
  await expect(copy).toContainText('已复制')
  // 头部条不遮挡代码：代码文本仍在 pre 内且可见
  await expect(block.locator('pre')).toContainText('line two')
})

test('REQ-EDITOR-030 提示块：切换类型改 data-callout，取消提示块后内容留在外层', async ({
  page,
  request,
}) => {
  await open(page, request)
  await page.keyboard.type('/提示')
  await page.keyboard.press('Enter')
  await page.keyboard.type('注意事项正文')
  const callout = editor(page).locator('aside[data-callout]')
  await expect(callout).toHaveAttribute('data-callout', 'info')
  await callout.hover()
  await callout.getByTestId('callout-kind').selectOption('warn')
  await expect(callout).toHaveAttribute('data-callout', 'warn')
  await callout.hover()
  await callout.getByTestId('callout-unwrap').click()
  await expect(editor(page).locator('aside[data-callout]')).toHaveCount(0)
  await expect(editor(page).locator('p', { hasText: '注意事项正文' })).toBeVisible()
})

test('REQ-EDITOR-027 块手柄菜单：段落转为标题 2、复制此块、删除此块', async ({ page, request }) => {
  await open(page, request)
  await page.keyboard.type('手柄目标段落')
  const para = editor(page).locator('p', { hasText: '手柄目标段落' })
  await para.hover()
  const handle = page.getByTestId('block-handle')
  await expect(handle).toBeVisible()
  await handle.click()
  const menu = page.getByTestId('block-menu')
  await expect(menu).toBeVisible()
  await menu.getByTestId('block-h2').click()
  const h2 = editor(page).locator('h2', { hasText: '手柄目标段落' })
  await expect(h2).toHaveCount(1)

  await h2.hover()
  await handle.click()
  await menu.getByTestId('block-duplicate').click()
  await expect(editor(page).locator('h2', { hasText: '手柄目标段落' })).toHaveCount(2)

  await editor(page).locator('h2', { hasText: '手柄目标段落' }).last().hover()
  await handle.click()
  await menu.getByTestId('block-delete').click()
  await expect(editor(page).locator('h2', { hasText: '手柄目标段落' })).toHaveCount(1)
})
