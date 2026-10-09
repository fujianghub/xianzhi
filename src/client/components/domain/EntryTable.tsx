/**
 * 记录列表视图（ADR-0012、REQ-KB-004；ADR-0016 起为记录页默认视图，REQ-ENTRY-016）：
 * 列 = 勾选 · 标题（+ 目录路径 + 一行摘要）· 类型（多类型时）· 状态 · 进度 · 所选单一类型的其它字段 · 标签 · （跨空间时）空间 · 更新时间。
 * 模板元数据（ADR-0039）：单一类型时，已加载行的来源模板带来的自有字段也各占一列；某行没有这个属性
 * （别的模板建的 / 被它的模板移除了）显示 `—`、不可编辑。
 * 状态：任何带 status 的类型都显示（内置类型译名；自定义类型原样）；进度：学习计划 / 自定义类型的百分比条。
 * 点列头在已加载数据内排序；枚举字段按 schema 定义顺序，日期 / 文本按字典序，数字按数值。
 * 勾选列常驻（有 `select` 时）：表头复选框全选 / 取消本页。
 * 值统一彩色展示（FieldValue，ADR-0035 §C）；`editable` 时点单元格弹出编辑器、选定即保存（REQ-ENTRY-026）。
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { Fragment, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFieldCommit, useTagsCommit } from '../../hooks/useFieldCommit.ts'
import { cn } from '../../lib/cn.ts'
import { openInDock } from '../../lib/entry-dock.ts'
import type { Entry, EntryKind } from '../../lib/entry-queries.ts'
import { useKindLabel } from '../../lib/entry-types.ts'
import { useEntryDock } from '../../lib/stores.ts'
import { Checkbox } from '../ui/checkbox.tsx'
import { RelativeTime } from '../ui/relative-time.tsx'
import { FieldEditor, type FieldSpec, FieldValue, useFieldSpecs } from './FieldValue.tsx'
import { KindBadge } from './KindIcon.tsx'
import { PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'
import { SpaceTag } from './SpaceTag.tsx'
import { type Tag, TagPicker, tagsQuery } from './TagPicker.tsx'

type Col = { key: string; label: string; rank?: (v: unknown) => number }

/** 不进列表的属性（ADR-0033：Bug 的提交 / 踩坑目录很少填、又长，留在属性栏） */
const TABLE_HIDDEN = ['commit', 'debugDir']

export { ProgressBar, StatusPill } from './FieldValue.tsx'

