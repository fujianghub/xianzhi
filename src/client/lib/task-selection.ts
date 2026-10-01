/**
 * 任务的页面级选择（ADR-0045、REQ-TASK-040）：跨分组多选，一个页面一条批量条。
 * - store（zustand）：`selected` = id → 任务快照（批量要 `updatedAt` 作 ifUpdatedAt、要本人标签算增删）；
 *   行用 `useTaskSelected(id)` 逐行订阅，选择变化只重渲染相关行（REQ-UI-017：1 万行不掉帧）。
 * - 顺序注册表（模块级、非响应式）：每个 TaskList / 行容器按「组序」登记其可见任务，
 *   Shift 连选按这个跨组顺序；登记变化时把已不可见（完成 / 收起 / 换视图）的选中项剔除。
 * - 只有包在 `TaskSelectionScope` 里的页面启用（`selectionEnabled` 上下文），详情里的子任务等不参与。
 */
import { createContext, useContext } from 'react'
import { create } from 'zustand'
import type { Task } from './task-queries.ts'

interface SelectionState {
  selected: Map<string, Task>
  /** Shift 连选起点 */
  anchor: string | null
  /** 页头「选择」模式：行前显示复选框，点行即切换 */
  selectMode: boolean
  toggle: (t: Task) => void
  add: (ts: Task[]) => void
  set: (ts: Task[]) => void
  rangeTo: (t: Task) => void
  clear: () => void
  setSelectMode: (on: boolean) => void
}

const registry = new Map<string, { rank: number; tasks: Task[] }>()

/** 跨组的当前可见顺序 */
export function selectionOrder(): Task[] {
  return [...registry.values()].sort((a, b) => a.rank - b.rank).flatMap((x) => x.tasks)
}

/** Shift 连选：order 中 anchor 与 target 之间（含两端）的 id；anchor 不在 order 里则只选 target */
export function rangeSelect(
  order: readonly string[],
  anchor: string | null,
  target: string,
): string[] {
  const b = order.indexOf(target)
  if (b < 0) return []
  const a = anchor ? order.indexOf(anchor) : -1
  if (a < 0) return [target]
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return order.slice(lo, hi + 1)
}

export const useTaskSelectionStore = create<SelectionState>((set, get) => ({
  selected: new Map(),
  anchor: null,
  selectMode: false,
  toggle: (t) =>
    set((s) => {
      const next = new Map(s.selected)
      if (next.has(t.id)) next.delete(t.id)
      else next.set(t.id, t)
      return { selected: next, anchor: t.id }
    }),
  add: (ts) =>
    set((s) => {
      const next = new Map(s.selected)
      for (const t of ts) next.set(t.id, t)
      return { selected: next }
    }),
  set: (ts) => set({ selected: new Map(ts.map((t) => [t.id, t])) }),
  rangeTo: (t) => {
    const order = selectionOrder()
    const ids = new Set(
      rangeSelect(
        order.map((x) => x.id),
        get().anchor,
        t.id,
      ),
    )
    get().add(order.filter((x) => ids.has(x.id)))
  },
  clear: () => set({ selected: new Map(), anchor: null }),
  setSelectMode: (on) =>
    set(on ? { selectMode: true } : { selectMode: false, selected: new Map(), anchor: null }),
}))

/** 登记某组的可见任务；同时把已不可见的选中项剔除、把仍可见的快照更新为最新 */
export function registerSelectable(key: string, rank: number, tasks: Task[]) {
  registry.set(key, { rank, tasks })
  prune()
}
export function unregisterSelectable(key: string) {
  registry.delete(key)
  prune()
}
function prune() {
  const s = useTaskSelectionStore.getState()
  if (!s.selected.size) return
  const live = new Map(selectionOrder().map((t) => [t.id, t]))
  let changed = false
  const next = new Map<string, Task>()
  for (const [id, old] of s.selected) {
    const cur = live.get(id)
    if (!cur) {
      changed = true
      continue
    }
    if (cur !== old) changed = true
    next.set(id, cur)
  }
  if (changed) useTaskSelectionStore.setState({ selected: next })
}
/** 换页面 / 视图时清空 */
export function resetSelection() {
  registry.clear()
  useTaskSelectionStore.setState({ selected: new Map(), anchor: null, selectMode: false })
}

export const useTaskSelected = (id: string) => useTaskSelectionStore((s) => s.selected.has(id))

/** 本页是否启用页面级选择（TaskSelectionScope 提供） */
export const SelectionEnabledContext = createContext(false)
export const useSelectionEnabled = () => useContext(SelectionEnabledContext)

/** 平台多选修饰键：Mac 用 ⌘（Ctrl+点击在 Mac 上是右键），其余用 Ctrl */
export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const isMultiKey = (e: { metaKey: boolean; ctrlKey: boolean }) =>
  isMac ? e.metaKey : e.ctrlKey
