/**
 * ADR-0045 任务行内编辑 · 单个管理菜单 · 页面级批量（REQ-TASK-037 ~ 041）。
 * xz_e2e 共用：每次自建两个清单与几条任务，只在这两个清单里断言，用完删除。
 */
import { randomUUID } from 'node:crypto'
import { type APIRequestContext, expect, test } from '@playwright/test'
import { STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const headers = () => ({ ...sameSite, 'idempotency-key': randomUUID() })

async function setup(request: APIRequestContext) {
  const s = stamp()
  const list = async (name: string) =>
    (
      (await (
        await request.post('/api/v1/task-lists', {
          data: { name, color: 'green' },
          headers: headers(),
        })
      ).json()) as { id: string }
    ).id
  const L = await list(`管理L${s}`)
  const M = await list(`管理M${s}`)
  const day = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() + n)
    d.setHours(23, 59, 0, 0)
    return d.toISOString()
  }
  const mk = async (title: string, dueAt: string | null) =>
    (await (
      await request.post('/api/v1/tasks', {
        data: { title: `${title} ${s}`, status: 'todo', listId: L, dueAt },
        headers: headers(),
      })
    ).json()) as { id: string; title: string }
  const A = await mk('甲', day(0))
  const B = await mk('乙', day(1))
  const C = await mk('丙', null)
  const D = await mk('丁', day(1))
  const cleanup = async () => {
    for (const t of [A, B, C, D])
      await request.delete(`/api/v1/tasks/${t.id}?permanent=1`, { headers: sameSite })
    await request.delete(`/api/v1/task-lists/${L}`, { headers: sameSite })
    await request.delete(`/api/v1/task-lists/${M}`, { headers: sameSite })
  }
  return { s, L, M, A, B, C, D, cleanup }
}

const getTask = async (request: APIRequestContext, id: string) => {
  const r = await request.get(`/api/v1/tasks/${id}`)
  return r.status() === 200
    ? ((await r.json()) as {
        title: string
        status: string
        priority: number
        dueAt: string | null
        list: { id: string } | null
      })
    : null
}

test('REQ-TASK-037 · 038 · 039 行内改名（回车保存 / Esc 取消 / 输入空格不完成）· 点胶囊改日期与优先级 · 右键移到清单 · ⋯ 删除可撤销', async ({
  page,
  request,
}) => {
  const d = await setup(request)
  try {
    await page.goto(`/tasks?list=${d.L}`)
    const row = (id: string) => page.locator(`[data-testid="task-row"][data-task-id="${id}"]`)
    await expect(row(d.A.id)).toBeVisible()

    // 改名：单击标题 → 输入框，输入带空格的新名回车保存
    await row(d.A.id).getByTestId('task-row-title').click()
    const input = row(d.A.id).getByTestId('task-title-input')
    await expect(input).toBeFocused()
    await input.fill(`甲 改过 ${d.s}`)
    await input.press('Enter')
    await expect(row(d.A.id).getByTestId('task-row-title')).toHaveText(`甲 改过 ${d.s}`)
    await expect.poll(async () => (await getTask(request, d.A.id))?.title).toBe(`甲 改过 ${d.s}`)
    expect((await getTask(request, d.A.id))?.status).toBe('todo') // 空格没有触发完成
    // Esc 取消
    await row(d.B.id).getByTestId('task-row-title').click()
    await row(d.B.id).getByTestId('task-title-input').fill('不要这个')
    await row(d.B.id).getByTestId('task-title-input').press('Escape')
    await expect(row(d.B.id).getByTestId('task-row-title')).toHaveText(d.B.title)

    // 无日期的丙：悬停出「日期」占位 → 选明天
    await row(d.C.id).hover()
    await row(d.C.id).getByTestId('task-due-add').click()
    await page.getByTestId('due-picker').getByTestId('due-quick-tomorrow').click()
    await expect.poll(async () => (await getTask(request, d.C.id))?.dueAt).toMatch(/T15:59:00/)

    // 点旗改优先级
    await row(d.A.id).hover()
    await row(d.A.id).getByTestId('task-prio').click()
    await page.getByTestId('priority-picker').locator('button[data-priority="4"]').click()
    await expect.poll(async () => (await getTask(request, d.A.id))?.priority).toBe(4)

    // 右键 → 移到清单 M
    await row(d.D.id).getByTestId('task-row-title').click({ button: 'right' })
    const menu = page.getByTestId('task-menu')
    await expect(menu).toBeVisible()
    await menu.getByTestId('task-menu-list').click()
    await page.getByTestId('list-picker').locator(`[data-list-id="${d.M}"]`).click()
    await expect.poll(async () => (await getTask(request, d.D.id))?.list?.id).toBe(d.M)

    // ⋯ → 删除 → 撤销
    await row(d.B.id).hover()
    await row(d.B.id).getByTestId('task-menu-btn').click()
    await page.getByTestId('task-menu-delete').click()
    await expect(row(d.B.id)).toHaveCount(0)
    await page.getByRole('button', { name: '撤销' }).last().click()
    await expect(row(d.B.id)).toBeVisible()
  } finally {
    await d.cleanup()
  }
})

