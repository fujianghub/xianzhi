/**
 * 拼图滑块（ADR-0006、REQ-AUTH-016）：服务端出题（/api/captcha），客户端只回传拼块 x（图片像素）。
 * - 图片随容器等比缩放；手柄行程按比例换算到图片坐标，窄屏同样可对准（不写死 320 宽）
 * - 拖拽（pointer capture，pointercancel 回位）与键盘（role=slider：←/→ 1px，Shift 10px，Enter 确认）
 * - 原地点一下不算解开；解开后锁定，换题用右上角按钮；题目 110 s 未用自动换
 * - 结果只在登录时由服务端判定；失败由父组件递增 resetKey 并传 failed 触发抖动 + 换题
 */
import { Check, ChevronsRight, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'

interface Challenge {
  id: string
  background: string
  piece: string
  y: number
  pieceSize: number
  width: number
  height: number
  /** 仅非生产环境由服务端回显（e2e 走真实拖拽用），production 不会出现 */
  debugX?: number
}

const HANDLE = 44
const EXPIRE_MS = 110_000

export function SliderCaptcha({
  onChange,
  resetKey = 0,
  failed = false,
}: {
  /** 解开时给出 `x-captcha` 头的值（`<id>:<x>`），换题 / 未解时为 null */
  onChange: (token: string | null) => void
  resetKey?: number
  failed?: boolean
}) {
  const { t } = useTranslation()
  const [c, setC] = useState<Challenge | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [pos, setPos] = useState(0) // 手柄左缘，track 像素
  const [solved, setSolved] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [shake, setShake] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackW, setTrackW] = useState(320)
  const drag = useRef<{ startX: number; startPos: number; moved: boolean } | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const travel = Math.max(1, trackW - HANDLE)
  const maxX = c ? c.width - c.pieceSize : 1
  const imageX = Math.round((pos / travel) * maxX)
  const scale = trackW / (c?.width ?? 320)

  const load = useCallback(async () => {
    setC(null) // 先清旧题，避免在已消费的题目上完成拼图
    setSolved(false)
    setPos(0)
    setLoadError(false)
    onChangeRef.current(null)
    try {
      const r = await fetch('/api/captcha', { credentials: 'same-origin', cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      setC((await r.json()) as Challenge)
    } catch {
      setC(null)
      setLoadError(true)
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey 递增即换题
  useEffect(() => {
    void load()
  }, [load, resetKey])

  // biome-ignore lint/correctness/useExhaustiveDependencies: 连续失败时 failed 保持 true，靠 resetKey 变化重新触发抖动
  useEffect(() => {
    if (!failed) return
    setShake(true)
    const id = setTimeout(() => setShake(false), 420)
    return () => clearTimeout(id)
  }, [failed, resetKey])

  // 题目过期前自动换
  useEffect(() => {
    if (!c) return
    const id = setTimeout(() => void load(), EXPIRE_MS)
    return () => clearTimeout(id)
  }, [c, load])

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => e && setTrackW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const commit = (p: number) => {
    if (!c || p < 2) {
      setPos(0)
      return
    }
    setSolved(true)
    onChangeRef.current(`${c.id}:${Math.round((p / travel) * maxX)}`)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (solved || !c) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startPos: pos, moved: false }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const next = Math.min(travel, Math.max(0, d.startPos + e.clientX - d.startX))
    if (Math.abs(next - d.startPos) > 1) d.moved = true
    setPos(next)
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (!d) return
    if (!d.moved) setPos(0)
    else commit(pos)
  }
  const onPointerCancel = () => {
    drag.current = null
    setDragging(false)
    setPos(0)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (solved || !c) return
    const step = (e.shiftKey ? 10 : 1) * (travel / maxX)
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setPos((p) => Math.min(travel, p + step))
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setPos((p) => Math.max(0, p - step))
    else if (e.key === 'Home') setPos(0)
    else if (e.key === 'End') setPos(travel)
    else if (e.key === 'Enter' || e.key === ' ') commit(pos)
    else return
    e.preventDefault()
  }

  return (
    <div
      className={cn('flex flex-col gap-2', shake && 'animate-[xz-shake_var(--xz-dur-slow)_ease]')}
      data-testid="captcha"
      data-solved={solved || undefined}
      data-debug-x={c?.debugX}
    >
      <div
        className="relative w-full overflow-hidden rounded-lg border border-border bg-surface-2"
        style={{ aspectRatio: '2 / 1' }}
      >
        {c ? (
          <>
            <img
              src={c.background}
              alt=""
              draggable={false}
              className="block size-full select-none"
            />
            <img
              src={c.piece}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-0 left-0 select-none drop-shadow-[0_2px_4px_color-mix(in_srgb,var(--xz-fg)_35%,transparent)]"
              style={{
                width: c.pieceSize * scale,
                height: c.pieceSize * scale,
                transform: `translate(${imageX * scale}px, ${c.y * scale}px)`,
              }}
              data-testid="captcha-piece"
            />
          </>
        ) : loadError ? (
          <button
            type="button"
            onClick={() => void load()}
            className="absolute inset-0 text-fg-muted text-sm hover:text-fg"
          >
            {t('auth.captcha.loadFailed')}
          </button>
        ) : (
          <div className="skeleton-shimmer absolute inset-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => void load()}
          aria-label={t('auth.captcha.refresh')}
          title={t('auth.captcha.refresh')}
          className="absolute top-1.5 right-1.5 inline-flex size-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--xz-fg)_55%,transparent)] text-bg hover:bg-fg"
          data-testid="captcha-refresh"
        >
          <RotateCw className="size-4" strokeWidth={2} />
        </button>
      </div>

      <div
        ref={trackRef}
        className={cn(
          'relative h-11 select-none overflow-hidden rounded-full border',
          solved ? 'border-success bg-success-soft' : 'border-border bg-surface',
        )}
      >
        <div
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            solved
              ? 'bg-[color-mix(in_srgb,var(--xz-success)_22%,transparent)]'
              : 'bg-[color-mix(in_srgb,var(--xz-primary)_22%,transparent)]',
            !dragging && 'transition-[width] duration-(--xz-dur-base) ease-(--xz-ease-out)',
          )}
          style={{ width: pos + HANDLE }}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center pl-10 text-fg-muted text-sm">
          {solved ? t('auth.captcha.solved') : t('auth.captcha.drag')}
        </span>
        <div
          role="slider"
          tabIndex={0}
          aria-label={t('auth.captcha.label')}
          aria-valuemin={0}
          aria-valuemax={maxX}
          aria-valuenow={imageX}
          aria-disabled={!c || solved}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={onKeyDown}
          className={cn(
            'absolute top-0 left-0 inline-flex size-11 touch-none items-center justify-center rounded-full text-primary-fg shadow-(--xz-shadow-card)',
            solved
              ? 'bg-success text-surface'
              : 'cursor-grab bg-(image:--xz-primary-gradient) active:cursor-grabbing',
            !dragging && 'transition-transform duration-(--xz-dur-base) ease-(--xz-ease-spring)',
          )}
          style={{ transform: `translateX(${pos}px)` }}
          data-testid="captcha-handle"
        >
          {solved ? (
            <Check className="size-5" strokeWidth={2.25} />
          ) : (
            <ChevronsRight className="size-5" strokeWidth={2} />
          )}
        </div>
      </div>
    </div>
  )
}
