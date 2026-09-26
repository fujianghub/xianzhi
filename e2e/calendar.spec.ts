/** 日历（REQ-UI-031 · REQ-TASK-024 · REQ-CAL-*）与侧栏改版（REQ-UI-032）。 */
import { expect, test } from '@playwright/test'
import { STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

/**
 * xz_e2e 各 worktree 共用、不重建也要能过：固定日期 / 时段会与历次运行留下的数据重叠，触发周视图「+N」折叠（REQ-CAL-011）
 * 把被测项收起来。用例按时间戳挑一个「周一」与时段，基本不撞（见 debug/2026-09-26-e2e-shared-db-data-drift）。
 */
const RUN = Date.now()
/** 2027-01-04（周一）起第 k 周的周一，YYYY-MM-DD */
function mondayAfter(k: number) {
  const d = new Date(Date.UTC(2027, 0, 4) + (k % 400) * 7 * 86_400_000)
  return d.toISOString().slice(0, 10)
}
const addDaysStr = (ymd: string, n: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const pad = (n: number) => String(n).padStart(2, '0')
/** 06:00–19:55 之间按时间戳挑的 5 分钟时段 */
const slotOf = (seed: number) => {
  const m = 6 * 60 + (seed % (14 * 12)) * 5
  return { h: Math.floor(m / 60), m: m % 60 }
}

/** 上海时间「今天 h:m」的 UTC ISO（e2e timezoneId = Asia/Shanghai，owner 时区默认同） */
function todayAt(h: number, m: number) {
  const now = new Date()
  const sh = new Date(now.getTime() + 8 * 3_600_000)
  return new Date(
    Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate(), h - 8, m),
  ).toISOString()
}

test('REQ-UI-031 REQ-CAL-012 月视图显示区间内任务，点击弹快速编辑气泡；w / m 切换视图，周视图有当前时间线；← → t 翻页与回到今天', async ({
  page,
  request,
}) => {
  const product = (await (await request.get('/api/v1/spaces/product')).json()) as { id: string }
  const at = slotOf(RUN)
  const r = await request.post('/api/v1/tasks', {
    data: {
      title: '日历样例 · 下午评审',
      spaceId: product.id,
      status: 'todo',
      dueAt: todayAt(at.h, at.m),
    },
    headers: sameSite,
  })
  expect(r.status()).toBe(201)
  const task = (await r.json()) as { id: string }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/calendar')
  await expect(page.getByTestId('cal-month')).toBeVisible()
  // 今天格：今天标记唯一；事件或「还有 N 项」（e2e 库今天已有多条到期任务，月格只显示 3 条）
  const todayCell = page.locator('[data-testid="cal-day"]:has([aria-current="date"])')
  await expect(todayCell).toHaveCount(1)
  await expect(todayCell.locator('[data-testid="cal-event"]').first()).toBeVisible()

  // 周视图：定时事件全部显示，点击就地弹气泡（不跳转、不开 Peek）
  await page.getByTestId('cal-view-week').click()
  const ev = page.locator(`[data-testid="cal-event"][data-task-id="${task.id}"]`)
  await expect(ev).toBeVisible()
  // 并列 ≥ 3 栏时块内只显示标题，完整信息在 title
  await expect(ev).toHaveAttribute('title', new RegExp(`${pad(at.h)}:${pad(at.m)}`))
  await ev.click()
  await expect(page.getByTestId('cal-quick-task')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('cal-quick')).toBeHidden()
  await page.getByTestId('cal-view-month').click()

  const title = await page.getByTestId('cal-title').innerText()
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/date=/)
  await expect(page.getByTestId('cal-title')).not.toHaveText(title)
  await page.keyboard.press('t')
  await expect(page).not.toHaveURL(/date=/)

  await page.keyboard.press('w')
  await expect(page).toHaveURL(/view=week/)
  await expect(page.getByTestId('cal-week')).toBeVisible()
  await expect(page.getByTestId('cal-now')).toBeVisible()
  await expect(ev).toBeVisible()
  await page.keyboard.press('m')
  await expect(page.getByTestId('cal-month')).toBeVisible()
})

