/**
 * 动效档位（04 §2.4、ADR-0005 §3、REQ-UI-028）：reduce / standard / rich，本机偏好 `xz:motion`。
 * 写 html[data-motion]：standard 不写属性，reduce / rich 写同名值；系统 prefers-reduced-motion 优先于用户选择。
 * 唯一判定入口：CSS 用 `[data-motion]` 与媒体查询，JS 用 `effectiveMotion()`，Motion 组件包在 `XzMotionConfig` 内。
 */
export type MotionLevel = 'reduce' | 'standard' | 'rich'

const KEY = 'xz:motion'

export function storedMotion(): MotionLevel {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'reduce' || v === 'rich' ? v : 'standard'
  } catch {
    return 'standard'
  }
}

export function applyMotion(level: MotionLevel): void {
  const root = document.documentElement
  if (level === 'standard') delete root.dataset.motion
  else root.dataset.motion = level
}

export function setMotion(level: MotionLevel): void {
  try {
    if (level === 'standard') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, level)
  } catch {
    /* 隐私模式 */
  }
  applyMotion(level)
}

/** 实际生效档位：系统减弱动效时一律 reduce。 */
export function effectiveMotion(): MotionLevel {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduce'
  const v = document.documentElement.dataset.motion
  return v === 'reduce' || v === 'rich' ? v : 'standard'
}
