/**
 * 认证页小燕的纯逻辑（ADR-0034、REQ-UI-041 · 042）：表单信号 → 情绪（mood）、气泡文案键、视线数学。
 * 无 DOM 依赖，单测覆盖；渲染与动画见 `AuthShell` / `bird-engine`。
 */

/** 情绪：由表单状态推导，优先级 success > error > cover > peek > captcha > scout > idle。 */
export type BirdMood = 'idle' | 'scout' | 'cover' | 'peek' | 'captcha' | 'error' | 'success'

/**
 * 小动作：引擎按时间调度（待机 / 睡觉 / 被点），不改变情绪，只叠加表情。
 * 待机清单取燕子停栖时真会做的：张望、歪头打量、抬头看天、理羽、啾鸣、抖羽、翘尾、伸翅、横挪
 * （燕子腿弱，几乎不在枝上原地蹦，所以不做「跳一下」）。
 */
export type BirdBehavior =
  | 'look'
  | 'tilt'
  | 'lookup'
  | 'preen'
  | 'chirp'
  | 'ruffle'
  | 'tailbob'
  | 'stretch'
  | 'shuffle'
  | 'sleep'
  | 'wake'
  | 'shy'
  | 'love'

export type BirdFocus = 'text' | 'secret' | 'captcha' | null

export interface BirdInputs {
  focus: BirdFocus
  /** 页面上的密码框当前是否为明文 */
  secretVisible: boolean
  secretFilled: boolean
  flash: 'error' | 'success' | null
}

export function deriveMood(i: BirdInputs): BirdMood {
  if (i.flash) return i.flash
  if (i.focus === 'secret' && !i.secretVisible) return 'cover'
  if (i.secretVisible && i.secretFilled) return 'peek'
  if (i.focus === 'captcha') return 'captcha'
  if (i.focus === 'text') return 'scout'
  return 'idle'
}

/** 被点 / 睡觉只在平静情绪下接管表情与气泡；出错与成功永远优先。 */
export function visibleBehavior(mood: BirdMood, b: BirdBehavior | null): BirdBehavior | null {
  if (!b) return null
  if (mood === 'error' || mood === 'success') return null
  if (b === 'shy' || b === 'love') return b
  if (mood === 'cover' || mood === 'peek') return null
  return b
}

export type CaptionKey =
  | 'hello'
  | 'scout'
  | 'scoutName'
  | 'cover'
  | 'peek'
  | 'captcha'
  | 'error'
  | 'success'
  | 'sleep'
  | 'shy'
  | 'love'
  | 'chirp'

export function captionKey(mood: BirdMood, b: BirdBehavior | null, hasName: boolean): CaptionKey {
  const v = visibleBehavior(mood, b)
  if (v === 'shy' || v === 'love' || v === 'sleep' || v === 'chirp') return v
  if (mood === 'idle') return 'hello'
  if (mood === 'scout') return hasName ? 'scoutName' : 'scout'
  return mood
}

/** 气泡里回显的名字：去空白、最多 8 个字符（按码点），超出加省略号。 */
export function namePreview(raw: string): string {
  const s = [...raw.trim()]
  return s.length > 8 ? `${s.slice(0, 8).join('')}…` : s.join('')
}

/** 视线：目标点相对头心 (dx, dy) → 瞳孔偏移（椭圆限幅）与歪头角度。reach = 达到最大偏移的距离。 */
export function gaze(dx: number, dy: number, max = { x: 5, y: 4 }, reach = 260) {
  const d = Math.hypot(dx, dy)
  if (d < 0.001) return { px: 0, py: 0, tilt: 0 }
  const k = Math.min(d, reach) / reach
  return {
    px: (dx / d) * k * max.x,
    py: (dy / d) * k * max.y,
    tilt: Math.max(-6, Math.min(6, dx / 60)),
  }
}

export interface Spring {
  x: number
  v: number
}
/** 子步长：半隐式欧拉在 k·h² + 2c·h < 4 时才稳定，眼珠（k 760 / c 54）单步超过约 30 ms 就发散 */
export const SPRING_SUBSTEP = 1 / 120
/** 一帧最多推进的时长：卡顿 / 切回前台后不追帧爆冲 */
export const SPRING_MAX_DT = 1 / 10

/**
 * 半隐式欧拉弹簧；dt 秒。整帧拆成 ≤ 1/120 s 的子步，任何帧率都稳定
 * （原先单步、上限 1/30：低于约 33 帧 / 秒时眼珠来回放大飞出画面，debug/2026-10-12-bird-eye-spring-diverge）。
 * 数值异常（NaN / Infinity）时归位到目标。
 */
export function stepSpring(s: Spring, target: number, k: number, c: number, dt: number): void {
  const total = Math.min(Number.isFinite(dt) ? Math.max(dt, 0) : 0, SPRING_MAX_DT)
  const n = Math.max(1, Math.ceil(total / SPRING_SUBSTEP))
  const h = total / n
  for (let i = 0; i < n; i++) {
    s.v += (k * (target - s.x) - c * s.v) * h
    s.x += s.v * h
  }
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) {
    s.x = target
    s.v = 0
  }
}

/** 兜底：把弹簧位置限在 ±lim 内（碰边即停），眼珠不出眼眶 */
export function boundSpring(s: Spring, lim: number): void {
  if (s.x > lim || s.x < -lim) {
    s.x = Math.max(-lim, Math.min(lim, s.x))
    s.v = 0
  }
}

/** 待机小动作的加权随机；r ∈ [0, 1)。 */
const IDLE: [BirdBehavior, number][] = [
  ['look', 4],
  ['tilt', 3],
  ['tailbob', 3],
  ['chirp', 2],
  ['ruffle', 2],
  ['preen', 2],
  ['lookup', 1],
  ['stretch', 1],
  ['shuffle', 1],
]
export function pickIdle(r: number): BirdBehavior {
  const total = IDLE.reduce((a, [, w]) => a + w, 0)
  let acc = 0
  for (const [b, w] of IDLE) {
    acc += w / total
    if (r < acc) return b
  }
  return 'look'
}

export const BEHAVIOR_MS: Record<BirdBehavior, number> = {
  look: 1800,
  tilt: 1400,
  lookup: 1500,
  preen: 1600,
  chirp: 1000,
  ruffle: 750,
  tailbob: 650,
  stretch: 1400,
  shuffle: 1500,
  sleep: Number.POSITIVE_INFINITY,
  wake: 900,
  shy: 1500,
  love: 1700,
}

/** 无操作多久入睡（毫秒）。 */
export const SLEEP_AFTER = 20_000
