/**
 * 认证页外壳（ADR-0034、REQ-UI-041）：登录 / 注册 / 2FA / 邀请共用。
 * ≥ 900px：一张宽 `glass-thick` 卡，左栏「衔枝小院」插画 + 小燕气泡，右栏表单；
 * < 900px：只留表单卡，小燕从卡片顶沿探头（插画不挂载，移动端首屏不背它）。
 * 小燕自己从表单读信号——焦点（文本 / 密码 / 滑块）、密码框明暗与是否有值、按键——页面只需在
 * 提交失败 / 成功时 `fire('error' | 'success')`。密码框标 `data-secret`（切明文后仍能认出）。
 * 整张插画 aria-hidden，错误照旧由表单里的 `role=alert` 播报。
 */
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import { effectiveMotion, type MotionLevel } from '../../lib/motion.ts'
import { ThemeMenu } from '../layout/ThemeMenu.tsx'
import { useBirdEngine } from './bird-engine.ts'
import {
  type BirdBehavior,
  type BirdFocus,
  type BirdMood,
  captionKey,
  deriveMood,
  namePreview,
  visibleBehavior,
} from './bird-mood.ts'
import { SwallowPeek, SwallowScene } from './SwallowArt.tsx'
import '../../styles/auth.css'

/** 动作实验台：仅开发环境且带 `?birdlab` 时出现；生产构建里这段被裁掉。 */
const BirdLab = import.meta.env.DEV ? lazy(() => import('./BirdLab.tsx')) : null

export type BirdFlash = { kind: 'error' | 'success'; n: number } | null

/** 页面持有的出错 / 成功信号；n 自增保证连续失败也能重播。 */
export function useBirdFlash() {
  const [flash, set] = useState<BirdFlash>(null)
  const fire = useCallback(
    (kind: 'error' | 'success') => set((f) => ({ kind, n: (f?.n ?? 0) + 1 })),
    [],
  )
  return [flash, fire] as const
}

/** 成功后留给「衔枝回巢」的时间；减弱档不等。 */
export const birdPause = () =>
  new Promise<void>((r) => setTimeout(r, effectiveMotion() === 'reduce' ? 0 : 900))

/** 登录类页面给 body 加 `xz-login`：放大背景光晕（06 §5.6）。 */
export function useLoginBody() {
  useEffect(() => {
    document.body.classList.add('xz-login')
    return () => document.body.classList.remove('xz-login')
  }, [])
}

const WIDE = '(min-width: 900px)'

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

function useMotionLevel(): MotionLevel {
  const [level, setLevel] = useState(effectiveMotion)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setLevel(effectiveMotion())
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return level
}

const NAME_FIELDS = new Set(['username', 'nickname', 'email'])
const findSecret = (root: HTMLElement) =>
  root.querySelector<HTMLInputElement>('input[data-secret], input[type="password"]')

interface Signals {
  focus: BirdFocus
  secretVisible: boolean
  secretFilled: boolean
  name: string
}
const NONE: Signals = { focus: null, secretVisible: false, secretFilled: false, name: '' }
const same = (a: Signals, b: Signals) =>
  a.focus === b.focus &&
  a.secretVisible === b.secretVisible &&
  a.secretFilled === b.secretFilled &&
  a.name === b.name

