/**
 * 记录卡片（08 §2.8）：kind 徽章、标题、160 字摘要、关键字段与标签（ADR-0012）、作者、更新时间、固定图钉；
 * ADR-0014：目录路径、收藏星标、悬停 ⋯ 菜单（链接之外，避免交互元素嵌套）、多选模式整卡切换选中。
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, Pin, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useHoverIntent } from '../../hooks/useHoverIntent.ts'
import { markSharedSource } from '../../hooks/useSharedElement.ts'
import { cn } from '../../lib/cn.ts'
import type { Entry } from '../../lib/entry-queries.ts'
import { usePeek } from '../../lib/stores.ts'
import { RelativeTime } from '../ui/relative-time.tsx'
import { EntryMenu } from './EntryMenu.tsx'
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
  canWrite = false,
  select,
}: {
  entry: Entry
  showSpace?: boolean
  /** 网格中的序号，用于入场错峰（app.css .xz-rise） */
  index?: number
  canWrite?: boolean
  /** 多选模式（ADR-0014 批量） */
  select?: { selected: boolean; toggle: () => void }
}) {
  const { t } = useTranslation()
  return (
    <div className="group/card relative" style={{ '--i': index } as React.CSSProperties}>
      <CardLink entry={entry} showSpace={showSpace} />
      {select ? (
        <button
          type="button"
          aria-pressed={select.selected}
          aria-label={t('entry.batch.toggle', { title: entry.title || t('entry.untitled') })}
          onClick={select.toggle}
          data-testid="entry-select"
          className={cn(
            'absolute inset-0 rounded-lg border-2 transition-colors duration-(--xz-dur-fast)',
            select.selected
              ? 'border-primary bg-primary-soft/40'
              : 'border-transparent hover:bg-hover/40',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'absolute top-3 right-3 grid size-5 place-items-center rounded-md border',
              select.selected
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-border bg-surface',
            )}
          >
            {select.selected ? <Check className="size-3.5" /> : null}
          </span>
        </button>
      ) : (
        <div className="absolute right-3 bottom-3 opacity-0 transition-opacity duration-(--xz-dur-fast) focus-within:opacity-100 group-hover/card:opacity-100 [@media(hover:none)]:opacity-100">
          <EntryMenu entry={entry} canWrite={canWrite} />
        </div>
      )}
    </div>
  )
}

function CardLink({ entry, showSpace }: { entry: Entry; showSpace?: boolean }) {
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
      className="paper xz-lift xz-rise group flex min-h-36 flex-col gap-2 rounded-lg border border-divider p-4"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className={cn('rounded-full px-2 py-0.5 font-medium', entryKindClass(entry.kind))}>
          {t(`entry.kind.${entry.kind}`)}
        </span>
        {showSpace ? <SpaceTag slug={entry.spaceSlug} /> : null}
        {entry.archivedAt ? (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-fg-muted">
            {t('entry.menu.archivedBadge')}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          {entry.favorited ? (
            <Star
              className="size-3.5 fill-current text-warning"
              aria-label={t('entry.nav.favorite')}
              data-testid="entry-card-favorited"
            />
          ) : null}
          {entry.pinned ? (
            <Pin className="size-3.5 text-primary-text" aria-label={t('entry.pinned')} />
          ) : null}
        </span>
      </div>
      {entry.path?.length ? (
        <p className="-mb-1 truncate text-fg-faint text-xs" data-testid="entry-card-path">
          {entry.path.map((p) => p.title || t('entry.untitled')).join(' / ')}
        </p>
      ) : null}
      <h3 className="line-clamp-2 font-medium leading-snug transition-colors duration-(--xz-dur-fast) group-hover:text-primary-text">
        {entry.title || t('entry.untitled')}
      </h3>
      {entry.excerpt ? <p className="line-clamp-3 text-fg-muted text-sm">{entry.excerpt}</p> : null}
      <EntryMeta entry={entry} />
      <div className="mt-auto flex items-center gap-2 pr-8 text-fg-muted text-xs">
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
