/** ADR-0032：表头行 / 表头列（REQ-EDITOR-033）、代码块折叠与默认行为（REQ-EDITOR-034）、插入时间（REQ-EDITOR-035）。 */
import { expect, type Page, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const editor = (p: Page) => p.getByTestId('editor')

test.afterEach(async ({ request }) => {
  await request.patch('/api/v1/me/preferences', {
    data: { reading: { codeFold: 'expanded' } },
    headers: sameSite,
  })
})

async function open(page: Page, title: string) {
  const id = await createEntry(page.request, { kind: 'note', title })
  await page.goto(`/entries/${id}`)
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'synced', {
    timeout: 15_000,
  })
  await editor(page).click()
}

test('REQ-EDITOR-033 表格工具条：表头行与表头列可分别开关，按钮状态反映整表', async ({ page }) => {
  await open(page, '表头')
  await page.keyboard.type('/表格')
  await page.keyboard.press('Enter')
  const table = editor(page).locator('table').first()
  await expect(table.locator('tr').first().locator('th')).toHaveCount(3)
  const menu = page.getByTestId('table-menu')
  await expect(menu.getByTestId('table-headerRow')).toHaveAttribute('aria-pressed', 'true')
  await expect(menu.getByTestId('table-headerCol')).toHaveAttribute('aria-pressed', 'false')
  await menu.getByTestId('table-headerCol').click()
  // 各行首格变成 th
  await expect(table.locator('tr').nth(1).locator('> :first-child')).toHaveJSProperty(
    'tagName',
    'TH',
  )
  await expect(table.locator('tr').nth(2).locator('> :first-child')).toHaveJSProperty(
    'tagName',
    'TH',
  )
  await expect(menu.getByTestId('table-headerCol')).toHaveAttribute('aria-pressed', 'true')
  // 关掉表头行：首行其余格回到 td
  await menu.getByTestId('table-headerRow').click()
  await expect(table.locator('tr').first().locator('td')).toHaveCount(2)
  await expect(menu.getByTestId('table-headerRow')).toHaveAttribute('aria-pressed', 'false')
})

test('REQ-EDITOR-034 代码块折叠：头部开关折叠 / 展开；「默认折叠」偏好让代码块初始折叠；「长代码折叠」只折叠超过 15 行的', async ({
  page,
  request,
}) => {
  await open(page, '代码折叠')
  await page.keyboard.type('```')
  await page.keyboard.press('Enter')
  for (let i = 1; i <= 6; i++) {
    await page.keyboard.type(`line ${i}`)
    await page.keyboard.press('Enter')
  }
  const block = editor(page).getByTestId('code-block').first()
  await expect(block).not.toHaveAttribute('data-collapsed', /.*/)
  await block.getByTestId('code-fold').click()
  await expect(block).toHaveAttribute('data-collapsed', 'true')
  await expect(block.getByTestId('code-expand')).toContainText('展开全部')
  await block.getByTestId('code-expand').click()
  await expect(block).not.toHaveAttribute('data-collapsed', /.*/)

  // 默认折叠：刷新后初始即折叠
  await request.patch('/api/v1/me/preferences', {
    data: { reading: { codeFold: 'collapsed' } },
    headers: sameSite,
  })
  await page.reload()
  await expect(editor(page).getByTestId('code-block').first()).toHaveAttribute(
    'data-collapsed',
    'true',
  )
  // 长代码折叠：7 行不超过 15 行 → 展开
  await request.patch('/api/v1/me/preferences', {
    data: { reading: { codeFold: 'auto' } },
    headers: sameSite,
  })
  await page.reload()
  await expect(editor(page).getByTestId('code-block').first()).not.toHaveAttribute(
    'data-collapsed',
    /.*/,
  )
})

test('REQ-EDITOR-035 插入时间：斜杠「今天日期」「当前时间」「日期时间」插入本地时间文字', async ({
  page,
}) => {
  await open(page, '插入时间')
  await page.keyboard.type('/今天日期')
  await page.keyboard.press('Enter')
  const p = editor(page).locator('p')
  await expect(p.nth(0)).toHaveText(/^\d{4}-\d{2}-\d{2}$/)
  await page.keyboard.press('Enter')
  await page.keyboard.type('/当前时间')
  await page.keyboard.press('Enter')
  await expect(p.nth(1)).toHaveText(/^\d{2}:\d{2}$/)
  await page.keyboard.press('Enter')
  await page.getByTestId('insert-open').click()
  await page.getByTestId('insert-panel').locator('[data-insert="datetime"]').click()
  await expect(p.nth(2)).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})
