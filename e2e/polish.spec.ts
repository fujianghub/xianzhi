/** 界面精修（ADR-0046）：浮层退出动效与减弱档、图标描边与按钮内图标尺寸、材质层级覆盖、空状态（REQ-UI-045 ~ 048）。 */
import { expect, type Page, test } from '@playwright/test'
import {
  appearanceSaved,
  createEntry,
  resetAppearance,
  STATE,
  sameSite,
  setAppearancePref,
} from './helpers.ts'

test.use({ storageState: STATE.owner })

/** 在页面内对浮层派发 Esc，下一帧读它是否还在 DOM、正在播哪些动画。 */
const escapeAndProbe = (page: Page, testId: string) =>
  page.evaluate(
    (id) =>
      new Promise<{ connected: boolean; state: string | null; anims: string[] }>((resolve) => {
        const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
        if (!el) throw new Error(`no ${id}`)
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        requestAnimationFrame(() =>
          resolve({
            connected: el.isConnected,
            state: el.getAttribute('data-state'),
            anims: el
              .getAnimations()
              .map((a) => (a as CSSAnimation).animationName)
              .filter(Boolean),
          }),
        )
      }),
    testId,
  )

test('REQ-UI-045 浮层关闭播退出动画后卸载；减弱档不播、立即卸载，裸 transition 时长归零', async ({
  page,
}) => {
  await page.goto('/settings/design?page=components')
  await page.getByTestId('open-popover').click()
  const pop = page.getByTestId('popover-content')
  await expect(pop).toBeVisible()
  await expect.poll(() => pop.evaluate((el) => el.getAnimations().length)).toBe(0) // 入场播完
  const closing = await escapeAndProbe(page, 'popover-content')
  expect(closing.connected).toBe(true)
  expect(closing.state).toBe('closed')
  expect(closing.anims).toContain('xz-pop-out')
  await expect(pop).toHaveCount(0)

  await page.evaluate(() => {
    document.documentElement.dataset.motion = 'reduce'
  })
  await page.getByTestId('open-popover').click()
  await expect(pop).toBeVisible()
  const reduced = await escapeAndProbe(page, 'popover-content')
  expect(reduced.anims).not.toContain('xz-pop-out')
  await expect(pop).toHaveCount(0)
  const dur = await page.evaluate(() => {
    const el = document.querySelector('.transition-colors')
    return el ? getComputedStyle(el).transitionDuration : null
  })
  expect(dur).not.toBeNull()
  expect(dur?.split(',').every((d) => Number.parseFloat(d) === 0)).toBe(true)
})

test('REQ-UI-046 Lucide 描边统一 1.75（小图标 2）；按钮内写了 size-4 的图标按 16px 渲染', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/entries')
  const strokes = await page
    .getByTestId('sidebar')
    .evaluate((el) =>
      [...el.querySelectorAll('svg.lucide')]
        .filter((s) => !s.matches('.size-3, .size-3\\.5, :is(.xz-chip, .xz-kind-badge) svg'))
        .map((s) => getComputedStyle(s).strokeWidth),
    )
  expect(strokes.length).toBeGreaterThan(0)
  expect(new Set(strokes)).toEqual(new Set(['1.75px']))
  const icon = page.getByTestId('new-entry').locator('svg.size-4')
  await expect(icon).toBeVisible()
  const box = await icon.boundingBox()
  expect(box?.width).toBe(16)
})

test('REQ-UI-047 材质类在 components 层：顶栏无侧边线、secondary 按钮无浮影但留折射环、记录页纸面带卡片投影', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/settings/design?page=components')
  const topbar = page.getByTestId('topbar')
  await expect(topbar).toBeVisible()
  expect(await topbar.evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe('0px')
  const secondary = page.locator('button[data-variant="secondary"]').first()
  await expect(secondary).toBeVisible()
  const shadow = await secondary.evaluate((el) => getComputedStyle(el).boxShadow)
  expect(shadow).toContain('inset') // 折射环 / 棱线仍在
  expect(shadow).not.toMatch(/14px 40px/) // shadow-float 外投影已去掉

  const id = await createEntry(request, { kind: 'note', title: `材质 ${Date.now()}` })
  await page.goto(`/entries/${id}`)
  const paperShadow = await page
    .locator('.paper.xz-reading')
    .first()
    .evaluate((el) => getComputedStyle(el).boxShadow)
  expect(paperShadow).toContain('inset') // 顶缘棱线
  expect(paperShadow).toMatch(/8px 24px/) // shadow-card
})

test('REQ-UI-048 空目录树显示 EmptyState（插画 + 光晕 + 一句话）', async ({ page, request }) => {
  const slug = `polish-${Date.now().toString(36)}`
  const r = await request.post('/api/v1/spaces', {
    data: { name: `空间 ${slug}`, slug, kind: 'learning', visibility: 'workspace' },
    headers: sameSite,
  })
  expect(r.status(), await r.text()).toBe(201)
  await page.goto(`/spaces/${slug}/tree`)
  const empty = page.getByTestId('kb-tree').getByTestId('empty-state')
  await expect(empty).toBeVisible()
  await expect(empty.locator('.xz-empty-art svg')).toBeVisible()
  await expect(empty).toContainText('目录还是空的')
})

