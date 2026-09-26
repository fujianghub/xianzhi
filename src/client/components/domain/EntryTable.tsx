/**
 * 记录列表视图（ADR-0012、REQ-KB-004；ADR-0016 起为记录页默认视图，REQ-ENTRY-016）：
 * 列 = 勾选 · 标题（+ 目录路径 + 一行摘要）· 类型（多类型时）· 状态 · 进度 · 所选单一类型的其它字段 · 标签 · （跨空间时）空间 · 更新时间。
 * 状态：任何带 status 的类型都显示（内置类型译名；自定义类型原样）；进度：学习计划 / 自定义类型的百分比条。
 * 点列头在已加载数据内排序；枚举字段按 schema 定义顺序，日期 / 文本按字典序，数字按数值。
 * 勾选列常驻（有 `select` 时）：表头复选框全选 / 取消本页。
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import type { Entry, EntryKind } from '../../lib/entry-queries.ts'
import { useKindLabel } from '../../lib/entry-types.ts'
import { Checkbox } from '../ui/checkbox.tsx'
import { RelativeTime } from '../ui/relative-time.tsx'
import { fieldSpecs } from './EntryFieldsForm.tsx'
import { KindBadge, toneClass } from './KindIcon.tsx'
import { PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'
import { SpaceTag } from './SpaceTag.tsx'
import { tagsQuery } from './TagPicker.tsx'

type Col = { key: string; label: string; rank?: (v: unknown) => number }

/** 内置状态的语义色（不单靠颜色：旁边有文字） */
const STATUS_TONE: Record<string, PaletteName> = {
  open: 'red',
  fixed: 'green',
  wontfix: 'gray',
  proposed: 'blue',
  accepted: 'green',
  superseded: 'gray',
  rejected: 'gray',
  planned: 'cyan',
  doing: 'orange',
  shipped: 'green',
  dropped: 'gray',
  planning: 'blue',
  active: 'orange',
  paused: 'yellow',
  done: 'green',
}
/** 自定义状态按在列表中的位置取色：首项灰、末项绿、其余依次蓝 / 橙 / 紫… */
const CUSTOM_TONES: PaletteName[] = ['blue', 'orange', 'purple', 'cyan', 'pink', 'yellow']
export function statusTone(v: string, statuses: string[] | null): PaletteName {
  if (!statuses) return STATUS_TONE[v] ?? 'gray'
  const i = statuses.indexOf(v)
  if (i <= 0) return 'gray'
  if (i === statuses.length - 1) return 'green'
  return CUSTOM_TONES[(i - 1) % CUSTOM_TONES.length] ?? 'blue'
}

export function StatusPill({ value, statuses }: { value: string; statuses: string[] | null }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'xz-kind-badge h-5 gap-1 px-1.5 text-[11px]',
        toneClass(statusTone(value, statuses)),
      )}
      data-status={value}
    >
      {statuses ? value : t(`entry.fieldValue.${value}`, { defaultValue: value })}
    </span>
  )
}

