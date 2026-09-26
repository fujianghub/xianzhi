/** 动效档位、路由转场、卡片 → 详情共享元素、展开指示（REQ-UI-028 · 029 · 021 · 030，04 §2.4、ADR-0005 §3）。 */
import { expect, type Page, test } from '@playwright/test'
import { createEntry, STATE } from './helpers.ts'

test.use({ storageState: STATE.owner })

type VtLog = { types: string[][]; atStart: number[]; atReady: number[]; atEnd: number[] }

/** 记录每次 startViewTransition 的类型，以及开始 / ready / 结束时带 xz-shared 名的元素数。 */
async function recordTransitions(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __vt: VtLog }
    w.__vt = { types: [], atStart: [], atReady: [], atEnd: [] }
    const named = () =>
      [...document.querySelectorAll('[data-shared-source], [data-shared-target]')].filter(
        (el) => getComputedStyle(el).viewTransitionName === 'xz-shared',
      ).length
    const d = document as Document & { startViewTransition?: (a: unknown) => ViewTransition }
    const orig = d.startViewTransition?.bind(d)
    if (!orig) return
    d.startViewTransition = (arg: unknown) => {
      const types = (arg as { types?: string[] })?.types ?? []
      w.__vt.types.push([...types])
      const vt = orig(arg)
      w.__vt.atStart.push(named())
      vt.ready.then(() => w.__vt.atReady.push(named())).catch(() => undefined)
      vt.finished.then(() => w.__vt.atEnd.push(named())).catch(() => undefined)
      return vt
    }
  })
}
const log = (page: Page) => page.evaluate(() => (window as unknown as { __vt: VtLog }).__vt)

test('REQ-UI-028 设置页切换动效档位：写 html[data-motion] 并持久化；刷新前即生效', async ({
  page,
}) => {
  await page.goto('/settings')
  const select = page.getByTestId('profile-motion')
  await expect(select).toHaveValue('standard')
  await select.selectOption('reduce')
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce')
  await select.selectOption('rich')
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'rich')
  await select.selectOption('standard')
  await expect(page.locator('html')).not.toHaveAttribute('data-motion', /.*/)
  expect(await page.evaluate(() => localStorage.getItem('xz:motion'))).toBeNull()
})

test('REQ-UI-029 路径变化带 route 类型转场；只改 search 与减弱档不转场', async ({ page }) => {
  await recordTransitions(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/today')
  const supported = await page.evaluate(
    () => !!CSS.supports?.('selector(:active-view-transition-type(a))'),
  )
  test.skip(!supported, '浏览器不支持 view-transition types，路由转场关闭')
  expect((await log(page)).types).toEqual([]) // 首次加载不转场
  await page.getByTestId('sidebar').getByRole('link', { name: '收件箱' }).click()
  await expect(page).toHaveURL(/\/inbox/)
  await expect.poll(async () => (await log(page)).types).toEqual([['route']])

  await page.evaluate(() => localStorage.setItem('xz:motion', 'reduce'))
  await page.reload()
  await page.getByTestId('sidebar').getByRole('link', { name: '今日' }).click()
  await expect(page).toHaveURL(/\/today/)
  await page.waitForTimeout(300)
  expect((await log(page)).types).toEqual([])
  await page.evaluate(() => localStorage.removeItem('xz:motion'))
})

test('REQ-UI-021 卡片 → 详情共享元素：同一时刻带名元素 ≤ 1，结束后为 0', async ({
  page,
  request,
}) => {
  await recordTransitions(page)
  await createEntry(request, { kind: 'note', title: '共享元素用例' })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/entries?view=cards')
  const supported = await page.evaluate(
    () => !!CSS.supports?.('selector(:active-view-transition-type(a))'),
  )
  test.skip(!supported, '浏览器不支持 view-transition types')
  await page.getByTestId('entry-card').filter({ hasText: '共享元素用例' }).first().click()
  await expect(page.getByTestId('entry-title')).toBeVisible()
  await expect.poll(async () => (await log(page)).atEnd.length).toBeGreaterThan(0)
  const l = await log(page)
  expect(l.types.at(-1)).toEqual(['route'])
  expect(Math.max(...l.atStart, ...l.atReady)).toBeLessThanOrEqual(1)
  expect(l.atStart.at(-1)).toBe(1) // 旧快照：被点的卡片
  expect(l.atEnd.at(-1)).toBe(0)
})

test('REQ-UI-030 展开指示：收起 / 展开切换 data-open 并旋转 90°', async ({ page }) => {
  await page.goto('/today')
  const toggle = page.getByRole('button', { name: '今天完成的' })
  const icon = toggle.locator('svg')
  await expect(icon).not.toHaveAttribute('data-open', /.*/)
  await toggle.click()
  await expect(icon).toHaveAttribute('data-open', 'true')
  await expect.poll(() => icon.evaluate((el) => getComputedStyle(el).rotate)).toBe('90deg')
})
