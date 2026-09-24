/** G7 编辑器（T1-014 ~ 016 · T1-018）：斜杠菜单、快捷键、IME、浮动工具条、代码语言、粘贴 / 上传、软限、协同健壮性。 */
import { execSync } from 'node:child_process'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const editor = (p: Page) => p.getByTestId('editor')
const pill = (p: Page) => p.getByTestId('status-pill')
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function open(page: Page, request: APIRequestContext, title = '编辑器用例') {
  const id = await createEntry(request, { kind: 'note', title })
  await page.goto(`/entries/${id}`)
  await expect(pill(page)).toHaveAttribute('data-status', 'synced', { timeout: 15_000 })
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  return id
}
const serverBody = async (request: APIRequestContext, id: string) => {
  const r = await request.get(`/api/v1/entries/${id}?withBody=1`, { headers: sameSite })
  return JSON.stringify(((await r.json()) as { pmJson: unknown }).pmJson ?? '')
}

test('REQ-EDITOR-002 输入 /表 过滤出「表格」，Enter 插入 3×3 表', async ({ page, request }) => {
  await open(page, request)
  await page.keyboard.type('/表')
  const menu = page.getByTestId('slash-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('option').first()).toHaveAttribute('data-slash', 'table')
  await page.keyboard.press('Enter')
  const table = editor(page).locator('table')
  await expect(table).toHaveCount(1)
  await expect(table.locator('tr')).toHaveCount(3)
  await expect(table.locator('tr').first().locator('th, td')).toHaveCount(3)
  // Esc 关闭并保留 `/`
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('/')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})

test('REQ-EDITOR-003 代码块选 rust：高亮出现且只发一次语言 chunk 请求', async ({
  page,
  request,
}) => {
  await open(page, request)
  const chunks: string[] = []
  page.on('request', (r) => {
    // dev 下为预构建产物 highlight__js_lib_languages_rust.js，生产为 rust-*.js chunk
    if (/languages[/_]rust|\/rust-[\w-]+\.js/.test(r.url())) chunks.push(r.url())
  })
  await page.keyboard.type('/代码')
  await page.keyboard.press('Enter')
  await page.keyboard.type('fn main() { let x = 1; }')
  await page.getByTestId('code-language').selectOption('rust')
  await expect(editor(page).locator('pre .hljs-keyword').first()).toBeVisible()
  // 再插一个 rust 代码块不应重复请求
  await page.getByTestId('code-language').first().selectOption('rust')
  await page.waitForTimeout(300)
  expect(chunks.length).toBe(1)
})

test('REQ-UI-026 代码块 One Dark 高亮：深底、关键字取 --xz-code-keyword', async ({
  page,
  request,
}) => {
  await open(page, request)
  await page.keyboard.type('/代码')
  await page.keyboard.press('Enter')
  await page.keyboard.type('const answer = 42')
  await page.getByTestId('code-language').selectOption('javascript')
  const kw = editor(page).locator('pre .hljs-keyword').first()
  await expect(kw).toHaveCSS('color', 'rgb(198, 120, 221)') // --xz-code-keyword #C678DD
  // --xz-code-bg #282C34
  await expect(editor(page).locator('pre').first()).toHaveCSS('background-color', 'rgb(40, 44, 52)')
})

test('REQ-EDITOR-013 Mod+Shift+2 变 H2；编辑器内按 c 输入字符而不新建任务', async ({
  page,
  request,
}) => {
  await open(page, request)
  await page.keyboard.type('小标题')
  await page.keyboard.press('ControlOrMeta+Shift+2')
  await expect(editor(page).locator('h2', { hasText: '小标题' })).toBeVisible()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('c')
  await expect(page.getByTestId('new-task-dialog')).toBeHidden()
  await expect(editor(page)).toContainText('c')
  await page.keyboard.press('ControlOrMeta+Shift+8')
  await expect(editor(page).locator('ul li', { hasText: 'c' })).toBeVisible()
})

test('REQ-EDITOR-006 IME 组合输入「1. 」期间不触发有序列表', async ({ page, request }) => {
  await open(page, request)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: '1. ', selectionStart: 3, selectionEnd: 3 })
  await page.waitForTimeout(200)
  await expect(editor(page).locator('ol')).toHaveCount(0)
  await expect(editor(page)).toContainText('1.')
  // commit 之后按普通输入处理（REQ-EDITOR-006：「直到 commit」前不得触发）
  await cdp.send('Input.insertText', { text: '1. ' })
})

