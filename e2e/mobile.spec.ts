/** 移动视口（REQ-MOBILE-001）：390 宽显示底部导航，含 safe-area；侧栏隐藏。 */
import { expect, test } from '@playwright/test'
import { STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

test('REQ-MOBILE-001 390 视口底部导航含 safe-area，侧栏改抽屉', async ({ page }) => {
  await page.goto('/today')
  const nav = page.getByTestId('bottom-nav')
  await expect(nav).toBeVisible()
  await expect(page.getByTestId('sidebar')).toBeHidden()
  const box = await nav.boundingBox()
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844)
  const cls = (await nav.getAttribute('class')) ?? ''
  expect(cls).toContain('safe-area-inset-bottom')
  await page.getByTestId('open-drawer').click()
  await expect(page.getByTestId('drawer')).toBeVisible()
})

test('REQ-MOBILE-006 390 视口 --xz-blur-thick ≤ 12px', async ({ page }) => {
  await page.goto('/today')
  const px = await page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--xz-blur-thick'),
    ),
  )
  expect(px).toBeLessThanOrEqual(12)
})

test('REQ-MOBILE-002 任务行左滑 > 40% 完成；右滑改期', async ({ page, request }) => {
  const slug = `m-${Date.now().toString(36)}`
  const s = (await (
    await request.post('/api/v1/spaces', {
      data: { name: `移动 ${slug}`, slug, kind: 'work' },
      headers: sameSite,
    })
  ).json()) as { id: string }
  const mk = async (title: string) =>
    (await (
      await request.post('/api/v1/tasks', {
        data: { title, spaceId: s.id, status: 'todo' },
        headers: sameSite,
      })
    ).json()) as { id: string }
  const a = await mk('左滑完成')
  const b = await mk('右滑改期')
  await page.goto(`/spaces/${slug}?view=list`)
  const swipe = async (id: string, dir: -1 | 1) => {
    const row = page.locator(`[data-testid="task-row"][data-task-id="${id}"]`)
    const box = await row.boundingBox()
    if (!box) throw new Error('no row')
    const y = box.y + box.height / 2
    const x0 = box.x + box.width / 2
    const ev = (type: string, x: number) =>
      row.dispatchEvent(type, {
        pointerType: 'touch',
        pointerId: 7,
        isPrimary: true,
        clientX: x,
        clientY: y,
        bubbles: true,
      })
    await ev('pointerdown', x0)
    for (let i = 1; i <= 6; i++) await ev('pointermove', x0 + (dir * box.width * 0.5 * i) / 6)
    await ev('pointerup', x0 + dir * box.width * 0.5)
  }
  await swipe(a.id, -1)
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/v1/tasks/${a.id}`)).json()) as { status: string }).status,
    )
    .toBe('done')
  await swipe(b.id, 1)
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/v1/tasks/${b.id}`)).json()) as { dueAt: string | null })
          .dueAt,
    )
    .not.toBeNull()
})

test('REQ-MOBILE-003 编辑器工具条固定底部并随软键盘上移', async ({ page, request }) => {
  // 可控的 visualViewport：测试改 height 并派发 resize 模拟软键盘弹出
  await page.addInitScript(() => {
    const target = new EventTarget() as EventTarget & {
      height: number
      offsetTop: number
      width: number
      scale: number
    }
    target.height = window.innerHeight
    target.offsetTop = 0
    target.width = window.innerWidth
    target.scale = 1
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => target })
    ;(window as unknown as { __vv: typeof target }).__vv = target
  })
  const r = await request.post('/api/v1/entries', {
    data: { kind: 'note', title: '移动编辑' },
    headers: sameSite,
  })
  const { id } = (await r.json()) as { id: string }
  await page.goto(`/entries/${id}`)
  await page.getByTestId('editor').click()
  const bar = page.getByTestId('mobile-toolbar')
  await expect(bar).toBeVisible()
  const vh = page.viewportSize()?.height ?? 844
  const before = await bar.boundingBox()
  expect(Math.round((before?.y ?? 0) + (before?.height ?? 0))).toBe(vh)
  await page.evaluate(() => {
    const vv = (window as unknown as { __vv: EventTarget & { height: number } }).__vv
    vv.height = 500
    vv.dispatchEvent(new Event('resize'))
  })
  await expect
    .poll(async () =>
      Math.round(((await bar.boundingBox())?.y ?? 0) + ((await bar.boundingBox())?.height ?? 0)),
    )
    .toBe(500)
})

test('REQ-MOBILE-007 触控目标 ≥ 40×40（元素本身或其 ::after 点击区）', async ({ page }) => {
  const small: string[] = []
  for (const path of ['/today', '/inbox', '/entries', '/notifications', '/search', '/settings']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const bad = await page.evaluate(() => {
      const sel =
        'button, [role="button"], [role="checkbox"], [role="tab"], [role="switch"], a[href], select, input:not([type=hidden])'
      const out: string[] = []
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const r = el.getBoundingClientRect()
        const st = getComputedStyle(el)
        if (!r.width || !r.height || st.visibility === 'hidden' || st.display === 'none') continue
        if (el.closest('.xz-prose')) continue // 正文行内链接豁免
        if (r.width >= 40 && r.height >= 40) continue
        const after = getComputedStyle(el, '::after')
        const aw = Number.parseFloat(after.width)
        const ah = Number.parseFloat(after.height)
        if (after.content !== 'none' && after.position === 'absolute' && aw >= 40 && ah >= 40)
          continue
        out.push(
          `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 12)}] ${Math.round(r.width)}×${Math.round(r.height)}`,
        )
      }
      return out
    })
    small.push(...bad.map((b) => `${path} ${b}`))
  }
  expect(small).toEqual([])
})
