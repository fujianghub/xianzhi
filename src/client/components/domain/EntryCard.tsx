/** 记录卡片（08 §2.8）：kind 徽章、标题、160 字摘要、作者、更新时间、固定图钉。 */
import { Link } from '@tanstack/react-router'
import { Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useHoverIntent } from '../../hooks/useHoverIntent.ts'
import type { Entry } from '../../lib/entry-queries.ts'
import { usePeek } from '../../lib/stores.ts'
import { RelativeTime } from '../ui/relative-time.tsx'

export function EntryCard({ entry, showSpace }: { entry: Entry; showSpace?: boolean }) {
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
      onKeyDown={(e) => {
        if (e.key === 'p') {
          e.preventDefault()
          openPeek({ kind: 'entry', id: entry.id })
        }
      }}
      className="paper group flex min-h-36 flex-col gap-2 rounded-lg border border-divider p-4 transition-shadow duration-(--xz-dur-base) hover:shadow-card"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-fg">
          {t(`entry.kind.${entry.kind}`)}
        </span>
        {showSpace ? <span className="text-fg-muted">{entry.spaceSlug}</span> : null}
        {entry.pinned ? (
          <Pin className="ml-auto size-3.5 text-primary" aria-label={t('entry.pinned')} />
        ) : null}
      </div>
      <h3 className="line-clamp-2 font-medium leading-snug">
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