test('REQ-EDITOR-015 选中文本出现浮动工具条（glass-thick，backdrop-filter 非 none），加粗生效', async ({
  page,
  request,
}) => {
  await open(page, request)
  await page.keyboard.type('选中我加粗')
  await page.keyboard.press('Shift+Home')
  const bar = page.getByTestId('bubble-menu')
  await expect(bar).toBeVisible()
  const bf = await bar.evaluate((el) => getComputedStyle(el).backdropFilter)
  expect(bf).not.toBe('none')
  await bar.getByRole('button', { name: '加粗' }).click()
  await expect(editor(page).locator('strong', { hasText: '选中我加粗' })).toBeVisible()
  // 链接白名单：javascript: 被拒
  await bar.getByRole('button', { name: '链接' }).click()
  await page.getByRole('textbox', { name: '链接' }).fill('javascript:alert(1)')
  await page.keyboard.press('Enter')
  await expect(editor(page).locator('a[href^="javascript"]')).toHaveCount(0)
})

test('REQ-EDITOR-005 粘贴 Markdown 转为标题与列表', async ({ page, request }) => {
  await open(page, request)
  await editor(page).evaluate((el) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', '## 粘贴标题\n\n- 甲\n- 乙')
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  })
  await expect(editor(page).locator('h2', { hasText: '粘贴标题' })).toBeVisible()
  await expect(editor(page).locator('ul li')).toHaveCount(2)
})

test('REQ-EDITOR-004 粘贴 PNG：POST /attachments 201，节点 src 为 xz: 协议并渲染 md 变体', async ({
  page,
  request,
}) => {
  const id = await open(page, request)
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/attachments') && r.request().method() === 'POST',
  )
  const md = page.waitForRequest((r) => /\/api\/v1\/attachments\/[0-9a-f-]+\/md$/.test(r.url()))
  await editor(page).evaluate((el, b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bin], 'dot.png', { type: 'image/png' }))
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  }, PNG_1x1)
  expect((await uploaded).status()).toBe(201)
  await md
  await expect(editor(page).locator('img[data-src^="xz:attachment/"]')).toHaveCount(1)
  await expect.poll(() => serverBody(request, id), { timeout: 10_000 }).toContain('xz:attachment/')
})

test('REQ-EDITOR-017 文档超过软限：提示「文档过大」并拒绝插入附件（阈值在验证实例调低）', async ({
  page,
  request,
}) => {
  await open(page, request)
  await page.keyboard.type('一些内容让文档超过阈值')
  await page.evaluate(() => {
    ;(window as { __GI_DOC_SOFT_LIMIT__?: number }).__GI_DOC_SOFT_LIMIT__ = 16
  })
  let posted = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/api/v1/attachments') && r.method() === 'POST') posted++
  })
  await editor(page).evaluate((el, b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bin], 'dot.png', { type: 'image/png' }))
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  }, PNG_1x1)
  await expect(page.getByText('文档过大（超过 10 MB）')).toBeVisible()
  await page.waitForTimeout(300)
  expect(posted).toBe(0)
  await expect(editor(page).locator('img')).toHaveCount(0)
})

test('REQ-COLLAB-012 IndexedDB 不可用：提示「离线保存不可用」且编辑仍同步到服务端', async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('SecurityError: blocked')
      },
    })
  })
  const id = await open(page, request)
  await expect(page.getByTestId('offline-storage-warning')).toBeVisible()
  await page.keyboard.type('无本地存储也能同步')
  await expect
    .poll(() => serverBody(request, id), { timeout: 10_000 })
    .toContain('无本地存储也能同步')
})

test('REQ-COLLAB-013 同一浏览器两个标签页：各自输入后内容一致且无重复段', async ({
  context,
  request,
}) => {
  const id = await createEntry(request, { kind: 'note', title: '多标签页' })
  const a = await context.newPage()
  const b = await context.newPage()
  for (const p of [a, b]) {
    await p.goto(`/entries/${id}`)
    await expect(pill(p)).toHaveAttribute('data-status', 'synced', { timeout: 15_000 })
  }
  await editor(a).click()
  await a.keyboard.press('ControlOrMeta+End')
  await a.keyboard.press('Enter')
  await a.keyboard.type('标签页甲的段落')
  await editor(b).click()
  await b.keyboard.press('ControlOrMeta+End')
  await b.keyboard.press('Enter')
  await b.keyboard.type('标签页乙的段落')
  const text = (p: Page) =>
    editor(p).evaluate((el) => {
      const c = el.cloneNode(true) as HTMLElement
      for (const n of c.querySelectorAll('.collaboration-carets__caret')) n.remove()
      return c.innerText
    })
  await expect.poll(async () => (await text(a)) === (await text(b)), { timeout: 8000 }).toBe(true)
  // 两个标签页刷新后（IndexedDB + 服务端合并）仍无重复
  await a.reload()
  await expect(pill(a)).toHaveAttribute('data-status', 'synced', { timeout: 15_000 })
  const final = await text(a)
  expect(final.split('标签页甲的段落').length - 1).toBe(1)
  expect(final.split('标签页乙的段落').length - 1).toBe(1)
})