test('REQ-UI-049 玻璃强度默认流光；设置页可切换、写 html[data-glass] 并持久化，标准档不写属性', async ({
  page,
}) => {
  await page.goto('/settings')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-glass', 'liquid')
  const select = page.getByTestId('profile-glass')
  await expect(select).toHaveValue('liquid')
  let saved = appearanceSaved(page)
  await select.selectOption('vivid')
  await expect(html).toHaveAttribute('data-glass', 'vivid')
  await saved
  await page.reload()
  await expect(html).toHaveAttribute('data-glass', 'vivid')
  saved = appearanceSaved(page)
  await page.getByTestId('profile-glass').selectOption('standard')
  await expect(html).not.toHaveAttribute('data-glass', /.*/)
  await saved
  await page.reload()
  await expect(html).not.toHaveAttribute('data-glass', /.*/)
  // 恢复为工作区默认（ADR-0049）：账号值删除，回到默认流光，本机缓存不存默认值
  saved = appearanceSaved(page)
  await page.getByTestId('profile-appearance-reset').click()
  await saved
  await expect(html).toHaveAttribute('data-glass', 'liquid')
  expect(await page.evaluate(() => localStorage.getItem('xz:glass'))).toBeNull()
  await expect(page.getByTestId('profile-appearance-reset')).toHaveCount(0)
})

test('REQ-UI-050 日场流光下侧栏 / 顶栏不叠白色渐变、底色 ≤ 30% 白；标准档保持原玻璃', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addInitScript(() => localStorage.setItem('xz:theme', 'light'))
  const chrome = () =>
    page.evaluate(() => {
      const read = (el: Element | null) => {
        const cs = getComputedStyle(el as Element)
        const a = /rgba?\([^)]*?,\s*([\d.]+)\)/.exec(cs.backgroundColor)?.[1]
        return { alpha: a === undefined ? 1 : Number(a), image: cs.backgroundImage }
      }
      return {
        sidebar: read(document.querySelector('.xz-sidebar')),
        topbar: read(document.querySelector('[data-testid="topbar"]')),
      }
    })
  await page.goto('/today')
  await expect(page.locator('.xz-sidebar')).toBeVisible()
  const liquid = await chrome()
  expect(liquid.sidebar.alpha).toBeLessThanOrEqual(0.3)
  expect(liquid.topbar.alpha).toBeLessThanOrEqual(0.3)
  expect(liquid.sidebar.image).not.toContain('linear-gradient')
  expect(liquid.topbar.image).not.toContain('linear-gradient')

  await setAppearancePref(page.request, { glass: 'standard' })
  await page.reload()
  await expect(page.locator('.xz-sidebar')).toBeVisible()
  const std = await chrome()
  expect(std.sidebar.alpha).toBeGreaterThan(0.6) // 原 glass-thick 82%
  await resetAppearance(page.request)
})

test('REQ-UI-051 外观随账号保存：设置页选「晶亮」后，换一个没有本机缓存的浏览器登录同账号也是晶亮', async ({
  page,
  browser,
}) => {
  await page.goto('/settings')
  const saved = appearanceSaved(page)
  await page.getByTestId('profile-glass').selectOption('vivid')
  await saved
  // 新上下文：同一登录态、空 localStorage（= 另一台设备）
  const other = await browser.newContext({ storageState: STATE.owner })
  const p2 = await other.newPage()
  await p2.goto('/today')
  await expect(p2.locator('html')).toHaveAttribute('data-glass', 'vivid')
  expect(await p2.evaluate(() => localStorage.getItem('xz:glass'))).toBe('vivid') // 已回写本机缓存
  await other.close()
  await resetAppearance(page.request)
})

test('REQ-WS-024 工作区默认外观：所有者改默认玻璃为「清透」，没单独选过的成员登录即生效', async ({
  page,
  browser,
}) => {
  await page.goto('/settings/workspace')
  const form = page.getByTestId('workspace-appearance')
  await expect(form).toBeVisible()
  const done = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/workspace') && r.request().method() === 'PATCH',
  )
  await form.getByTestId('workspace-appearance-glass').selectOption('clear')
  expect((await done).status()).toBe(200)

  const ctx = await browser.newContext({ storageState: STATE.member })
  const m = await ctx.newPage()
  await resetAppearance(m.request) // 成员没单独选过
  await m.goto('/today')
  await expect(m.locator('html')).toHaveAttribute('data-glass', 'clear')
  await ctx.close()

  // 复位：工作区默认清空 → 回到内置默认（流光）
  const r = await page.request.patch('/api/v1/workspace', {
    data: { settings: { appearance: {} } },
    headers: sameSite,
  })
  expect(r.status()).toBe(200)
})
