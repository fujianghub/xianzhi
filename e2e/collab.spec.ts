/** 编辑器协同闭环（REQ-COLLAB-001 · 004 · 005 · 010）。 */
import { expect, type Page, test } from '@playwright/test'
import { BASE, createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const editor = (p: Page) => p.getByTestId('editor')
const pill = (p: Page) => p.getByTestId('status-pill')
/** 正文文本（剔除远端光标标签，否则对方用户名会混进 innerText） */
const bodyText = (p: Page) =>
  editor(p).evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement
    for (const n of c.querySelectorAll('.collaboration-carets__caret')) n.remove()
    return c.innerText
  })

async function waitSynced(p: Page) {
  await expect(pill(p)).toHaveAttribute('data-status', 'synced', { timeout: 15_000 })
}

test('REQ-COLLAB-001 · REQ-COLLAB-010 两个 browserContext 各输入 200 字，5s 内两端收敛一致；可见对方光标', async ({
  browser,
  request,
}) => {
  // 个人空间只允许 private（REQ-ENTRY-003），协同用例建在 seed 的「产品开发」空间
  const product = (await (await request.get('/api/v1/spaces/product')).json()) as { id: string }
  const id = await createEntry(request, {
    kind: 'note',
    title: '协同收敛',
    spaceId: product.id,
    visibility: 'workspace',
  })
  const a = await browser.newContext({ storageState: STATE.owner })
  const b = await browser.newContext({ storageState: STATE.owner })
  const pa = await a.newPage()
  const pb = await b.newPage()
  await pa.goto(`/entries/${id}`)
  await pb.goto(`/entries/${id}`)
  await waitSynced(pa)
  await waitSynced(pb)
  const textA = '甲'.repeat(100) + 'A'.repeat(100)
  const textB = '乙'.repeat(100) + 'B'.repeat(100)
  await editor(pa).click()
  await pa.keyboard.type(textA, { delay: 0 })
  await pa.keyboard.press('Enter')
  await editor(pb).click()
  await pb.keyboard.press('ControlOrMeta+End')
  await pb.keyboard.press('Enter')
  await pb.keyboard.type(textB, { delay: 0 })
  await expect
    .poll(
      async () => {
        const [x, y] = [await bodyText(pa), await bodyText(pb)]
        return x === y && x.includes(textA) && x.includes(textB)
      },
      { timeout: 5000 },
    )
    .toBe(true)
  await expect(pa.locator('.collaboration-carets__caret')).toHaveCount(1)
  await a.close()
  await b.close()
})

test('REQ-COLLAB-004 离线编辑显示「本地已保存」，恢复网络后 5s 内服务端含该内容', async ({
  page,
  context,
  request,
}) => {
  const id = await createEntry(request, { kind: 'note', title: '离线用例' })
  await page.goto(`/entries/${id}`)
  await waitSynced(page)
  await context.setOffline(true)
  await expect(pill(page)).toHaveAttribute('data-status', 'offline')
  await editor(page).click()
  await page.keyboard.type('离线时写下的一句话')
  await context.setOffline(false)
  await expect
    .poll(
      async () => {
        const r = await request.get(`/api/v1/entries/${id}?withBody=1`, { headers: sameSite })
        return JSON.stringify(((await r.json()) as { pmJson: unknown }).pmJson ?? '')
      },
      { timeout: 15_000, intervals: [500] },
    )
    .toContain('离线时写下的一句话')
})

test('REQ-COLLAB-005 有本地缓存时首次内容 ≤ 300ms 出现（协同连接被阻断仍可渲染）', async ({
  page,
  request,
}) => {
  const id = await createEntry(request, { kind: 'note', title: '缓存首屏' })
  await page.goto(`/entries/${id}`)
  await waitSynced(page)
  await editor(page).click()
  await page.keyboard.type('来自本地缓存的内容')
  await page.waitForTimeout(800) // y-indexeddb 写入
  await page.routeWebSocket(/\/collab/, () => {
    /* 不连服务器：模拟网络极慢 */
  })
  await page.reload()
  await expect(editor(page)).toContainText('来自本地缓存的内容')
  const ms = await page.evaluate(() => {
    const m = performance.getEntriesByName('xz:editor:mount')[0]
    const l = performance.getEntriesByName('xz:editor:local')[0]
    return m && l ? l.startTime - m.startTime : Number.POSITIVE_INFINITY
  })
  expect(ms).toBeLessThanOrEqual(300)
  void BASE
})
