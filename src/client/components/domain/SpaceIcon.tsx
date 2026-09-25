/**
 * 空间图标（REQ-SPACE-008）：emoji 原样显示；Lucide 名只认精选集合（避免把全部图标打进首屏），
 * 未收录的名字与空值按空间类型回退。色块取 04 §2.1 色板 token。
 */
import {
  BookOpen,
  Briefcase,
  Bug,
  Calendar,
  Camera,
  Code,
  Compass,
  Dumbbell,
  FlaskConical,
  Folder,
  Globe,
  GraduationCap,
  Heart,
  Layers,
  Leaf,
  Lightbulb,
  type LucideIcon,
  Music,
  Palette,
  PenLine,
  Rocket,
  Sprout,
  Star,
  Target,
  User,
} from 'lucide-react'
import { cn } from '../../lib/cn.ts'

export const SPACE_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  rocket: Rocket,
  briefcase: Briefcase,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  code: Code,
  'flask-conical': FlaskConical,
  bug: Bug,
  music: Music,
  'pen-line': PenLine,
  sprout: Sprout,
  leaf: Leaf,
  target: Target,
  lightbulb: Lightbulb,
  palette: Palette,
  layers: Layers,
  compass: Compass,
  globe: Globe,
  calendar: Calendar,
  camera: Camera,
  dumbbell: Dumbbell,
  heart: Heart,
  star: Star,
}
const KIND_ICON: Record<string, LucideIcon> = {
  project: Rocket,
  learning: GraduationCap,
  work: Briefcase,
}

export const PALETTE = ['moss', 'amber', 'indigo', 'ochre', 'teal', 'plum', 'gray', 'pine'] as const
export type PaletteName = (typeof PALETTE)[number]
/** Tailwind 需要静态类名（app.css 的 --color-<name>-bg/-fg）。 */
export const PALETTE_CLASS: Record<PaletteName, string> = {
  moss: 'bg-moss-bg text-moss-fg',
  amber: 'bg-amber-bg text-amber-fg',
  indigo: 'bg-indigo-bg text-indigo-fg',
  ochre: 'bg-ochre-bg text-ochre-fg',
  teal: 'bg-teal-bg text-teal-fg',
  plum: 'bg-plum-bg text-plum-fg',
  gray: 'bg-gray-bg text-gray-fg',
  pine: 'bg-pine-bg text-pine-fg',
}

/** 色板圆点：日历事件与空间标注共用。 */
export const PALETTE_DOT: Record<PaletteName, string> = {
  moss: 'bg-moss-fg',
  amber: 'bg-amber-fg',
  indigo: 'bg-indigo-fg',
  ochre: 'bg-ochre-fg',
  teal: 'bg-teal-fg',
  plum: 'bg-plum-fg',
  gray: 'bg-gray-fg',
  pine: 'bg-pine-fg',
}

const isLucideName = (v: string) => /^[a-z][a-z0-9-]*$/.test(v)

export function SpaceIcon({
  icon,
  kind,
  color,
  isPersonal,
  className,
}: {
  icon: string | null
  kind: string
  color: string | null
  isPersonal?: boolean
  className?: string
}) {
  const tone =
    color && color in PALETTE_CLASS
      ? PALETTE_CLASS[color as PaletteName]
      : 'bg-surface-2 text-fg-muted'
  const emoji = icon && !isLucideName(icon) ? icon : null
  const Icon = (icon && SPACE_ICONS[icon]) || (isPersonal ? User : (KIND_ICON[kind] ?? Folder))
  return (
    <span
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-sm',
        tone,
        className,
      )}
      aria-hidden
    >
      {emoji ?? <Icon className="size-3.5" strokeWidth={2} />}
    </span>
  )
}
