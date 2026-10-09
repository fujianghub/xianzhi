/**
 * 记录链接单击 → 右侧详情坞（ADR-0054 §B）。列表 / 卡片 / 看板 / 时间线 / 空间首页的记录链接在 onClick 里调用：
 * ≥ lg 的普通左键单击改为在坞内打开（阻止跳转）；⌘ / Ctrl / Shift / 中键、窄屏照常走链接（整页 / 新标签）。
 * 返回是否已接管。
 */
import type { MouseEvent } from 'react'
import { useEntryDock } from './stores.ts'

export const DOCK_QUERY = '(min-width: 64rem)'

export function openInDock(e: MouseEvent, entryId: string): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return false
  if (typeof window === 'undefined' || !window.matchMedia?.(DOCK_QUERY).matches) return false
  e.preventDefault()
  useEntryDock.getState().open(entryId)
  return true
}

/** Peek / 命令等非点击入口：宽屏开坞，返回 false 时调用方自行跳整页 */
export function openEntryDetail(entryId: string): boolean {
  if (typeof window === 'undefined' || !window.matchMedia?.(DOCK_QUERY).matches) return false
  useEntryDock.getState().open(entryId)
  return true
}
