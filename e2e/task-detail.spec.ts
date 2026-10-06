/**
 * ADR-0053 任务详情：今日 / 收件箱就地打开（REQ-TASK-045）· 自定义字段选择器 + 计划按用户时区（REQ-TASK-046）·
 * 任务页 ≥ 1280 常驻详情栏、< 1440 收起清单栏（REQ-TASK-034 注）。
 * xz_e2e 共用：任务名带随机后缀，只断言自己建的；用完删除。
 */
import { randomUUID } from 'node:crypto'
import { type APIRequestContext, expect, test } from '@playwright/test'
import { addDays, type LocalDate, localDateOf } from '../src/shared/tz.ts'
import { STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const headers = () => ({ ...sameSite, 'idempotency-key': randomUUID() })
const ymd = (d: LocalDate) =>
  `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`

async function mkTask(request: APIRequestContext, data: Record<string, unknown>) {
  const r = await request.post('/api/v1/tasks', { data, headers: headers() })
  expect(r.status(), await r.text()).toBe(201)
  return ((await r.json()) as { id: string }).id
}
const getTask = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/v1/tasks/${id}`)).json()) as {
    status: string
    priority: number
    assigneeId: string | null
    scheduledAt: string | null
  }
const drop = (request: APIRequestContext, id: string) =>
  request.delete(`/api/v1/tasks/${id}?permanent=1`, { headers: sameSite })

test('REQ-TASK-045 收件箱点「›」详情就地打开（URL 仍是 /inbox?task=），Esc 关闭留在收件箱；今日 ?task= 深链同样就地', async ({
  page,
  request,
}) => {
  const s = stamp()
  const id = await mkTask(request, { title: `就地详情 ${s}`, status: 'inbox' })
  try {
    await page.goto('/inbox')
    const row = page.locator(`[data-testid="task-row"][data-task-id="${id}"]`)
    await row.hover()
    await row.getByTestId('task-open').click()
    await expect(page).toHaveURL(new RegExp(`/inbox\\?task=${id}`))
    const sheet = page.getByTestId('task-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId('task-title')).toContainText(`就地详情 ${s}`)
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(/\/inbox$/)

    await page.goto(`/today?task=${id}`)
    await expect(page.getByTestId('task-sheet')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/today$/)
  } finally {
    await drop(request, id)
  }
})

test('REQ-TASK-046 详情字段：状态 / 优先级 / 指派用自定义选择器；计划按用户时区，不选时间 = 当天 00:00', async ({
  page,
  request,
}) => {
  const s = stamp()
  const id = await mkTask(request, { title: `字段 ${s}`, status: 'todo' })
  const me = (await (await request.get('/api/v1/me')).json()) as { id: string }
  try {
    await page.goto(`/tasks?task=${id}`)
    const sheet = page.getByTestId('task-sheet')
    await expect(sheet).toBeVisible()

    await sheet.getByTestId('field-status').click()
    await page.getByTestId('status-picker').locator('button[data-status="doing"]').click()
    await expect.poll(async () => (await getTask(request, id)).status).toBe('doing')
    await expect(sheet.getByTestId('field-status')).toContainText('进行中')

    await sheet.getByTestId('field-priority').click()
    await page.getByTestId('priority-picker').locator('button[data-priority="4"]').click()
    await expect.poll(async () => (await getTask(request, id)).priority).toBe(4)
    await expect(sheet.getByTestId('field-priority').getByTestId('task-prio-chip')).toHaveText(
      '紧急',
    )

    await sheet.getByTestId('field-assignee').click()
    await page.getByTestId('assignee-picker').locator(`button[data-user-id="${me.id}"]`).click()
    await expect.poll(async () => (await getTask(request, id)).assigneeId).toBe(me.id)

    // 计划：选「明天」不选时间 → 明天 00:00（Asia/Shanghai = 前一天 16:00Z）
    await sheet.getByTestId('field-scheduled').click()
    await page.getByTestId('due-picker').getByTestId('due-quick-tomorrow').click()
    const tomorrow = addDays(localDateOf('Asia/Shanghai', new Date()), 1)
    const want = new Date(`${ymd(tomorrow)}T00:00:00+08:00`).toISOString()
    await expect.poll(async () => (await getTask(request, id)).scheduledAt).toBe(want)
  } finally {
    await drop(request, id)
  }
})

test('REQ-TASK-034 1280 宽：任务页详情为常驻栏（不遮挡列表、Esc 关闭），清单栏收起换成胶囊条；1440 宽清单栏与详情并存', async ({
  page,
  request,
}) => {
  const s = stamp()
  const id = await mkTask(request, { title: `常驻栏 ${s}`, status: 'todo' })
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/tasks?task=${id}`)
    const sheet = page.getByTestId('task-sheet')
    await expect(sheet).toHaveAttribute('data-variant', 'panel')
    await expect(page.locator('.scrim')).toHaveCount(0)
    await expect(page.getByTestId('tasks-rail')).toBeHidden()
    await expect(page.getByTestId('tasks-scopes')).toBeVisible()
    // 列表仍可用（不被遮挡）
    await expect(page.getByTestId('quick-add-input')).toBeVisible()
    await sheet.getByTestId('task-title').click()
    await page.keyboard.press('Escape') // 先退出标题编辑
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(page.getByTestId('tasks-rail')).toBeVisible()

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/tasks?task=${id}`)
    await expect(page.getByTestId('task-sheet')).toHaveAttribute('data-variant', 'panel')
    await expect(page.getByTestId('tasks-rail')).toBeVisible()
  } finally {
    await drop(request, id)
  }
})
