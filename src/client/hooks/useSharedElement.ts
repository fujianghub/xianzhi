/**
 * 卡片 → 详情共享元素过渡（04 §2.4、REQ-UI-021）。借路由转场（`route` 类型，main.tsx）完成，不另起 View Transition：
 * - 点击时 `markSharedSource(el)` 给被点的一张卡片打 `data-shared-source`，并摘掉页面上残留的目标标记（旧快照只有一个同名元素）；
 * - 目标（详情标题）挂载时 `useSharedTarget` 摘掉来源标记、给自己打 `data-shared-target`（新快照只有一个同名元素）；
 * - `view-transition-name` 只在 `:active-view-transition-type(route)` 期间由 app.css 赋予，平时 DOM 中为 0 个。
 * 来源 / 目标缺一（详情仍在加载、减弱档无转场）即退化为普通淡入。
 */
import { useCallback } from 'react'

const SOURCE = 'data-shared-source'
const TARGET = 'data-shared-target'
let timer: ReturnType<typeof setTimeout> | undefined

export function markSharedSource(el: Element | null): void {
  if (!el) return
  for (const n of document.querySelectorAll(`[${SOURCE}], [${TARGET}]`)) {
    n.removeAttribute(SOURCE)
    n.removeAttribute(TARGET)
  }
  el.setAttribute(SOURCE, '')
  // 没有发生导航（点击被拦截、同一路由）时自动清理，避免下一次转场误配
  clearTimeout(timer)
  timer = setTimeout(() => el.removeAttribute(SOURCE), 1000)
}

/** 目标元素的 ref；`key` 变化（切换到另一条任务）时重新认领。 */
export function useSharedTarget(key: string) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: key 变化需要重新认领
  return useCallback(
    (el: HTMLElement | null) => {
      if (!el) return
      for (const n of document.querySelectorAll(`[${SOURCE}]`)) n.removeAttribute(SOURCE)
      el.setAttribute(TARGET, '')
    },
    [key],
  )
}
