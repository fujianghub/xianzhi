/**
 * 侧栏宽度（ADR-0058、REQ-UI-054）：≥ lg 拖动侧栏右缘调整，200 ~ 400px，默认 240（tokens.css `--xz-sidebar-w`）。
 * 宽度随设备不随账号（屏幕尺寸各异）：只存本机 `xz:sidebar-w`，且只在用户调过后才写；还原 = 删键。
 * 生效方式：在 <html> 上内联覆盖 `--xz-sidebar-w`（侧栏、主区让位、抽屉宽度都读它），首帧前由 main.tsx 应用。
 */
export const SIDEBAR_W = { min: 200, max: 400, def: 240, step: 16 } as const
const KEY = 'xz:sidebar-w'

export const clampSidebarWidth = (px: number): number =>
  Math.round(Math.min(SIDEBAR_W.max, Math.max(SIDEBAR_W.min, px)))

/** 本机存的宽度；没存过 / 非法值 → null（用 token 默认）。 */
export function storedSidebarWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v > 0 ? clampSidebarWidth(v) : null
  } catch {
    return null
  }
}

/** 写 html 内联变量；null = 移除，回到 tokens.css 默认。 */
export function applySidebarWidth(px: number | null): void {
  if (typeof document === 'undefined') return
  const s = document.documentElement.style
  if (px === null) s.removeProperty('--xz-sidebar-w')
  else s.setProperty('--xz-sidebar-w', `${clampSidebarWidth(px)}px`)
}

/** 应用并记住；等于默认值时删键（不写默认值）。 */
export function saveSidebarWidth(px: number | null): void {
  const v = px === null ? null : clampSidebarWidth(px)
  const keep = v !== null && v !== SIDEBAR_W.def
  applySidebarWidth(keep ? v : null)
  try {
    if (keep) localStorage.setItem(KEY, String(v))
    else localStorage.removeItem(KEY)
  } catch {
    // 隐私模式等：只在本次会话生效
  }
}

/** 当前生效宽度（读计算值，含 token 默认）。 */
export function currentSidebarWidth(): number {
  if (typeof document === 'undefined') return SIDEBAR_W.def
  const v = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--xz-sidebar-w'),
  )
  return Number.isFinite(v) ? v : SIDEBAR_W.def
}
