/** 认证页「衔枝小院」（ADR-0034）：双栏插画 / 探头小燕（REQ-UI-041）、情绪状态机（REQ-UI-042）、动效档位与预算（REQ-UI-043）。 */
import { expect, type Page, test } from '@playwright/test'
import { solveCaptcha } from './helpers.ts'

const shell = (page: Page) => page.getByTestId('auth-shell')

test('REQ-UI-041 ≥ 900px 双栏：左栏插画 + 气泡，右栏表单；燕印仍在；整张插画对读屏隐藏；同屏 blur ≤ 6', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(page.locator('.xz-auth-art svg')).toBeVisible()
  await expect(page.locator('.xz-auth-peek')).toHaveCount(0)
  await expect(page.locator('.xz-seal.xz-seal-lg')).toBeVisible()
  await expect(page.getByTestId('bird-caption')).toHaveText('啾～今天也来衔一根枝吧')
  await expect(page.locator('.xz-auth-art')).toHaveAttribute('aria-hidden', 'true')
  const blurs = await page.evaluate(
    () =>
      [...document.querySelectorAll('*')].filter((el) => {
        const s = getComputedStyle(el)
        return (s.backdropFilter || s.getPropertyValue('-webkit-backdrop-filter')) !== 'none'
      }).length,
  )
  expect(blurs).toBeLessThanOrEqual(6)
  for (const path of ['/register', '/login/2fa']) {
    await page.goto(path)
    await expect(page.locator('.xz-auth-art svg')).toBeVisible()
  }
})

test.describe('窄屏', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('REQ-UI-041 < 900px 只挂探头小燕，不挂整幅插画；聚焦密码框翅尖捂眼', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('.xz-auth-peek svg')).toBeVisible()
    await expect(page.locator('.xz-auth-art')).toHaveCount(0)
    await page.getByLabel('密码', { exact: true }).focus()
    await expect(shell(page)).toHaveAttribute('data-mood', 'cover')
  })
})

test('REQ-UI-042 表单信号驱动情绪：探看（回显名字）→ 捂眼 → 偷看 → 滑块 → 出错 → 成功', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(shell(page)).toHaveAttribute('data-mood', 'idle')
  // 不存在的用户名：出错一步不累计真实账号的锁定次数
  const id = page.getByLabel('邮箱或用户名')
  await id.fill('nobody-bird')
  await expect(shell(page)).toHaveAttribute('data-mood', 'scout')
  await expect(page.getByTestId('bird-caption')).toHaveText('嗯？是「nobody-b…」吗')

  const pw = page.getByLabel('密码', { exact: true })
  await pw.focus()
  await expect(shell(page)).toHaveAttribute('data-mood', 'cover')
  await expect(page.getByTestId('bird-caption')).toHaveText('我不看，我不看！')
  await pw.fill('whatever-pass')
  await page.getByRole('button', { name: '显示密码' }).click()
  await expect(shell(page)).toHaveAttribute('data-mood', 'peek')
  await page.getByRole('button', { name: '隐藏密码' }).click()

  await page.getByTestId('captcha-handle').focus()
  await expect(shell(page)).toHaveAttribute('data-mood', 'captcha')

  // 登录接口用 route 模拟：不占 /sign-in 每 IP 每分钟 10 次的额度（REQ-AUTH-012），真实登录由 login / auth 用例覆盖
  await page.route('**/api/auth/sign-in/**', (r) =>
    r.fulfill({ status: 401, json: { code: 'INVALID_USERNAME_OR_PASSWORD', message: 'invalid' } }),
  )
  await solveCaptcha(page)
  await page.getByTestId('login-submit').click()
  await expect(page.getByRole('alert')).toHaveText('账号或密码不正确')
  await expect(shell(page)).toHaveAttribute('data-mood', 'error')
  await expect(page.getByTestId('bird-caption')).toHaveText('咦？好像哪里不对…')
  await expect(shell(page)).not.toHaveAttribute('data-mood', 'error', { timeout: 4000 })

  // 成功：先衔枝欢跳，约 0.9 s 后才整页跳转
  await page.unroute('**/api/auth/sign-in/**')
  await page.route('**/api/auth/sign-in/**', (r) =>
    r.fulfill({ status: 200, json: { redirect: false, token: 't', user: { id: 'u' } } }),
  )
  await solveCaptcha(page)
  const t0 = Date.now()
  await page.getByTestId('login-submit').click()
  await expect(shell(page)).toHaveAttribute('data-mood', 'success')
  await expect(page.locator('.xz-bird-twig')).toHaveCSS('opacity', '1')
  await page.waitForURL('**/today**', { waitUntil: 'commit' })
  expect(Date.now() - t0).toBeGreaterThan(800)
})

