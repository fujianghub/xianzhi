/**
 * 主题（06 §6、REQ-UI-001）：light / dark / system；持久化 localStorage `xz:theme`；
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

function persist(choice: ThemeChoice): void {
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

export function setTheme(next: ThemeChoice, origin?: { x: number; y: number }): Promise<void> {
  const resolved: Theme = next === 'system' ? systemTheme() : next
  const commit = () => {
    applyTheme(resolved)
    persist(next)
  }
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => {
      finished: Promise<void>
      skipTransition: () => void
    }
  }
  if (!doc.startViewTransition || reducedMotion() || resolved === currentTheme()) {
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

/** 跟随系统时监听系统变化（整页溶解）。 */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const on = () => {
    if (storedChoice() === 'system') void setTheme('system')
  }
  mq.addEventListener('change', on)
  return () => mq.removeEventListener('change', on)
}
