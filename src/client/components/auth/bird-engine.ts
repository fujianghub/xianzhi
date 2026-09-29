/**
 * 小燕动画引擎（ADR-0034、REQ-UI-042）：一个 rAF 循环，按真鸟的动作规律驱动节点——
 * 眼珠（pupil）+ 高光视差（glint）→ 头（head，绕颈转：喙指向目标，带出抬头 / 低头）→ 脸部组（face）
 * → 身（body，慢半拍倾 + 呼吸 + 换重心）→ 胸（chest，错相呼吸）→ 尾（tail，随身体倾斜速度反向摆 = 跟随回弹）。
 *
 * 跟随（第八轮「鼠标移动不跟随」）：
 *   - 头绕颈旋转让喙对准目标（角度随目标上下左右连续变化，而不是只平移 1px）；
 *   - 目标越过小燕背后一段距离就「转身」：根节点 `data-facing="back"`，CSS 把 head-fx 水平翻转，转头时顺带眨眼；
 *     回差防抖；捂眼 / 偷看 / 出错 / 成功时一律面朝前（它们自己的翻转优先）；
 *   - 眼珠放大行程，高光只跟 35%（视差），「在看」感更强；
 *   - 节奏：大幅换目标时快速甩头（扫视，眼先头后 60ms），小幅变化连续平滑跟随，不再僵住不动。
 * 去机械感：眼 → 头 → 身 → 尾 的弹簧由快到慢形成跟随链；平静时有鸟类的头部微顿挫、眼珠微扫、胸部错相呼吸、
 * 偶尔换重心；所有间隔与幅度随机化；情绪切换有预备冲量（缩脖、一怔）。
 *
 * 只写 `data-part` 节点的 `transform`（及根节点 data-facing）；CSS 用独立的 `rotate` / `translate` / `scale`
 * 叠加，互不覆盖。减弱档不起循环（姿态由 CSS 一步到位）；页面隐藏时停；首屏空闲后才启动，不占 LCP。
 */
import { type RefObject, useEffect, useRef } from 'react'
import type { MotionLevel } from '../../lib/motion.ts'
import {
  BEHAVIOR_MS,
  type BirdBehavior,
  type BirdMood,
  pickIdle,
  SLEEP_AFTER,
  type Spring,
  stepSpring,
} from './bird-mood.ts'

export interface EngineOptions {
  svg: RefObject<SVGSVGElement | null>
  mood: BirdMood
  motion: MotionLevel
  /** 表单关注点（client 坐标）：输入框光标 / 滑块手柄 / 密码框；null 则跟随指针 */
  focusPoint: () => { x: number; y: number } | null
  onBehavior: (b: BirdBehavior | null) => void
  /** 场景 / 探头版切换时重挂（svg 节点换了） */
  variant: string
}

export interface EngineHandle {
  poke: () => void
  pulse: (dir: 1 | -1) => void
  /** 立即播放一个小动作（动作实验台用） */
  play: (b: BirdBehavior) => void
}

const spring = (): Spring => ({ x: 0, v: 0 })
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const noop = () => undefined
const DEG = 180 / Math.PI

