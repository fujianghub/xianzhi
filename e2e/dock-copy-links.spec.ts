/**
 * ADR-0054：任务行「+ 清单 / + 标签」与记录表格标签就地改（REQ-TASK-047 · REQ-ENTRY-040）· 右侧详情坞（REQ-TASK-048 · REQ-ENTRY-041）·
 * 记录复制 / 移动（REQ-ENTRY-038 · 039）· 网页卡片 / 链接气泡（REQ-LINK-008）。
 * xz_e2e 共用：标题带随机后缀，只断言自己建的；用完删除。桌面 1280 宽 ≥ lg，详情走坞。
 */
import { randomUUID } from 'node:crypto'
import { type APIRequestContext, expect, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const headers = () => ({ ...sameSite, 'idempotency-key': randomUUID() })

async function mkTask(request: APIRequestContext, data: Record<string, unknown>) {
  const r = await request.post('/api/v1/tasks', { data, headers: headers() })
  expect(r.status(), await r.text()).toBe(201)
  return ((await r.json()) as { id: string }).id
}
async function mkTag(request: APIRequestContext, name: string) {
  const r = await request.post('/api/v1/tags', {
    data: { name, color: 'green' },
    headers: headers(),
  })
  expect(r.status(), await r.text()).toBeLessThan(300)
  return ((await r.json()) as { id: string }).id
}
const getJson = async <T>(request: APIRequestContext, path: string) =>
  (await (await request.get(path)).json()) as T
const personalSpace = async (request: APIRequestContext) =>
  (
    await getJson<{ items: { id: string; isPersonal: boolean; slug: string }[] }>(
      request,
      '/api/v1/spaces',
    )
  ).items.find((s) => s.isPersonal) as { id: string; slug: string }

test('REQ-TASK-047 无清单 / 无标签的任务行悬停露出「+ 清单」「+ 标签」，点开直接改', async ({
  page,
  request,
}) => {
  const s = stamp()
  const tag = await mkTag(request, `行标签${s}`)
  const id = await mkTask(request, { title: `行内改 ${s}`, status: 'inbox' })
  try {
    await page.goto('/inbox')
    const row = page.locator(`[data-testid="task-row"][data-task-id="${id}"]`)
    await row.hover()
    await expect(row.getByTestId('task-list-add')).toBeVisible()
    await row.getByTestId('task-tags-add').click()
    await page.getByTestId('tag-input').fill(`行标签${s}`)
    await page.getByRole('button', { name: `行标签${s}`, exact: true }).click()
    await page.keyboard.press('Escape')
    await expect
      .poll(async () =>
        (await getJson<{ tags: { id: string }[] }>(request, `/api/v1/tasks/${id}`)).tags.map(
          (x) => x.id,
        ),
      )
      .toEqual([tag])
    await expect(row.getByTestId('task-tags')).toContainText(`行标签${s}`)
  } finally {
    await request.delete(`/api/v1/tasks/${id}?permanent=1`, { headers: sameSite })
    await request.delete(`/api/v1/tags/${tag}`, { headers: sameSite })
  }
})

test('REQ-TASK-048 收件箱 ≥ lg 打开详情 = 右侧详情坞（不遮挡、列表仍可点），Esc 关闭', async ({
  page,
  request,
}) => {
  const s = stamp()
  const a = await mkTask(request, { title: `坞甲 ${s}`, status: 'inbox' })
  const b = await mkTask(request, { title: `坞乙 ${s}`, status: 'inbox' })
  try {
    await page.goto(`/inbox?task=${a}`)
    const dock = page.getByTestId('task-sheet')
    await expect(dock).toHaveAttribute('data-variant', 'panel')
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)
    // 主区让位：列表行不被坞盖住，可直接换到另一条
    const rowB = page.locator(`[data-testid="task-row"][data-task-id="${b}"]`)
    const rb = await rowB.boundingBox()
    const db = await dock.boundingBox()
    expect(rb && db && rb.x + rb.width <= db.x + 1).toBeTruthy()
    await rowB.hover()
    await rowB.getByTestId('task-open').click()
    await expect(page).toHaveURL(new RegExp(`task=${b}`))
    await expect(dock.getByTestId('task-title')).toContainText(`坞乙 ${s}`)
    await dock.click({ position: { x: 40, y: 200 } })
    await page.keyboard.press('Escape')
    await expect(dock).toBeHidden()
  } finally {
    for (const id of [a, b])
      await request.delete(`/api/v1/tasks/${id}?permanent=1`, { headers: sameSite })
  }
})

test('REQ-ENTRY-041 · 040 记录列表点标题在右侧坞展开（不跳页、可改标题与正文）；标签列就地改', async ({
  page,
  request,
}) => {
  const s = stamp()
  const sp = await personalSpace(request)
  const id = await createEntry(request, { kind: 'note', title: `坞记录 ${s}`, spaceId: sp.id })
  const tag = await mkTag(request, `表标签${s}`)
  try {
    await page.goto(`/entries?q=${encodeURIComponent(s)}`)
    const row = page.locator(`[data-testid="entry-row"][data-entry-id="${id}"]`)
    await row.getByRole('link', { name: `坞记录 ${s}` }).click()
    await expect(page).toHaveURL(/\/entries\?/)
    const dock = page.getByTestId('entry-dock')
    await expect(dock).toBeVisible()
    await expect(row).toHaveAttribute('data-active', 'true')
    await expect(dock.locator('.ProseMirror')).toBeVisible()
    // 标题就地改
    const title = dock.getByTestId('entry-dock-title')
    await title.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type(`坞记录改 ${s}`)
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => (await getJson<{ title: string }>(request, `/api/v1/entries/${id}`)).title)
      .toBe(`坞记录改 ${s}`)
    // 标签列就地改（关闭时一次提交）
    await row.getByTestId('cell-tags').click()
    await page.getByTestId('tag-input').fill(`表标签${s}`)
    await page.getByRole('button', { name: `表标签${s}`, exact: true }).click()
    await page.keyboard.press('Escape')
    await expect
      .poll(
        async () => (await getJson<{ tagIds: string[] }>(request, `/api/v1/entries/${id}`)).tagIds,
      )
      .toEqual([tag])
    // 打开完整页面
    await dock.getByTestId('entry-dock-full').click()
    await expect(page).toHaveURL(new RegExp(`/entries/${id}`))
    await expect(page.getByTestId('entry-dock')).toBeHidden()
  } finally {
    await request.delete(`/api/v1/entries/${id}`, { headers: sameSite })
    await request.delete(`/api/v1/tags/${tag}`, { headers: sameSite })
  }
})