test('REQ-UI-032 侧栏：整高实玻璃 + 右侧分隔；当前项为翡翠胶囊（data-active + aria-current），无左侧竖条；日历入口可用', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/today')
  const side = page.getByTestId('sidebar')
  await expect(side).toHaveCSS('border-right-width', '1px')
  const box = await side.boundingBox()
  expect(Math.round(box?.height ?? 0)).toBe(800)
  const active = side.locator('.xz-nav-item[data-active]')
  await expect(active).toHaveCount(1)
  await expect(active).toHaveAttribute('aria-current', 'page')
  expect(await active.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('gradient')
  expect(await active.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none')
  await side.getByRole('link', { name: '日历' }).click()
  await expect(page).toHaveURL(/\/calendar/)
  await expect(side.locator('.xz-nav-item[data-active]')).toContainText('日历')
})

test('REQ-UI-034 宽屏今日页：四枚计数卡 + 右侧速览栏；1280 宽不出速览栏', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1000 })
  await page.goto('/today')
  await expect(page.getByTestId('today-stats').locator(':scope > div')).toHaveCount(4)
  await expect(page.getByTestId('glance-rail')).toBeVisible()
  await expect(page.getByTestId('glance-schedule')).toBeVisible()
  await page.setViewportSize({ width: 1279, height: 800 })
  await expect(page.getByTestId('glance-rail')).toBeHidden()
})

// ---------------------------------------------------------------- ADR-0009 日程

test('REQ-CAL-007 月视图标注法定节假日「休」与调休「班」，农历小字可见', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/calendar?date=2026-10-01')
  const off = page.locator('[data-testid="cal-day"][data-date="2026-10-01"]')
  await expect(off.getByTestId('cal-off')).toHaveText('休')
  const work = page.locator('[data-testid="cal-day"][data-date="2026-10-10"]')
  await expect(work.getByTestId('cal-work')).toHaveText('班')
  await expect(off.getByTestId('cal-lunar')).toBeVisible()
})

test('REQ-CAL-002 · 003 周视图点空白新建 → 拖动改期 → 点开删除', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/calendar?view=week&date=2026-11-16')
  const timeline = page.getByTestId('cal-timeline')
  await timeline.evaluate((el) => {
    el.scrollTop = 9 * 48
  })
  const col = page.locator('[data-testid="cal-col"][data-date="2026-11-18"]')
  const box = await col.boundingBox()
  if (!box) throw new Error('no column')
  // 10:05 → 新建 10:00–11:00
  await page.mouse.click(box.x + box.width / 2, box.y + 10 * 48 + 4)
  const editor = page.getByTestId('cal-editor')
  await expect(editor).toBeVisible()
  await expect(page.getByTestId('cal-editor-start-time')).toHaveValue('10:00')
  const title = `e2e 日程 ${Date.now()}`
  await page.getByTestId('cal-editor-title').fill(title)
  await page.getByTestId('cal-editor-save').click()
  await expect(editor).toBeHidden()
  const ev = page.locator('[data-testid="cal-event"][data-source="event"]', { hasText: title })
  await expect(ev).toBeVisible()
  await expect(ev).toHaveAttribute('title', /10:00–11:00/)

  // 向下拖 1 小时
  const eb = await ev.boundingBox()
  if (!eb) throw new Error('no event box')
  await page.mouse.move(eb.x + eb.width / 2, eb.y + 10)
  await page.mouse.down()
  await page.mouse.move(eb.x + eb.width / 2, eb.y + 10 + 48, { steps: 8 })
  await page.mouse.up()
  await expect(ev).toHaveAttribute('title', /11:00–12:00/)

  // 点开气泡 → 删除
  await ev.click()
  await expect(page.getByTestId('cal-quick-event')).toBeVisible()
  await page.getByTestId('cal-quick-delete').click()
  await expect(page.getByTestId('cal-quick')).toBeHidden()
  await expect(ev).toHaveCount(0)
})