export function ProgressBar({ value }: { value: number }) {
  const { t } = useTranslation()
  const v = Math.max(0, Math.min(100, value))
  return (
    <span className="inline-flex items-center gap-2" data-testid="entry-progress">
      <span
        className="relative h-1.5 w-16 overflow-hidden rounded-full bg-active"
        role="progressbar"
        aria-label={t('entry.list.progress')}
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${v}%` }}
        />
      </span>
      <span className="text-fg-muted text-xs tabular-nums">{v}%</span>
    </span>
  )
}

export function EntryTable({
  items,
  kinds,
  typeId,
  showSpace,
  select,
}: {
  /** 勾选（ADR-0016：列表视图常驻） */
  select?: {
    has: (id: string) => boolean
    toggle: (id: string) => void
    setAll: (on: boolean) => void
  }
  items: Entry[]
  kinds: EntryKind[]
  /** 只选了一个自定义类型 */
  typeId?: string
  showSpace: boolean
}) {
  const { t } = useTranslation()
  const { data: tags = [] } = useQuery(tagsQuery)
  const kindOf = useKindLabel()
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const single: EntryKind | undefined = typeId
    ? 'custom'
    : kinds.length === 1
      ? kinds[0]
      : undefined
  const singleStatuses = single ? kindOf(single, typeId).statuses : null
  // 状态 / 进度常驻，单一类型的其它字段附在后面
  const specs = single
    ? fieldSpecs(single, singleStatuses).filter((f) => f.name !== 'status' && f.name !== 'progress')
    : []
  const statusSpec = single
    ? fieldSpecs(single, singleStatuses).find((f) => f.name === 'status')
    : undefined
  const cols: Col[] = specs.map((f) => ({
    key: `f.${f.name}`,
    label: t(`entry.field.${f.name}`),
    rank:
      f.kind === 'select'
        ? (v: unknown) => f.options.findIndex((o) => String(o) === String(v))
        : undefined,
  }))
  const statusRank =
    statusSpec?.kind === 'select'
      ? (v: unknown) => statusSpec.options.findIndex((o) => String(o) === String(v))
      : undefined
  const cellValue = (e: Entry, key: string): unknown =>
    key === 'title'
      ? e.title
      : key === 'kind'
        ? kindOf(e.kind, e.typeId).label
        : key === 'updatedAt'
          ? e.updatedAt
          : e.fields[key.slice(2)]
  // ≤ 200 行，直接排序（不缓存）
  const sorted = (() => {
    if (!sort) return items
    const rank = sort.key === 'f.status' ? statusRank : cols.find((c) => c.key === sort.key)?.rank
    const cmp = (a: Entry, b: Entry) => {
      const va = cellValue(a, sort.key)
      const vb = cellValue(b, sort.key)
      if (va === undefined || va === null || va === '') return 1
      if (vb === undefined || vb === null || vb === '') return -1
      if (rank) return (rank(va) - rank(vb)) * sort.dir
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir
      return String(va).localeCompare(String(vb)) * sort.dir
    }
    return [...items].sort(cmp)
  })()
  const header = (key: string, label: string, className?: string) => (
    <th
      key={key}
      scope="col"
      className={cn('px-3 py-2 text-left font-medium', className)}
      aria-sort={sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-fg"
        onClick={() =>
          setSort((s) =>
            s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 },
          )
        }
        data-sort-key={key}
      >
        {label}
        {sort?.key === key ? (
          sort.dir === 1 ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : null}
      </button>
    </th>
  )
  const show = (v: unknown, name: string) => {
    if (v === undefined || v === null || v === '') return <span className="text-fg-faint">—</span>
    if (name === 'progress') return `${String(v)}%`
    return single === 'custom'
      ? String(v)
      : t(`entry.fieldValue.${String(v)}`, { defaultValue: String(v) })
  }
  const allOn = !!select && items.length > 0 && items.every((e) => select.has(e.id))
  const someOn = !!select && items.some((e) => select.has(e.id))
  return (
    <div className="paper overflow-x-auto rounded-lg border border-divider">
      <table className="w-full min-w-[48rem] border-collapse text-sm" data-testid="entry-table">
        <thead className="border-divider border-b text-fg-muted text-xs">
          <tr>
            {select ? (
              <th scope="col" className="w-10 px-3 py-2">
                <Checkbox
                  checked={allOn ? true : someOn ? 'indeterminate' : false}
                  onCheckedChange={() => select.setAll(!allOn)}
                  aria-label={t('entry.batch.selectAll')}
                  className="size-4"
                  data-testid="entry-select-all"
                />
              </th>
            ) : null}
            {header('title', t('entry.title'))}
            {single ? null : header('kind', t('entry.props.kind'))}
            {header('f.status', t('entry.field.status'))}
            {header('f.progress', t('entry.list.progress'))}
            {cols.map((c) => header(c.key, c.label))}
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {t('kb.tags')}
            </th>
            {showSpace ? (
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {t('space.space')}
              </th>
            ) : null}
            {header('updatedAt', t('entry.aside.updatedAt'))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const meta = kindOf(e.kind, e.typeId)
            const status = e.fields.status
            const progress = e.fields.progress
            const on = !!select?.has(e.id)
            return (
              <tr
                key={e.id}
                className={cn(
                  'border-divider border-b align-top last:border-0 hover:bg-hover',
                  on && 'bg-selected',
                )}
                data-testid="entry-row"
                data-entry-id={e.id}
                aria-selected={select ? on : undefined}
              >
                {select ? (
                  <td className="px-3 py-2.5">
                    <Checkbox
                      checked={on}
                      onCheckedChange={() => select.toggle(e.id)}
                      aria-label={t('entry.batch.toggle', {
                        title: e.title || t('entry.untitled'),
                      })}
                      className="size-4"
                      data-testid="entry-row-select"
                    />
                  </td>
                ) : null}
                <td className="max-w-[30rem] px-3 py-2">
                  <Link
                    to="/entries/$entryId"
                    params={{ entryId: e.id }}
                    className="line-clamp-1 font-medium hover:text-primary-text"
                  >
                    {e.pinned ? <span className="sr-only">{t('entry.pinned')} · </span> : null}
                    {e.title || t('entry.untitled')}
                  </Link>
                  {e.path?.length ? (
                    <span className="line-clamp-1 text-fg-faint text-xs">
                      {e.path.map((p) => p.title || t('entry.untitled')).join(' / ')}
                    </span>
                  ) : null}
                  {e.excerpt ? (
                    <span
                      className="line-clamp-1 text-fg-muted text-xs"
                      data-testid="entry-excerpt"
                    >
                      {e.excerpt}
                    </span>
                  ) : null}
                </td>
                {single ? null : (
                  <td className="px-3 py-2">
                    <KindBadge kind={e.kind} typeId={e.typeId} />
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2" data-field="status">
                  {typeof status === 'string' && status ? (
                    <StatusPill value={status} statuses={meta.statuses} />
                  ) : (
                    <span className="text-fg-faint">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2" data-field="progress">
                  {typeof progress === 'number' ? (
                    <ProgressBar value={progress} />
                  ) : (
                    <span className="text-fg-faint">—</span>
                  )}
                </td>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className="whitespace-nowrap px-3 py-2"
                    data-field={c.key.slice(2)}
                  >
                    {show(e.fields[c.key.slice(2)], c.key.slice(2))}
                  </td>
                ))}
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(e.tagIds ?? []).map((id) => {
                      const tag = tags.find((x) => x.id === id)
                      return tag ? (
                        <span
                          key={id}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[11px]',
                            PALETTE_CLASS[(tag.color as PaletteName) ?? 'gray'],
                          )}
                        >
                          #{tag.name}
                        </span>
                      ) : null
                    })}
                  </div>
                </td>
                {showSpace ? (
                  <td className="px-3 py-2">
                    <SpaceTag slug={e.spaceSlug} />
                  </td>
                ) : null}
                <td className="whitespace-nowrap px-3 py-2 text-fg-muted text-xs">
                  <RelativeTime date={e.updatedAt} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