export function useBirdEngine(o: EngineOptions): RefObject<EngineHandle> {
  const opts = useRef(o)
  opts.current = o
  const handle = useRef<EngineHandle>({ poke: noop, pulse: noop, play: noop })
  const { motion, svg, variant } = o

  // biome-ignore lint/correctness/useExhaustiveDependencies: variant 变化 = svg 节点更换，需重挂
  useEffect(() => {
    const root = svg.current
    if (!root) return
    const $ = (p: string) => Array.from(root.querySelectorAll<SVGGElement>(`[data-part="${p}"]`))
    const head = $('head')[0]
    const face = $('face')[0]
    const body = $('body')[0]
    const chest = $('chest')[0]
    const tail = $('tail')[0]
    const pupils = $('pupil')
    const glints = $('glint')
    const lids = $('lid')
    const d = head?.dataset ?? {}
    const num = (v: string | undefined, dflt: number) => (v === undefined ? dflt : Number(v))
    const cx = num(d.cx, 122)
    const cy = num(d.cy, 82)
    const gmax = { x: num(d.gx, 1.8), y: num(d.gy, 1.4) }
    /** 喙的静息朝向（度，0 = 水平朝右，正 = 朝下） */
    const beakRest = num(d.beak, 8)
    if (head) head.style.transformOrigin = `${num(d.px, cx)}px ${num(d.py, cy + 18)}px`

    const cache = new WeakMap<Element, string>()
    const write = (els: (Element | undefined)[], v: string) => {
      for (const el of els) {
        if (!el || cache.get(el) === v) continue
        cache.set(el, v)
        ;(el as SVGGElement).style.transform = v
      }
    }

    let behavior: BirdBehavior | null = null
    let behaviorUntil = 0
    let behaviorAt = 0
    const setBehavior = (b: BirdBehavior | null, now: number) => {
      if (b === behavior) return
      behavior = b
      behaviorAt = now
      behaviorUntil = b ? now + BEHAVIOR_MS[b] : 0
      opts.current.onBehavior(b)
    }
    let taps: number[] = []
    const reduce = motion === 'reduce'
    let lastActivity = performance.now()

    const poke = () => {
      const now = performance.now()
      lastActivity = now
      taps = [...taps.filter((t) => now - t < 1600), now]
      if (reduce) {
        opts.current.onBehavior(taps.length > 1 ? 'love' : 'shy')
        return
      }
      setBehavior(null, now)
      setBehavior(taps.length > 1 ? 'love' : 'shy', now)
    }

    if (reduce) {
      let off: ReturnType<typeof setTimeout> | undefined
      const later = (ms: number) => {
        clearTimeout(off)
        off = setTimeout(() => opts.current.onBehavior(null), ms)
      }
      handle.current = {
        poke: () => {
          poke()
          later(BEHAVIOR_MS.love)
        },
        pulse: noop,
        play: (b) => {
          opts.current.onBehavior(b)
          if (Number.isFinite(BEHAVIOR_MS[b])) later(BEHAVIOR_MS[b])
        },
      }
      return () => clearTimeout(off)
    }

    // ---- 弹簧：眼最快（近临界）→ 头快而略回弹 → 脸随头 → 身慢 → 尾更慢且欠阻尼（回弹） ----
    const ex = spring()
    const ey = spring()
    const hr = spring()
    const hx = spring()
    const hy = spring()
    const fx = spring()
    const fy = spring()
    const lean = spring()
    const tailR = spring()

    // ---- 注视状态 ----
    let want = { x: 0.4, y: 0 } // 眼珠目标（归一化 -1..1）
    let aim = 0 // 头部目标转角（度）
    let aimFix = 0 // 已提交给头的转角（扫视 / 平滑）
    let aimAt = 0
    let lastSaccade = 0
    let facingBack = false
    let tiltBias = 0
    let micro = { x: 0, y: 0, until: 0 } // 眼珠微扫
    let nextMicro = performance.now() + rand(900, 2600)
    let nextTwitch = performance.now() + rand(700, 1800) // 头部微顿挫
    let shift = 0 // 换重心
    let nextShift = performance.now() + rand(3000, 7000)

    let pointer: { x: number; y: number } | null = null
    let nextIdle = performance.now() + rand(3500, 7000)
    let blinkNext = performance.now() + rand(1500, 4000)
    let blinkAt = -1
    let raf = 0
    let last = performance.now()
    let prevMood: BirdMood = opts.current.mood

    const blinkSoon = () => {
      if (blinkAt < 0) blinkNext = Math.min(blinkNext, performance.now() + 30)
    }
    const setFacing = (back: boolean) => {
      if (back === facingBack) return
      facingBack = back
      if (back) root.dataset.facing = 'back'
      else delete root.dataset.facing
      blinkSoon() // 转头时顺带眨眼
      hy.v += 40 // 转身时身子一沉
    }

    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY }
      lastActivity = performance.now()
    }
    const onActive = () => {
      lastActivity = performance.now()
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = (now - last) / 1000
      last = now
      const { mood, focusPoint } = opts.current

      // ---- 情绪切换：预备冲量 ----
      if (mood !== prevMood) {
        if (mood === 'cover') hy.v += 70 // 先缩脖
        if (mood === 'error') hr.v -= 110 // 一怔
        if (mood === 'success') hy.v += 60 // 蹲一下再跳（跳在 CSS）
        if (mood === 'scout' || mood === 'captcha') blinkSoon()
        prevMood = mood
        lastSaccade = 0
      }

      // ---- 小动作生命周期 ----
      if (behavior && now > behaviorUntil) setBehavior(behavior === 'sleep' ? 'wake' : null, now)
      if (behavior === 'sleep' && (mood !== 'idle' || now - lastActivity < 400))
        setBehavior('wake', now)
      if (mood === 'idle' && !behavior) {
        if (now - lastActivity > SLEEP_AFTER) setBehavior('sleep', now)
        else if (now > nextIdle && now - lastActivity > 1200) {
          setBehavior(pickIdle(Math.random()), now)
          nextIdle = now + rand(3500, 8000)
        }
      } else if (mood !== 'idle') nextIdle = Math.max(nextIdle, now + 2500)

      // ---- 目标：相对头心的屏幕向量，按插画尺寸归一 ----
      const r = root.getBoundingClientRect()
      const vb = root.viewBox.baseVal
      const s = r.width / (vb.width || 1)
      const ox = r.left + (cx - vb.x) * s
      const oy = r.top + (cy - vb.y) * s
      const reach = Math.max(160, r.width * 0.55)
      let target: { x: number; y: number } | null = null
      let poseRot = 0
      let poseX = 0
      let poseY = 0
      let bodyLean = 0
      let lidCap = 1
      let canTurn = mood === 'idle'
      const t = now - behaviorAt

      if (mood === 'error') {
        want = { x: -0.3, y: 0.9 }
        poseRot = 14
        poseY = 2.5
      } else if (mood === 'success') {
        want = { x: 0.4, y: -0.5 }
        poseRot = -4 // 微抬头即可：衔的枝不顶进气泡
        poseY = 0
      } else if (mood === 'cover') {
        want = { x: 0, y: 0.4 }
        poseY = 2.5
      } else if (mood === 'peek') {
        target = focusPoint() ?? pointer
        poseRot = -6
      } else if (mood === 'scout' || mood === 'captcha') {
        target = focusPoint() ?? pointer
      } else {
        switch (behavior) {
          case 'sleep':
            want = { x: 0, y: 0.8 }
            poseRot = 18
            poseY = 2.5
            canTurn = false
            break
          case 'look':
            if (now - lastSaccade > rand(380, 760)) {
              const back = Math.random() < 0.35
              setFacing(back)
              want = { x: rand(0.2, 1), y: rand(-0.8, 0.4) }
              aim = rand(-24, 16)
              lastSaccade = now
              aimAt = now + 60
            }
            canTurn = false
            break
          case 'tilt':
            if (t < 40) tiltBias = (Math.random() < 0.5 ? -1 : 1) * rand(14, 20)
            target = pointer
            break
          case 'lookup':
            want = { x: 0.5, y: -1 }
            poseRot = -26
            canTurn = false
            break
          case 'preen':
            want = { x: -0.8, y: 0.9 }
            poseRot = 30 + Math.sin(t / 85) * 4
            poseX = -3
            poseY = 3
            lidCap = 0.25
            canTurn = false
            setFacing(true)
            break
          case 'stretch':
            bodyLean = -4
            poseY = -1
            break
          case 'shy':
            want = { x: 0.9, y: 0.6 }
            poseRot = 10
            poseY = 1.5
            canTurn = false
            break
          case 'love':
            poseRot = Math.sin(t / 110) * 7
            break
          default:
            target = pointer
        }
      }
      if (mood !== 'idle' || (behavior && behavior !== 'look' && behavior !== 'preen')) {
        if (!canTurn) setFacing(false)
      }

      // ---- 目标 → 转身 / 喙指向 / 眼珠 ----
      if (!target && behavior !== 'look') aim = 0
      if (target) {
        const dx = target.x - ox
        const dy = target.y - oy
        // 转身（回差）：越过背后 0.45 × reach 转过去，回到 -0.12 × reach 以右才转回
        if (canTurn) {
          if (!facingBack && dx < -reach * 0.45) setFacing(true)
          else if (facingBack && dx > -reach * 0.12) setFacing(false)
        } else setFacing(false)
        const sx = facingBack ? -dx : dx // 面朝方向上的前向距离
        const ang = Math.atan2(dy, Math.max(24, Math.abs(sx))) * DEG // 喙指向（正 = 朝下）
        aim = clamp((ang - beakRest) * 0.7, -26, 22)
        const k = Math.min(1, Math.hypot(dx, dy) / reach)
        const n = Math.hypot(dx, dy) || 1
        want = { x: (Math.abs(sx) / n) * k, y: (dy / n) * k }
        // 扫视：换目标幅度大 → 眼先头后快速甩；幅度小 → 连续平滑跟随
        if (Math.abs(aim - aimFix) > 9 && now - lastSaccade > 140) {
          lastSaccade = now
          aimAt = now + 60
          if (mood === 'idle' && !behavior && Math.random() < 0.2)
            tiltBias = (Math.random() < 0.5 ? -1 : 1) * rand(3, 6)
          if (Math.abs(aim - aimFix) > 20 && Math.random() < 0.3) blinkSoon()
        }
      }
      if (now >= aimAt) aimFix = target ? aimFix + (aim - aimFix) * Math.min(1, dt * 9) : aim
      if (!behavior || behavior !== 'tilt') tiltBias *= 1 - Math.min(1, dt * 0.6)

      // ---- 平静时的活物感：头部微顿挫、眼珠微扫、换重心 ----
      const calm = (mood === 'idle' || mood === 'scout') && behavior !== 'sleep'
      if (calm && now > nextTwitch) {
        hr.v += rand(-38, 38)
        hy.v += rand(-10, 10)
        nextTwitch = now + rand(600, 2000)
      }
      if (calm && now > nextMicro) {
        micro = { x: rand(-0.18, 0.18), y: rand(-0.14, 0.14), until: now + rand(220, 480) }
        nextMicro = now + rand(900, 2800)
      }
      if (mood === 'idle' && now > nextShift) {
        shift = Math.random() < 0.4 ? 0 : rand(-1.6, 1.6)
        nextShift = now + rand(3000, 8000)
      }
      const mx = now < micro.until ? micro.x : 0
      const my = now < micro.until ? micro.y : 0

      // ---- 目标 → 弹簧 ----
      const eyeX = (want.x + mx) * gmax.x
      const eyeY = (want.y + my) * gmax.y
      stepSpring(ex, eyeX, 760, 54, dt)
      stepSpring(ey, eyeY, 760, 54, dt)
      const headRot = (facingBack ? -1 : 1) * (aimFix + poseRot) + tiltBias
      stepSpring(hr, headRot, 240, 21, dt)
      stepSpring(hx, want.x * 0.6 + poseX, 240, 21, dt)
      stepSpring(hy, (aimFix / 26) * 0.9 + poseY, 240, 21, dt)
      stepSpring(fx, want.x * 0.7, 240, 21, dt)
      stepSpring(fy, want.y * 0.5, 240, 21, dt)
      // 身体：朝注视方向慢半拍地倾，平静时再叠换重心与极缓的晃动
      const sway = calm ? Math.sin(now / 2700) * 0.5 + Math.sin(now / 4300 + 1) * 0.35 : 0
      const leanTarget = (facingBack ? -1 : 1) * want.x * 1.8 + bodyLean + shift + sway
      stepSpring(lean, leanTarget, 38, 9, dt)
      // 尾巴：跟随回弹——随身体倾斜速度反向摆，欠阻尼
      stepSpring(tailR, clamp(-lean.v * 0.9 - hr.v * 0.02, -9, 9), 70, 5, dt)

      // ---- 呼吸 / 眨眼 ----
      const sleeping = behavior === 'sleep'
      const bp = (now / (sleeping ? 4800 : 3100)) * Math.PI * 2
      const breath = 1 + (sleeping ? 0.03 : 0.012) * Math.sin(bp)
      const chestPuff = 1 + (sleeping ? 0.025 : 0.014) * Math.sin(bp - 0.9)
      let lid = lidCap
      const canBlink = !sleeping && mood !== 'success' && mood !== 'cover' && lidCap === 1
      if (blinkAt < 0 && canBlink && now >= blinkNext) blinkAt = now
      if (blinkAt >= 0) {
        const p = (now - blinkAt) / 150 // 快闭慢睁
        if (p >= 1) {
          blinkAt = -1
          blinkNext = now + (Math.random() < 0.18 ? 120 : rand(2000, 5500))
        } else lid = 1 - (p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7) * 0.94
      }

      const f = (n: number) => n.toFixed(2)
      write([head], `translate(${f(hx.x)}px, ${f(hy.x)}px) rotate(${f(hr.x)}deg)`)
      write([face], `translate(${f(fx.x)}px, ${f(fy.x)}px)`)
      write([body], `rotate(${f(lean.x)}deg) scale(1, ${breath.toFixed(3)})`)
      write([chest], `scale(${chestPuff.toFixed(3)})`)
      write([tail], `rotate(${f(tailR.x)}deg)`)
      write(pupils, `translate(${f(ex.x)}px, ${f(ey.x)}px)`)
      write(glints, `translate(${f(ex.x * 0.35)}px, ${f(ey.x * 0.35)}px)`)
      write(lids, `scale(1, ${lid.toFixed(3)})`)
    }

    handle.current = {
      poke,
      // 打字：头朝输入方向啄一下（删除时反向），像在一个字一个字地看
      pulse: (dir) => {
        lastActivity = performance.now()
        hr.v += dir * 50
        hy.v += 18
      },
      play: (b) => {
        const now = performance.now()
        lastActivity = now
        setBehavior(null, now)
        setBehavior(b, now)
      },
    }

    const start = () => {
      if (raf || document.hidden) return
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const onVis = () => {
      if (document.hidden) stop()
      else {
        lastActivity = performance.now()
        start()
      }
    }
    // 首屏空闲后再启动，避免与 LCP / 字体加载抢主线程
    const ric = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 400))
    const cic = window.cancelIdleCallback ?? clearTimeout
    const idleId = ric(start, { timeout: 1200 })
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('keydown', onActive, { passive: true })
    window.addEventListener('focusin', onActive)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cic(idleId as number)
      stop()
      delete root.dataset.facing
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('keydown', onActive)
      window.removeEventListener('focusin', onActive)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [motion, svg, variant])

  return handle
}
