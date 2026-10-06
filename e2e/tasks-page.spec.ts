/**
 * ADR-0043 任务页（REQ-TASK-025 ~ 028）：快速添加智能识别 → 按日期分组 → 页内详情写文字、插图片 → 勾选完成可撤销。
 * xz_e2e 共用：标题带随机后缀，只断言自己建的那条，不数总数。
 */
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

test('REQ-TASK-025 · 026 · 027 · 028 侧栏「任务」→ 一句话快速添加（明天 !高 #标签）→ 进「明天」组 → 页内详情写文字并插图片 → 勾选完成可撤销', async ({
  page,
  request,
}) => {
  const s = stamp()
  const title = `买牛奶 ${s}`
  await page.goto('/today')
  await page.getByRole('link', { name: '任务', exact: true }).click()
  await expect(page).toHaveURL(/\/tasks/)
  await expect(page.getByTestId('tasks-count')).not.toBeEmpty()
  const input = page.getByTestId('quick-add-input')
  await input.fill(`明天 ${title} !高 #生活${s}`)
  await expect(input).toHaveValue(`明天 ${title} !高 #生活${s}`)
  const tokens = page.getByTestId('quick-add-token')
  await expect(tokens).toHaveCount(3)
  await expect(tokens.nth(0)).toHaveAttribute('data-kind', 'date')
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await expect(input).toBeFocused()

  // 共用库 xz_e2e 累积了大量任务（虚拟列表只渲染视口内的行）：进本次新建的唯一标签视图再看「明天」分组
  await page.goto(`/tasks?tag=${encodeURIComponent(`生活${s}`)}&group=date`)
  const row = page.getByTestId('tasks-group-tomorrow').getByTestId('task-row').filter({
    hasText: title,
  })
  await expect(row).toBeVisible()
  // 服务端：标题已去掉识别片段、优先级高（3）、带标签、截止 = 明天 23:59（用户时区）
  const found = (await (
    await request.get(`/api/v1/tasks?view=mine&q=${encodeURIComponent(s)}`)
  ).json()) as {
    items: {
      id: string
      title: string
      priority: number
      dueAt: string
      tags: { name: string }[]
    }[]
  }
  const task = found.items.find((x) => x.title === title)
  expect(task?.priority).toBe(3)
  expect(task?.tags.map((x) => x.name)).toEqual([`生活${s}`])
  expect(task?.dueAt).toMatch(/T15:59:00/)

  // 点行 → 页内详情（列表仍在）
  // ADR-0045：点标题是改名，打开详情走行尾「›」
  await row.hover()
  await row.getByTestId('task-open').click()
  await expect(page).toHaveURL(/task=/)
  const sheet = page.getByTestId('task-sheet')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('tasks-page')).toBeVisible()
  const editor = sheet.getByTestId('lite-editor')
  await editor.click()
  await page.keyboard.type('牛奶要低脂的')
  const chooser = page.waitForEvent('filechooser')
  await sheet.getByTestId('lite-insert-image').click()
  await (await chooser).setFiles({ name: 'milk.png', mimeType: 'image/png', buffer: PNG_1x1 })
  await expect(editor.locator('img')).toHaveCount(1)
  // 插入即保存：服务端描述里有文字与 xz:attachment 图片
  await expect
    .poll(async () => {
      const r = await request.get(`/api/v1/tasks/${task?.id}`)
      return JSON.stringify(((await r.json()) as { descriptionPm: unknown }).descriptionPm)
    })
    .toMatch(/牛奶要低脂的[\s\S]*xz:attachment\//)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  // 行内勾选完成 → 行移出 → 撤销回来
  await row.getByTestId('task-check').click()
  await expect(row).toBeHidden()
  await page.getByRole('button', { name: '撤销' }).first().click()
  await expect(row).toBeVisible()
  // 用完即删，不在共用库里堆积（不能物理删时软删也可）
  if (task?.id) await request.delete(`/api/v1/tasks/${task.id}?permanent=1`, { headers: sameSite })
})

