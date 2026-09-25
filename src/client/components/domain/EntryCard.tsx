/** 记录卡片（08 §2.8）：kind 徽章、标题、160 字摘要、关键字段与标签（ADR-0012）、作者、更新时间、固定图钉。 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useHoverIntent } from '../../hooks/useHoverIntent.ts'
import { markSharedSource } from '../../hooks/useSharedElement.ts'
import { cn } from '../../lib/cn.ts'
import type { Entry } from '../../lib/entry-queries.ts'
import { usePeek } from '../../lib/stores.ts'
import { RelativeTime } from '../ui/relative-time.tsx'
import { PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'
import { SpaceTag } from './SpaceTag.tsx'
import { tagsQuery } from './TagPicker.tsx'

/** 记录类型色（04 §2.1 色板）：一眼分出决策 / 迭代 / Bug…；文字仍是类型名，不单靠颜色 */
export const ENTRY_KIND_TONE: Record<string, PaletteName> = {
  decision: 'blue',
  iteration: 'cyan',
  bug: 'red',
  changelog: 'orange',
  journal: 'green',
  note: 'yellow',
  review: 'purple',
  optimize: 'pink',
  plan: 'gray',
}
export const entryKindClass = (kind: string) => PALETTE_CLASS[ENTRY_KIND_TONE[kind] ?? 'gray']

export function EntryCard({
  entry,
  showSpace,
  index = 0,
}: {
  entry: Entry
  showSpace?: boolean
  /** 网格中的序号，用于入场错峰（app.css .xz-rise） */
  index?: number
}) {
  const { t } = useTranslation()
  const openPeek = usePeek((s) => s.open)
  const hover = useHoverIntent(() => openPeek({ kind: 'entry', id: entry.id }))
  return (
    <Link
      to="/entries/$entryId"
      params={{ entryId: entry.id }}
      data-testid="entry-card"
      data-entry-id={entry.id}
      data-pinned={entry.pinned ? 'true' : undefined}
      {...hover}
      onClick={(e) => markSharedSource(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'p') {
          e.preventDefault()
          openPeek({ kind: 'entry', id: entry.id })
        }
      }}
      style={{ '--i': index } as React.CSSProperties}
      className="paper xz-lift xz-rise group flex min-h-36 flex-col gap-2 rounded-lg border border-divider p-4"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className={cn('rounded-full px-2 py-0.5 font-medium', entryKindClass(entry.kind))}>
          {t(`entry.kind.${entry.kind}`)}
        </span>
        {showSpace ? <SpaceTag slug={entry.spaceSlug} /> : null}
        {entry.pinned ? (
          <Pin className="ml-auto size-3.5 text-primary-text" aria-label={t('entry.pinned')} />
        ) : null}
      </div>
      <h3 className="line-clamp-2 font-medium leading-snug transition-colors duration-(--xz-dur-fast) group-hover:text-primary-text">
        {entry.title || t('entry.untitled')}
      </h3>
      {entry.excerpt ? <p className="line-clamp-3 text-fg-muted text-sm">{entry.excerpt}</p> : null}
      <EntryMeta entry={entry} />
      <div className="mt-auto flex items-center gap-2 text-fg-muted text-xs">
        <span className="truncate">{entry.author.displayName}</span>
        <span aria-hidden>·</span>
        <RelativeTime date={entry.updatedAt} />
      </div>
    </Link>
  )
}

/** 卡片 / 表格共用：按优先级挑出最多 3 个关键字段（ADR-0012）。 */
const KEY_FIELDS = ['severity', 'status', 'version', 'progress', 'releasedAt', 'endDate'] as const
export function keyFields(entry: Entry): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = []
  for (const name of KEY_FIELDS) {
    const v = entry.fields[name]
    if (typeof v === 'string' || typeof v === 'number') out.push({ name, value: String(v) })
    if (out.length >= 3) break
  }
  return out
}

function EntryMeta({ entry }: { entry: Entry }) {
  const { t } = useTranslation()
  const { data: tags = [] } = useQuery(tagsQuery)
  const f = keyFields(entry)
  const tg = (entry.tagIds ?? [])
    .map((id) => tags.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => !!x)
  if (!f.length && !tg.length) return null
  return (
    <div className="flex flex-wrap gap-1 text-[11px]" data-testid="entry-card-meta">
      {f.map((x) => (
        <span
          key={x.name}
          className="rounded bg-surface-2 px-1.5 py-0.5 text-fg-muted"
          data-field={x.name}
        >
          {x.name === 'progress'
            ? `${x.value}%`
            : t(`entry.fieldValue.${x.value}`, { defaultValue: x.value })}
        </span>
      ))}
      {tg.map((x) => (
        <span
          key={x.id}
          className={cn('rounded px-1.5 py-0.5', PALETTE_CLASS[(x.color as PaletteName) ?? 'gray'])}
        >
          #{x.name}
        </span>
      ))}
    </div>
  )
}
