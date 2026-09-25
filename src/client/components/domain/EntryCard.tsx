/** 记录卡片（08 §2.8）：kind 徽章、标题、160 字摘要、作者、更新时间、固定图钉。 */
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

/** 记录类型色（04 §2.1 色板）：一眼分出决策 / 迭代 / Bug…；文字仍是类型名，不单靠颜色 */
export const ENTRY_KIND_TONE: Record<string, PaletteName> = {
  decision: 'indigo',
  iteration: 'teal',
  bug: 'ochre',
  changelog: 'amber',
  journal: 'pine',
  note: 'moss',
  review: 'plum',
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
      <div className="mt-auto flex items-center gap-2 text-fg-muted text-xs">
        <span className="truncate">{entry.author.displayName}</span>
        <span aria-hidden>·</span>
        <RelativeTime date={entry.updatedAt} />
      </div>
    </Link>
  )
}