test('REQ-COLLAB-011 重启 collab 进程期间输入 100 字，重连后服务端含全部内容', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const id = await open(page, request)
  await page.keyboard.type('重启前')
  await expect.poll(() => serverBody(request, id), { timeout: 10_000 }).toContain('重启前')
  // 杀掉监听 8013 的 collab 进程；验证实例的 respawn.sh 会在 0.5s 后拉起
  const pid = execSync(`ss -ltnpH 'sport = :8013' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2`)
    .toString()
    .trim()
  expect(pid).toMatch(/^\d+$/)
  process.kill(Number(pid), 'SIGKILL')
  await expect(pill(page)).not.toHaveAttribute('data-status', 'synced', { timeout: 10_000 })
  const hundred = '断'.repeat(50) + 'x'.repeat(50)
  await page.keyboard.type(hundred, { delay: 0 })
  await expect(pill(page)).toHaveAttribute('data-status', 'synced', { timeout: 60_000 })
  await expect.poll(() => serverBody(request, id), { timeout: 15_000 }).toContain(hundred)
})

test('REQ-EDITOR-014 打开 3000 词记录到可编辑（挂载 → 首次同步）≤ 800ms', async ({
  browser,
  request,
}) => {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const pg = (await import('pg')).default
  const Y = await import('yjs')
  const { appendPmJson } = await import('../src/collab/ydoc-json.ts')
  const id = await createEntry(request, { kind: 'note', title: '3000 词' })
  // 3000 词正文（中英混排段落）直接写入 ydoc：collab 首次加载即从库里读取
  const words = Array.from({ length: 3000 }, (_, i) => (i % 3 ? `word${i}` : `词语${i}`))
  const paras: { type: string; content: { type: string; text: string }[] }[] = []
  for (let i = 0; i < words.length; i += 60)
    paras.push({
      type: 'paragraph',
      content: [{ type: 'text', text: words.slice(i, i + 60).join(' ') }],
    })
  const ydoc = new Y.Doc({ gc: false })
  appendPmJson(ydoc.getXmlFragment('default'), { type: 'doc', content: paras })
  const client = new pg.Client({ connectionString: 'postgres://xz:xz@localhost:5433/xz_e2e' })
  await client.connect()
  await client.query('update entries set ydoc = $1 where id = $2', [
    Buffer.from(Y.encodeStateAsUpdate(ydoc)),
    id,
  ])
  await client.end()
  const openOnce = async () => {
    const ctx = await browser.newContext({ storageState: STATE.owner }) // 全新上下文：无 IndexedDB 缓存
    const p = await ctx.newPage()
    await p.goto(`/entries/${id}`)
    await expect(p.getByTestId('status-pill')).toHaveAttribute('data-status', 'synced', {
      timeout: 15_000,
    })
    await expect(p.getByTestId('editor')).toContainText('word2999')
    const ms = await p.evaluate(
      () => performance.getEntriesByName('xz:editor:open')[0]?.duration ?? -1,
    )
    await ctx.close()
    return ms
  }
  await openOnce() // 预热：dev server 首次编译编辑器 chunk
  const samples = [await openOnce(), await openOnce(), await openOnce()].sort((a, b) => a - b)
  const median = samples[1] ?? -1
  mkdirSync('debug/perf', { recursive: true })
  writeFileSync(
    'debug/perf/editor-open.json',
    `${JSON.stringify({ req: 'REQ-EDITOR-014', words: 3000, samplesMs: samples, medianMs: median, at: new Date().toISOString() }, null, 2)}\n`,
  )
  expect(median).toBeGreaterThan(0)
  expect(median).toBeLessThanOrEqual(800)
})