export function EntryTable({
  items,
  kinds,
  typeId,
  showSpace,
  select,
  group,
  editable,
  rowMenu,
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
  /** 分组（ADR-0033）：在已加载的行内按该属性分组；counts = 服务端各组总数（取值缺失为 ''） */
  group?: {
    key: string
    counts: Map<string, number>
    /** 分组键的规格（模板属性不在类型字段里，由调用方给出，ADR-0040）；缺省从类型字段里找 */
    spec?: FieldSpec
  }
  /** 就地编辑（REQ-ENTRY-026）：返回 true 的行可点单元格改值（写权限由调用方判断，服务端 can() 为准） */
  editable?: (e: Entry) => boolean
  /** 行末 ⋯ 菜单（REQ-KB-013） */
  rowMenu?: (e: Entry) => ReactNode
}) {
  const { t } = useTranslation()
  const { data: tags = [] } = useQuery(tagsQuery)
  const kindOf = useKindLabel()
  const specsOf = useFieldSpecs()
  const commit = useFieldCommit()
  const commitTags = useTagsCommit()
  // 在右侧详情坞里打开着的那一行高亮（ADR-0054 §B）
  const dockId = useEntryDock((s) => s.id)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const single: EntryKind | undefined = typeId
    ? 'custom'
    : kinds.length === 1
      ? kinds[0]
      : undefined
  // 状态常驻；进度只在该类型有进度属性（或多类型混排）时出现；单一类型的其它字段附在后面（很少填的长字段不进列表）
  const singleSpecs = single ? specsOf(single, typeId) : []
  // 每行自己的规格（按来源模板）：同一模板只算一次
  const rowSpecCache = new Map<string, FieldSpec[]>()
  const rowSpecsOf = (e: Entry): FieldSpec[] => {
    const k = `${e.kind}|${e.typeId ?? ''}|${e.templateId ?? ''}`
    let v = rowSpecCache.get(k)
    if (!v) {
      v = specsOf(e.kind, e.typeId, e.templateId)
      rowSpecCache.set(k, v)
    }
    return v
  }
  // 来源模板带来的自有字段（类型里没有的）：按首次出现的顺序附在类型字段之后
  const templateSpecs: FieldSpec[] = []
  if (single)
    for (const e of items)
      if (e.templateId)
        for (const f of rowSpecsOf(e))
          if (
            f.extra &&
            !singleSpecs.some((s) => s.name === f.name) &&
            !templateSpecs.some((s) => s.name === f.name)
          )
            templateSpecs.push(f)
  const specs = [...singleSpecs, ...templateSpecs].filter(
    (f) => f.name !== 'status' && f.name !== 'progress' && !TABLE_HIDDEN.includes(f.name),
  )
  // 状态 / 进度专列：单一类型时只在该字段可见时出（代码字段覆盖可隐藏，ADR-0042）
  const showProgress = !single || singleSpecs.some((f) => f.name === 'progress')
  const statusSpec = singleSpecs.find((f) => f.name === 'status')
  const showStatus = !single || !!statusSpec
  const cols: (Col & { spec: FieldSpec })[] = specs.map((f) => ({
    key: `f.${f.name}`,
    label: f.label,
    spec: f,
    rank:
      f.kind === 'select'
        ? (v: unknown) => f.options.findIndex((o) => String(o.value) === String(v))
        : undefined,
  }))
  const statusRank =
    statusSpec?.kind === 'select'
      ? (v: unknown) => statusSpec.options.findIndex((o) => String(o.value) === String(v))
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
  /** 单元格：彩色值；可编辑时包一层按钮弹出编辑器 */
  const cell = (e: Entry, spec: FieldSpec | undefined, name: string, canEdit: boolean) => {
    const v = e.fields[name]
    if (!spec) return <span className="text-fg-faint">—</span>
    const shown = (
      <FieldValue
        spec={spec}
        value={v}
        fields={e.fields}
        statuses={kindOf(e.kind, e.typeId).statuses}
        size="sm"
      />
    )
    if (!canEdit) return shown
    return (
      <FieldEditor
        spec={spec}
        value={v}
        onCommit={(nv) => void commit(e, name, nv)}
        trigger={
          <button
            type="button"
            className="xz-cell-edit"
            aria-label={t('field.edit', { name: spec.label })}
            data-testid={`cell-${name}`}
          >
            {shown}
          </button>
        }
      />
    )
  }
  const row = (e: Entry) => {
    const rowSpecs = rowSpecsOf(e)
    const canEdit = !!editable?.(e)
    const on = !!select?.has(e.id)
    return (
      <tr
        key={e.id}
        className={cn(
          'group border-divider border-b align-top last:border-0 hover:bg-hover',
          (on || dockId === e.id) && 'bg-selected',
        )}
        data-active={dockId === e.id || undefined}
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
        <td className="min-w-[12rem] max-w-[30rem] px-3 py-2">
          <Link
            to="/entries/$entryId"
            params={{ entryId: e.id }}
            onClick={(ev) => openInDock(ev, e.id)}
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
            <span className="line-clamp-1 text-fg-muted text-xs" data-testid="entry-excerpt">
              {e.excerpt}
            </span>
          ) : null}
        </td>
        {single ? null : (
          <td className="px-3 py-2">
            <KindBadge kind={e.kind} typeId={e.typeId} />
          </td>
        )}
        {showStatus ? (
          <td className="whitespace-nowrap px-3 py-2" data-field="status">
            {cell(
              e,
              rowSpecs.find((f) => f.name === 'status'),
              'status',
              canEdit,
            )}
          </td>
        ) : null}
        {showProgress ? (
          <td className="whitespace-nowrap px-3 py-2" data-field="progress">
            {cell(
              e,
              rowSpecs.find((f) => f.name === 'progress'),
              'progress',
              canEdit,
            )}
          </td>
        ) : null}
        {cols.map((c) => (
          <td key={c.key} className="whitespace-nowrap px-3 py-2" data-field={c.key.slice(2)}>
            {cell(
              e,
              rowSpecs.find((f) => f.name === c.spec.name),
              c.spec.name,
              canEdit,
            )}
          </td>
        ))}
        <td className="px-3 py-2" data-field="tags">
          <TagsCell
            entry={e}
            tags={tags}
            canEdit={canEdit}
            onCommit={(ids) => void commitTags(e, ids)}
          />
        </td>
        {showSpace ? (
          <td className="px-3 py-2">
            <SpaceTag slug={e.spaceSlug} />
          </td>
        ) : null}
        <td className="whitespace-nowrap px-3 py-2 text-fg-muted text-xs">
          <RelativeTime date={e.updatedAt} />
        </td>
        {rowMenu ? <td className="w-8 px-1 py-1.5">{rowMenu(e)}</td> : null}
      </tr>
    )
  }
  // 分组：组序 = 枚举定义顺序（模块按总数降序），缺值组放最后
  const grouped = (() => {
    if (!group) return null
    const buckets = new Map<string, Entry[]>()
    for (const e of sorted) {
      const v = e.fields[group.key]
      const k = v === undefined || v === null ? '' : String(v)
      buckets.set(k, [...(buckets.get(k) ?? []), e])
    }
    const spec = group.spec ?? singleSpecs.find((f) => f.name === group.key)
    const order =
      spec?.kind === 'select'
        ? spec.options.map((o) => String(o.value))
        : [...new Set([...group.counts.keys(), ...buckets.keys()])]
            .filter(Boolean)
            .sort((a, b) => (group.counts.get(b) ?? 0) - (group.counts.get(a) ?? 0))
    return [...order, '']
      .filter((v) => buckets.has(v))
      .map((value) => ({ value, items: buckets.get(value) ?? [], total: group.counts.get(value) }))
  })()
  const colCount =
    (select ? 1 : 0) +
    1 +
    (single ? 0 : 1) +
    (showStatus ? 1 : 0) +
    (showProgress ? 1 : 0) +
    cols.length +
    1 +
    (showSpace ? 1 : 0) +
    1 +
    (rowMenu ? 1 : 0)
  const groupSpec = group
    ? (group.spec ?? singleSpecs.find((f) => f.name === group.key))
    : undefined
  const allOn = !!select && items.length > 0 && items.every((e) => select.has(e.id))
  const someOn = !!select && items.some((e) => select.has(e.id))
  return (
    // relative：表内 sr-only（absolute）以此为包含块，不再逃出横向滚动、撑宽整页（ADR-0054 §E）
    <div className="paper relative overflow-x-auto rounded-lg">
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
            {showStatus ? header('f.status', statusSpec?.label ?? t('entry.field.status')) : null}
            {showProgress
              ? header(
                  'f.progress',
                  singleSpecs.find((f) => f.name === 'progress')?.label ?? t('entry.list.progress'),
                )
              : null}
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
            {rowMenu ? (
              <th scope="col" className="w-8">
                <span className="sr-only">{t('entry.menu.label')}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {grouped
            ? grouped.map((g) => (
                <Fragment key={g.value}>
                  <tr className="border-divider border-b bg-surface-2" data-testid="entry-group">
                    <th
                      scope="colgroup"
                      colSpan={colCount}
                      className="px-3 py-1.5 text-left font-medium text-fg-muted text-xs"
                      data-group={g.value}
                    >
                      {g.value && groupSpec ? (
                        <FieldValue spec={groupSpec} value={g.value} size="sm" />
                      ) : g.value ? (
                        g.value
                      ) : (
                        t('entry.group.empty')
                      )}
                      <span className="ms-2 tabular-nums" data-testid="entry-group-count">
                        {g.total !== undefined && g.total > g.items.length
                          ? t('entry.group.partial', { loaded: g.items.length, total: g.total })
                          : g.items.length}
                      </span>
                    </th>
                  </tr>
                  {g.items.map(row)}
                </Fragment>
              ))
            : sorted.map(row)}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 标签列（ADR-0054 §A）：可写行点标签（无标签时悬停露出「+ 标签」）弹出 TagPicker，
 * 多选草稿在弹层里即时显示，关闭时整组一次提交（同任务行，REQ-TASK-038）。
 */
function TagsCell({
  entry,
  tags,
  canEdit,
  onCommit,
}: {
  entry: Entry
  tags: Tag[]
  canEdit: boolean
  onCommit: (ids: string[]) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[] | null>(null)
  const ids = draft ?? entry.tagIds ?? []
  const value = ids.map((id) => tags.find((x) => x.id === id)).filter((x): x is Tag => !!x)
  const chips = value.map((tag) => (
    <span
      key={tag.id}
      className={cn(
        'rounded px-1.5 py-0.5 text-[11px]',
        PALETTE_CLASS[(tag.color as PaletteName) ?? 'gray'],
      )}
    >
      #{tag.name}
    </span>
  ))
  if (!canEdit) return <div className="flex flex-wrap gap-1">{chips}</div>
  return (
    <TagPicker
      open={open}
      value={value}
      onChange={setDraft}
      onOpenChange={(o) => {
        setOpen(o)
        if (o || !draft) return
        const cur = entry.tagIds ?? []
        if (draft.length !== cur.length || draft.some((x) => !cur.includes(x))) onCommit(draft)
        setDraft(null)
      }}
      trigger={
        value.length ? (
          <button
            type="button"
            className="xz-cell-edit flex flex-wrap gap-1"
            aria-label={t('field.edit', { name: t('kb.tags') })}
            data-testid="cell-tags"
          >
            {chips}
          </button>
        ) : (
          <button
            type="button"
            className={cn('xz-row-ghost', open && 'xz-row-ghost-on')}
            aria-label={t('taskRow.addTags')}
            data-testid="cell-tags"
          >
            <Plus className="size-3" aria-hidden />
            {t('taskRow.tags')}
          </button>
        )
      }
    />
  )
}
