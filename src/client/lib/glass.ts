/**
 * 玻璃强度（ADR-0047、REQ-UI-049）：liquid 流光（默认）/ vivid 晶亮 / clear 清透 / standard 标准，本机偏好 `xz:glass`。
 * 写 html[data-glass]：standard 不写属性（= 原 token），其余写同名值；默认 liquid 不存储。
 * 首帧前由 public/theme-init.js 应用；只调 token，不新增 backdrop-filter。
 */
export type GlassLevel = 'standard' | 'clear' | 'vivid' | 'liquid'
export const GLASS_LEVELS: GlassLevel[] = ['liquid', 'vivid', 'clear', 'standard']
export const DEFAULT_GLASS: GlassLevel = 'liquid'

const KEY = 'xz:glass'

export function storedGlass(): GlassLevel {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'standard' || v === 'clear' || v === 'vivid' ? v : DEFAULT_GLASS
  } catch {
    return DEFAULT_GLASS
  }
}

export function setGlass(level: GlassLevel): void {
  try {
    if (level === DEFAULT_GLASS) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, level)
  } catch {
    /* 隐私模式 */
  }
  const root = document.documentElement
  if (level === 'standard') delete root.dataset.glass
  else root.dataset.glass = level
}
