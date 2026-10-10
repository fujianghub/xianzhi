/**
 * 编辑器浮层的公共定位（ADR-0056 §B · §D · §E）：链接气泡、表格工具条（BubbleMenu）与斜杠 / @ 候选（Suggestion）共用。
 * - 一律 fixed，挂到 body 下的专用容器；编辑器在 Radix 弹窗（`[role=dialog]`）里时挂到弹窗内——模态弹窗给 body
 *   设了 `pointer-events: none` 且有焦点锁，挂在外面就点不中、输入框拿不到焦点（debug/2026-10-09-mention-menu-unclickable-in-modal-sheet）；
 * - flip / shift 的边界 = 所在纸面 / 详情坞 / 弹窗，顶部让出顶栏与吸住的格式栏；
 * - 任意内部滚动容器滚动（capture，rAF 节流）时重新定位——插件自己只听 window。
 */
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useRef, useState } from 'react'

const EDGE = 8

function editorDom(editor: Editor): HTMLElement | null {
  try {
    return editor.isDestroyed ? null : editor.view.dom
  } catch {
    return null // 视图未挂载
  }
}

/** 浮层的定位边界：所在纸面 / 详情坞 / 弹窗；都不在则为视口 */
export function menuBoundary(editor: Editor): HTMLElement | null {
  return (
    editorDom(editor)?.closest<HTMLElement>('.xz-reading, .xz-detail-dock, [role="dialog"]') ?? null
  )
}

/** 浮层的挂载父节点：所在 Radix 弹窗，否则 body */
export function menuParent(editor: Editor): HTMLElement {
  return editorDom(editor)?.closest<HTMLElement>('[role="dialog"]') ?? document.body
}

const visibleBottom = (el: Element | null | undefined) =>
  el?.getClientRects().length ? el.getBoundingClientRect().bottom : 0

/** 顶部留白：顶栏底边、所在区域里吸住的格式栏底边，取较低者 + 边距 */
export function topInset(editor: Editor): number {
  const bar = visibleBottom(document.querySelector('[data-testid="topbar"]'))
  const stuck = visibleBottom(menuBoundary(editor)?.querySelector('.xz-editor-toolbar[data-stuck]'))
  return Math.max(0, bar, stuck) + EDGE
}

/** flip / shift 的边界参数（定位时现取） */
export function menuBounds(editor: Editor) {
  return {
    boundary: menuBoundary(editor) ?? ('clippingAncestors' as const),
    padding: { top: topInset(editor), right: EDGE, bottom: EDGE, left: EDGE },
  }
}

/**
 * BubbleMenu 用：返回 `appendTo`、显隐标记与 `reposition()`（派发 `updatePosition` 元事务）。
 * 调用方在 options 里设 `strategy: 'fixed'`、flip / shift 用 `menuBounds`，onShow / onHide 里维护 `visible`。
 */
export function useFixedMenu(editor: Editor, pluginKey: string) {
  const [host] = useState(() => document.createElement('div'))
  useEffect(() => () => host.remove(), [host])
  const visible = useRef(false)
  const appendTo = useCallback(() => {
    const parent = menuParent(editor)
    if (host.parentElement !== parent) parent.appendChild(host)
    return host
  }, [editor, host])
  const reposition = useCallback(() => {
    if (!visible.current || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(pluginKey, 'updatePosition'))
  }, [editor, pluginKey])
  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      if (!visible.current || raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        reposition()
      })
    }
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      cancelAnimationFrame(raf)
    }
  }, [reposition])
  return { appendTo, visible, reposition }
}

/**
 * Suggestion（斜杠 / @）候选框的宿主：fixed、挂在弹窗内或 body 下，锚在光标矩形下方，滚动 / 尺寸变化时跟随。
 * `place(getRect)` 每次 onStart / onUpdate 调用；`destroy()` 在 onExit 调用。
 */
export function suggestionPopup(editor: Editor, zIndex: string) {
  const el = document.createElement('div')
  el.style.position = 'fixed'
  el.style.zIndex = zIndex
  menuParent(editor).appendChild(el)
  let getRect: (() => DOMRect | null | undefined) | null = null
  const update = () => {
    const rect = getRect?.()
    if (!rect) return
    void computePosition({ getBoundingClientRect: () => rect }, el, {
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [offset(6), flip(menuBounds(editor)), shift(menuBounds(editor))],
    }).then(({ x, y }) => Object.assign(el.style, { left: `${x}px`, top: `${y}px` }))
  }
  // 光标矩形随内部容器滚动而变：用 autoUpdate 监听祖先滚动与尺寸（虚拟参照取当前光标矩形）
  const stop = autoUpdate(
    {
      getBoundingClientRect: () => getRect?.() ?? new DOMRect(),
      contextElement: editorDom(editor) ?? undefined,
    },
    el,
    update,
  )
  return {
    el,
    place(next: () => DOMRect | null | undefined) {
      getRect = next
      update()
    },
    destroy() {
      stop()
      el.remove()
    },
  }
}
