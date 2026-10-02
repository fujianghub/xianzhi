/**
 * 设计画廊 /settings/design（04 §8、06 §10、08 §2.16、ADR-0020、REQ-UI-004 · 016 · 039 · 040）：仅 owner/admin，其他角色 404。
 * 页：tokens / materials / depth / switch / components。`theme=both` 时深浅并排；默认只渲染当前主题，保证同屏 blur ≤ 6（06 §8）。
 * `motion` / `transparency` 只在画廊内临时写 html[data-*]，离开恢复本机偏好（不写 localStorage）。
 */
import { createFileRoute, notFound } from '@tanstack/react-router'
import { Check, Palette, X } from 'lucide-react'
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { contrastRatio, over, type RGBA } from '../../shared/contrast.ts'
import { PALETTE_COLORS } from '../../shared/schemas/enums.ts'
import { resolveAppearance } from '../../shared/schemas/preferences.ts'
import { ENTRY_KIND_ICON, IconChip, KindBadge, KindIcon } from '../components/domain/KindIcon.tsx'
import { Avatar } from '../components/ui/avatar.tsx'
import { Button } from '../components/ui/button.tsx'
import { Checkbox } from '../components/ui/checkbox.tsx'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/command.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog.tsx'
import { Disclosure } from '../components/ui/disclosure.tsx'
import { Input } from '../components/ui/input.tsx'
import { KeyHint } from '../components/ui/key-hint.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.tsx'
import { Seal } from '../components/ui/seal.tsx'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../components/ui/sheet.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.tsx'
import { Tooltip } from '../components/ui/tooltip.tsx'
import { TreeGuides, treeLevelClass } from '../components/ui/tree-guides.tsx'
import { isAdmin, type Me } from '../hooks/useMe.ts'
import { setAppearance, useAppearance } from '../lib/appearance.ts'
import { cn } from '../lib/cn.ts'
import { GLASS_LEVELS } from '../lib/glass.ts'
import { applyMotion, type MotionLevel, storedMotion } from '../lib/motion.ts'
import { optOneOf } from '../lib/search.ts'
import { setTheme } from '../lib/theme.ts'

const PAGES = ['tokens', 'materials', 'depth', 'switch', 'components'] as const
type Page = (typeof PAGES)[number]
type ThemeOpt = 'light' | 'dark' | 'both'
type Search = Partial<{
  page: Page
  theme: ThemeOpt
  motion: MotionLevel
  transparency: 'reduce'
}>
type SetSearch = (patch: Search) => void
const search = (s: Record<string, unknown>): Search => ({
  page: optOneOf(PAGES)(s.page),
  theme: optOneOf(['light', 'dark', 'both'] as const)(s.theme),
  motion: optOneOf(['reduce', 'standard', 'rich'] as const)(s.motion),
  transparency: optOneOf(['reduce'] as const)(s.transparency),
})

const BASELINE_CMD =
  'pnpm exec playwright test e2e/design.spec.ts e2e/feedback.spec.ts --project=setup --project=desktop --update-snapshots'

export const Route = createFileRoute('/_app/settings/design')({
  validateSearch: search,
  beforeLoad: ({ context }) => {
    const me = (context as { me?: Me }).me
    if (!isAdmin(me)) throw notFound()
  },
  component: Design,
})

function Themed({
  theme,
  children,
}: {
  theme: 'light' | 'dark' | 'current'
  children: React.ReactNode
}) {
  if (theme === 'current') return <div className="@container">{children}</div>
  return (
    <div
      data-theme={theme}
      className="@container rounded-xl bg-bg p-4 text-fg"
      style={{ colorScheme: theme }}
    >
      {children}
    </div>
  )
}

const pill = (on: boolean) =>
  cn('h-8 rounded-full px-3 text-sm hover:bg-hover', on ? 'bg-selected text-fg' : 'text-fg-muted')