test('REQ-ENTRY-038 · 039 ⋯ 菜单「创建副本」与「移动到…」', async ({ page, request }) => {
  const s = stamp()
  const sp = await personalSpace(request)
  const spaces = await getJson<{
    items: { id: string; isPersonal: boolean; myRole: string | null; archivedAt: string | null }[]
  }>(request, '/api/v1/spaces')
  const other = spaces.items.find(
    (x) => !x.isPersonal && !x.archivedAt && (x.myRole === 'admin' || x.myRole === 'member'),
  )
  const id = await createEntry(request, { kind: 'note', title: `可复制 ${s}`, spaceId: sp.id })
  const made: string[] = [id]
  try {
    await page.goto(`/entries/${id}`)
    await page.getByTestId('entry-menu').click()
    await page.getByTestId('entry-menu-duplicate').click()
    await expect(page.getByText(`已创建副本「可复制 ${s} 副本」`)).toBeVisible()
    const list = await getJson<{ items: { id: string; title: string }[] }>(
      request,
      `/api/v1/entries?q=${encodeURIComponent(s)}`,
    )
    const copy = list.items.find((e) => e.title === `可复制 ${s} 副本`)
    expect(copy).toBeTruthy()
    if (copy) made.push(copy.id)

    test.skip(!other, 'xz_e2e 里没有可写的非个人空间')
    await page.getByTestId('entry-menu').click()
    await page.getByTestId('entry-menu-move-to').click()
    const dlg = page.getByTestId('entry-place-dialog')
    await dlg.getByTestId('entry-place-space').selectOption(other?.id ?? '')
    await dlg.getByTestId('entry-place-where').selectOption({ index: 1 }) // 不放进目录
    await dlg.getByTestId('entry-place-submit').click()
    await expect
      .poll(
        async () =>
          (await getJson<{ spaceId: string; visibility: string }>(request, `/api/v1/entries/${id}`))
            .spaceId,
      )
      .toBe(other?.id)
    expect(
      (await getJson<{ visibility: string }>(request, `/api/v1/entries/${id}`)).visibility,
    ).toBe('space')
  } finally {
    for (const e of made) await request.delete(`/api/v1/entries/${e}`, { headers: sameSite })
  }
})

test('REQ-LINK-008 斜杠「网页卡片」输入网址成卡片；光标在链接上出链接气泡，可转成卡片', async ({
  page,
  request,
}) => {
  const s = stamp()
  const sp = await personalSpace(request)
  const id = await createEntry(request, {
    kind: 'note',
    title: `链接 ${s}`,
    spaceId: sp.id,
    templateId: 'builtin:blank',
  })
  try {
    await page.goto(`/entries/${id}`)
    const pm = page.locator('.ProseMirror')
    await pm.click()
    await page.keyboard.type('/网页卡片')
    await page.keyboard.press('Enter')
    const input = page.getByTestId('link-card-input')
    await expect(input).toBeFocused()
    await input.fill('https://example.com/')
    await input.press('Enter')
    const card = page.getByTestId('link-card').first()
    await expect(card).toContainText('https://example.com/')
    await expect(card.locator('a')).toHaveAttribute('href', 'https://example.com/')

    // 光标落在链接里 → 链接气泡（卡片后有一个空段落）
    await pm.locator('p').last().click()
    // 自动识别：输入网址后敲空格即成链接
    await page.keyboard.type('看 https://example.org/ ')
    const link = pm.locator('a[href="https://example.org/"]')
    await expect(link).toBeVisible()
    await link.click()
    const bubble = page.getByTestId('link-bubble')
    await expect(bubble).toBeVisible()
    await bubble.getByTestId('link-bubble-as-card').click()
    await expect(page.getByTestId('link-card')).toHaveCount(2)
  } finally {
    await request.delete(`/api/v1/entries/${id}`, { headers: sameSite })
  }
})

test('REQ-UI-052 常见视口下各页无整页横向滚动；手机宽度记录页默认卡片视图', async ({ page }) => {
  test.setTimeout(180_000) // 6 个视口 × 6 页
  const sizes: [number, number][] = [
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1280, 800],
    [1366, 768],
    [1920, 1080],
  ]
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h })
    for (const p of ['/today', '/tasks', '/inbox', '/entries', '/calendar', '/spaces']) {
      // 实时流（SSE）常开，等不到 networkidle：等首屏渲染后稍候
      await page.goto(p)
      await page.waitForLoadState('load')
      await page.waitForTimeout(400)
      const [sw, vw] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ])
      expect(sw, `${w}x${h} ${p}`).toBeLessThanOrEqual(vw as number)
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/entries')
  await expect(page.getByTestId('entry-card').first()).toBeVisible()
  await expect(page.getByTestId('entry-table')).toHaveCount(0)
})