test('REQ-TASK-029 · 032 · 033 · 034 清单栏新建清单 → 快速添加用按钮选日期「明天」、优先级「紧急」→ 进该清单的「明天」组 → 组内就地添加 → 展开卡片带备注与子任务 → 删清单任务仍在', async ({
  page,
  request,
}) => {
  const s = stamp()
  const listName = `生活${s}`
  await page.goto('/tasks')
  const rail = page.getByTestId('tasks-rail')
  await rail.getByTestId('rail-new-list').click()
  await rail.getByTestId('rail-new-input').fill(listName)
  await rail.getByTestId('rail-new-input').press('Enter')
  // 新建即进入该清单视图
  await expect(page.getByTestId('tasks-title')).toHaveText(listName)
  const listId = new URL(page.url()).searchParams.get('list')
  expect(listId).toBeTruthy()
  // 默认按清单分组（ADR-0051）：本用例要看「明天」组与组内添加，显式按日期分组
  await page.goto(`/tasks?list=${listId}&group=date`)
  await expect(page.getByTestId('tasks-title')).toHaveText(listName)
  try {
    // 快速添加：清单按钮已带上当前清单；按钮选「明天」与「紧急」
    await expect(page.getByTestId('qa-list')).toContainText(listName)
    await page.getByTestId('qa-due').click()
    await page.getByTestId('due-quick-tomorrow').click()
    await page.getByTestId('qa-priority').click()
    await page.getByTestId('priority-picker').locator('button[data-priority="4"]').click()
    const input = page.getByTestId('quick-add').getByTestId('quick-add-input')
    await input.fill(`交电费 ${s}`)
    await input.press('Enter')
    const tomorrow = page.getByTestId('tasks-group-tomorrow')
    const row = tomorrow.getByTestId('task-row').filter({ hasText: `交电费 ${s}` })
    await expect(row).toBeVisible()
    await expect(row.getByTestId('task-check')).toHaveAttribute('data-check-priority', '4')
    await expect(row.getByTestId('task-due')).toHaveAttribute('data-tone', 'tomorrow')
    // 组内就地添加：带组的日期（明天）与当前清单
    await tomorrow.getByTestId('group-add').click()
    const inline = page.getByTestId('group-quick-add').getByTestId('quick-add-input')
    await inline.fill(`取快递 ${s}`)
    await inline.press('Enter')
    await expect(tomorrow.getByTestId('task-row').filter({ hasText: `取快递 ${s}` })).toBeVisible()
    // 展开卡片：备注 + 两条子任务
    await input.fill(`周末大扫除 ${s}`)
    await input.press('Shift+Enter')
    await page.getByTestId('qa-note').fill('厨房和阳台')
    await page.getByTestId('qa-subtask').first().fill('擦窗户')
    await page.getByTestId('qa-subtask').first().press('Enter')
    await page.getByTestId('qa-subtask').nth(1).fill('洗窗帘')
    await page.getByTestId('qa-submit').click()
    const parent = page.getByTestId('task-row').filter({ hasText: `周末大扫除 ${s}` })
    await expect(parent).toBeVisible()
    const found = (await (
      await request.get(`/api/v1/tasks?view=mine&listId=${listId}&q=${encodeURIComponent(s)}`)
    ).json()) as { items: { id: string; title: string; hasDescription: boolean }[] }
    const p = found.items.find((x) => x.title === `周末大扫除 ${s}`)
    expect(p?.hasDescription).toBe(true)
    // 父任务先建好（列表先刷新），子任务随后逐条创建：轮询等齐
    await expect
      .poll(async () => {
        const r = await request.get(`/api/v1/tasks?parentId=${p?.id}`)
        return ((await r.json()) as { items: { title: string }[] }).items.map((x) => x.title).sort()
      })
      .toEqual(['擦窗户', '洗窗帘'])
    expect(found.items.length).toBe(3)
  } finally {
    // 删清单：任务不删、只是移出清单（共用库 xz_e2e，用完即删）
    await request.delete(`/api/v1/task-lists/${listId}`, { headers: sameSite })
  }
  const after = (await (
    await request.get(`/api/v1/tasks?view=mine&q=${encodeURIComponent(s)}`)
  ).json()) as { items: { list: unknown }[] }
  expect(after.items.length).toBe(3)
  expect(after.items.every((x) => x.list === null)).toBe(true)
})

