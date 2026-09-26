/**
 * 记录列表（08 §2.8、REQ-ENTRY-002 · 006、REQ-KB-004）：卡片 / 表格两种视图；固定项置顶（先查 pinned=1，再查 pinned=0）；
 * 类型可多选（`kind=bug,iteration`）；只选一种类型时按其 fields 给出下拉过滤（`fields=status=open,severity=high`）；
 * 表格视图列 = 该类型的 fields，点列头在已加载的数据内排序（枚举按定义顺序），一次最多加载 200 条。
 * 参数与 02 §9 同名、全部进 URL。`/entries` 与空间记录页共用。
 *
 * ADR-0014（REQ-ENTRY-012 ~ 015、REQ-TAG-006）：
 * - 左栏位置：全部 / 最近打开 / 收藏 / 已归档 / 个人随笔 / 大类 → 空间 → 目录子树（空间页签内只列本空间目录）；
 * - 标签多选筛选；只选一种带 status 的类型时可切「看板」，只选 迭代 / 变更 时可切「时间线」；
 * - 「多选」进入批量模式（`select=1`），吸底操作条走 `POST /entries/batch`。
 * 「最近打开 / 收藏 / 已归档」不分固定区（单次查询）；最近打开按本机访问顺序排列。
 *
 * ADR-0016（REQ-ENTRY-016 ~ 019）：
 * - 默认 = 列表视图（状态 / 进度 / 摘要常驻），`view=cards` 为卡片；列表勾选列常驻，选中即出批量条（卡片仍用「多选」）；
 * - 类型筛选 = 未隐藏的内置类型 + 自定义类型（`typeId=`），旁边「管理」进 /settings/types；标签筛选旁「管理」进 /settings/tags。
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  CalendarRange,
  CheckSquare,
  Columns3,
  LayoutGrid,
  List,
  ListTree,
  Plus,
  Settings2,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDelayedFlag } from '../../hooks/useDelayedFlag.ts'
import { useMe } from '../../hooks/useMe.ts'
import { cn } from '../../lib/cn.ts'
import {
  ENTRY_SORTS,
  type Entry,
  type EntryKind,
  type EntryListParams,
  entriesInfiniteQuery,
  flattenEntries,
  treeQuery,
} from '../../lib/entry-queries.ts'
import { kindKey, useKindLabel, useKindOptions } from '../../lib/entry-types.ts'
import { recentIds } from '../../lib/recent.ts'
import { csvList } from '../../lib/search.ts'
import { type Space, spaceGroupsQuery, spacesQuery } from '../../lib/space-queries.ts'
import { useNewEntry } from '../../lib/stores.ts'
import { Button } from '../ui/button.tsx'
import { EmptyState } from '../ui/empty-state.tsx'
import { Input } from '../ui/input.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { type EntriesLocation, EntriesNav, locationPatch } from './EntriesNav.tsx'
import { EntryBatchBar } from './EntryBatchBar.tsx'
import { boardStatuses, EntryBoard } from './EntryBoard.tsx'
import { EntryCard } from './EntryCard.tsx'
import { fieldSpecs } from './EntryFieldsForm.tsx'
import { EntryTable } from './EntryTable.tsx'
import { EntryTimeline, hasTimeline } from './EntryTimeline.tsx'
import { TagFilter } from './TagFilter.tsx'

export interface EntriesSearch {
  kind?: string
  /** 自定义类型（ADR-0016），逗号多值；与 kind 同给 = 任一命中 */
  typeId?: string
  fields?: string
  view?: 'table' | 'cards' | 'board' | 'timeline'
  authorId?: string
  tag?: string
  q?: string
  pinned?: '1'
  sort?: string
  /** 左栏位置（ADR-0014），互斥 */
  spaceId?: string
  under?: string
  groupId?: string
  favorite?: '1'
  recent?: '1'
  archived?: '1'
  /** 多选（批量）模式 */
  select?: '1'
}

/** `status=open|fixed,severity=high` ⇄ { status: 'open|fixed', severity: 'high' } */
export const parseFieldsParam = (s: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (s ?? '')
      .split(',')
      .map((p) => p.split('='))
      .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]),
  )
