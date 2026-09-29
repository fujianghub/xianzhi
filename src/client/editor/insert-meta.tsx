/**
 * 插入项的图标与分区（ADR-0025 §2，参考简斋 insertMenuRegistry）：斜杠菜单与「+」插入面板共用 SLASH_ITEMS，
 * 这里只补展示信息——图标、色块（9 色板 key，经 .xz-chip 取 token）、面板分区与顺序。
 */
import {
  Boxes,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronsDownUp,
  Clock,
  Code2,
  FileCode,
  GitBranch,
  GitCommitHorizontal,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Image,
  Info,
  LayoutTemplate,
  Lightbulb,
  Link,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  ListTree,
  type LucideIcon,
  Minus,
  OctagonAlert,
  Paperclip,
  Pilcrow,
  Quote,
  Radical,
  Sigma,
  SquareStack,
  Table,
  TableProperties,
  TriangleAlert,
  Waypoints,
  Workflow,
} from 'lucide-react'
import type { PaletteColor } from '../../shared/schemas/enums.ts'

/** 工具栏「链接」弹层（光标处无选区也能插入；与气泡条的 LINK_EVENT 分开，避免两个输入框）。 */
export const LINK_INSERT_EVENT = 'xz:editor-link-insert'

interface Meta {
  icon: LucideIcon
  tone: PaletteColor
}

export const INSERT_META: Record<string, Meta> = {
  h1: { icon: Heading1, tone: 'gray' },
  h2: { icon: Heading2, tone: 'gray' },
  h3: { icon: Heading3, tone: 'gray' },
  h4: { icon: Heading4, tone: 'gray' },
  paragraph: { icon: Pilcrow, tone: 'gray' },
  quote: { icon: Quote, tone: 'gray' },
  hr: { icon: Minus, tone: 'gray' },
  bullet: { icon: List, tone: 'blue' },
  ordered: { icon: ListOrdered, tone: 'blue' },
  todo: { icon: ListTodo, tone: 'green' },
  code: { icon: Code2, tone: 'purple' },
  mathInline: { icon: Radical, tone: 'purple' },
  math: { icon: Sigma, tone: 'purple' },
  mermaid: { icon: Workflow, tone: 'cyan' },
  mermaidFlow: { icon: GitBranch, tone: 'cyan' },
  mermaidSeq: { icon: Waypoints, tone: 'cyan' },
  mermaidClass: { icon: Boxes, tone: 'cyan' },
  mermaidState: { icon: GitCommitHorizontal, tone: 'cyan' },
  mermaidGantt: { icon: CalendarRange, tone: 'cyan' },
  table: { icon: Table, tone: 'green' },
  date: { icon: CalendarDays, tone: 'orange' },
  time: { icon: Clock, tone: 'orange' },
  datetime: { icon: CalendarClock, tone: 'orange' },
  details: { icon: ChevronsDownUp, tone: 'orange' },
  info: { icon: Info, tone: 'blue' },
  tip: { icon: Lightbulb, tone: 'green' },
  warn: { icon: TriangleAlert, tone: 'yellow' },
  danger: { icon: OctagonAlert, tone: 'red' },
  toc: { icon: ListTree, tone: 'orange' },
  link: { icon: Link, tone: 'blue' },
  image: { icon: Image, tone: 'pink' },
  file: { icon: Paperclip, tone: 'orange' },
  card: { icon: SquareStack, tone: 'purple' },
  query: { icon: TableProperties, tone: 'blue' },
  entryLink: { icon: Link2, tone: 'purple' },
  source: { icon: FileCode, tone: 'gray' },
  template: { icon: LayoutTemplate, tone: 'green' },
}

/** 「+」插入面板分区（简斋：基础 / 程序员 / 画板 / 布局 / 小工具）；basic 区两列大块。 */
export const INSERT_SECTIONS: { key: string; ids: string[]; grid?: boolean }[] = [
  { key: 'basic', ids: ['link', 'image', 'table', 'file', 'info', 'code'], grid: true },
  { key: 'text', ids: ['paragraph', 'h1', 'h2', 'h3', 'h4', 'quote', 'hr'] },
  { key: 'list', ids: ['bullet', 'ordered', 'todo'] },
  { key: 'layout', ids: ['details', 'tip', 'warn', 'danger', 'toc'] },
  { key: 'dev', ids: ['math', 'mathInline'] },
  {
    key: 'diagram',
    ids: ['mermaid', 'mermaidFlow', 'mermaidSeq', 'mermaidClass', 'mermaidState', 'mermaidGantt'],
  },
  { key: 'time', ids: ['date', 'time', 'datetime'] },
  { key: 'relate', ids: ['card', 'entryLink', 'query', 'template', 'source'] },
]

export function InsertIcon({ id, size = 'sm' }: { id: string; size?: 'sm' | 'md' }) {
  const m = INSERT_META[id]
  if (!m) return null
  const Icon = m.icon
  return (
    <span
      className={size === 'md' ? 'xz-insert-icon size-9' : 'xz-insert-icon size-6'}
      data-tone={m.tone}
      aria-hidden
    >
      <Icon className={size === 'md' ? 'size-5' : 'size-3.5'} />
    </span>
  )
}