/** 工具栏单选胶囊组（同材质页的 fieldset + aria-pressed）。 */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  testId: string
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          data-testid={`${testId}-${o.value}`}
          onClick={() => onChange(o.value)}
          className={pill(o.value === value)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  )
}

function Design() {
  const { t } = useTranslation()
  const s = Route.useSearch()
  const nav = Route.useNavigate()
  const page: Page = s.page ?? 'tokens'
  const set: SetSearch = (patch) =>
    nav({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const themes: ('light' | 'dark' | 'current')[] =
    s.theme === 'both' ? ['light', 'dark'] : s.theme ? [s.theme] : ['current']

  // 画廊内临时覆盖动效档位 / 透明度；卸载或参数清掉时恢复本机偏好
  useEffect(() => {
    if (!s.motion) return
    applyMotion(s.motion)
    return () => applyMotion(storedMotion())
  }, [s.motion])
  useEffect(() => {
    if (!s.transparency) return
    const root = document.documentElement
    root.dataset.transparency = s.transparency
    return () => {
      delete root.dataset.transparency
    }
  }, [s.transparency])

  const motion = s.motion ?? storedMotion()
  // 玻璃强度（ADR-0047）：写本机偏好，离开画廊仍生效，便于全站对比
  const glass = useAppearance((a) => resolveAppearance(a.workspace, a.user).glass)
  return (
    <div className="@container/gallery" data-testid="design" data-page={page}>
      <h1 className="font-semibold text-2xl tracking-tight">{t('design.title')}</h1>
      <p className="mt-1 max-w-3xl text-fg-muted text-sm">{t('design.intro')}</p>

      <div className="mt-5 flex flex-col gap-3 border-border border-b pb-4">
        <div className="flex flex-wrap items-center gap-1" role="tablist">
          {PAGES.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={p === page}
              data-testid={`design-tab-${p}`}
              onClick={() => set({ page: p })}
              className={pill(p === page)}
            >
              {t(`design.tabs.${p}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="flex items-center gap-2">
            <span className="text-fg-muted text-xs">{t('design.toolbar.theme')}</span>
            <Segmented
              label={t('design.toolbar.theme')}
              value={s.theme ?? 'current'}
              options={(['current', 'light', 'dark', 'both'] as const).map((v) => ({
                value: v,
                label: t(`design.toolbar.themeOpt.${v}`),
              }))}
              onChange={(v) => set({ theme: v === 'current' ? undefined : v })}
              testId="design-theme"
            />
          </span>
          <span className="flex items-center gap-2">
            <span className="text-fg-muted text-xs">{t('design.toolbar.motion')}</span>
            <Segmented
              label={t('design.toolbar.motion')}
              value={motion}
              options={(['reduce', 'standard', 'rich'] as const).map((v) => ({
                value: v,
                label: t(`settings.profile.motionLevel.${v}`),
              }))}
              onChange={(v) => set({ motion: v === storedMotion() ? undefined : v })}
              testId="design-motion"
            />
          </span>
          <span className="flex items-center gap-2" title={t('design.toolbar.glassHint')}>
            <span className="text-fg-muted text-xs">{t('design.toolbar.glass')}</span>
            <Segmented
              label={t('design.toolbar.glass')}
              value={glass}
              options={GLASS_LEVELS.map((v) => ({
                value: v,
                label: t(`design.toolbar.glassOpt.${v}`),
              }))}
              onChange={(v) => {
                setAppearance({ glass: v })
              }}
              testId="design-glass"
            />
          </span>
          <TransparencyToggle
            id="design-transparency"
            value={!!s.transparency}
            onChange={(v) => set({ transparency: v ? 'reduce' : undefined })}
          />
        </div>
      </div>

      <p className="mt-4 mb-4 text-fg-muted text-sm" data-testid="design-hint">
        {t(`design.hint.${page}`)}
      </p>
      <div className={cn('grid gap-4', themes.length > 1 && '@3xl/gallery:grid-cols-2')}>
        {themes.map((th) => (
          <Themed key={th} theme={th}>
            {page === 'tokens' ? (
              <TokensPage />
            ) : page === 'materials' ? (
              <MaterialsPage />
            ) : page === 'depth' ? (
              <DepthPage />
            ) : page === 'switch' ? (
              <SwitchPage
                reduceMotion={s.motion === 'reduce'}
                reduceTransparency={!!s.transparency}
                set={set}
              />
            ) : (
              <ComponentsPage />
            )}
          </Themed>
        ))}
      </div>

      <footer className="mt-10 border-border border-t pt-4 text-fg-muted text-xs">
        <p className="mb-1.5">{t('design.baseline')}</p>
        <code className="block select-all break-all rounded-md bg-surface-solid-2 px-3 py-2 font-mono text-[11px] text-fg">
          {BASELINE_CMD}
        </code>
      </footer>
    </div>
  )
}

function TransparencyToggle({
  id,
  value,
  onChange,
}: {
  id: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <span className="flex items-center gap-2 text-sm">
      <Checkbox id={id} checked={value} onCheckedChange={(v) => onChange(!!v)} />
      <label htmlFor={id}>{t('design.simulateReducedTransparency')}</label>
    </span>
  )
}

const COLORS = [
  'bg',
  'surface-solid',
  'surface-solid-2',
  'fg',
  'fg-muted',
  'fg-faint',
  'primary',
  'primary-soft',
  'accent',
  'accent-soft',
  'success',
  'warning',
  'danger',
  'info',
  'border',
] as const
const PALETTE = PALETTE_COLORS

/** 对比度表（06 §7 门槛）：[前景, 背景, 门槛, 分组] */
const PAIRS = [
  ...(['bg', 'surface-solid'] as const).flatMap(
    (b) =>
      [
        ['fg', b, 7],
        ['fg-muted', b, 4.5],
        ['fg-faint', b, 3],
        ['primary-text', b, 4.5],
      ] as const,
  ),
  ['primary-fg', 'primary', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['danger-fg', 'danger', 4.5],
] as const

/** 把任意 CSS 颜色（含 var 解析后的 hex / rgba / color-mix）经 1×1 canvas 归一为 RGBA。 */
function makeResolver(): (css: string) => RGBA | null {
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 1
  const ctx = c.getContext('2d', { willReadFrequently: true })
  return (css) => {
    if (!ctx || !css) return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 255) / 255]
  }
}

/** 读 el 处（随其所在主题容器）的 token 并计算 fg/bg 对比度；html data-theme 变化时重算。 */
function useContrast(pairs: readonly (readonly [string, string])[]) {
  const ref = useRef<HTMLDivElement>(null)
  const [ratios, setRatios] = useState<(number | null)[]>([])
  const key = pairs.map((p) => p.join('/')).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: pairs 以 key 判等
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const resolve = makeResolver()
    const compute = () => {
      const cs = getComputedStyle(el)
      const get = (k: string) => resolve(cs.getPropertyValue(`--xz-${k}`).trim())
      setRatios(
        pairs.map(([f, b]) => {
          const fg = get(f)
          const bg = get(b)
          if (!fg || !bg) return null
          const back = over(bg, [255, 255, 255, 1])
          return contrastRatio(over(fg, back), back)
        }),
      )
    }
    compute()
    const mo = new MutationObserver(compute)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [key])
  return { ref, ratios }
}

function TokensPage() {
  const { t } = useTranslation()
  const palette = useContrast(PALETTE.map((p) => [`palette-${p}-fg`, `palette-${p}-bg`] as const))
  const table = useContrast(PAIRS.map(([f, b]) => [f, b] as const))
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 font-medium">{t('design.color')}</h2>
        <div className="grid grid-cols-3 gap-3 @lg:grid-cols-5">
          {COLORS.map((c) => (
            <div key={c} className="paper overflow-hidden rounded-lg">
              <div className="h-12" style={{ background: `var(--xz-${c})` }} />
              <div className="px-2 py-1 font-mono text-[11px] text-fg-muted">--xz-{c}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2" ref={palette.ref}>
          {PALETTE.map((p, i) => (
            <span
              key={p}
              className="rounded-full border px-3 py-1 text-xs"
              style={{
                background: `var(--xz-palette-${p}-bg)`,
                color: `var(--xz-palette-${p}-fg)`,
                borderColor: `var(--xz-palette-${p}-solid)`,
              }}
            >
              {p}
              {palette.ratios[i] ? (
                <span className="ms-1.5 font-mono opacity-80">{palette.ratios[i]?.toFixed(1)}</span>
              ) : null}
            </span>
          ))}
        </div>
      </section>
      <section ref={table.ref}>
        <h2 className="mb-1 font-medium">{t('design.contrast')}</h2>
        <p className="mb-3 text-fg-muted text-xs">{t('design.contrastHint')}</p>
        <table className="w-full max-w-xl text-sm" data-testid="design-contrast">
          <tbody>
            {PAIRS.map(([f, b, min], i) => {
              const r = table.ratios[i]
              const ok = r != null && r >= min
              return (
                <tr
                  key={`${f}/${b}`}
                  className="border-border border-b last:border-0"
                  data-pair={`${f}/${b}`}
                  data-ok={r == null ? undefined : ok}
                >
                  <td className="py-1.5 pe-3">
                    <span
                      className="inline-grid h-7 w-10 place-items-center rounded-md border border-border font-medium"
                      style={{ color: `var(--xz-${f})`, background: `var(--xz-${b})` }}
                      aria-hidden
                    >
                      Aa
                    </span>
                  </td>
                  <td className="py-1.5 pe-3 font-mono text-xs">
                    {f}
                    <span className="text-fg-muted">
                      {' / '}
                      {b === 'bg'
                        ? t('design.onBg')
                        : b === 'surface-solid'
                          ? t('design.onPaper')
                          : b}
                    </span>
                  </td>
                  <td className="py-1.5 pe-3 text-end font-mono text-xs tabular-nums">
                    {r == null ? '—' : r.toFixed(2)}
                  </td>
                  <td className="py-1.5 pe-3 font-mono text-fg-muted text-xs">≥ {min}</td>
                  <td className="py-1.5 text-xs">
                    {r == null ? null : (
                      <span className="inline-flex items-center gap-1">
                        {ok ? (
                          <Check className="size-3.5 text-success" aria-hidden />
                        ) : (
                          <X className="size-3.5 text-danger" aria-hidden />
                        )}
                        {ok ? t('design.pass') : t('design.fail')}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="mb-3 font-medium">{t('design.typography')}</h2>
        {(
          ['text-3xl', 'text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-xs'] as const
        ).map((sz) => (
          <p key={sz} className={cn(sz, 'leading-snug')}>
            <span className="mr-3 font-mono text-fg-muted text-xs">{sz}</span>
            {t('design.sample')}
          </p>
        ))}
        <p className="mt-2 font-serif text-lg">{t('design.denseText')}</p>
        <p className="font-mono text-sm">const nest = await weave(twigs)</p>
      </section>
      <section>
        <h2 className="mb-3 font-medium">{t('design.spacing')}</h2>
        <div className="flex flex-wrap items-end gap-2">
          {[4, 8, 12, 16, 20, 24, 32, 40, 48, 64].map((n) => (
            <div
              key={n}
              className="bg-primary-soft"
              style={{ width: n, height: n }}
              title={`${n}px`}
            />
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-medium">{t('design.motion')}</h2>
        <div className="flex flex-wrap gap-3">
          {(['fast', 'base', 'slow', 'stage', 'theme'] as const).map((d) => (
            <div key={d} className="paper group rounded-lg px-3 py-2 font-mono text-xs">
              <div
                className="mb-2 h-2 w-8 rounded-full bg-primary transition-[width] ease-(--xz-ease-out) group-hover:w-24"
                style={{ transitionDuration: `var(--xz-dur-${d})` } as CSSProperties}
              />
              dur-{d}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function MaterialsPage() {
  const { t } = useTranslation()
  const [bg, setBg] = useState<'backdrop' | 'image' | 'text'>('backdrop')
  const levels = [
    { cls: 'glass-thin', token: 'glass-thin', blur: 'blur-thin' },
    { cls: 'glass', token: 'glass', blur: 'blur-regular' },
    { cls: 'glass-thick', token: 'glass-thick', blur: 'blur-thick' },
    { cls: 'glass-opaque', token: 'glass-opaque', blur: null },
  ] as const
  return (
    <div>
      <fieldset className="mb-4 inline-flex items-center gap-1 border-0 p-0">
        <legend className="sr-only">{t('design.tabs.materials')}</legend>
        {(['backdrop', 'image', 'text'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={bg === k}
            onClick={() => setBg(k)}
            className={cn(
              'h-8 rounded-full px-3 text-sm hover:bg-hover',
              bg === k ? 'bg-selected text-fg' : 'text-fg-muted',
            )}
          >
            {t(
              k === 'backdrop'
                ? 'design.surfaceBackdrop'
                : k === 'image'
                  ? 'design.surfaceImage'
                  : 'design.surfaceText',
            )}
          </button>
        ))}
      </fieldset>
      <div
        className="relative grid grid-cols-2 gap-4 overflow-hidden rounded-xl p-6 @2xl:grid-cols-4"
        style={
          bg === 'image'
            ? {
                backgroundImage:
                  'conic-gradient(from 90deg at 30% 40%, var(--xz-primary), var(--xz-accent), var(--xz-info), var(--xz-primary))',
              }
            : undefined
        }
      >
        {bg === 'text' ? (
          <p
            className="pointer-events-none absolute inset-0 p-4 text-fg-muted text-sm leading-6"
            aria-hidden
          >
            {Array.from({ length: 30 }, () => t('design.denseText')).join(' ')}
          </p>
        ) : null}
        {levels.map((l) => (
          <div
            key={l.cls}
            className={cn(l.cls, 'relative flex h-32 flex-col justify-end rounded-lg p-3')}
            data-material={l.cls}
          >
            <div className="font-medium text-sm">{l.token}</div>
            <div className="font-mono text-[11px] text-fg-muted">
              {l.blur ? `blur var(--xz-${l.blur})` : 'no blur'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DepthPage() {
  const { t } = useTranslation()
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 @md:grid-cols-3">
        {(['soft', 'card', 'float'] as const).map((s) => (
          <div
            key={s}
            className="paper flex h-28 items-end rounded-lg p-3 font-mono text-xs"
            style={{ boxShadow: `inset 0 1px 0 var(--xz-edge), var(--xz-shadow-${s})` }}
          >
            --xz-shadow-{s}
          </div>
        ))}
      </div>
      <div className="relative h-48 rounded-xl border border-border border-dashed">
        <button
          type="button"
          data-testid="drag-card"
          className={cn(
            'paper absolute top-8 left-8 flex h-24 w-48 cursor-grab touch-none select-none items-center justify-center rounded-lg text-sm shadow-soft transition-[box-shadow,transform] duration-(--xz-dur-base) ease-(--xz-ease-out) hover:shadow-card',
            drag && 'cursor-grabbing shadow-float',
          )}
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) ${drag ? 'scale(1.02) rotate(1.5deg)' : ''}`,
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setDrag({ x: e.clientX - pos.x, y: e.clientY - pos.y })
          }}
          onPointerMove={(e) => drag && setPos({ x: e.clientX - drag.x, y: e.clientY - drag.y })}
          onPointerUp={() => setDrag(null)}
        >
          {drag ? t('design.states.drag') : t('design.dragMe')}
        </button>
      </div>
    </div>
  )
}

function SwitchPage({
  reduceMotion,
  reduceTransparency,
  set,
}: {
  reduceMotion: boolean
  reduceTransparency: boolean
  set: SetSearch
}) {
  const { t } = useTranslation()
  // theme=both 时本页渲染两份，id 须唯一
  const id = useId()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          data-testid="vt-circle"
          onClick={(e) => {
            const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
            void setTheme(cur, { x: e.clientX, y: e.clientY })
          }}
        >
          {t('design.circleReveal')}
        </Button>
        <Button
          data-testid="vt-dissolve"
          onClick={() => {
            const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
            void setTheme(cur)
          }}
        >
          {t('design.dissolve')}
        </Button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id={`${id}-motion`}
          checked={reduceMotion}
          onCheckedChange={(v) =>
            set({ motion: v ? 'reduce' : storedMotion() === 'reduce' ? 'standard' : undefined })
          }
        />
        <label htmlFor={`${id}-motion`}>{t('design.simulateReducedMotion')}</label>
      </div>
      <TransparencyToggle
        id={`${id}-transparency`}
        value={reduceTransparency}
        onChange={(v) => set({ transparency: v ? 'reduce' : undefined })}
      />
      <div className="glass-thick rounded-xl p-6 text-sm">{t('design.dialogBody')}</div>
    </div>
  )
}

function ComponentsPage() {
  const { t } = useTranslation()
  const [cmd, setCmd] = useState(false)
  const variants = ['primary', 'secondary', 'ghost', 'destructive'] as const
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 font-medium">Button · {t('design.variants')}</h2>
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
          {variants.map((v) => (
            <div key={v} className="flex flex-col items-start gap-2">
              <span className="font-mono text-fg-muted text-xs">{v}</span>
              <Button variant={v} size="sm">
                {t('design.sample')}
              </Button>
              <Button variant={v}>{t('design.sample')}</Button>
              <Button variant={v} disabled>
                {t('design.sample')}
              </Button>
              <Button variant={v} loading>
                {t('design.sample')}
              </Button>
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-wrap items-center gap-3">
        <Input placeholder={t('design.inputPlaceholder')} className="max-w-60" />
        <Input placeholder={t('design.inputPlaceholder')} className="max-w-60" invalid />
        <div className="flex items-center gap-2 text-sm">
          <Checkbox id="design-cb-3" defaultChecked />
          <label htmlFor="design-cb-3">{t('design.checkbox')}</label>
        </div>
        <Avatar id="u-1" name="Moss" />
        <Avatar id="u-7" name="Amber" />
        <KeyHint keys={['⌘', 'K']} />
        <Skeleton className="h-6 w-32" />
      </section>
      <section className="flex flex-wrap items-center gap-3">
        <Tooltip content={t('design.tooltip')}>
          <Button variant="ghost">{t('design.tooltip')}</Button>
        </Tooltip>
        <Popover>
          <PopoverTrigger asChild>
            <Button data-testid="open-popover">Popover</Button>
          </PopoverTrigger>
          <PopoverContent data-testid="popover-content">{t('design.popover')}</PopoverContent>
        </Popover>
        <Dialog>
          <DialogTrigger asChild>
            <Button data-testid="open-dialog">Dialog</Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-content">
            <DialogTitle>{t('design.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('design.dialogBody')}</DialogDescription>
          </DialogContent>
        </Dialog>
        <Sheet>
          <SheetTrigger asChild>
            <Button>Sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetTitle>{t('design.sheetTitle')}</SheetTitle>
            <SheetDescription>{t('design.dialogBody')}</SheetDescription>
          </SheetContent>
        </Sheet>
        <Button onClick={() => setCmd(true)}>⌘K</Button>
        <Button onClick={() => toast.success(t('design.toastDone'))} data-testid="toast-ok">
          Toast
        </Button>
        <Button
          variant="destructive"
          onClick={() => toast.error(t('design.toastError'))}
          data-testid="toast-error"
        >
          Toast error
        </Button>
        <CommandDialog open={cmd} onOpenChange={setCmd} title={t('design.commandPlaceholder')}>
          <CommandInput placeholder={t('design.commandPlaceholder')} />
          <CommandList>
            <CommandEmpty>{t('design.commandEmpty')}</CommandEmpty>
            <CommandGroup heading={t('ui.page.today')}>
              <CommandItem>{t('ui.page.today')}</CommandItem>
              <CommandItem>{t('ui.page.design')}</CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </section>
      <section>
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">{t('design.tab1')}</TabsTrigger>
            <TabsTrigger value="b">{t('design.tab2')}</TabsTrigger>
          </TabsList>
          <TabsContent value="a" className="mt-3 text-fg-muted text-sm">
            {t('design.tab1')}
          </TabsContent>
          <TabsContent value="b" className="mt-3 text-fg-muted text-sm">
            {t('design.tab2')}
          </TabsContent>
        </Tabs>
      </section>
      <DomainSection />
    </div>
  )
}

const BUILTIN_KINDS = Object.keys(ENTRY_KIND_ICON).filter((k) => k !== 'custom')
const CHIP_SIZES = ['xs', 'sm', 'md', 'lg'] as const
/** 静态目录树样例（不请求数据）：[节点 key, 深度, 类型, 是否有子页, 是否当前] */
const TREE = [
  ['a', 0, 'plan', true, false],
  ['b', 1, 'iteration', true, false],
  ['c', 2, 'bug', false, true],
  ['d', 2, 'changelog', false, false],
  ['e', 0, 'journal', false, false],
] as const
const TREE_INDENT = 12

function DomainSection() {
  const { t } = useTranslation()
  const h3 = 'mb-2 font-mono text-fg-muted text-xs'
  return (
    <section className="flex flex-col gap-6" data-testid="design-domain">
      <h2 className="font-medium">{t('design.domain')}</h2>
      <div>
        <h3 className={h3}>{t('design.kindChips')}</h3>
        <div className="flex flex-col gap-2">
          {CHIP_SIZES.map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-2">
              {BUILTIN_KINDS.map((k) => (
                <KindIcon key={k} kind={k} size={size} label={k} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className={h3}>{t('design.kindBadges')}</h3>
        <div className="flex flex-col gap-2">
          {(['sm', 'md'] as const).map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-2">
              {BUILTIN_KINDS.map((k) => (
                <KindBadge key={k} kind={k} size={size} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className={h3}>{t('design.paletteChips')}</h3>
        <div className="flex flex-wrap items-center gap-3">
          {PALETTE.map((p) => (
            <span key={p} className="flex items-center gap-1.5 font-mono text-fg-muted text-xs">
              <IconChip icon={Palette} tone={p} size="md" />
              {p}
            </span>
          ))}
        </div>
      </div>
      <div>
        <h3 className={h3}>{t('design.seal')}</h3>
        <div className="flex items-end gap-4">
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <Seal key={size} size={size} />
          ))}
        </div>
      </div>
      <div>
        <h3 className={h3}>{t('design.tree')}</h3>
        <ul className="paper flex max-w-xs flex-col rounded-lg p-2">
          {TREE.map(([key, depth, kind, hasChildren, active]) => (
            <li
              key={key}
              className="relative flex py-px"
              style={{ paddingInlineStart: `${depth * TREE_INDENT}px` }}
            >
              <TreeGuides depth={depth} x0={12} indent={TREE_INDENT} active={active} />
              <div className="flex min-w-0 flex-1 items-center">
                <span className="grid size-6 shrink-0 place-items-center" aria-hidden>
                  {hasChildren ? <Disclosure open /> : null}
                </span>
                <span
                  className={cn(
                    'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm',
                    active ? 'bg-selected font-medium text-fg' : 'text-fg-muted',
                  )}
                >
                  <KindIcon kind={kind} size="xs" />
                  <span className={cn('truncate', treeLevelClass(depth))}>
                    {t(`design.treeNodes.${key}`)}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
