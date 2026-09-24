/** 主题、布局、浮层、blur 预算（REQ-UI-001 · 014 · 016 · 023）。 */
import { expect, test } from '@playwright/test'
import { countBlur, createEntry, STATE } from './helpers.ts'

test.use({ storageState: STATE.owner })

test('REQ-UI-001 默认跟随系统；手动选择持久化；切换后 data-theme 与 color-scheme 正确；reduced-motion 下不启动 View Transition', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/today')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.addInitScript(() => {
    const w = window as unknown as { __vt: number }
    w.__vt = 0
    const d = document as Document & { startViewTransition?: (cb: () => void) => unknown }
    const orig = d.startViewTransition?.bind(d)
    if (orig)
      d.startViewTransition = (cb: () => void) => {
        w.__vt++
        return orig(cb)
      }
  })
  await page.reload()
  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('light')
  expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBe(1)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light') // 持久化到 xz:theme
  expect(await page.evaluate(() => localStorage.getItem('xz:theme'))).toBe('light')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBe(0) // reload 后计数归零，reduce 下未调用
  await page.evaluate(() => localStorage.removeItem('xz:theme'))
})

test('REQ-UI-014 1280 三栏（Topbar / Sidebar / Aside）；1024 侧栏改抽屉、Aside 隐藏', async ({
  page,
  request,
}) => {
  const id = await createEntry(request, { kind: 'note', title: '布局用例' })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/entries/${id}`)
  await expect(page.getByTestId('topbar')).toBeVisible()
  await expect(page.getByTestId('sidebar')).toBeVisible()
  await expect(page.getByTestId('aside')).toBeVisible()
  const topbar = await page.getByTestId('topbar').boundingBox()
  const sidebar = await page.getByTestId('sidebar').boundingBox()
  const aside = await page.getByTestId('aside').boundingBox()
  expect(Math.round(topbar?.height ?? 0)).toBe(56)
  expect(Math.round(sidebar?.width ?? 0)).toBe(240)
  expect(Math.round(aside?.width ?? 0)).toBe(320)
  await page.keyboard.press('[')
  await expect(page.getByTestId('sidebar')).toBeHidden()
  await page.keyboard.press('[')
  await expect(page.getByTestId('sidebar')).toBeVisible()

  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(page.getByTestId('sidebar')).toBeVisible() // lg = 1024 仍为侧栏
  await page.setViewportSize({ width: 1000, height: 768 })
  await expect(page.getByTestId('sidebar')).toBeHidden()
  await expect(page.getByTestId('aside')).toBeHidden()
  await page.getByTestId('open-drawer').click()
  await expect(page.getByTestId('drawer')).toBeVisible()
})

test('REQ-UI-023 浮层（Popover / Dialog / Tooltip）portal 到 body，不在 backdrop-filter 元素内', async ({
  page,
}) => {
  await page.goto('/design?page=components')
  await page.getByTestId('open-popover').click()
  const pop = page.getByTestId('popover-content')
  await expect(pop).toBeVisible()
  const inBlur = async (testId: string) =>
    page.getByTestId(testId).evaluate((el) => {
      const chain: string[] = []
      let p = el.parentElement
      let blurred = false
      while (p) {
        chain.push(p.tagName)
        if (p !== el && getComputedStyle(p).backdropFilter !== 'none') blurred = true
        p = p.parentElement
      }
      return {
        topParent: chain.at(-2),
        blurred,
        portalDirectChildOfBody:
          el.closest('body > [data-radix-popper-content-wrapper], body > [role], body > div') !==
          null,
      }
    })
  const p1 = await inBlur('popover-content')
  expect(p1.blurred).toBe(false)
  expect(p1.topParent).toBe('BODY')
  await page.keyboard.press('Escape')
  await page.getByTestId('open-dialog').click()
  const d = await inBlur('dialog-content')
  expect(d.blurred).toBe(false)
  expect(d.topParent).toBe('BODY')
})

test('REQ-UI-016 同屏 backdrop-filter ≤ 6（/design 各页、记录页、Dialog 打开态）；reduced-transparency 下玻璃无 blur', async ({
  page,
  request,
}) => {
  for (const p of ['tokens', 'materials', 'depth', 'switch', 'components']) {
    await page.goto(`/design?page=${p}`)
    await expect(page.getByTestId('design')).toHaveAttribute('data-page', p)
    const n = await countBlur(page)
    expect(n, `/design?page=${p}`).toBeLessThanOrEqual(6)
  }
  await page.getByTestId('open-dialog').click()
  await expect(page.getByTestId('dialog-content')).toBeVisible()
  expect(await countBlur(page)).toBeLessThanOrEqual(6)
  await page.keyboard.press('Escape')

  const id = await createEntry(request, { kind: 'note', title: 'blur 预算' })
  await page.goto(`/entries/${id}`)
  await expect(page.getByTestId('editor')).toBeVisible()
  expect(await countBlur(page)).toBeLessThanOrEqual(6)

  // 看板页（最密集的玻璃场景）、任务详情 Sheet 打开、⌘K 打开、Peek 打开
  await page.goto('/spaces/product')
  await expect(page.getByTestId('space-page')).toBeVisible()
  expect(await countBlur(page), '看板页').toBeLessThanOrEqual(6)
  const card = page.getByTestId('kanban-card').first()
  await card.hover()
  await page.waitForTimeout(700)
  expect(await countBlur(page), '看板页 + Peek').toBeLessThanOrEqual(6)
  await page.keyboard.press('Escape')
  await card.click()
  await expect(page.getByTestId('task-sheet')).toBeVisible()
  expect(await countBlur(page), '任务详情 Sheet').toBeLessThanOrEqual(6)
  await page.keyboard.press('Escape')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await expect(page.getByTestId('command-input')).toBeVisible()
  expect(await countBlur(page), '⌘K').toBeLessThanOrEqual(6)
  await page.keyboard.press('Escape')

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  })
  await page.reload()
  await expect(page.getByTestId('topbar')).toBeVisible()
  expect(await countBlur(page)).toBe(0)
  const bf = await page.getByTestId('topbar').evaluate((el) => getComputedStyle(el).backdropFilter)
  expect(bf).toBe('none')
})