test('REQ-TASK-038 行内标签多选：⋯ → 标签，连续勾两个都保留（勾选即时显示），关闭时一次提交', async ({
  page,
  request,
}) => {
  const d = await setup(request)
  const mkTag = async (name: string) =>
    (
      (await (
        await request.post('/api/v1/tags', { data: { name, color: 'blue' }, headers: headers() })
      ).json()) as { id: string }
    ).id
  const names = [`多选甲${d.s}`, `多选乙${d.s}`]
  const tagIds = [await mkTag(names[0] as string), await mkTag(names[1] as string)]
  try {
    await page.goto(`/tasks?list=${d.L}`)
    const row = page.locator(`[data-testid="task-row"][data-task-id="${d.C.id}"]`)
    await expect(row).toBeVisible()
    const patches: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && r.url().includes(`/api/v1/tasks/${d.C.id}`))
        patches.push(r.postData() ?? '')
    })
    await row.hover()
    await row.getByTestId('task-menu-btn').click()
    await page.getByTestId('task-menu-tags').click()
    const pop = page.locator('[data-state="open"]').filter({ has: page.getByTestId('tag-input') })
    for (const name of names) {
      await pop.getByTestId('tag-input').fill(name)
      await pop.getByRole('button', { name, exact: true }).click()
      await pop.getByTestId('tag-input').fill('')
    }
    // 两个都显示为已勾选（之前第二次勾选会把第一个冲掉）
    for (const name of names)
      await expect(pop.getByRole('button', { name, exact: true }).locator('svg')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect
      .poll(async () =>
        (
          (await (await request.get(`/api/v1/tasks/${d.C.id}`)).json()) as {
            tags: { name: string }[]
          }
        ).tags
          .map((x) => x.name)
          .sort(),
      )
      .toEqual([...names].sort())
    expect(patches).toHaveLength(1)
    await expect(row.getByTestId('task-tags')).toContainText(names[0] as string)
    await expect(row.getByTestId('task-tags')).toContainText(names[1] as string)
  } finally {
    await d.cleanup()
    for (const id of tagIds) await request.delete(`/api/v1/tags/${id}`, { headers: sameSite })
  }
})

test('REQ-TASK-040 · 041 跨组多选（Ctrl 点 + Shift 连选）→ 批量改优先级、批量完成可撤销；选择模式全选 → 批量删除可撤销', async ({
  page,
  request,
}) => {
  const d = await setup(request)
  try {
    await page.goto(`/tasks?list=${d.L}`)
    const row = (id: string) => page.locator(`[data-testid="task-row"][data-task-id="${id}"]`)
    await expect(row(d.C.id)).toBeVisible()
    // 甲（今天组）Ctrl 点，丙（无日期组）Shift 点：跨组连选甲 → 丙（含中间的乙、丁）
    await row(d.A.id).click({ modifiers: ['Control'], position: { x: 200, y: 10 } })
    await expect(row(d.A.id)).toHaveAttribute('data-selected', '')
    await row(d.C.id).click({ modifiers: ['Shift'], position: { x: 200, y: 10 } })
    const bar = page.getByTestId('batch-bar')
    await expect(bar.getByTestId('batch-count')).toContainText('4')

    await bar.getByTestId('batch-priority').click()
    await page.getByTestId('priority-picker').locator('button[data-priority="1"]').click()
    for (const t of [d.A, d.B, d.C, d.D])
      await expect.poll(async () => (await getTask(request, t.id))?.priority).toBe(1)

    await bar.getByTestId('batch-complete').click()
    await expect.poll(async () => (await getTask(request, d.A.id))?.status).toBe('done')
    await page.getByRole('button', { name: '撤销' }).last().click()
    for (const t of [d.A, d.B, d.C, d.D])
      await expect.poll(async () => (await getTask(request, t.id))?.status).toBe('todo')

    // 选择模式：每行出复选框，全选当前视图 → 批量删除 → 撤销
    await page.getByTestId('select-mode').click()
    await expect(row(d.A.id).getByTestId('task-select')).toBeVisible()
    await page.getByTestId('batch-select-all').click()
    await expect(page.getByTestId('batch-count')).toContainText('4')
    await page.getByTestId('batch-delete').click()
    await expect.poll(async () => getTask(request, d.A.id)).toBeNull()
    await page.getByRole('button', { name: '撤销' }).last().click()
    for (const t of [d.A, d.B, d.C, d.D])
      await expect.poll(async () => (await getTask(request, t.id))?.status).toBe('todo')
  } finally {
    await d.cleanup()
  }
})
