/** ADR-0025 §8 图表与公式：Mermaid 预览 / 源码编辑 / 错误框 / note 列表规避（REQ-EDITOR-007）、KaTeX 块级与行内（REQ-EDITOR-008）。 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const editor = (p: Page) => p.getByTestId('editor')

async function open(page: Page, request: APIRequestContext, title: string) {
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

const serverBody = async (request: APIRequestContext, id: string) => {
  const r = await request.get(`/api/v1/entries/${id}?withBody=1`, { headers: sameSite })
  return JSON.stringify(((await r.json()) as { pmJson: unknown }).pmJson ?? '')
}

/** 在 Mermaid 源码编辑器里整段替换为 src。 */
async function setSource(page: Page, src: string) {
  const cm = page.getByTestId('mermaid-source').locator('.cm-content')
  await cm.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  // CM 回车会自动缩进：逐行输入后去掉行首缩进不影响 mermaid 解析
  await page.keyboard.insertText(src)
}

test('REQ-EDITOR-007 Mermaid：插入后直接进源码编辑，实时预览出图；语法错误显示错误框；note 内列表正常渲染；源码落库', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const id = await open(page, request, 'Mermaid 用例')
  await page.keyboard.type('/mermaid')
  await expect(page.getByTestId('slash-menu')).toBeVisible()
  await page.keyboard.press('Enter')
  const node = editor(page).getByTestId('mermaid')
  await expect(node).toHaveCount(1)
  await expect(page.getByTestId('mermaid-source')).toBeVisible()

  await setSource(page, 'graph TD\nA[开始] --> B[结束]')
  await expect(node.getByTestId('mermaid-svg').locator('svg')).toBeVisible({ timeout: 20_000 })
  await expect(node.getByTestId('mermaid-error')).toHaveCount(0)

  // 语法错误 → 错误框（非空白）
  await setSource(page, 'graph TD\nA -->')
  await expect(node.getByTestId('mermaid-error')).toBeVisible({ timeout: 20_000 })

  // note 内 3 条列表（上游 bug，U+2060 规避）→ 正常出图
  await setSource(
    page,
    'stateDiagram-v2\nA --> B\nnote right of A\n1. 第一条比较长的说明文字需要折行显示\n2. 第二条\n3. 第三条\nend note',
  )
  await expect(node.getByTestId('mermaid-error')).toHaveCount(0, { timeout: 20_000 })
  await expect(node.getByTestId('mermaid-svg').locator('svg')).toBeVisible({ timeout: 20_000 })

  // Esc 退出编辑，预览留下；源码写回节点属性并落库
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mermaid-source')).toHaveCount(0)
  await expect(node.getByTestId('mermaid-svg').locator('svg')).toBeVisible()
  await expect.poll(() => serverBody(request, id), { timeout: 20_000 }).toContain('stateDiagram-v2')

  // 点「编辑图表」可再次进入
  await node.getByTestId('mermaid-edit').click()
  await expect(page.getByTestId('mermaid-source')).toBeVisible()
  await node.getByTestId('mermaid-done').click()
  await expect(page.getByTestId('mermaid-source')).toHaveCount(0)
})

test('REQ-EDITOR-008 公式：块级公式插入即编辑并实时渲染 KaTeX；行内 $E=mc^2$ 渲染为公式', async ({
  page,
  request,
}) => {
  const id = await open(page, request, '公式用例')
  await page.keyboard.type('/math')
  await expect(page.getByTestId('slash-menu')).toBeVisible()
  await page.keyboard.press('Enter')
  const block = editor(page).getByTestId('math-block')
  await expect(block.getByTestId('math-input')).toBeFocused()
  await page.keyboard.type('\\frac{a}{b} + c^2')
  await expect(block.locator('.katex')).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape')
  await expect(block.getByTestId('math-input')).toHaveCount(0)
  await expect(block.locator('.katex')).toBeVisible()

  // 行内公式：输入规则 $…$ → mathInline → KaTeX
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('质能方程 $E=mc^2$ ')
  const inline = editor(page).getByTestId('math-inline')
  await expect(inline.locator('.katex')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => serverBody(request, id), { timeout: 20_000 }).toContain('E=mc^2')
})