export function AuthShell({
  greeting,
  flash,
  children,
}: {
  /** 待机时气泡里的招呼语（各页不同） */
  greeting: string
  flash?: BirdFlash
  children: ReactNode
}) {
  const { t } = useTranslation()
  useLoginBody()
  const wide = useMedia(WIDE)
  const motion = useMotionLevel()
  const pane = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [sig, setSig] = useState<Signals>(NONE)
  const [burst, setBurst] = useState<'error' | 'success' | null>(null)
  const [behavior, setBehavior] = useState<BirdBehavior | null>(null)

  // 出错 2.4 s 后自动平复；成功保持到跳转
  useEffect(() => {
    if (!flash) return
    setBurst(null)
    const r = requestAnimationFrame(() => setBurst(flash.kind))
    if (flash.kind === 'success') return () => cancelAnimationFrame(r)
    const id = setTimeout(() => setBurst(null), 2400)
    return () => {
      cancelAnimationFrame(r)
      clearTimeout(id)
    }
  }, [flash])

  const lab = BirdLab !== null && new URLSearchParams(window.location.search).has('birdlab')
  const [labMood, setLabMood] = useState<BirdMood | null>(null)
  const mood = labMood ?? deriveMood({ ...sig, flash: burst })

  const sync = useCallback(() => {
    const root = pane.current
    if (!root) return
    const el = document.activeElement
    let focus: BirdFocus = null
    let name = ''
    if (el && root.contains(el)) {
      if (el.matches('[role="slider"]')) focus = el.closest('[data-solved]') ? null : 'captcha'
      else if (el instanceof HTMLInputElement) {
        focus = el.type === 'password' ? 'secret' : 'text'
        if (focus === 'text' && NAME_FIELDS.has(el.autocomplete)) name = namePreview(el.value)
      }
    }
    const s = findSecret(root)
    const next: Signals = {
      focus,
      secretVisible: !!s && s.type === 'text',
      secretFilled: !!s && s.value.length > 0,
      name,
    }
    setSig((prev) => (same(prev, next) ? prev : next))
  }, [])

  const focusPoint = useCallback(() => {
    const root = pane.current
    const el = document.activeElement
    const target =
      el && root?.contains(el) && (el instanceof HTMLInputElement || el.matches('[role="slider"]'))
        ? el
        : root
          ? findSecret(root)
          : null
    if (!target) return null
    const r = target.getBoundingClientRect()
    if (target instanceof HTMLInputElement) {
      const len = target.type === 'password' ? target.value.length * 0.8 : target.value.length
      return { x: r.left + 44 + Math.min(len * 8.5, r.width - 60), y: r.top + r.height / 2 }
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, [])

  const engine = useBirdEngine({
    svg,
    mood,
    motion,
    focusPoint,
    onBehavior: setBehavior,
    variant: wide ? 'scene' : 'peek',
  })

  // 表单信号：焦点进出 / 输入 / 点击（显隐按钮、滑块松手后 React 才改 DOM，下一帧再读）
  useEffect(() => {
    const root = pane.current
    if (!root) return
    const soon = () => requestAnimationFrame(sync)
    const onInput = (e: Event) => {
      const type = (e as InputEvent).inputType ?? ''
      engine.current.pulse(type.startsWith('delete') ? -1 : 1)
      sync()
    }
    const pairs: [string, EventListener][] = [
      ['focusin', sync],
      ['focusout', soon],
      ['click', soon],
      ['pointerup', soon],
      ['keyup', soon],
      ['input', onInput],
    ]
    for (const [k, f] of pairs) root.addEventListener(k, f)
    const first = requestAnimationFrame(sync) // autoFocus 早于监听挂上（2FA 页）
    return () => {
      cancelAnimationFrame(first)
      for (const [k, f] of pairs) root.removeEventListener(k, f)
    }
  }, [sync, engine])

  const shown = visibleBehavior(mood, behavior)
  const key = captionKey(mood, behavior, !!sig.name)
  const caption = key === 'hello' ? greeting : t(`auth.bird.${key}`, { name: sig.name })

  return (
    <main className="xz-auth">
      <ThemeMenu className="fixed top-4 right-4 z-(--xz-z-sticky)" />
      <div
        className={cn(
          'glass-thick xz-auth-card xz-rise [--xz-edge:var(--xz-edge-login)]',
          wide ? 'is-wide' : 'is-narrow',
        )}
        data-mood={mood}
        data-behavior={shown ?? undefined}
        data-testid="auth-shell"
      >
        {wide ? (
          <aside className="xz-auth-art" aria-hidden>
            <div className="xz-auth-stage">
              <p className="xz-auth-bubble" key={`${key}-${mood}`} data-testid="bird-caption">
                {caption}
              </p>
              <SwallowScene ref={svg} onPoke={() => engine.current.poke()} />
            </div>
            <p className="xz-auth-foot font-display">{t('auth.bird.foot')}</p>
          </aside>
        ) : (
          <div className="xz-auth-peek" aria-hidden>
            <SwallowPeek ref={svg} onPoke={() => engine.current.poke()} />
          </div>
        )}
        <div ref={pane} className="xz-auth-pane">
          {children}
        </div>
      </div>
      {lab && BirdLab ? (
        <Suspense fallback={null}>
          <BirdLab mood={labMood} onMood={setLabMood} onPlay={(b) => engine.current.play(b)} />
        </Suspense>
      ) : null}
    </main>
  )
}
