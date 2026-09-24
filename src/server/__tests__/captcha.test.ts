/** 登录拼图滑块（ADR-0006、REQ-AUTH-016）：出题、一次性校验、容差、最短用时、不计入锁定、生产不回显、邀请通行证。 */
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import { CAPTCHA, issueCaptchaPass, renderCaptcha, verifyCaptcha } from '../services/captcha.ts'
import { truncateAll } from './db.ts'
import { buildApp, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

type Challenge = {
  id: string
  background: string
  piece: string
  y: number
  pieceSize: number
  width: number
  height: number
  debugX?: number
}

async function challenge(app: ReturnType<typeof buildApp>['app'], ip = '10.9.0.1') {
  const r = await app.request('/api/captcha', { headers: { 'x-forwarded-for': ip } })
  expect(r.status).toBe(200)
  expect(r.headers.get('cache-control')).toBe('no-store')
  return (await r.json()) as Challenge
}

describe('captcha', () => {
  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
  })

  it('REQ-AUTH-016 出题：两张 webp、尺寸 320×160、拼块边长与 y 在画布内，非生产回显答案', async () => {
    const { app } = buildApp()
    const c = await challenge(app)
    expect(c.width).toBe(CAPTCHA.width)
    expect(c.height).toBe(CAPTCHA.height)
    expect(c.background.startsWith('data:image/webp;base64,')).toBe(true)
    const bg = await sharp(Buffer.from(c.background.split(',')[1] as string, 'base64')).metadata()
    expect([bg.width, bg.height]).toEqual([320, 160])
    const piece = await sharp(Buffer.from(c.piece.split(',')[1] as string, 'base64')).metadata()
    expect(piece.width).toBe(c.pieceSize)
    expect(piece.hasAlpha).toBe(true)
    expect(c.y + c.pieceSize).toBeLessThanOrEqual(c.height)
    expect(typeof c.debugX).toBe('number')
  })

  it('REQ-AUTH-016 production 下即使配置 debug 也不回显答案', async () => {
    const { app } = buildApp({ nodeEnv: 'production', captcha: { debug: true } })
    const c = await challenge(app)
    expect(c.debugX).toBeUndefined()
  })

  it('REQ-AUTH-016 正确位置（±6px 内）登录成功；偏 7px、缺头、重复使用同一题均 400 CAPTCHA_INVALID', async () => {
    const { app } = buildApp()
    const ok = await challenge(app)
    const r1 = await signIn(app, OWNER.email, OWNER.password, {
      'x-captcha': `${ok.id}:${(ok.debugX as number) + 6}`,
    })
    expect(r1.res.status).toBe(200)
    // 同一题再用一次：已被消费
    const again = await signIn(app, OWNER.email, OWNER.password, {
      'x-captcha': `${ok.id}:${ok.debugX}`,
    })
    expect(again.res.status).toBe(400)
    expect((await problemOf(again.res)).code).toBe('CAPTCHA_INVALID')

    const off = await challenge(app)
    const r2 = await signIn(app, OWNER.email, OWNER.password, {
      'x-captcha': `${off.id}:${(off.debugX as number) + 7}`,
    })
    expect(r2.res.status).toBe(400)
    const none = await signIn(app, OWNER.email, OWNER.password, { 'x-captcha': '' })
    expect(none.res.status).toBe(400)
  })

  it('REQ-AUTH-016 滑块失败不计入账号失败次数：18 次错滑块（超过锁定阈值 10）后正确登录仍成功', async () => {
    // 邮箱维度限流 10/min 排在滑块之前：每 9 次拨钟 61 s 让限流窗口重置，锁定计时（15 min）不受影响
    let t = Date.now()
    const { app } = buildApp({ now: () => t })
    for (let i = 0; i < 18; i++) {
      if (i && i % 9 === 0) t += 61_000
      const r = await signIn(app, OWNER.email, OWNER.password, { 'x-captcha': `nope:${i}` })
      expect(r.res.status).toBe(400)
    }
    t += 61_000
    const ok = await signIn(app, OWNER.email, OWNER.password)
    expect(ok.res.status).toBe(200)
  })

  it('REQ-AUTH-016 最短解题时间：出题后立即提交判失败', async () => {
    const { app } = buildApp({ captcha: { debug: true, minSolveMs: 5_000 } })
    const c = await challenge(app)
    const r = await signIn(app, OWNER.email, OWNER.password, {
      'x-captcha': `${c.id}:${c.debugX}`,
    })
    expect(r.res.status).toBe(400)
  })

  it('REQ-AUTH-016 邀请通行证只能用一次；伪造通行证无效', async () => {
    const db = getDb()
    const pass = await issueCaptchaPass(db)
    expect(pass.startsWith('pass:')).toBe(true)
    expect(await verifyCaptcha(db, pass)).toBe(true)
    expect(await verifyCaptcha(db, pass)).toBe(false)
    expect(await verifyCaptcha(db, 'pass:forged')).toBe(false)
  })

  it('REQ-AUTH-016 出题接口按 IP 限流 30/min', async () => {
    const { app } = buildApp()
    let last = 200
    for (let i = 0; i < 31; i++)
      last = (await app.request('/api/captcha', { headers: { 'x-forwarded-for': '10.9.9.9' } }))
        .status
    expect(last).toBe(429)
  })

  it('REQ-AUTH-016 纯渲染：缺口位置只在像素里，拼块尺寸 50–58', async () => {
    const r = await renderCaptcha()
    expect(r.box).toBeGreaterThanOrEqual(50)
    expect(r.box).toBeLessThanOrEqual(58)
    expect(r.x).toBeGreaterThan(r.box)
    expect(r.x + r.box).toBeLessThanOrEqual(CAPTCHA.width)
  })
})
