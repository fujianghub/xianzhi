/**
 * 右侧详情坞（ADR-0054 §B，滴答清单式三栏）：任务 / 记录详情在主区右侧常驻展开，列表不离开、不遮挡。
 * - fixed 贴在顶栏下方右缘（同 Aside），挂载时给 <html> 打 `data-detail-dock`，主区按 `--xz-dock-w` 让位（app.css）；
 * - 左缘可拖动改宽（320 ~ 60vw），宽度记在本机 `xz:dock-w`；双击把手恢复默认；方向键每次 32px；
 * - 同时只显示最后挂载的一个（例如空间页先开着记录、再开任务）：先开的被盖住、关掉后它回来。
 * 只在 ≥ lg 使用；更窄由调用方改用抽屉 / 整页。
 */
import { type ReactNode, type Ref, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import { cn } from '../../lib/cn.ts'

const KEY = 'xz:dock-w'
const MIN = 320

const useDockStack = create<{
  ids: string[]
  push: (id: string) => void
  pop: (id: string) => void
}>((set) => ({
  ids: [],
  push: (id) => set((s) => ({ ids: [...s.ids.filter((x) => x !== id), id] })),
  pop: (id) => set((s) => ({ ids: s.ids.filter((x) => x !== id) })),
}))

const maxW = () => Math.max(MIN, Math.round(window.innerWidth * 0.6))
function applyW(w: number | null) {
  const st = document.documentElement.style
  if (w === null) st.removeProperty('--xz-dock-w')
  else st.setProperty('--xz-dock-w', `${w}px`)
}
function readW(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v >= MIN ? v : null
  } catch {
    return null
  }
}
function saveW(w: number | null) {
  try {
    if (w === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(w))
  } catch {
    // 隐私模式等：只本次生效
  }
}

/** 当前有没有详情坞开着（AppShell 在 lg ~ 1280 间据此收起主侧栏，ADR-0054 §B） */
export const useDockOpen = () => useDockStack((s) => s.ids.length > 0)

export function DetailDock({
  children,
  label,
  testId,
  variant,
  className,
  ref,
}: {
  children: ReactNode
  label: string
  testId?: string
  /** 写到 data-variant（e2e / 样式区分） */
  variant?: string
  className?: string
  ref?: Ref<HTMLElement>
}) {
  const { t } = useTranslation()
  const id = useId()
  const top = useDockStack((s) => s.ids.at(-1) === id)
  const [dragging, setDragging] = useState(false)
  // 只用于 aria-valuenow（键盘调宽后读屏能报出当前宽度）
  const [width, setWidth] = useState(() => readW() ?? 416)
  useEffect(() => {
    const { push, pop } = useDockStack.getState()
    push(id)
    return () => pop(id)
  }, [id])
  useEffect(() => {
    if (!top) return
    const root = document.documentElement
    const saved = readW()
    if (saved) applyW(Math.min(saved, maxW()))
    root.setAttribute('data-detail-dock', '')
    return () => {
      // 下一个坞（若有）会在自己的 effect 里重新打上
      root.removeAttribute('data-detail-dock')
    }
  }, [top])
  if (!top) return null

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    setDragging(true)
    let last: number | null = null
    const move = (ev: PointerEvent) => {
      last = Math.min(maxW(), Math.max(MIN, Math.round(window.innerWidth - ev.clientX)))
      applyW(last)
      setWidth(last)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDragging(false)
      if (last !== null) saveW(last)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const cur = e.currentTarget.parentElement?.offsetWidth ?? MIN
    const next = Math.min(maxW(), Math.max(MIN, cur + (e.key === 'ArrowLeft' ? 32 : -32)))
    applyW(next)
    saveW(next)
    setWidth(next)
  }

  return createPortal(
    <aside
      ref={ref}
      className={cn('xz-detail-dock', className)}
      aria-label={label}
      data-testid={testId}
      data-variant={variant}
      data-dragging={dragging || undefined}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: 可拖动分隔条（role=separator + 方向键），不是 <hr> */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('dock.resize')}
        aria-valuemin={MIN}
        aria-valuemax={typeof window === 'undefined' ? MIN : maxW()}
        aria-valuenow={width}
        tabIndex={0}
        className="xz-dock-handle"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          applyW(null)
          saveW(null)
          setWidth(416)
        }}
        data-testid="dock-handle"
      />
      {children}
    </aside>,
    document.body,
  )
}