test('REQ-CAL-005 重复日程删除「仅此日程」只去掉这一次', async ({ page, request }) => {
  const cals = (await (await request.get('/api/v1/calendars')).json()) as {
    items: { id: string }[]
  }
  const title = `e2e 晨读 ${Date.now()}`
  const mon = mondayAfter(Math.floor(RUN / 1000))
  const at = slotOf(RUN + 7)
  const r = await request.post('/api/v1/calendar-events', {
    data: {
      calendarId: cals.items[0]?.id,
      title,
      startAt: `${mon}T${pad(at.h)}:${pad(at.m)}:00+08:00`,
      endAt: `${mon}T${pad(at.h + 1)}:${pad(at.m)}:00+08:00`,
      timezone: 'Asia/Shanghai',
      rrule: 'FREQ=DAILY;COUNT=5',
    },
    headers: { ...sameSite, 'idempotency-key': crypto.randomUUID() },
  })
  expect(r.status()).toBe(201)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/calendar?view=week&date=${mon}`)
  const evs = page.locator('[data-testid="cal-event"][data-source="event"]', { hasText: title })
  await expect(evs).toHaveCount(5)
  await evs.nth(1).click()
  await page.getByTestId('cal-quick-delete').click()
  await expect(page.getByTestId('cal-scope-dialog')).toBeVisible()
  await page.getByTestId('cal-scope-this').click()
  await expect(evs).toHaveCount(4)
})

test('REQ-CAL-010 月视图按住拖选 9/9 → 9/11 新建跨日全天日程；反向拖同样有效；单击仍为单日', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/calendar?view=month&date=2026-09-15')
  const cell = (d: string) => page.locator(`[data-testid="cal-day"][data-date="${d}"]`)
  // 按在格子下半部空白处（上半部有日期号按钮）
  const spot = async (d: string) => {
    const b = await cell(d).boundingBox()
    if (!b) throw new Error(`no cell ${d}`)
    return { x: b.x + b.width / 2, y: b.y + b.height - 8 }
  }
  const drag = async (from: string, to: string) => {
    const a = await spot(from)
    const b = await spot(to)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 10 })
    await expect(cell(from)).toHaveAttribute('data-selecting', 'true')
    await page.mouse.up()
  }
  const editor = page.getByTestId('cal-editor')

  await drag('2026-09-09', '2026-09-11')
  await expect(editor).toBeVisible()
  await expect(page.getByTestId('cal-editor-allday')).toBeChecked()
  await expect(page.getByTestId('cal-editor-start-date')).toHaveValue('2026-09-09')
  await expect(page.getByTestId('cal-editor-end-date')).toHaveValue('2026-09-11')
  const title = `e2e 拖选 ${Date.now()}`
  await page.getByTestId('cal-editor-title').fill(title)
  await page.getByTestId('cal-editor-save').click()
  await expect(editor).toBeHidden()
  for (const d of ['2026-09-09', '2026-09-10', '2026-09-11'])
    await expect(cell(d).getByTestId('cal-event').filter({ hasText: title })).toBeVisible()
  await expect(cell('2026-09-12').getByTestId('cal-event').filter({ hasText: title })).toHaveCount(
    0,
  )

  // 反向拖
  await drag('2026-09-24', '2026-09-22')
  await expect(page.getByTestId('cal-editor-start-date')).toHaveValue('2026-09-22')
  await expect(page.getByTestId('cal-editor-end-date')).toHaveValue('2026-09-24')
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()

  // 单击 = 单日
  const one = await spot('2026-09-16')
  await page.mouse.click(one.x, one.y)
  await expect(page.getByTestId('cal-editor-start-date')).toHaveValue('2026-09-16')
  await expect(page.getByTestId('cal-editor-end-date')).toHaveValue('2026-09-16')
  await page.keyboard.press('Escape')

  // 清理（点开 = 快速编辑气泡，REQ-CAL-012）
  await cell('2026-09-10').getByTestId('cal-event').filter({ hasText: title }).click()
  await page.getByTestId('cal-quick-delete').click()
  await expect(cell('2026-09-10').getByTestId('cal-event').filter({ hasText: title })).toHaveCount(
    0,
  )
})

test('REQ-CAL-011 周视图同一时段 3 个日程：只并排 1 个 + 「+N」按钮（≥ 24px），点「+N」进当天日视图全部可见', async ({
  page,
  request,
}) => {
  const cals = (await (await request.get('/api/v1/calendars')).json()) as {
    items: { id: string }[]
  }
  const stamp = Date.now().toString(36)
  const titles = ['甲', '乙', '丙'].map((x) => `e2e 并排${x} ${stamp}`)
  for (const title of titles) {
    const r = await request.post('/api/v1/calendar-events', {
      data: {
        calendarId: cals.items[0]?.id,
        title,
        startAt: '2026-12-07T15:00:00+08:00',
        endAt: '2026-12-07T15:30:00+08:00',
        timezone: 'Asia/Shanghai',
      },
      headers: { ...sameSite, 'idempotency-key': crypto.randomUUID() },
    })
    expect(r.status()).toBe(201)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/calendar?view=week&date=2026-12-07')
  const col = page.locator('[data-testid="cal-col"][data-date="2026-12-07"]')
  const more = col.getByTestId('cal-more')
  await expect(more).toHaveCount(1)
  await expect(more).toHaveText(/^\+\d+$/)
  const box = await more.boundingBox()
  expect(box && box.width >= 24 && box.height >= 24).toBe(true)
  // 并排的日程同样不窄于 24px
  for (const ev of await col.getByTestId('cal-event').all()) {
    const b = await ev.boundingBox()
    expect(b && b.width >= 24).toBe(true)
  }
  await more.click()
  await expect(page).toHaveURL(/view=day/)
  await expect(page).toHaveURL(/date=2026-12-07/)
  for (const title of titles)
    await expect(page.getByTestId('cal-event').filter({ hasText: title })).toBeVisible()
  await expect(page.getByTestId('cal-more')).toHaveCount(0)
})

test('REQ-CAL-012 · 013 气泡就地改日程标题 / 时间、Delete 删除；任务改标题、完成、改时刻、拖动改期、删除可撤销', async ({
  page,
  request,
}) => {
  const cals = (await (await request.get('/api/v1/calendars')).json()) as {
    items: { id: string }[]
  }
  const stamp = Date.now()
  const title = `e2e 气泡日程 ${stamp}`
  const mon = mondayAfter(Math.floor(RUN / 1000) + 200)
  const wed = addDaysStr(mon, 2)
  const thu = addDaysStr(mon, 3)
  const r = await request.post('/api/v1/calendar-events', {
    data: {
      calendarId: cals.items[0]?.id,
      title,
      startAt: `${wed}T10:00:00+08:00`,
      endAt: `${wed}T11:00:00+08:00`,
      timezone: 'Asia/Shanghai',
    },
    headers: { ...sameSite, 'idempotency-key': crypto.randomUUID() },
  })
  expect(r.status()).toBe(201)
  const product = (await (await request.get('/api/v1/spaces/product')).json()) as { id: string }
  const tr = await request.post('/api/v1/tasks', {
    data: {
      title: `e2e 气泡任务 ${stamp}`,
      spaceId: product.id,
      status: 'todo',
      dueAt: `${thu}T15:00:00+08:00`,
    },
    headers: { ...sameSite, 'idempotency-key': crypto.randomUUID() },
  })
  expect(tr.status()).toBe(201)
  const task = (await tr.json()) as { id: string }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/calendar?view=week&date=${wed}`)
  await page.getByTestId('cal-timeline').evaluate((el) => {
    el.scrollTop = 9 * 48
  })

  // 日程：改标题 + 结束时间，点「保存」
  const ev = page.locator('[data-testid="cal-event"][data-source="event"]', { hasText: title })
  await ev.click()
  const quick = page.getByTestId('cal-quick-event')
  await expect(quick).toBeVisible()
  await page.getByTestId('cal-quick-title').fill(`${title} 改`)
  await page.getByTestId('cal-quick-end-time').fill('11:30')
  await page.getByTestId('cal-quick-done').click()
  const ev2 = page.locator('[data-testid="cal-event"][data-source="event"]', {
    hasText: `${title} 改`,
  })
  await expect(ev2).toHaveAttribute('title', /10:00–11:30/)
  // 再点开，焦点在气泡上，直接按 Delete 删除
  await ev2.click()
  await expect(quick).toBeVisible()
  await page.keyboard.press('Delete')
  await expect(ev2).toHaveCount(0)

  // 任务：改标题、改时刻、标记完成
  const tk = page.locator(`[data-testid="cal-event"][data-task-id="${task.id}"]`)
  await expect(tk).toHaveAttribute('title', /15:00/)
  await tk.click()
  const tq = page.getByTestId('cal-quick-task')
  await expect(tq).toBeVisible()
  await page.getByTestId('cal-quick-title').fill(`e2e 气泡任务 ${stamp} 改`)
  await page.getByTestId('cal-quick-title').press('Enter')
  await page.getByTestId('cal-quick-task-time').fill('16:00')
  await expect(tk).toHaveAttribute('title', /16:00/)
  await expect(tk).toContainText('改')
  await page.getByTestId('cal-quick-done-toggle').click()
  await expect(page.getByTestId('cal-quick-done-toggle')).toBeChecked()
  await expect(tk).toHaveClass(/line-through/)
  await page.keyboard.press('Escape')

  // 拖动任务向下 1 小时 = 改期（REQ-CAL-013）
  const tb = await tk.boundingBox()
  if (!tb) throw new Error('no task box')
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 6)
  await page.mouse.down()
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 6 + 48, { steps: 8 })
  await page.mouse.up()
  await expect(tk).toHaveAttribute('title', /17:00/)

  // 删除 → Toast 撤销 → 回来
  await tk.click()
  await page.getByTestId('cal-quick-delete').click()
  await expect(tk).toHaveCount(0)
  await page.mouse.move(0, 0)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(tk).toBeVisible()
  // 清理：共用库不留数据
  await request.delete(`/api/v1/tasks/${task.id}`, { headers: sameSite })
})