export const stringifyFieldsParam = (m: Record<string, string>): string | undefined => {
  const parts = Object.entries(m)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
  return parts.length ? parts.join(',') : undefined
}

export function EntriesPage({
  search,
  setSearch,
  spaceId,
  space,
  title,
  header,
  hideTitle,
}: {
  search: EntriesSearch
  setSearch: (patch: Partial<EntriesSearch>) => void
  spaceId?: string
  /** 空间页签内：左栏只列本空间目录 */
  space?: Space
  title: string
  header?: React.ReactNode
  /** 空间页签内：页头已由 KbHeader 提供 */
  hideTitle?: boolean
}) {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const openNew = useNewEntry((s) => s.setOpen)
  const setDefaults = useNewEntry((s) => s.setDefaults)
  const kinds = csvList(search.kind) as EntryKind[]
  const typeIds = csvList(search.typeId)
  const kindOf = useKindLabel()
  const kindOptions = useKindOptions()
  // 只选了一种类型：内置 kind，或一个自定义类型
  const typeId = !kinds.length && typeIds.length === 1 ? typeIds[0] : undefined
  const kind: EntryKind | undefined = typeId
    ? 'custom'
    : kinds.length === 1 && !typeIds.length
      ? kinds[0]
      : undefined
  const customStatuses = typeId ? kindOf('custom', typeId).statuses : null
  const statuses = typeId ? (customStatuses?.length ? customStatuses : null) : boardStatuses(kind)
  const view =
    search.view === 'board' && statuses
      ? 'board'
      : search.view === 'timeline' && hasTimeline(kind)
        ? 'timeline'
        : search.view === 'cards'
          ? 'cards'
          : 'table'
  const effSpaceId = spaceId ?? search.spaceId
  const showNav = !spaceId || !!space
  const selecting = search.select === '1'
  const newDefaults = useMemo(
    () => ({
      spaceId: effSpaceId,
      kind,
      ...(typeId ? { typeId } : {}),
      ...(search.under && effSpaceId ? { parentId: search.under } : {}),
    }),
    [effSpaceId, kind, typeId, search.under],
  )
  useEffect(() => {
    setDefaults(newDefaults)
    return () => setDefaults({})
  }, [newDefaults, setDefaults])

  // 标题筛选输入防抖 300ms 后写入 URL
  const [q, setQ] = useState(search.q ?? '')
  useEffect(() => setQ(search.q ?? ''), [search.q])
  useEffect(() => {
    const h = setTimeout(() => {
      if ((search.q ?? '') !== q.trim()) setSearch({ q: q.trim() || undefined })
    }, 300)
    return () => clearTimeout(h)
  }, [q, search.q, setSearch])

  // 最近打开：本机访问顺序（任务 id 会被服务端自然滤掉）
  const recent = useMemo(() => (search.recent ? recentIds() : null), [search.recent])
  const special = !!(search.recent || search.favorite || search.archived)
  const base: EntryListParams = {
    spaceId: effSpaceId,
    under: search.under,
    groupId: search.groupId,
    favorite: search.favorite,
    archived: search.archived,
    ids: recent?.join(','),
    kind: search.kind,
    typeId: search.typeId,
    fields: search.fields,
    authorId: search.authorId,
    tag: search.tag,
    q: search.q,
    sort: search.sort ?? '-updatedAt',
  }
  const pageSize = view === 'cards' ? 30 : 200
  const recentEmpty = !!recent && !recent.length
  const pinned = useInfiniteQuery({
    ...entriesInfiniteQuery({ ...base, pinned: '1' }, 50),
    enabled: !special,
  })
  const rest = useInfiniteQuery({
    ...entriesInfiniteQuery(special ? base : { ...base, pinned: '0' }, pageSize),
    enabled: search.pinned !== '1' && !recentEmpty,
  })
  const pinnedItems = special ? [] : flattenEntries(pinned.data)
  let restItems = search.pinned === '1' || recentEmpty ? [] : flattenEntries(rest.data)
  if (recent) {
    const order = new Map(recent.map((id, i) => [id, i]))
    restItems = [...restItems].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
  }
  const items = [...pinnedItems, ...restItems]
  const loading =
    (!special && pinned.isPending) || (search.pinned !== '1' && !recentEmpty && rest.isPending)
  const skeleton = useDelayedFlag(loading)

  // 多选：列表视图勾选列常驻；卡片视图需进入「多选」模式。筛选 / 位置 / 视图变了清空选择
  const [selected, setSelected] = useState<string[]>([])
  const listKey = JSON.stringify(base)
  // biome-ignore lint/correctness/useExhaustiveDependencies: listKey / view 变化即清空
  useEffect(() => {
    setSelected([])
  }, [listKey, view])
  useEffect(() => {
    if (!selecting && view === 'cards') setSelected([])
  }, [selecting, view])
  const showBatch = view === 'table' ? selected.length > 0 || selecting : selecting
  const selSet = new Set(selected)
  const toggleSel = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const canWrite = (e: Entry) => !!me && (e.authorId === me.id || me.workspaceRole !== 'guest')

  const locTitle = useLocationTitle(search, effSpaceId, title)
  const [navOpen, setNavOpen] = useState(false)
  const selectLoc = (loc: EntriesLocation) => {
    setSearch({ ...locationPatch(loc), select: undefined })
    setNavOpen(false)
  }

  const chip = (active: boolean) =>
    cn(
      'h-8 shrink-0 rounded-full border px-3 text-sm',
      active ? 'border-selected-border bg-selected' : 'border-border hover:bg-hover',
    )
  const kindOn = (o: { kind: string; typeId: string | null }) =>
    o.kind === 'custom' ? typeIds.includes(o.typeId ?? '') : kinds.includes(o.kind as EntryKind)
  const toggleKind = (o: { kind: string; typeId: string | null }) => {
    // 类型变了，字段过滤可能不再适用：清空
    if (o.kind === 'custom' && o.typeId) {
      const id = o.typeId
      const next = typeIds.includes(id) ? typeIds.filter((x) => x !== id) : [...typeIds, id]
      setSearch({ typeId: next.length ? next.join(',') : undefined, fields: undefined })
      return
    }
    const k = o.kind as EntryKind
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]
    setSearch({ kind: next.length ? next.join(',') : undefined, fields: undefined })
  }
  const fieldFilters = kind
    ? fieldSpecs(kind, customStatuses).filter((f) => f.kind === 'select')
    : []
  const fieldValues = parseFieldsParam(search.fields)
  const viewBtn = (key: typeof view, icon: ReactNode, label: string, testId: string) => (
    <button
      type="button"
      aria-pressed={view === key}
      aria-label={label}
      title={label}
      onClick={() => setSearch({ view: key === 'table' ? undefined : key })}
      className={cn(
        'grid h-7 w-8 place-items-center rounded-full',
        view === key ? 'bg-selected' : 'text-fg-muted',
      )}
      data-testid={testId}
    >
      {icon}
    </button>
  )
  const emptyTitle = search.recent
    ? t('entry.nav.recentEmpty')
    : search.favorite
      ? t('entry.nav.favoriteEmpty')
      : search.archived
        ? t('entry.nav.archivedEmpty')
        : t(`entry.empty.${kind ?? 'all'}`, { defaultValue: t('entry.empty.all') })

  return (
    <section className="mx-auto max-w-[100rem]" data-testid="entries-page">
      <div className={cn(showNav && 'lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8')}>
        {showNav ? (
          <aside className={cn('mb-4 lg:mb-0 lg:block', !navOpen && 'hidden')}>
            <div className="paper rounded-xl p-2 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:bg-transparent lg:p-0 lg:shadow-none">
              <EntriesNav search={search} onSelect={selectLoc} fixedSpace={space} />
            </div>
          </aside>
        ) : null}
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {showNav ? (
              <button
                type="button"
                aria-expanded={navOpen}
                onClick={() => setNavOpen((v) => !v)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-sm lg:hidden"
                data-testid="entries-nav-toggle"
              >
                <ListTree className="size-4" />
                {t('entry.nav.toggle')}
              </button>
            ) : null}
            {hideTitle && !search.under && !search.archived ? null : (
              <h1
                className={cn('font-semibold tracking-tight', hideTitle ? 'text-lg' : 'text-2xl')}
                data-testid="entries-title"
              >
                {locTitle}
              </h1>
            )}
            {header}
            <div className="ml-auto flex items-center gap-2">
              <fieldset className="flex rounded-full border border-border p-0.5">
                <legend className="sr-only">{t('kb.view')}</legend>
                {viewBtn('table', <List className="size-4" />, t('entry.list.label'), 'view-table')}
                {viewBtn(
                  'cards',
                  <LayoutGrid className="size-4" />,
                  t('kb.viewCards'),
                  'view-cards',
                )}
                {statuses
                  ? viewBtn(
                      'board',
                      <Columns3 className="size-4" />,
                      t('entry.board.label'),
                      'view-board',
                    )
                  : null}
                {hasTimeline(kind)
                  ? viewBtn(
                      'timeline',
                      <CalendarRange className="size-4" />,
                      t('entry.timeline.label'),
                      'view-timeline',
                    )
                  : null}
              </fieldset>
              {view === 'cards' ? (
                <Button
                  variant={selecting ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={selecting}
                  onClick={() => setSearch({ select: selecting ? undefined : '1' })}
                  data-testid="entries-select-mode"
                >
                  <CheckSquare className="size-4" />
                  {t(selecting ? 'entry.batch.done' : 'entry.batch.select')}
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                onClick={() => openNew(true, newDefaults)}
                data-testid="new-entry"
              >
                <Plus className="size-4" />
                {t('entry.new')}
              </Button>
            </div>
          </div>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <fieldset className="flex gap-1.5 overflow-x-auto">
              <legend className="sr-only">{t('entry.props.kind')}</legend>
              <button
                type="button"
                className={chip(!kinds.length && !typeIds.length)}
                onClick={() => setSearch({ kind: undefined, typeId: undefined, fields: undefined })}
              >
                {t('entry.allKinds')}
              </button>
              {kindOptions.map((o) => (
                <button
                  key={kindKey(o)}
                  type="button"
                  aria-pressed={kindOn(o)}
                  className={chip(kindOn(o))}
                  onClick={() => toggleKind(o)}
                  data-kind-filter={kindKey(o)}
                >
                  {o.label}
                </button>
              ))}
              <Link
                to="/settings/types"
                className="inline-grid size-8 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"
                title={t('entry.types.manage')}
                aria-label={t('entry.types.manage')}
                data-testid="manage-types"
              >
                <Settings2 className="size-4" />
              </Link>
            </fieldset>
            {fieldFilters.map((f) =>
              f.kind === 'select' ? (
                <select
                  key={f.name}
                  value={fieldValues[f.name] ?? ''}
                  onChange={(e) =>
                    setSearch({
                      fields: stringifyFieldsParam({ ...fieldValues, [f.name]: e.target.value }),
                    })
                  }
                  aria-label={t(`entry.field.${f.name}`)}
                  className="h-8 rounded-full border border-border bg-surface px-3 text-sm"
                  data-testid={`field-filter-${f.name}`}
                >
                  <option value="">
                    {t(`entry.field.${f.name}`)}：{t('entry.allKinds')}
                  </option>
                  {f.options.map((o) => (
                    <option key={String(o)} value={String(o)}>
                      {f.raw ? String(o) : t(`entry.fieldValue.${o}`, { defaultValue: String(o) })}
                    </option>
                  ))}
                </select>
              ) : null,
            )}
            <TagFilter value={search.tag} onChange={(tag) => setSearch({ tag })} />
            <Link
              to="/settings/tags"
              className="inline-grid size-8 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"
              title={t('entry.tagsManage')}
              aria-label={t('entry.tagsManage')}
              data-testid="manage-tags"
            >
              <Settings2 className="size-4" />
            </Link>
            <button
              type="button"
              aria-pressed={search.authorId === 'me'}
              className={chip(search.authorId === 'me')}
              onClick={() => setSearch({ authorId: search.authorId === 'me' ? undefined : 'me' })}
            >
              {t('entry.mine')}
            </button>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('entry.searchPlaceholder')}
              aria-label={t('entry.searchPlaceholder')}
              className="h-8 w-48"
            />
            {search.recent ? null : (
              <select
                value={search.sort ?? '-updatedAt'}
                onChange={(e) =>
                  setSearch({ sort: e.target.value === '-updatedAt' ? undefined : e.target.value })
                }
                aria-label={t('entry.sortLabel')}
                className="h-8 rounded-full border border-border bg-surface px-3 text-sm"
              >
                {ENTRY_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`entry.sort.${s}`)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {skeleton ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架占位
                <Skeleton key={i} className="h-36 rounded-lg" />
              ))}
            </div>
          ) : !loading && !items.length ? (
            <EmptyState
              illustration="entries"
              title={emptyTitle}
              action={
                special ? undefined : (
                  <Button variant="primary" onClick={() => openNew(true, newDefaults)}>
                    {t('entry.new')}
                  </Button>
                )
              }
            />
          ) : view === 'board' && statuses ? (
            <EntryBoard
              items={items}
              statuses={statuses}
              canWrite={!!me && me.workspaceRole !== 'guest'}
            />
          ) : view === 'timeline' ? (
            <EntryTimeline items={items} />
          ) : view === 'table' ? (
            <EntryTable
              items={items}
              kinds={kinds}
              typeId={typeId}
              showSpace={!effSpaceId}
              select={{
                has: (id) => selSet.has(id),
                toggle: toggleSel,
                setAll: (on) => setSelected(on ? items.map((e) => e.id) : []),
              }}
            />
          ) : (
            <div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
              data-testid="entry-grid"
            >
              {items.map((e, i) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  showSpace={!effSpaceId}
                  index={i}
                  canWrite={canWrite(e)}
                  select={
                    selecting
                      ? { selected: selSet.has(e.id), toggle: () => toggleSel(e.id) }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
          {rest.hasNextPage && !skeleton && items.length ? (
            <div className="mt-6 flex justify-center">
              <Button
                variant="ghost"
                loading={rest.isFetchingNextPage}
                onClick={() => void rest.fetchNextPage()}
              >
                {t('entry.loadMore')}
              </Button>
            </div>
          ) : null}
          {showBatch ? (
            <EntryBatchBar
              selected={selected}
              items={items}
              setSelected={setSelected}
              onSelectAll={() => setSelected(items.map((e) => e.id))}
              archivedView={!!search.archived}
            />
          ) : null}
        </div>
      </div>
    </section>
  )
}

/** 页头标题随左栏位置变化：目录节点 > 空间 > 大类 > 收藏 / 最近 / 归档 > 默认标题。 */
function useLocationTitle(search: EntriesSearch, spaceId: string | undefined, fallback: string) {
  const { t } = useTranslation()
  const spaces = useQuery({ ...spacesQuery(), enabled: !!search.spaceId })
  const groups = useQuery({ ...spaceGroupsQuery, enabled: !!search.groupId })
  const tree = useQuery({ ...treeQuery(spaceId ?? ''), enabled: !!search.under && !!spaceId })
  if (search.recent) return t('entry.nav.recent')
  if (search.favorite) return t('entry.nav.favorite')
  if (search.archived) return t('entry.nav.archived')
  if (search.under) {
    const n = tree.data?.find((x) => x.id === search.under)
    if (n) return n.title || t('entry.untitled')
  }
  if (search.spaceId) {
    const s = spaces.data?.find((x) => x.id === search.spaceId)
    if (s) return s.isPersonal ? t('entry.nav.personal') : s.name
  }
  if (search.groupId === 'none') return t('entry.nav.ungrouped')
  if (search.groupId) {
    const g = groups.data?.find((x) => x.id === search.groupId)
    if (g) return g.name
  }
  return fallback
}
