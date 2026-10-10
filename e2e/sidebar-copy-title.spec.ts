/**
 * ADR-0058：侧栏空间胶囊不压过分区引导线（REQ-UI-053）· 侧栏拖动调宽（REQ-UI-054）· 复制标题快捷键（REQ-UI-055）。
 * xz_e2e 共用：名称带随机后缀，只断言自己建的；用完删除。桌面 1280 宽 ≥ lg。
 */
import { randomUUID } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

/** 截获剪贴板写入（不依赖浏览器剪贴板权限） */
async function captureClipboard(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] }
    w.__copied = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (s: string) => {
          w.__copied.push(s)
        },
      },
    })
  })
}
const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)

test('REQ-UI-053 大类分区里的当前空间：胶囊左缘在引导线右侧', async ({ page, request }) => {
  const s = stamp()
  const g = await request.post('/api/v1/space-groups', {
    data: { name: `分区 ${s}`, color: 'blue' },
    headers: sameSite,
  })
  expect(g.status(), await g.text()).toBe(201)
  const groupId = ((await g.json()) as { id: string }).id
  const sp = await request.post('/api/v1/spaces', {
    data: { name: `胶囊 ${s}`, slug: `pill-${s}`, kind: 'project', groupId },
    headers: sameSite,
  })
  expect(sp.status(), await sp.text()).toBe(201)
  const spaceId = ((await sp.json()) as { id: string }).id
  try {
    await page.goto(`/spaces/pill-${s}/home`)
    const section = page.locator(`[data-testid="space-section"][data-group-id="${groupId}"]`)
    const row = section.locator('a[data-active]')
    await expect(row).toBeVisible()
    const guide = section.locator('.xz-guide')
    const rb = await row.boundingBox()
    const gb = await guide.boundingBox()
    if (!rb || !gb) throw new Error('row / guide not visible')
    expect(rb.x).toBeGreaterThanOrEqual(gb.x + gb.width + 4)
  } finally {
    await request.delete(`/api/v1/spaces/${spaceId}?permanent=1`, { headers: sameSite })
    await request.delete(`/api/v1/space-groups/${groupId}`, { headers: sameSite })
  }
})

test('REQ-UI-054 拖动侧栏右缘调宽、夹在 200 ~ 400、刷新保持、双击还原', async ({ page }) => {
  await page.goto('/today')
  const sidebar = page.getByTestId('sidebar')
  const handle = page.getByTestId('sidebar-resizer')
  const width = async () => (await sidebar.boundingBox())?.width ?? 0
  expect(await width()).toBe(240)
  const drag = async (dx: number) => {
    const b = await handle.boundingBox()
    if (!b) throw new Error('handle not visible')
    const x = b.x + b.width / 2
    const y = b.y + b.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y, { steps: 8 })
    await page.mouse.up()
  }
  try {
    await drag(80)
    await expect.poll(width).toBe(320)
    // 主区让位跟着变
    const main = await page.locator('#main').boundingBox()
    expect(main?.x).toBe(320)
    await drag(500)
    await expect.poll(width).toBe(400)
    await expect(handle).toHaveAttribute('aria-valuenow', '400')
    await page.reload()
    await expect.poll(width).toBe(400)
    // 键盘：聚焦后 ← 每次 16
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(width).toBe(384)
    await drag(-600)
    await expect.poll(width).toBe(200)
    await handle.dblclick()
    await expect.poll(width).toBe(240)
    expect(await page.evaluate(() => localStorage.getItem('xz:sidebar-w'))).toBeNull()
  } finally {
    await page.evaluate(() => {
      localStorage.removeItem('xz:sidebar-w')
      document.documentElement.style.removeProperty('--xz-sidebar-w')
    })
  }
})

test('REQ-UI-055 Mod+Shift+C 复制当前任务 / 记录标题（编辑器内也生效），菜单项带快捷键提示', async ({
  page,
  request,
}) => {
  const s = stamp()
  const tr = await request.post('/api/v1/tasks', {
    data: { title: `可复制任务 ${s}`, status: 'inbox' },
    headers: { ...sameSite, 'idempotency-key': randomUUID() },
  })
  expect(tr.status(), await tr.text()).toBe(201)
  const taskId = ((await tr.json()) as { id: string }).id
  const spaces = (await (await request.get('/api/v1/spaces')).json()) as {
    items: { id: string; isPersonal: boolean }[]
  }
  const personal = spaces.items.find((x) => x.isPersonal) as { id: string }
  const entryId = await createEntry(request, {
    kind: 'note',
    title: `可复制记录 ${s}`,
    spaceId: personal.id,
  })
  await captureClipboard(page)
  try {
    // 任务：详情坞打开 → 上下文为该任务
    await page.goto(`/inbox?task=${taskId}`)
    await expect(page.getByTestId('task-sheet').getByTestId('task-title')).toContainText(
      `可复制任务 ${s}`,
    )
    await page.keyboard.press('ControlOrMeta+Shift+C')
    await expect.poll(() => copied(page)).toContain(`可复制任务 ${s}`)
    await expect(page.getByText(`已复制标题「可复制任务 ${s}」`)).toBeVisible()

    // 记录：光标在正文里也生效
    await page.goto(`/entries/${entryId}`)
    const pm = page.locator('.ProseMirror')
    await pm.click()
    await page.keyboard.type('正文')
    await page.keyboard.press('ControlOrMeta+Shift+C')
    await expect.poll(() => copied(page)).toContain(`可复制记录 ${s}`)
    // 列表页的记录详情坞：上下文为坞里的记录
    await page.goto(`/entries?q=${encodeURIComponent(s)}`)
    const erow = page.locator(`[data-testid="entry-row"][data-entry-id="${entryId}"]`)
    await erow.getByRole('link', { name: `可复制记录 ${s}` }).click()
    const dock = page.getByTestId('entry-dock')
    await expect(dock.locator('.ProseMirror')).toBeVisible()
    await page.evaluate(() => {
      ;(window as unknown as { __copied: string[] }).__copied = []
    })
    await dock.locator('.ProseMirror').click()
    await page.keyboard.press('ControlOrMeta+Shift+C')
    await expect.poll(() => copied(page)).toEqual([`可复制记录 ${s}`])
    // 记录菜单有「复制标题」且带快捷键提示
    await page.getByTestId('entry-menu').first().click()
    const item = page.getByTestId('entry-menu-copy-title')
    await expect(item).toContainText('复制标题')
    await expect(item.locator('kbd')).toHaveCount(3)
  } finally {
    await request.delete(`/api/v1/tasks/${taskId}?permanent=1`, { headers: sameSite })
    await request.delete(`/api/v1/entries/${entryId}?permanent=1`, { headers: sameSite })
  }
})