test('REQ-UI-042 点小燕：一下害羞，连点冒心', async ({ page }) => {
  await page.goto('/login')
  const hit = page.locator('.xz-auth-art .xz-bird-hit')
  await hit.click()
  await expect(shell(page)).toHaveAttribute('data-behavior', 'shy')
  await hit.click()
  await expect(shell(page)).toHaveAttribute('data-behavior', 'love')
  await expect(page.getByTestId('bird-caption')).toHaveText('啾啾，最喜欢你了')
})

test.describe('减弱档', () => {
  test.use({ reducedMotion: 'reduce' })
  test('REQ-UI-043 系统减弱动效：引擎不起循环、小燕无关键帧，情绪姿态照常一步到位', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.mouse.move(100, 100)
    await page.mouse.move(600, 500, { steps: 5 })
    await page.waitForTimeout(1600)
    const head = page.locator('.xz-auth-art [data-part="head"]')
    await expect(head).toHaveAttribute('style', /transform-origin/)
    expect(await head.evaluate((el) => (el as SVGElement).style.transform)).toBe('')
    const running = await page.evaluate(
      () => document.querySelector('.xz-auth-art')?.getAnimations({ subtree: true }).length ?? -1,
    )
    expect(running).toBe(0)
    await page.getByLabel('密码', { exact: true }).focus()
    await expect(shell(page)).toHaveAttribute('data-mood', 'cover')
    await expect(page.locator('.xz-auth-art .xz-bird-head-fx')).toHaveCSS('scale', '-1 1')
    // 出错情绪的摇头 / 泪滴关键帧同样不跑（情绪规则特异性更高，靠源码顺序压住）
    await shell(page).evaluate((el) => {
      ;(el as HTMLElement).dataset.mood = 'error'
    })
    await expect(page.locator('.xz-auth-art .xz-fx-q')).toHaveCSS('opacity', '1')
    expect(
      await page.evaluate(
        () => document.querySelector('.xz-auth-art')?.getAnimations({ subtree: true }).length,
      ),
    ).toBe(0)
  })
})

test('REQ-UI-043 标准档：视线跟随指针——头指向指针（抬头 / 低头）、指针到背后转身；丰富档才飘柳叶', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(page.locator('.xz-falling')).toHaveCSS('display', 'none')
  await page.waitForTimeout(1500)
  const svg = page.locator('.xz-auth-art svg')
  const head = page.locator('.xz-auth-art [data-part="head"]')
  const rot = () =>
    head.evaluate((el) =>
      Number(/rotate\((-?[\d.]+)deg/.exec((el as SVGElement).style.transform)?.[1] ?? 0),
    )
  // 指针在右上 → 朝前、抬头（喙朝上 = 负角）；右下 → 低头（正角）
  await page.mouse.move(700, 60, { steps: 6 })
  await expect.poll(rot).toBeLessThan(-12)
  await expect(svg).not.toHaveAttribute('data-facing', /.*/)
  await page.mouse.move(700, 790, { steps: 6 })
  await expect.poll(rot).toBeGreaterThan(10)
  // 指针越过背后 → 转身；回到右侧 → 转回、眼珠向前（正向位移）
  await page.mouse.move(20, 420, { steps: 6 })
  await expect(svg).toHaveAttribute('data-facing', 'back')
  await page.mouse.move(1100, 420, { steps: 6 })
  await expect(svg).not.toHaveAttribute('data-facing', /.*/)
  const pupil = page.locator('.xz-auth-art [data-part="pupil"]').first()
  await expect
    .poll(() => pupil.evaluate((el) => (el as SVGElement).style.transform))
    .toMatch(/translate\([1-9]/)
  await page.evaluate(() => {
    document.documentElement.dataset.motion = 'rich'
  })
  await expect(page.locator('.xz-falling')).toHaveCSS('display', 'inline')
})
