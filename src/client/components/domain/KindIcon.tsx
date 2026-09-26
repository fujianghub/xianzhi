/**
 * 记录类型图标（ADR-0015、REQ-UI-037）：每种类型一个 Lucide 图标 + 04 §2.1 色板色（ENTRY_KIND_TONE）。
 * - `KindIcon`：带质感的色块（app.css .xz-chip：浅底 → 实色的斜向渐变 + 顶部高光 + 同色细描边），用于目录树 / 导航 / 面板标题；
 *   单独出现时必须给 `label`（读屏与 title），与文字并排时省略即为装饰。
 * - `KindBadge`：图标 + 类型名的胶囊，替代原先纯文字的类型徽章（颜色不单独承载含义，文字仍在）。
 * - 自定义类型（ADR-0016）：传 `typeId`，图标统一为 Shapes，名 / 色取该类型。
 */
import {
  Bug,
  ClipboardCheck,
  IterationCw,
  type LucideIcon,
  NotebookPen,
  Rocket,
  Scale,
  Shapes,
  Sparkles,
  StickyNote,
  Target,
} from 'lucide-react'
import { cn } from '../../lib/cn.ts'
import { ENTRY_KIND_TONE, useKindLabel } from '../../lib/entry-types.ts'

/** 记录类型色（04 §2.1 色板）：一眼分出决策 / 迭代 / Bug…；文字仍是类型名，不单靠颜色 */
export { ENTRY_KIND_TONE }

export const ENTRY_KIND_ICON: Record<string, LucideIcon> = {
  decision: Scale,
  iteration: IterationCw,
  bug: Bug,
  changelog: Rocket,
  journal: NotebookPen,
  note: StickyNote,
  review: ClipboardCheck,
  optimize: Sparkles,
  plan: Target,
  custom: Shapes,
}

/** 色块的色调类：app.css `.xz-tone-<色>` 把色板三件套映射到 --k-solid / --k-bg / --k-fg */
export const toneClass = (tone: string | null | undefined) => `xz-tone-${tone ?? 'gray'}`

const CHIP_SIZE = {
  xs: 'size-[18px] rounded-[5px] [&>svg]:size-3',
  sm: 'size-5 rounded-md [&>svg]:size-3',
  md: 'size-6 rounded-[7px] [&>svg]:size-3.5',
  lg: 'size-8 rounded-[9px] [&>svg]:size-[18px]',
} as const

/** 通用色块：任意 Lucide 图标 + 色板色（面板标题、导航快捷项复用）。 */
export function IconChip({
  icon: Icon,
  tone,
  size = 'md',
  label,
  className,
}: {
  icon: LucideIcon
  tone: string | null | undefined
  size?: keyof typeof CHIP_SIZE
  label?: string
  className?: string
}) {
  return (
    <>
      <span
        className={cn('xz-chip', toneClass(tone), CHIP_SIZE[size], className)}
        title={label}
        aria-hidden
      >
        <Icon strokeWidth={2} />
      </span>
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  )
}

export function KindIcon({
  kind,
  typeId,
  size = 'md',
  label,
  className,
}: {
  kind: string
  typeId?: string | null
  size?: keyof typeof CHIP_SIZE
  /** 单独出现（无相邻类型名）时传入，作为读屏文本与悬停提示 */
  label?: string
  className?: string
}) {
  const meta = useKindLabel()(kind, typeId)
  return (
    <IconChip
      icon={ENTRY_KIND_ICON[kind] ?? StickyNote}
      tone={meta.tone}
      size={size}
      label={label}
      className={className}
    />
  )
}

/** 类型胶囊：图标 + 类型名；`sm` 用于行内（列表 / 关联），`md` 用于卡片与详情页头。 */
export function KindBadge({
  kind,
  typeId,
  size = 'sm',
  className,
}: {
  kind: string
  typeId?: string | null
  size?: 'sm' | 'md'
  className?: string
}) {
  const meta = useKindLabel()(kind, typeId)
  const Icon = ENTRY_KIND_ICON[kind] ?? StickyNote
  return (
    <span
      className={cn(
        'xz-kind-badge',
        toneClass(meta.tone),
        size === 'sm'
          ? 'h-5 gap-1 px-1.5 text-[11px] [&>svg]:size-3'
          : 'h-6 gap-1 px-2 text-xs [&>svg]:size-3.5',
        className,
      )}
      data-kind={kind}
    >
      <Icon strokeWidth={2.25} aria-hidden />
      {meta.label}
    </span>
  )
}

/** 只要图标本身（放进已有胶囊里，如时间线的版本号徽章）。 */
export function KindGlyph({ kind }: { kind: string }) {
  const Icon = ENTRY_KIND_ICON[kind] ?? StickyNote
  return <Icon strokeWidth={2.25} aria-hidden />
}
