/** ADR-0024 阅读与写作偏好（REQ-READ-002 ~ 007）：阅读胶囊（字体 / 纸张 / 排版 / 目录，ADR-0025）、纸张、章节编号与目录深度、专注写作、设置页预览。 */
import { expect, type Page, test } from '@playwright/test'
import { createEntry, openReading, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const DEFAULTS = {
  font: 'sans',
  size: 'md',
  lineHeight: 'standard',
  width: 'full',
  paragraph: 'standard',
  indent: false,
  justify: false,
  paper: 'plain',
  headingNumbers: true,
  tocNumbers: true,
  tocDepth: 4,
}

// 偏好按人存在共享库里：每条用例前后都复位（前：手动试用可能留下改动；后：不影响后续用例，workers = 1 串行）
test.beforeEach(async ({ request }) => {
  await request.patch('/api/v1/me/preferences', { data: { reading: DEFAULTS }, headers: sameSite })
})
test.afterEach(async ({ request }) => {
  await request.patch('/api/v1/me/preferences', { data: { reading: DEFAULTS }, headers: sameSite })
})

const article = (p: Page) => p.getByTestId('entry-page')
// 编辑器根节点即 .xz-prose（data-testid=editor）
const prose = (p: Page) => p.getByTestId('editor')

async function openEntry(page: Page, id: string) {
  await page.goto(`/entries/${id}`)
  await expect(page.getByTestId('editor')).toBeVisible()
}

/** 等本次改动的 PATCH 落库（防抖 600ms）。 */
const saved = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/me/preferences') && r.request().method() === 'PATCH',
  )

test('REQ-READ-002 阅读胶囊改字体与版心即时生效、刷新后保留；恢复默认回到默认外观（版心满栏，ADR-0026）', async ({
  page,
  request,
}) => {
  const id = await createEntry(request, { kind: 'note', title: '阅读偏好示例' })
  await openEntry(page, id)
  await expect(article(page)).toHaveAttribute('data-font', 'sans')
  await expect(article(page)).toHaveCSS('max-width', 'none')

  const done = saved(page)
  await openReading(page, 'font')
  await page.getByTestId('reading-font-wenkai').click()
  await page.keyboard.press('Escape')
  await openReading(page, 'layout')
  await page.getByTestId('reading-width-wide').click()
  await page.getByTestId('reading-size-lg').click()
  await expect(article(page)).toHaveAttribute('data-font', 'wenkai')
  await expect(article(page)).toHaveCSS('max-width', '1080px')
  const family = await prose(page).evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family).toContain('LXGW WenKai')
  await expect(prose(page)).toHaveCSS('font-size', '17.5px')
  await done

  await page.reload()
  await expect(article(page)).toHaveAttribute('data-font', 'wenkai')
  await expect(article(page)).toHaveAttribute('data-width', 'wide')

  await openReading(page, 'layout')
  await page.getByTestId('reading-reset').click()
  await expect(article(page)).toHaveAttribute('data-font', 'sans')
  await expect(article(page)).toHaveCSS('max-width', 'none')
  await expect(prose(page)).toHaveCSS('font-size', '16px')
})

