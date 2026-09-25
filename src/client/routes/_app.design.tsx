/**
 * /design 画廊（04 §8、06 §10、08 §2.16、REQ-UI-004 · 016）：仅 owner/admin，其他角色 404。
 * 页：tokens / materials / depth / switch / components。`theme=both` 时深浅并排；默认只渲染当前主题，保证同屏 blur ≤ 6（06 §8）。
 */
import { createFileRoute, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PALETTE_COLORS } from '../../shared/schemas/enums.ts'
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
import { Input } from '../components/ui/input.tsx'
import { KeyHint } from '../components/ui/key-hint.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.tsx'
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
import { isAdmin, type Me } from '../hooks/useMe.ts'
import { cn } from '../lib/cn.ts'
import { optOneOf } from '../lib/search.ts'
import { setTheme } from '../lib/theme.ts'

const PAGES = ['tokens', 'materials', 'depth', 'switch', 'components'] as const
type Page = (typeof PAGES)[number]
const search = (
  s: Record<string, unknown>,
): Partial<{
  page: Page
  theme: 'light' | 'dark' | 'both'
  motion: 'reduce' | 'standard' | 'rich'
  transparency: 'reduce'
}> => ({
  page: optOneOf(PAGES)(s.page),
  theme: optOneOf(['light', 'dark', 'both'] as const)(s.theme),
  motion: optOneOf(['reduce', 'standard', 'rich'] as const)(s.motion),
  transparency: optOneOf(['reduce'] as const)(s.transparency),
})

export const Route = createFileRoute('/_app/design')({
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
  if (theme === 'current') return <>{children}</>
  return (
    <div data-theme={theme} className="rounded-xl bg-bg p-4 text-fg" style={{ colorScheme: theme }}>
      {children}
    </div>
  )
}

function Design() {
  const { t } = useTranslation()
  const s = Route.useSearch()
  const nav = Route.useNavigate()
  const page: Page = s.page ?? 'tokens'
  const themes: ('light' | 'dark' | 'current')[] =
    s.theme === 'both' ? ['light', 'dark'] : s.theme ? [s.theme] : ['current']
  return (
    <div className="mx-auto max-w-6xl" data-testid="design" data-page={page}>
      <h1 className="mb-4 font-semibold text-2xl">{t('design.title')}</h1>
      <div className="mb-6 flex flex-wrap items-center gap-1" role="tablist">
        {PAGES.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === page}
            data-testid={`design-tab-${p}`}
            onClick={() => nav({ search: (prev) => ({ ...prev, page: p }) })}
            className={cn(
              'h-8 rounded-full px-3 text-sm hover:bg-hover',
              p === page ? 'bg-selected text-fg' : 'text-fg-muted',
            )}
          >
            {t(`design.tabs.${p}`)}
          </button>
        ))}
      </div>
      <div className={cn('grid gap-4', themes.length > 1 && 'lg:grid-cols-2')}>
        {themes.map((th) => (
          <Themed key={th} theme={th}>
            {page === 'tokens' ? (
              <TokensPage />
            ) : page === 'materials' ? (
              <MaterialsPage />
            ) : page === 'depth' ? (
              <DepthPage />
            ) : page === 'switch' ? (
              <SwitchPage />
            ) : (
              <ComponentsPage />
            )}
          </Themed>
        ))}
      </div>
    </div>
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

function TokensPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 font-medium">{t('design.color')}</h2>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {COLORS.map((c) => (
            <div key={c} className="paper overflow-hidden rounded-lg">
              <div className="h-12" style={{ background: `var(--xz-${c})` }} />
              <div className="px-2 py-1 font-mono text-[11px] text-fg-muted">--xz-{c}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {PALETTE.map((p) => (
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
            </span>
          ))}
        </div>
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
        <div className="flex items-end gap-2">
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
        <div className="flex gap-3">
          {(['fast', 'base', 'slow', 'stage', 'theme'] as const).map((d) => (
            <div key={d} className="paper group rounded-lg px-3 py-2 font-mono text-xs">
              <div
                className="mb-2 h-2 w-8 rounded-full bg-primary transition-[width] ease-(--xz-ease-out) group-hover:w-24"
                style={{ transitionDuration: `var(--xz-dur-${d})` }}
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
        className="relative grid grid-cols-2 gap-4 overflow-hidden rounded-xl p-6 md:grid-cols-4"
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

function SwitchPage() {
  const { t } = useTranslation()
  const root = typeof document === 'undefined' ? undefined : document.documentElement
  const [rm, setRm] = useState(root?.dataset.motion === 'reduce')
  const [rt, setRt] = useState(root?.dataset.transparency === 'reduce')
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
          id="design-cb-1"
          checked={rm}
          onCheckedChange={(v) => {
            setRm(!!v)
            if (v) document.documentElement.dataset.motion = 'reduce'
            else delete document.documentElement.dataset.motion
          }}
        />
        <label htmlFor="design-cb-1">{t('design.simulateReducedMotion')}</label>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id="design-cb-2"
          checked={rt}
          onCheckedChange={(v) => {
            setRt(!!v)
            if (v) document.documentElement.dataset.transparency = 'reduce'
            else delete document.documentElement.dataset.transparency
          }}
        />
        <label htmlFor="design-cb-2">{t('design.simulateReducedTransparency')}</label>
      </div>
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
    </div>
  )
}
