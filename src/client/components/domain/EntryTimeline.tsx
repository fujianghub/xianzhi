/**
 * 迭代 / 变更时间线（ADR-0014、REQ-ENTRY-015）：只选 迭代 或 变更 一种类型时可用；
 * 迭代按 periodStart、变更按 releasedAt 倒序，按月分组；没填日期的放最后「未填日期」。
 */
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import type { Entry, EntryKind } from '../../lib/entry-queries.ts'
import { ENTRY_KIND_TONE, KindGlyph, toneClass } from './KindIcon.tsx'

export const TIMELINE_KINDS = ['iteration', 'changelog'] as const satisfies readonly EntryKind[]
export const hasTimeline = (k: EntryKind | undefined) =>
  !!k && (TIMELINE_KINDS as readonly string[]).includes(k)

const dateOf = (e: Entry): string | null => {
  const v = e.kind === 'iteration' ? e.fields.periodStart : e.fields.releasedAt
  return typeof v === 'string' ? v : null
}

export function EntryTimeline({ items }: { items: Entry[] }) {
  const { t } = useTranslation()
  const dated = items
    .filter((e) => dateOf(e))
    .sort((a, b) => (dateOf(b) ?? '').localeCompare(dateOf(a) ?? ''))
  const undated = items.filter((e) => !dateOf(e))
  const months = new Map<string, Entry[]>()
  for (const e of dated) {
    const m = (dateOf(e) ?? '').slice(0, 7)
    months.set(m, [...(months.get(m) ?? []), e])
  }
  const groups: [string, Entry[]][] = [...months.entries()]
  if (undated.length) groups.push([t('entry.timeline.undated'), undated])
  if (!groups.length)
    return <p className="py-10 text-center text-fg-muted text-sm">{t('entry.timeline.empty')}</p>
  return (
    <ol className="relative flex flex-col gap-8 pl-6" data-testid="entry-timeline">
      <span aria-hidden className="absolute top-2 bottom-2 left-2 w-px bg-divider" />
      {groups.map(([label, list]) => (
        <li key={label}>
          <h3 className="mb-3 font-medium text-fg-muted text-sm tabular-nums">{label}</h3>
          <ol className="flex flex-col gap-3">
            {list.map((e) => (
              <li key={e.id} className="relative" data-testid="entry-timeline-item">
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-3 -left-[1.3rem] size-2.5 rounded-full ring-4 ring-bg',
                    e.fields.version ? 'bg-primary' : 'bg-fg-faint',
                  )}
                />
                <Link
                  to="/entries/$entryId"
                  params={{ entryId: e.id }}
                  className="paper xz-lift flex flex-col gap-1 rounded-lg border border-divider p-3"
                >
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={cn(
                        'xz-kind-badge h-6 gap-1 px-2 [&>svg]:size-3.5',
                        toneClass(ENTRY_KIND_TONE[e.kind]),
                      )}
                    >
                      <KindGlyph kind={e.kind} />
                      {typeof e.fields.version === 'string'
                        ? e.fields.version
                        : t(`entry.kind.${e.kind}`)}
                    </span>
                    <span className="text-fg-muted tabular-nums">
                      {e.kind === 'iteration'
                        ? `${String(e.fields.periodStart ?? '')} → ${String(e.fields.periodEnd ?? '')}`
                        : String(e.fields.releasedAt ?? '')}
                    </span>
                  </span>
                  <span className="font-medium">{e.title || t('entry.untitled')}</span>
                  {e.excerpt ? (
                    <span className="line-clamp-2 text-fg-muted text-sm">{e.excerpt}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  )
}
