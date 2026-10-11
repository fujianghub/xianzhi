/**
 * 主题（06 §6、REQ-UI-001）：light / dark / system；持久化 localStorage `xz:theme`；皮肤生效时由皮肤锁定（ADR-0059）；
 * View Transitions：有坐标 → 圆形揭幕（dur-theme），无坐标 → 整页溶解（dur-stage）；reduced-motion 瞬切；连点 skip 上一个。
 */
import { effectiveMotion } from './motion.ts'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

const KEY = 'xz:theme'
let running: { skipTransition: () => void } | null = null

export function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function storedChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/** 只记住选择（不改页面）；皮肤生效 / 退出皮肤时用 */
export function persist(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    /* 隐私模式 */
  }
}

/** 动效档位的唯一判定在 lib/motion.ts（REQ-UI-028）。 */
export function reducedMotion(): boolean {
  return effectiveMotion() === 'reduce'
}

function farthestCorner(o: { x: number; y: number }): number {
  const w = window.innerWidth
  const h = window.innerHeight
  return Math.max(
    Math.hypot(o.x, o.y),
    Math.hypot(w - o.x, o.y),
    Math.hypot(o.x, h - o.y),
    Math.hypot(w - o.x, h - o.y),
  )
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement
  root.dataset.theme = t
  root.style.colorScheme = t
}

/**
 * 在 View Transition 里提交外观变化：有坐标 → 圆形揭幕，无坐标 → 整页溶解；不支持 / reduced-motion / skip 为真 → 直接提交。
 * 主题切换与皮肤切换（ADR-0059）共用。
 */
export function viewTransition(
  commit: () => void,
  origin?: { x: number; y: number },
  skip = false,
): Promise<void> {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => {
      finished: Promise<void>
      skipTransition: () => void
    }
  }
  if (!doc.startViewTransition || reducedMotion() || skip) {
    commit()
    return Promise.resolve()
  }
  running?.skipTransition() // 06 §9 #6：连点不叠帧
  const root = document.documentElement
  root.classList.add('vt-live')
  if (origin) {
    root.style.setProperty('--vt-x', `${origin.x}px`)
    root.style.setProperty('--vt-y', `${origin.y}px`)
    root.style.setProperty('--vt-r', `${farthestCorner(origin) + 90}px`)
    root.classList.add('vt-circle')
  }
  const vt = doc.startViewTransition(commit)
  running = vt
  return vt.finished.finally(() => {
    if (running === vt) running = null
    root.classList.remove('vt-live', 'vt-circle')
  })
}

export function setTheme(next: ThemeChoice, origin?: { x: number; y: number }): Promise<void> {
  const resolved: Theme = next === 'system' ? systemTheme() : next
  // 皮肤生效时日夜场由皮肤锁定（ADR-0059）：只记住选择，不改 data-theme
  if (document.documentElement.dataset.skin) {
    persist(next)
    return Promise.resolve()
  }
  return viewTransition(
    () => {
      applyTheme(resolved)
      persist(next)
    },
    origin,
    resolved === currentTheme(),
  )
}

/** 跟随系统时监听系统变化（整页溶解）。 */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const on = () => {
    if (storedChoice() === 'system') void setTheme('system')
  }
  mq.addEventListener('change', on)
  return () => mq.removeEventListener('change', on)
}
