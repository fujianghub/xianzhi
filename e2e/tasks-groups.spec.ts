/**
 * ADR-0050：按清单分组 · 文件夹聚合（REQ-TASK-042）· 相对日期快选（REQ-TASK-043）· Peek 停留触发与完整预览（REQ-UI-007）。
 * xz_e2e 共用：清单 / 任务名带随机后缀，只断言自己建的，用完删清单。
 */
import { randomUUID } from 'node:crypto'
import { type APIRequestContext, expect, test } from '@playwright/test'
import { addDays, addMonthsKeepDay, type LocalDate, localDateOf } from '../src/shared/tz.ts'
import { STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const headers = () => ({ ...sameSite, 'idempotency-key': randomUUID() })
const ymd = (d: LocalDate) =>
  `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`

async function mkList(request: APIRequestContext, data: Record<string, unknown>) {
  const r = await request.post('/api/v1/task-lists', { data, headers: headers() })
  expect(r.status(), await r.text()).toBe(201)
  return ((await r.json()) as { id: string }).id
}
async function mkTask(request: APIRequestContext, data: Record<string, unknown>) {
  const r = await request.post('/api/v1/tasks', {
    data: { status: 'todo', ...data },
    headers: headers(),
  })
  expect(r.status(), await r.text()).toBe(201)
  return ((await r.json()) as { id: string }).id
}
const getTask = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/v1/tasks/${id}`)).json()) as {
    dueAt: string | null
    list: { id: string } | null
  }

test('REQ-TASK-042 点文件夹 = 聚合其下清单、按清单分组；组内添加归进该组清单；箭头单独折叠；单个清单里没有「按清单分组」', async ({
  page,
  request,
}) => {
  const s = stamp()
  const folder = await mkList(request, { kind: 'folder', name: `夹${s}` })
  const a = await mkList(request, { name: `甲${s}`, color: 'blue', parentId: folder })
  const b = await mkList(request, { name: `乙${s}`, color: 'green', parentId: folder })
  const out = await mkList(request, { name: `外${s}`, color: 'red' })
  try {
    await mkTask(request, { title: `甲任务 ${s}`, listId: a })
    await mkTask(request, { title: `乙任务 ${s}`, listId: b })
    await mkTask(request, { title: `外任务 ${s}`, listId: out })

    await page.goto('/tasks')
    const rail = page.getByTestId('tasks-rail')
    await rail.locator(`[data-testid="rail-folder"][data-folder-id="${folder}"]`).click()
    await expect(page).toHaveURL(new RegExp(`folder=${folder}`))
    await expect(page.getByTestId('tasks-title')).toHaveText(`夹${s}`)
    await expect(page.getByTestId('tasks-group-mode')).toHaveValue('list')
    const ga = page.getByTestId(`tasks-group-${a}`)
    const gb = page.getByTestId(`tasks-group-${b}`)
    await expect(ga.getByTestId('task-row').filter({ hasText: `甲任务 ${s}` })).toBeVisible()
    await expect(gb.getByTestId('task-row').filter({ hasText: `乙任务 ${s}` })).toBeVisible()
    await expect(page.getByTestId('task-row').filter({ hasText: `外任务 ${s}` })).toHaveCount(0)
    // 文件夹视图没有「未归类」组
    await expect(page.getByTestId('tasks-group-unlisted')).toHaveCount(0)

    // 组内就地添加：归进该组的清单
    await gb.hover()
    await gb.getByTestId('group-add').click()
    const inline = page.getByTestId('group-quick-add').getByTestId('quick-add-input')
    await inline.fill(`乙新增 ${s}`)
    await inline.press('Enter')
    await expect(gb.getByTestId('task-row').filter({ hasText: `乙新增 ${s}` })).toBeVisible()
    const found = (await (
      await request.get(`/api/v1/tasks?view=mine&q=${encodeURIComponent(`乙新增 ${s}`)}`)
    ).json()) as { items: { list: { id: string } | null }[] }
    expect(found.items[0]?.list?.id).toBe(b)

    // 箭头折叠：文件夹下的清单收起，视图不变
    const kids = rail.locator(`[data-testid="rail-list"][data-list-id="${a}"]`)
    await expect(kids).toBeVisible()
    await rail
      .locator('li', { has: page.locator(`[data-folder-id="${folder}"]`) })
      .getByTestId('rail-folder-toggle')
      .click()
    await expect(kids).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`folder=${folder}`))

    // 全部 + 按清单分组：末尾有「未归类」组（标题是文案，不是 key）
    await page.goto('/tasks?group=list')
    await expect(
      page.getByTestId('tasks-group-unlisted').locator('.xz-group-head button').first(),
    ).toHaveText('未归类')

    // 单个清单：没有「按清单分组」选项；URL 带 group=list 回落到不分组（ADR-0051）
    await page.goto(`/tasks?list=${a}&group=list`)
    await expect(page.getByTestId('tasks-group-mode')).toHaveValue('none')
    await expect(page.getByTestId('tasks-group-mode').locator('option[value="list"]')).toHaveCount(
      0,
    )
  } finally {
    for (const id of [a, b, out, folder])
      await request.delete(`/api/v1/task-lists/${id}`, { headers: sameSite })
  }
})

test('REQ-TASK-044 默认按清单分组：「全部」/ 智能清单打开即按清单分组（末尾「未归类」），单个清单为不分组；选过的分组方式本机记住', async ({
  page,
}) => {
  await page.goto('/tasks')
  await expect(page.getByTestId('tasks-group-mode')).toHaveValue('list')
  await expect(page.getByTestId('tasks-group-unlisted')).toBeVisible()
  await page.getByTestId('rail-next7').click()
  await expect(page.getByTestId('tasks-group-mode')).toHaveValue('list')
  // 选「按日期」后换视图、刷新仍按日期
  await page.getByTestId('tasks-group-mode').selectOption('date')
  await page.goto('/tasks')
  await expect(page.getByTestId('tasks-group-mode')).toHaveValue('date')
})

test('REQ-TASK-043 日期快选：选择器「1 周后」、单个菜单「1 个月后」按用户时区落到对应日 23:59', async ({
  page,
  request,
}) => {
  const s = stamp()
  const list = await mkList(request, { name: `快选${s}`, color: 'purple' })
  try {
    const id = await mkTask(request, { title: `快选任务 ${s}`, listId: list })
    const today = localDateOf('Asia/Shanghai', new Date())
    await page.goto(`/tasks?list=${list}`)
    const row = page.getByTestId('task-row').filter({ hasText: `快选任务 ${s}` })
    await row.hover()
    await row.getByTestId('task-due-add').click()
    const picker = page.getByTestId('due-picker')
    await expect(picker.getByTestId('due-quick-in1y')).toBeVisible()
    await picker.getByTestId('due-quick-in1w').click()
    await expect
      .poll(async () => (await getTask(request, id)).dueAt)
      .toBe(`${ymd(addDays(today, 7))}T15:59:00.000Z`)

    await row.hover()
    await row.getByTestId('task-menu-btn').click()
    await page.getByTestId('task-menu-due-in1m').click()
    await expect
      .poll(async () => (await getTask(request, id)).dueAt)
      .toBe(`${ymd(addMonthsKeepDay(today, 1))}T15:59:00.000Z`)
  } finally {
    await request.delete(`/api/v1/task-lists/${list}`, { headers: sameSite })
  }
})

test('REQ-UI-007 Peek：扫过不弹、停留 1 秒才弹；预览摊开全部属性、完整描述与子任务', async ({
  page,
  request,
}) => {
  const s = stamp()
  const list = await mkList(request, { name: `预览${s}`, color: 'yellow' })
  try {
    const lines = Array.from({ length: 16 }, (_, i) => `第 ${i + 1} 段说明 ${s}`)
    const id = await mkTask(request, {
      title: `预览任务 ${s}`,
      listId: list,
      priority: 3,
      descriptionPm: {
        type: 'doc',
        content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
      },
    })
    await mkTask(request, { title: `子任务一 ${s}`, parentId: id })
    await page.goto(`/tasks?list=${list}`)
    const row = page.getByTestId('task-row').filter({ hasText: `预览任务 ${s}` })
    await expect(row).toBeVisible()
    const box = await row.boundingBox()
    if (!box) throw new Error('no box')
    // 在行上一直移动（扫过）：不弹
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(box.x + 40 + i * 30, box.y + box.height / 2)
      await page.waitForTimeout(150)
    }
    const peek = page.getByTestId('peek-panel')
    await expect(peek).toBeHidden()
    // 停住：约 1 秒后弹出
    await page.waitForTimeout(500)
    await expect(peek).toBeHidden()
    await expect(peek).toBeVisible()
    await expect(peek).toContainText(`预览任务 ${s}`)
    await expect(peek).toContainText(`预览${s}`) // 清单
    await expect(peek).toContainText('高') // 优先级
    // 描述完整（不截断）：最后一段也在
    await expect(peek).toContainText(lines[15] as string)
    await expect(peek.getByTestId('peek-subtasks')).toContainText(`子任务一 ${s}`)
  } finally {
    await request.delete(`/api/v1/task-lists/${list}`, { headers: sameSite })
  }
})
