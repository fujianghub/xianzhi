import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  type BirdInputs,
  boundSpring,
  captionKey,
  deriveMood,
  gaze,
  namePreview,
  pickIdle,
  type Spring,
  stepSpring,
  visibleBehavior,
} from '../components/auth/bird-mood.ts'
import { zhCN } from '../i18n/zh-CN.ts'

const base: BirdInputs = { focus: null, secretVisible: false, secretFilled: false, flash: null }
const css = (f: string) => readFileSync(new URL(`../styles/${f}`, import.meta.url), 'utf8')

describe('ADR-0034 认证页小燕', () => {
  it('REQ-UI-042 情绪优先级 success > error > cover > peek > captcha > scout > idle', () => {
    expect(deriveMood(base)).toBe('idle')
    expect(deriveMood({ ...base, focus: 'text' })).toBe('scout')
    expect(deriveMood({ ...base, focus: 'captcha' })).toBe('captcha')
    expect(deriveMood({ ...base, focus: 'secret' })).toBe('cover')
    // 密码明文且有值：不论焦点在哪都偷看；明文但空 → 按焦点
    expect(deriveMood({ ...base, focus: 'captcha', secretVisible: true, secretFilled: true })).toBe(
      'peek',
    )
    expect(deriveMood({ ...base, focus: 'text', secretVisible: true })).toBe('scout')
    // 捂眼优先于偷看：聚焦密码框且仍为密文
    expect(deriveMood({ ...base, focus: 'secret', secretFilled: true })).toBe('cover')
    expect(deriveMood({ ...base, focus: 'secret', flash: 'error' })).toBe('error')
    expect(deriveMood({ ...base, focus: 'secret', flash: 'success' })).toBe('success')
  })

  it('REQ-UI-042 小动作不压过出错 / 成功；被点可打断捂眼，待机动作不打断', () => {
    expect(visibleBehavior('error', 'love')).toBeNull()
    expect(visibleBehavior('success', 'sleep')).toBeNull()
    expect(visibleBehavior('cover', 'shy')).toBe('shy')
    expect(visibleBehavior('cover', 'chirp')).toBeNull()
    expect(visibleBehavior('idle', 'sleep')).toBe('sleep')
    expect(captionKey('idle', null, false)).toBe('hello')
    expect(captionKey('scout', null, true)).toBe('scoutName')
    expect(captionKey('scout', null, false)).toBe('scout')
    expect(captionKey('idle', 'sleep', false)).toBe('sleep')
    expect(captionKey('error', 'love', false)).toBe('error')
    expect(captionKey('idle', 'look', false)).toBe('hello')
  })

  it('REQ-UI-042 每个气泡键都有文案；名字回显截断 8 字', () => {
    const bird = zhCN.auth.bird as Record<string, unknown>
    for (const k of [
      'scout',
      'scoutName',
      'cover',
      'peek',
      'captcha',
      'error',
      'success',
      'sleep',
      'shy',
      'love',
      'chirp',
    ])
      expect(typeof bird[k]).toBe('string')
    expect(Object.keys(zhCN.auth.bird.hello)).toEqual(['login', 'register', 'twoFactor', 'invite'])
    expect(namePreview('  fujiang ')).toBe('fujiang')
    expect(namePreview('abcdefghijk')).toBe('abcdefgh…')
    expect(namePreview('燕子衔枝筑巢春来早了')).toBe('燕子衔枝筑巢春来…')
  })

  it('REQ-UI-042 视线限幅：瞳孔不出眼白，歪头 ≤ 6°；弹簧收敛', () => {
    const far = gaze(10_000, 0)
    expect(far.px).toBeCloseTo(5)
    expect(far.tilt).toBe(6)
    const diag = gaze(-5000, 5000)
    expect(Math.hypot(diag.px / 5, diag.py / 4)).toBeLessThanOrEqual(1.0001)
    expect(gaze(0, 0)).toEqual({ px: 0, py: 0, tilt: 0 })
    const s: Spring = { x: 0, v: 0 }
    for (let i = 0; i < 240; i++) stepSpring(s, 1, 110, 13, 1 / 60)
    expect(s.x).toBeCloseTo(1, 2)
    // 掉帧（dt 很大）不爆冲
    const j: Spring = { x: 0, v: 0 }
    stepSpring(j, 1, 320, 28, 2)
    expect(Math.abs(j.x)).toBeLessThan(1)
  })

  it('REQ-UI-042 任何帧率弹簧都收敛：眼珠在 30 帧 / 秒及更低时不发散飞出（debug/2026-10-12-bird-eye-spring-diverge）', () => {
    // 引擎里用到的全部弹簧参数（眼珠 / 头 / 身体倾斜 / 尾巴）
    const springs: [number, number][] = [
      [760, 54],
      [240, 21],
      [38, 9],
      [70, 5],
    ]
    for (const [k, c] of springs)
      for (const ms of [4, 16.7, 25, 30, 31, 33.3, 40, 50, 100, 250, 2000]) {
        const s: Spring = { x: 0.5, v: 0 }
        let peak = 0
        for (let i = 0; i < 600; i++) {
          stepSpring(s, 0, k, c, ms / 1000)
          peak = Math.max(peak, Math.abs(s.x))
        }
        expect(Math.abs(s.x), `k${k} c${c} ${ms}ms`).toBeLessThan(0.01)
        expect(peak, `k${k} c${c} ${ms}ms 峰值`).toBeLessThan(1)
      }
    // 数值异常归位；负 / 非数字 dt 不推进
    const bad: Spring = { x: Number.NaN, v: Number.POSITIVE_INFINITY }
    stepSpring(bad, 0.3, 760, 54, 1 / 60)
    expect(bad).toEqual({ x: 0.3, v: 0 })
    const still: Spring = { x: 0.2, v: 0 }
    stepSpring(still, 1, 760, 54, -1)
    stepSpring(still, 1, 760, 54, Number.NaN)
    expect(still.x).toBeCloseTo(0.2, 6)
    // 兜底限位
    const far: Spring = { x: -1e9, v: 5 }
    boundSpring(far, 2.7)
    expect(far).toEqual({ x: -2.7, v: 0 })
  })

  it('REQ-UI-042 待机小动作覆盖全部种类', () => {
    const seen = new Set(Array.from({ length: 100 }, (_, i) => pickIdle(i / 100)))
    expect([...seen].sort()).toEqual([
      'chirp',
      'look',
      'lookup',
      'preen',
      'ruffle',
      'shuffle',
      'stretch',
      'tailbob',
      'tilt',
    ])
  })

  it('REQ-UI-043 样式守则：减弱档停关键帧、不用 will-change / backdrop-filter、丰富档才落叶；色值全走 token', () => {
    const a = css('auth.css')
    expect(a).toMatch(/:root\[data-motion="reduce"\] \.xz-auth \*/)
    expect(a).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(a).toMatch(/:root\[data-motion="rich"\] \.xz-falling/)
    const rules = a.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules).not.toMatch(/will-change|backdrop-filter/)
    const tokens = css('tokens.css')
    const used = new Set(
      [...a.matchAll(/var\((--xz-(?:bird|scene|willow|branch)[\w-]*)\)/g)].map((m) => m[1]),
    )
    for (const v of used) expect(tokens, v).toContain(`${v}:`)
  })
})