test('REQ-TASK-036 拖拽：拖到左栏清单 → 归入；拖到左栏「明天」→ 截止明天；按优先级分组时拖进空的「紧急」组 → 改优先级；拖到「未归类」→ 移出清单', async ({
  page,
  request,
}) => {
  const s = stamp()
  const mk = async (name: string) =>
    (
      (await (
        await request.post('/api/v1/task-lists', {
          data: { name, color: 'blue' },
          headers: {
            ...sameSite,
            'idempotency-key': randomUUID(),
          },
        })
      ).json()) as { id: string }
    ).id
  const a = await mk(`拖入A${s}`)
  const b = await mk(`拖出B${s}`)
  const title = `拖我 ${s}`
  const created = (await (
    await request.post('/api/v1/tasks', {
      data: { title, status: 'todo', listId: b },
      headers: { ...sameSite, 'idempotency-key': randomUUID() },
    })
  ).json()) as { id: string }
  const get = async () =>
    (await (await request.get(`/api/v1/tasks/${created.id}`)).json()) as {
      list: { id: string } | null
      dueAt: string | null
      priority: number
    }
  // 鼠标拖：按下 → 先挪几像素越过激活距离 → 移到落点 → 松开
  const drag = async (
    from: import('@playwright/test').Locator,
    to: import('@playwright/test').Locator,
  ) => {
    const fb = await from.boundingBox()
    if (!fb) throw new Error('no source box')
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
    await page.mouse.down()
    await page.mouse.move(fb.x + fb.width / 2 + 12, fb.y + fb.height / 2 + 4, { steps: 4 })
    await expect(page.getByTestId('task-drag-overlay')).toBeVisible()
    const tb = await to.boundingBox()
    if (!tb) throw new Error('no target box')
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  const row = () => page.getByTestId('task-row').filter({ hasText: title })
  try {
    await page.goto(`/tasks?list=${b}`)
    await expect(row()).toBeVisible()
    await drag(
      row().getByText(title),
      page.locator(`[data-testid="rail-list"][data-list-id="${a}"]`),
    )
    await expect.poll(async () => (await get()).list?.id).toBe(a)
    await expect(row()).toBeHidden() // 已离开清单 B

    await page.goto(`/tasks?list=${a}&group=date`)
    await expect(row()).toBeVisible()
    await drag(row().getByText(title), page.getByTestId('rail-tomorrow'))
    await expect(
      page.getByTestId('tasks-group-tomorrow').getByTestId('task-row').filter({ hasText: title }),
    ).toBeVisible()
    expect((await get()).dueAt).toMatch(/T15:59:00/)

    await page.goto(`/tasks?list=${a}&group=priority`)
    await expect(row()).toBeVisible()
    const fb = await row().getByText(title).boundingBox()
    if (!fb) throw new Error('no box')
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
    await page.mouse.down()
    await page.mouse.move(fb.x + fb.width / 2 + 12, fb.y + fb.height / 2 + 4, { steps: 4 })
    // 空的「紧急」组在拖动中露出来
    const p4 = page.getByTestId('tasks-group-p4')
    await expect(p4).toBeVisible()
    const tb = await p4.boundingBox()
    if (!tb) throw new Error('no p4 box')
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await get()).priority).toBe(4)

    await drag(row().getByText(title), page.getByTestId('rail-unlisted'))
    await expect.poll(async () => (await get()).list).toBeNull()
  } finally {
    await request.delete(`/api/v1/task-lists/${a}`, { headers: sameSite })
    await request.delete(`/api/v1/task-lists/${b}`, { headers: sameSite })
    await request.delete(`/api/v1/tasks/${created.id}?permanent=1`, { headers: sameSite })
  }
})
