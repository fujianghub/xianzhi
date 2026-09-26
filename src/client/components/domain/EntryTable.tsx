/**
 * 记录表格视图（ADR-0012、REQ-KB-004）：列 = 标题 · （多类型时）类型 · 所选类型的 fields · 标签 · （跨空间时）空间 · 更新时间。
 * 点列头在已加载数据内排序；枚举字段按 schema 定义顺序（如严重度 low → critical），日期 / 文本按字典序，数字按数值。
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import type { Entry, EntryKind } from '../../lib/entry-queries.ts'
import { RelativeTime } from '../ui/relative-time.tsx'
import { fieldSpecs } from './EntryFieldsForm.tsx'
import { KindBadge } from './KindIcon.tsx'
import { PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'
import { SpaceTag } from './SpaceTag.tsx'
import { tagsQuery } from './TagPicker.tsx'

type Col = { key: string; label: string; rank?: (v: unknown) => number }

export function EntryTable({
  items,
  kinds,
  showSpace,
  select,
}: {
  /** 多选模式（ADR-0014 批量） */
  select?: { has: (id: string) => boolean; toggle: (id: string) => void }
  items: Entry[]
  kinds: EntryKind[]
  showSpace: boolean
}) {
  const { t } = useTranslation()
  const { data: tags = [] } = useQuery(tagsQuery)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const specs = kinds.length === 1 && kinds[0] ? fieldSpecs(kinds[0]) : []
  const cols: Col[] = specs.map((f) => ({
    key: `f.${f.name}`,
    label: t(`entry.field.${f.name}`),
    rank:
      f.kind === 'select'
        ? (v: unknown) => f.options.findIndex((o) => String(o) === String(v))
        : undefined,
  }))
  const cellValue = (e: Entry, key: string): unknown =>
    key === 'title'
      ? e.title
      : key === 'kind'
        ? e.kind
        : key === 'updatedAt'
          ? e.updatedAt
          : e.fields[key.slice(2)]
  // ≤ 200 行，直接排序（不缓存）
  const sorted = (() => {
    if (!sort) return items
    const col = cols.find((c) => c.key === sort.key)
    const cmp = (a: Entry, b: Entry) => {
      const va = cellValue(a, sort.key)
      const vb = cellValue(b, sort.key)
      if (va === undefined || va === null || va === '') return 1
      if (vb === undefined || vb === null || vb === '') return -1
      if (col?.rank) return (col.rank(va) - col.rank(vb)) * sort.dir
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir
      return String(va).localeCompare(String(vb)) * sort.dir
    }
    return [...items].sort(cmp)
  })()
  const header = (key: string, label: string) => (
    <th
      scope="col"
      className="px-3 py-2 text-left font-medium"
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
    return t(`entry.fieldValue.${String(v)}`, { defaultValue: String(v) })
  }
  return (
    <div className="paper overflow-x-auto rounded-lg border border-divider">
      <table className="w-full min-w-[40rem] border-collapse text-sm" data-testid="entry-table">
        <thead className="border-divider border-b text-fg-muted text-xs">
          <tr>
            {select ? <th scope="col" className="w-10 px-3 py-2" /> : null}
            {header('title', t('entry.title'))}
            {kinds.length !== 1 ? header('kind', t('entry.props.kind')) : null}
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
          {sorted.map((e) => (
            <tr
              key={e.id}
              className="border-divider border-b last:border-0 hover:bg-hover"
              data-testid="entry-row"
              data-entry-id={e.id}
            >
              {select ? (
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={select.has(e.id)}
                    onChange={() => select.toggle(e.id)}
                    aria-label={t('entry.batch.toggle', { title: e.title || t('entry.untitled') })}
                    className="size-4 accent-(--color-primary)"
                    data-testid="entry-row-select"
                  />
                </td>
              ) : null}
              <td className="max-w-[28rem] px-3 py-2">
                <Link
                  to="/entries/$entryId"
                  params={{ entryId: e.id }}
                  className="line-clamp-1 font-medium hover:text-primary-text"
                >
                  {e.title || t('entry.untitled')}
                </Link>
                {e.path?.length ? (
                  <span className="line-clamp-1 text-fg-faint text-xs">
                    {e.path.map((p) => p.title || t('entry.untitled')).join(' / ')}
                  </span>
                ) : null}
              </td>
              {kinds.length !== 1 ? (
                <td className="px-3 py-2">
                  <KindBadge kind={e.kind} />
                </td>
              ) : null}
              {cols.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-3 py-2" data-field={c.key.slice(2)}>
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
          ))}
        </tbody>
      </table>
    </div>
  )
}
