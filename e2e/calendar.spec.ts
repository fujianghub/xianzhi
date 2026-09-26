/** 日历（REQ-UI-031 · REQ-TASK-024）与侧栏改版（REQ-UI-032）。 */
import { expect, test } from '@playwright/test'
import { STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

/** 上海时间「今天 14:30」的 UTC ISO（e2e timezoneId = Asia/Shanghai，owner 时区默认同） */
function todayAt(h: number, m: number) {
  const now = new Date()
  const sh = new Date(now.getTime() + 8 * 3_600_000)
  return new Date(
    Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate(), h - 8, m),
  ).toISOString()
}

test('REQ-UI-031 月视图显示区间内任务，点击打开 Peek；w / m 切换视图，周视图有当前时间线；← → t 翻页与回到今天', async ({
  page,
  request,
}) => {
  const product = (await (await request.get('/api/v1/spaces/product')).json()) as { id: string }
  const r = await request.post('/api/v1/tasks', {
    data: {
      title: '日历样例 · 下午评审',
      spaceId: product.id,
      status: 'todo',
      dueAt: todayAt(14, 30),
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

  // 周视图：定时事件全部显示，点击打开 Peek
  await page.getByTestId('cal-view-week').click()
  const ev = page.locator(`[data-testid="cal-event"][data-task-id="${task.id}"]`)
  await expect(ev).toBeVisible()
  await expect(ev).toHaveAttribute('title', /14:30/) // 并列 ≥ 3 栏时块内只显示标题，完整信息在 title
  await ev.click()
  await expect(page.getByTestId('peek-panel')).toBeVisible()
  await page.keyboard.press('Escape')
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

  // 点开 → 删除
  await ev.click()
  await expect(editor).toBeVisible()
  await page.getByTestId('cal-editor-delete').click()
  await expect(editor).toBeHidden()
  await expect(ev).toHaveCount(0)
})

test('REQ-CAL-005 重复日程删除「仅此日程」只去掉这一次', async ({ page, request }) => {
  const cals = (await (await request.get('/api/v1/calendars')).json()) as {
    items: { id: string }[]
  }
  const title = `e2e 晨读 ${Date.now()}`
  const r = await request.post('/api/v1/calendar-events', {
    data: {
      calendarId: cals.items[0]?.id,
      title,
      startAt: '2026-11-23T07:00:00+08:00',
      endAt: '2026-11-23T07:30:00+08:00',
      timezone: 'Asia/Shanghai',
      rrule: 'FREQ=DAILY;COUNT=5',
    },
    headers: { ...sameSite, 'idempotency-key': crypto.randomUUID() },
  })
  expect(r.status()).toBe(201)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/calendar?view=week&date=2026-11-23')
  const evs = page.locator('[data-testid="cal-event"][data-source="event"]', { hasText: title })
  await expect(evs).toHaveCount(5)
  await evs.nth(1).click()
  await page.getByTestId('cal-editor-delete').click()
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

  // 清理
  await cell('2026-09-10').getByTestId('cal-event').filter({ hasText: title }).click()
  await page.getByTestId('cal-editor-delete').click()
  await expect(editor).toBeHidden()
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