test('REQ-READ-003 纸张按人生效：方格纸面有底纹，宣纸换底色', async ({ page, request }) => {
  const id = await createEntry(request, { kind: 'note', title: '纸张示例' })
  await openEntry(page, id)
  await openReading(page, 'paper')
  await page.getByTestId('reading-paper-grid').click()
  await expect(article(page)).toHaveAttribute('data-paper', 'grid')
  const bgImage = await article(page).evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(bgImage).toContain('linear-gradient')
  const plainBg = await article(page).evaluate((el) => getComputedStyle(el).backgroundColor)
  await page.getByTestId('reading-paper-rice').click()
  await expect(article(page)).toHaveAttribute('data-paper', 'rice')
  await expect
    .poll(() => article(page).evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(plainBg)
})

test('REQ-READ-004 章节编号：正文与大纲同一编号（跳级压缩），目录深度过滤大纲', async ({
  page,
  request,
}) => {
  const id = await createEntry(request, { kind: 'note', title: '编号示例' })
  await openEntry(page, id)
  const ed = page.getByTestId('editor')
  await ed.click()
  await page.keyboard.type('## 背景')
  await page.keyboard.press('Enter')
  await page.keyboard.type('#### 细节')
  await page.keyboard.press('Enter')
  await page.keyboard.type('### 补充')
  await page.keyboard.press('Enter')
  await expect(ed.locator('h3', { hasText: '补充' })).toBeVisible()

  // 正文章节编号默认开（ADR-0027）
  await expect(article(page)).toHaveAttribute('data-numbered', 'true')
  await openReading(page, 'toc')
  // h2 → h4 → h3：1 / 1.1 / 1.2（回到中间层级续接计数）
  await expect(ed.locator('h2', { hasText: '背景' })).toHaveAttribute('data-num', '1')
  await expect(ed.locator('h4', { hasText: '细节' })).toHaveAttribute('data-num', '1.1')
  await expect(ed.locator('h3', { hasText: '补充' })).toHaveAttribute('data-num', '1.2')
  const outline = page.getByTestId('outline')
  await expect(outline.getByTestId('outline-num')).toHaveText(['1', '1.1', '1.2'])

  await page.getByTestId('reading-tocDepth-2').click()
  await expect(outline).toContainText('补充')
  await page.keyboard.press('Escape')
  // 编号只是显示：正文文本里没有编号
  await expect(ed.locator('h2', { hasText: '背景' })).toHaveText('背景')
})

test('REQ-READ-005 专注写作：按钮 / 快捷键进入，隐藏外框；Esc 与浮动按钮退出', async ({
  page,
  request,
}) => {
  const id = await createEntry(request, { kind: 'note', title: '专注示例' })
  await openEntry(page, id)
  await page.getByTestId('focus-enter').click()
  await expect(page.getByTestId('topbar')).toBeHidden()
  await expect(page.getByTestId('sidebar')).toBeHidden()
  await expect(page.getByTestId('focus-exit')).toBeVisible()
  await expect(page.getByTestId('entry-breadcrumb')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('topbar')).toBeVisible()

  // 在正文里用快捷键进入，浮动按钮退出
  await page.getByTestId('editor').click()
  await page.keyboard.press('ControlOrMeta+Shift+Enter')
  await expect(page.getByTestId('focus-exit')).toBeVisible()
  await page.getByTestId('focus-exit').click()
  await expect(page.getByTestId('topbar')).toBeVisible()
})

test('REQ-READ-007 · 010 阅读设置在标题下的文档栏里（ADR-0029 · 0037）：一个弹层四个分页；吸顶的格式工具栏里不再有阅读设置', async ({
  page,
  request,
}) => {
  const id = await createEntry(request, { kind: 'note', title: '胶囊示例' })
  await openEntry(page, id)
  const docBar = page.getByTestId('doc-bar')
  // 文档栏紧跟标题之下、在格式工具栏之上
  const titleBox = await page.getByTestId('entry-title').boundingBox()
  const docBox = await docBar.boundingBox()
  const barBox = await page.getByTestId('editor-toolbar').boundingBox()
  expect(docBox?.y ?? 0).toBeGreaterThan(titleBox?.y ?? 0)
  expect(docBox?.y ?? 0).toBeLessThan(barBox?.y ?? 0)
  // 阅读设置是文档栏里一个「阅读」弹层，四个分页各管一类（ADR-0037、REQ-READ-010）
  await docBar.getByTestId('reading-open').click()
  for (const k of ['font', 'paper', 'layout', 'toc']) {
    await page.getByTestId(`reading-open-${k}`).click()
    await expect(page.getByTestId(`reading-${k}-panel`)).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('editor-toolbar').getByTestId('reading-open')).toHaveCount(0)
  await expect(docBar.getByTestId('word-count')).toBeVisible()
  // 写长一点再滚动：格式工具栏吸顶，文档栏随正文滚走
  await page.getByTestId('editor').click()
  for (let i = 0; i < 40; i++) await page.keyboard.press('Enter')
  await page.mouse.wheel(0, 2000)
  await expect(page.getByTestId('editor-toolbar')).toBeInViewport()
  await expect(docBar).not.toBeInViewport()
})

test('REQ-READ-009 /toc 目录块：主色卡片 + 标题行；编号只出现一次（无浏览器列表序号）；正文标题默认带编号', async ({
  page,
  request,
}) => {
  const id = await createEntry(request, { kind: 'note', title: '目录卡片' })
  await openEntry(page, id)
  const ed = page.getByTestId('editor')
  await ed.click()
  await page.keyboard.type('## 背景')
  await page.keyboard.press('Enter')
  await page.keyboard.type('### 细节')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/toc')
  await expect(page.getByTestId('slash-menu')).toBeVisible()
  await page.keyboard.press('Enter')
  const card = ed.getByTestId('toc')
  await expect(card).toBeVisible()
  // 插入后光标落在目录下方：接着打字不会把目录替换掉
  await page.keyboard.type('目录下面的正文')
  await expect(card).toBeVisible()
  await expect(ed.locator('p', { hasText: '目录下面的正文' })).toBeVisible()
  await expect(card).toContainText('目录')
  await expect(card.getByTestId('toc-num')).toHaveText(['1', '1.1'])
  // 列表不显示浏览器序号：编号只出现一次
  const style = await card.locator('ol').evaluate((el) => getComputedStyle(el).listStyleType)
  expect(style).toBe('none')
  await expect(card.getByTestId('toc-item').first()).toHaveText('1背景')
  // 卡片带主色底（不是纸面同色）
  const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor)
  const paper = await article(page).evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).not.toBe(paper)
  // 正文标题默认带编号（显示层 data-num）
  await expect(ed.locator('h2', { hasText: '背景' })).toHaveAttribute('data-num', '1')
  const before = await ed
    .locator('h2', { hasText: '背景' })
    .evaluate((el) => getComputedStyle(el, '::before').content)
  expect(before).toContain('1')
})

test('REQ-READ-006 设置 → 阅读与写作：预览实时生效，记录页同样生效', async ({ page, request }) => {
  const id = await createEntry(request, { kind: 'note', title: '设置页联动' })
  await page.goto('/settings')
  await page.getByTestId('nav-reading').click()
  await expect(page).toHaveURL(/\/settings\/reading$/)
  const preview = page.getByTestId('reading-preview')
  await expect(preview).toHaveAttribute('data-paper', 'plain')
  const done = saved(page)
  await page.getByTestId('reading-paper-lines').click()
  await page.getByTestId('reading-lineHeight-loose').click()
  await expect(preview).toHaveAttribute('data-paper', 'lines')
  await expect(preview.locator('p').first()).toHaveCSS('line-height', '32px')
  await done
  await openEntry(page, id)
  await expect(article(page)).toHaveAttribute('data-paper', 'lines')
  await expect(article(page)).toHaveAttribute('data-line-height', 'loose')
})
