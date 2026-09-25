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
import { PALETTE_COLORS, type PaletteColor } from '../../../shared/schemas/enums.ts'
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

export const PALETTE = PALETTE_COLORS
export type PaletteName = PaletteColor
/** Tailwind 需要静态类名（app.css 的 --color-<name>-solid/-bg/-fg；ADR-0010）。 */
export const PALETTE_CLASS: Record<PaletteName, string> = {
  blue: 'bg-blue-bg text-blue-fg',
  orange: 'bg-orange-bg text-orange-fg',
  yellow: 'bg-yellow-bg text-yellow-fg',
  red: 'bg-red-bg text-red-fg',
  green: 'bg-green-bg text-green-fg',
  purple: 'bg-purple-bg text-purple-fg',
  pink: 'bg-pink-bg text-pink-fg',
  cyan: 'bg-cyan-bg text-cyan-fg',
  gray: 'bg-gray-bg text-gray-fg',
}

/** 色板圆点（鲜艳实色）：日历事件与空间标注共用。 */
export const PALETTE_DOT: Record<PaletteName, string> = {
  blue: 'bg-blue-solid',
  orange: 'bg-orange-solid',
  yellow: 'bg-yellow-solid',
  red: 'bg-red-solid',
  green: 'bg-green-solid',
  purple: 'bg-purple-solid',
  pink: 'bg-pink-solid',
  cyan: 'bg-cyan-solid',
  gray: 'bg-gray-solid',
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
