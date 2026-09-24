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
