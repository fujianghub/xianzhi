/**
 * 空间概览（ADR-0012 · 0036、REQ-KB-016、08 §2.5b）：进入空间的默认页（侧栏 / 卡片链接到此）。
 * 按空间启用的类型分页签（ADR-0036）：每个类型一张可编辑表格 + 状态概要，「全部」= 最近更新；
 * 快捷新建带好类型与内置模板。
 * 个人空间（ADR-0015、REQ-KB-007）换成个人工作台：「空间目录」（大类 → 空间 → 目录树，逐级展开、目录懒加载）
 * + 个人记录 + 各空间最近更新；快捷新建为随笔 / 笔记 / 计划。
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound, useNavigate } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Clock,
  FolderTree,
  Layers,
  type LucideIcon,
  Plus,
  Shapes,
  UserRound,
} from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DirTree, TWISTY_CENTER } from '../components/domain/DirTree.tsx'
import { EntryRowMenu } from '../components/domain/EntryRowMenu.tsx'
import { EntryTable } from '../components/domain/EntryTable.tsx'
import { useFieldSpecs } from '../components/domain/FieldValue.tsx'
import { KbHeader } from '../components/domain/KbHeader.tsx'
import { IconChip, KindBadge, KindIcon, toneClass } from '../components/domain/KindIcon.tsx'
import { SpaceIcon } from '../components/domain/SpaceIcon.tsx'
import { SpaceTag } from '../components/domain/SpaceTag.tsx'
import { SpaceTypesDialog } from '../components/domain/SpaceTypesDialog.tsx'
import { Button } from '../components/ui/button.tsx'
import { Disclosure } from '../components/ui/disclosure.tsx'
import { RelativeTime } from '../components/ui/relative-time.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { TreeGuides } from '../components/ui/tree-guides.tsx'
import { useMe } from '../hooks/useMe.ts'
import { useNewEntryContext } from '../hooks/useNewEntryContext.ts'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { openInDock } from '../lib/entry-dock.ts'
import {
  bugSorts,
  type Entry,
  type EntryKind,
  type EntryPage,
  entriesInfiniteQuery,
  entryStatsQuery,
  flattenEntries,
  statsByValue,
} from '../lib/entry-queries.ts'
import {
  type KindMeta,
  kindKey,
  useEnabledKinds,
  useKindLabel,
  useKindOptions,
} from '../lib/entry-types.ts'
import {
  canCreateIn,
  groupSpaces,
  type Space,
  spaceGroupsQuery,
  spaceQuery,
  spacesQuery,
} from '../lib/space-queries.ts'
import { useNewEntry } from '../lib/stores.ts'

type HomeSearch = { type?: string; status?: string }

export const Route = createFileRoute('/_app/spaces/$spaceSlug_/home')({
  validateSearch: (s: Record<string, unknown>): HomeSearch => ({
    type: typeof s.type === 'string' && /^[\w-]{1,64}$/.test(s.type) ? s.type : undefined,
    status:
      typeof s.status === 'string' && s.status.length <= 20 && !/[,|=]/.test(s.status)
        ? s.status
        : undefined,
  }),
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(spaceQuery(params.spaceSlug))
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 422)) throw notFound()
      throw err
    }
  },
  component: KbHome,
})

/** spaceId 为空串 = 跨全部可见空间 */
function useEntryList(spaceId: string, query: Record<string, string>, limit: number) {
  return useQuery({
    queryKey: ['entries', { spaceId, ...query }, 'overview', limit],
    queryFn: () =>
      unwrap<EntryPage>(
        api.entries.$get({
          query: { ...(spaceId ? { spaceId } : {}), ...query, limit: String(limit) } as never,
        }),
      ).then((r) => r.items),
    staleTime: 15_000,
  })
}

function Panel({
  title,
  icon,
  count,
  more,
  children,
  testId,
  className,
}: {
  title: string
  /** 标题前的彩色图标块（REQ-UI-037） */
  icon?: ReactNode
  count?: number
  more?: ReactNode
  children: ReactNode
  testId: string
  className?: string
}) {
  return (
    <section
      className={cn('paper flex flex-col gap-3 rounded-xl p-4', className)}
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-semibold text-sm">{title}</h2>
        {count !== undefined ? (
          <span className="rounded-full bg-surface-2 px-1.5 text-fg-muted text-xs tabular-nums">
            {count}
          </span>
        ) : null}
        <div className="ms-auto text-xs">{more}</div>
      </div>
      {children}
    </section>
  )
}

function EntryLine({ e, meta }: { e: Entry; meta?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <li>
      <Link
        to="/entries/$entryId"
        params={{ entryId: e.id }}
        onClick={(ev) => openInDock(ev, e.id)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-hover"
      >
        <KindBadge kind={e.kind} typeId={e.typeId} />
        <span className="min-w-0 flex-1 truncate">{e.title || t('entry.untitled')}</span>
        {meta}
        <RelativeTime date={e.updatedAt} className="shrink-0 text-fg-muted text-xs" />
      </Link>
    </li>
  )
}

function List({
  items,
  loading,
  empty,
  meta,
}: {
  items: Entry[] | undefined
  loading: boolean
  empty: string
  meta?: (e: Entry) => ReactNode
}) {
  if (loading) return <Skeleton className="h-20 w-full" />
  if (!items?.length) return <p className="px-2 text-fg-muted text-sm">{empty}</p>
  return (
    <ul className="-mx-2 flex flex-col">
      {items.map((e) => (
        <EntryLine key={e.id} e={e} meta={meta?.(e)} />
      ))}
    </ul>
  )
}

const chip = (icon: LucideIcon, tone: string) => <IconChip icon={icon} tone={tone} size="md" />

function KbHome() {
  const { spaceSlug } = Route.useParams()
  const { data: space } = useQuery(spaceQuery(spaceSlug))
  if (!space) return null
  return space.isPersonal ? <PersonalHome space={space} /> : <SpaceHome space={space} />
}

/** 快捷新建的内置模板（沿用原概览的快捷按钮；空间设了默认模板且类型一致时用默认模板） */
const KIND_TEMPLATE: Partial<Record<EntryKind, string>> = {
  bug: 'builtin:bug-fix',
  optimize: 'builtin:product-optimize',
  plan: 'builtin:learning-plan',
}
const LEARNING_TEMPLATE: Partial<Record<EntryKind, string>> = {
  note: 'builtin:study-note',
  journal: 'builtin:learning-weekly',
}
const ALL_TAB = 'all'

/** 列表 / 统计参数：内置 = kind，自定义 = typeId */
const kindParams = (m: { kind: string; typeId: string | null }) =>
  m.kind === 'custom' && m.typeId ? { typeId: m.typeId } : { kind: m.kind }

/**
 * 空间首页（ADR-0036、REQ-KB-016；取代按空间种类写死的版块）：启用类型的页签（带计数）+「全部」；
 * 选中类型 → 状态概要（彩色胶囊，点击筛选）+ 可编辑表格（点单元格即改，写回记录，REQ-ENTRY-026）；
 * 「全部」= 最近更新。页签与状态筛选记在 `?type=` `?status=`。
 */
function SpaceHome({ space }: { space: Space }) {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const nav = useNavigate({ from: Route.fullPath })
  const openNew = useNewEntry((s) => s.setOpen)
  const { data: me } = useMe()
  useNewEntryContext({ spaceId: space.id, parentId: null }) // 在概览按 e = 建在本空间目录根（ADR-0018）
  const kindOf = useKindLabel()
  const options = useKindOptions(space)
  const enabled = useEnabledKinds(space) ?? []
  // 页签 = 启用清单（本人不可用的空间类型也显示，只是不能新建）
  const tabs = enabled.map((k) =>
    k.startsWith('type:') ? kindOf('custom', k.slice(5)) : kindOf(k as EntryKind),
  )
  const defaultKey = space.defaultTypeId ?? space.defaultKind ?? null
  const fallback = (defaultKey && tabs.find((m) => kindKey(m) === defaultKey)) || tabs[0] || null
  const active =
    search.type === ALL_TAB ? null : (tabs.find((m) => kindKey(m) === search.type) ?? fallback)
  const [typesOpen, setTypesOpen] = useState(false)
  const canManage = space.myRole === 'admin'
  const canWrite = canCreateIn(space)
  const writeEntry = (e: Entry) => !!me && (e.authorId === me.id || me.workspaceRole !== 'guest')
  const setTab = (key: string) =>
    void nav({ search: (s) => ({ ...s, type: key, status: undefined }), replace: true })

  const quick = (m: KindMeta) => {
    const usable = options.some((o) => kindKey(o) === kindKey(m))
    if (!canWrite || !usable) return null
    const k = m.kind as EntryKind
    const templateId =
      m.kind === 'custom'
        ? undefined
        : space.defaultKind === k && space.defaultTemplateId
          ? space.defaultTemplateId
          : (KIND_TEMPLATE[k] ?? (space.kind === 'learning' ? LEARNING_TEMPLATE[k] : undefined))
    return (
      <Button
        size="sm"
        onClick={() =>
          openNew(true, {
            spaceId: space.id,
            kind: k,
            ...(m.typeId ? { typeId: m.typeId } : {}),
            templateId,
            parentId: null,
          })
        }
        data-testid={`kb-quick-${kindKey(m)}`}
      >
        <Plus className="size-4" />
        {t('kb.home.new', { kind: m.label })}
      </Button>
    )
  }

  return (
    <section className="mx-auto max-w-[100rem]" data-testid="kb-home">
      <KbHeader space={space} active="home" />
      <div
        className="mt-4 flex flex-wrap items-center gap-1"
        role="tablist"
        data-testid="kb-type-tabs"
      >
        {tabs.map((m) => (
          <TypeTab
            key={kindKey(m)}
            meta={m}
            spaceId={space.id}
            on={!!active && kindKey(active) === kindKey(m)}
            onClick={() => setTab(kindKey(m))}
          />
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={!active}
          onClick={() => setTab(ALL_TAB)}
          className={cn('xz-type-tab', !active && 'xz-type-tab-on')}
          data-testid="kb-type-tab"
          data-key={ALL_TAB}
        >
          <Clock className="size-3.5" aria-hidden />
          {t('kb.home.all')}
        </button>
        {canManage ? (
          <Button
            size="sm"
            variant="ghost"
            className="ms-auto"
            onClick={() => setTypesOpen(true)}
            data-testid="kb-manage-types"
          >
            <Shapes className="size-4" />
            {t('spaceTypes.menu')}
          </Button>
        ) : null}
      </div>
      {active ? (
        <TypeSection
          key={kindKey(active)}
          space={space}
          meta={active}
          status={search.status}
          onStatus={(status) => void nav({ search: (s) => ({ ...s, status }), replace: true })}
          canWrite={writeEntry}
          quick={quick(active)}
        />
      ) : (
        <RecentSection space={space} canWrite={writeEntry} />
      )}
      {typesOpen ? (
        <SpaceTypesDialog
          space={space}
          open={typesOpen}
          onOpenChange={setTypesOpen}
          canManage={canManage}
        />
      ) : null}
    </section>
  )
}

/** 类型页签：色块 + 名 + 该类型在本空间的记录数 */
function TypeTab({
  meta,
  spaceId,
  on,
  onClick,
}: {
  meta: KindMeta
  spaceId: string
  on: boolean
  onClick: () => void
}) {
  const stats = useQuery(entryStatsQuery({ spaceId, ...kindParams(meta) }))
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cn('xz-type-tab group', toneClass(meta.tone), on && 'xz-type-tab-on')}
      data-testid="kb-type-tab"
      data-key={kindKey(meta)}
    >
      <KindIcon kind={meta.kind} typeId={meta.typeId} size="xs" />
      {meta.label}
      {stats.data ? (
        <span className="xz-type-tab-count tabular-nums">{stats.data.total}</span>
      ) : null}
    </button>
  )
}

function TypeSection({
  space,
  meta,
  status,
  onStatus,
  canWrite,
  quick,
}: {
  space: Space
  meta: KindMeta
  status?: string
  onStatus: (s: string | undefined) => void
  canWrite: (e: Entry) => boolean
  quick: ReactNode
}) {
  const { t } = useTranslation()
  const specs = useFieldSpecs()(meta.kind as EntryKind, meta.typeId)
  const statusSpec = specs.find((f) => f.name === 'status' && f.kind === 'select')
  const base = { spaceId: space.id, ...kindParams(meta) }
  const stats = useQuery({
    ...entryStatsQuery({ ...base, groupBy: 'status' }),
    enabled: !!statusSpec,
  })
  const counts = statsByValue(stats.data, 'status')
  const list = useInfiniteQuery(
    entriesInfiniteQuery(
      {
        ...base,
        ...(status ? { fields: `status=${status}` } : {}),
        // Bug 按优先级（优先级被代码字段覆盖隐藏则按更新时间，ADR-0042）
        sort:
          meta.kind === 'bug' && bugSorts(specs).includes('priority') ? 'priority' : '-updatedAt',
      },
      100,
    ),
  )
  const items = flattenEntries(list.data)
  return (
    <div
      className="mt-3 flex flex-col gap-3"
      data-testid="kb-type-section"
      data-key={kindKey(meta)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {statusSpec ? (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="kb-status-summary">
            <button
              type="button"
              aria-pressed={!status}
              onClick={() => onStatus(undefined)}
              className={cn('xz-status-filter', !status && 'xz-status-filter-on')}
              data-status=""
            >
              {t('kb.home.allStatuses')}
              <span className="tabular-nums">{stats.data?.total ?? '…'}</span>
            </button>
            {statusSpec.options
              .filter((o) => !o.hidden || (counts.get(String(o.value)) ?? 0) > 0)
              .map((o) => (
                <button
                  key={String(o.value)}
                  type="button"
                  aria-pressed={status === String(o.value)}
                  onClick={() => onStatus(status === String(o.value) ? undefined : String(o.value))}
                  className={cn(
                    'xz-status-filter',
                    toneClass(o.tone),
                    status === String(o.value) && 'xz-status-filter-on',
                  )}
                  data-status={String(o.value)}
                >
                  <span className="xz-pill-dot" aria-hidden />
                  {o.label}
                  <span className="tabular-nums">{counts.get(String(o.value)) ?? 0}</span>
                </button>
              ))}
          </div>
        ) : null}
        <div className="ms-auto flex items-center gap-2">
          <Link
            to="/spaces/$spaceSlug/entries"
            params={{ spaceSlug: space.slug }}
            search={{
              ...kindParams(meta),
              view: 'table',
              ...(status ? { fields: `status=${status}` } : {}),
            }}
            className="text-primary-text text-xs hover:underline"
          >
            {t('kb.home.openInEntries')}
          </Link>
          {quick}
        </div>
      </div>
      {list.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length ? (
        <EntryTable
          items={items}
          kinds={meta.kind === 'custom' ? [] : [meta.kind as EntryKind]}
          typeId={meta.typeId ?? undefined}
          showSpace={false}
          editable={(e) => canWrite(e) && !e.archivedAt}
          rowMenu={(e) => (
            <EntryRowMenu entryId={e.id} title={e.title} entry={e} canWrite={canWrite(e)} />
          )}
        />
      ) : (
        <p
          className="paper rounded-xl px-4 py-8 text-center text-fg-muted text-sm"
          data-testid="kb-type-empty"
        >
          {status ? t('kb.home.emptyStatus') : t('kb.home.empty', { kind: meta.label })}
        </p>
      )}
      {list.hasNextPage ? (
        <Button variant="ghost" size="sm" onClick={() => void list.fetchNextPage()}>
          {t('kb.home.more')}
        </Button>
      ) : null}
    </div>
  )
}

/** 「全部」页签：本空间最近更新（可编辑表格，多类型混排） */
function RecentSection({ space, canWrite }: { space: Space; canWrite: (e: Entry) => boolean }) {
  const { t } = useTranslation()
  const list = useInfiniteQuery(entriesInfiniteQuery({ spaceId: space.id, sort: '-updatedAt' }, 30))
  const items = flattenEntries(list.data)
  return (
    <div className="mt-3 flex flex-col gap-3" data-testid="kb-panel-recent">
      {list.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length ? (
        <EntryTable
          items={items}
          kinds={[]}
          showSpace={false}
          editable={(e) => canWrite(e) && !e.archivedAt}
          rowMenu={(e) => (
            <EntryRowMenu entryId={e.id} title={e.title} entry={e} canWrite={canWrite(e)} />
          )}
        />
      ) : (
        <p className="paper rounded-xl px-4 py-8 text-center text-fg-muted text-sm">
          {t('kb.empty.recent')}
        </p>
      )}
    </div>
  )
}

/** 空间目录的缩进（大类 → 空间 → 目录，每级 20px；引导线落在上一级展开指示中心） */
const DIR_INDENT = 20
const HOME_FOLDS_KEY = 'xz:home-dir:v1'
interface HomeFolds {
  /** 已收起的大类（默认全部展开） */
  groups: string[]
  /** 已展开的空间（默认全部收起，展开时才请求目录） */
  spaces: string[]
}
const readHomeFolds = (): HomeFolds => {
  try {
    const v = JSON.parse(localStorage.getItem(HOME_FOLDS_KEY) ?? '{}') as Partial<HomeFolds>
    return { groups: v.groups ?? [], spaces: v.spaces ?? [] }
  } catch {
    return { groups: [], spaces: [] }
  }
}
const writeHomeFolds = (v: HomeFolds) => {
  try {
    localStorage.setItem(HOME_FOLDS_KEY, JSON.stringify(v))
  } catch {
    // 忽略（隐私模式）
  }
}
const toggled = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

/** 个人工作台（ADR-0015、REQ-KB-007）：空间目录 + 个人记录 + 各空间最近更新。 */
function PersonalHome({ space }: { space: Space }) {
  const { t } = useTranslation()
  const openNew = useNewEntry((s) => s.setOpen)
  const mine = useEntryList(space.id, {}, 8)
  useNewEntryContext({ spaceId: space.id, parentId: null })
  const all = useEntryList('', {}, 8)
  const quick = (kind: EntryKind, templateId?: string) => (
    <Button
      key={kind}
      size="sm"
      variant="ghost"
      className="group"
      onClick={() => openNew(true, { spaceId: space.id, kind, templateId, parentId: null })}
      data-testid={`kb-quick-${kind}`}
    >
      <KindIcon kind={kind} size="sm" />
      {t(`entry.kind.${kind}`)}
    </Button>
  )
  return (
    <section className="mx-auto max-w-[100rem]" data-testid="kb-home" data-personal>
      <KbHeader space={space} active="home" />
      <div className="mt-4 flex flex-wrap gap-1" data-testid="kb-quick">
        {[
          quick('journal'),
          quick('note', 'builtin:study-note'),
          quick('plan', 'builtin:learning-plan'),
        ]}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel
          title={t('kb.personal.dir')}
          icon={chip(FolderTree, 'green')}
          more={
            <Link to="/spaces" className="text-primary-text hover:underline">
              {t('kb.personal.manage')}
            </Link>
          }
          testId="kb-panel-dir"
          className="lg:col-span-3"
        >
          <SpaceDirectory />
        </Panel>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel
            title={t('kb.personal.mine')}
            icon={chip(UserRound, 'pink')}
            more={
              <Link
                to="/spaces/$spaceSlug/entries"
                params={{ spaceSlug: space.slug }}
                className="text-primary-text hover:underline"
              >
                {t('kb.viewAll')}
              </Link>
            }
            testId="kb-panel-mine"
          >
            <List items={mine.data} loading={mine.isPending} empty={t('kb.personal.emptyMine')} />
          </Panel>
          <Panel
            title={t('kb.personal.recentAll')}
            icon={chip(Clock, 'cyan')}
            more={
              <Link to="/entries" className="text-primary-text hover:underline">
                {t('kb.viewAll')}
              </Link>
            }
            testId="kb-panel-recent"
          >
            <List
              items={all.data}
              loading={all.isPending}
              empty={t('kb.empty.recent')}
              meta={(e) => <SpaceTag slug={e.spaceSlug} />}
            />
          </Panel>
        </div>
      </div>
    </section>
  )
}

/** 大类 → 空间 → 目录树：大类默认展开，空间默认收起（展开时才请求目录），展开状态本地保存。 */
function SpaceDirectory() {
  const { t } = useTranslation()
  const spaces = useQuery(spacesQuery())
  const groups = useQuery(spaceGroupsQuery)
  const sections = useMemo(
    () => groupSpaces(spaces.data ?? [], groups.data ?? []),
    [spaces.data, groups.data],
  )
  const [folds, setFolds] = useState(readHomeFolds)
  const update = (next: HomeFolds) => {
    setFolds(next)
    writeHomeFolds(next)
  }
  if (spaces.isPending || groups.isPending) return <Skeleton className="h-40 w-full" />
  if (!sections.length)
    return <p className="px-2 text-fg-muted text-sm">{t('kb.personal.noSpaces')}</p>
  return (
    <ul className="-mx-1 flex flex-col gap-1" data-testid="space-dir">
      {sections.map(({ group, items }) => {
        const gid = group?.id ?? 'none'
        const open = !folds.groups.includes(gid)
        const name = group?.name ?? t('space.ungrouped')
        const toggle = () => update({ ...folds, groups: toggled(folds.groups, gid) })
        return (
          <li key={gid} data-testid="space-dir-group" data-group-id={gid}>
            <div className="flex items-center">
              <button
                type="button"
                aria-expanded={open}
                aria-label={t(open ? 'entry.nav.collapse' : 'entry.nav.expand', { name })}
                onClick={toggle}
                className="xz-twisty size-6"
              >
                <Disclosure open={open} />
              </button>
              <button
                type="button"
                onClick={toggle}
                className="group flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-hover"
              >
                <IconChip icon={Layers} tone={group?.color ?? 'gray'} size="md" />
                <span className="xz-tree-l0 truncate text-sm">{name}</span>
                <span className="xz-tree-count" aria-hidden>
                  {items.length}
                </span>
              </button>
            </div>
            {!open ? null : items.length ? (
              <ul className="flex flex-col">
                {items.map((sp) => (
                  <DirSpaceRow
                    key={sp.id}
                    space={sp}
                    open={folds.spaces.includes(sp.id)}
                    onToggle={() => update({ ...folds, spaces: toggled(folds.spaces, sp.id) })}
                  />
                ))}
              </ul>
            ) : (
              <p
                className="relative py-1 text-fg-faint text-xs"
                style={{ paddingInlineStart: `${DIR_INDENT + 34}px` }}
              >
                <TreeGuides depth={1} x0={TWISTY_CENTER} indent={DIR_INDENT} />
                {t('kb.personal.emptyGroup')}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function DirSpaceRow({
  space,
  open,
  onToggle,
}: {
  space: Space
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const openNew = useNewEntry((s) => s.setOpen)
  return (
    <li className="relative" data-testid="space-dir-space" data-space-id={space.id}>
      <TreeGuides depth={1} x0={TWISTY_CENTER} indent={DIR_INDENT} />
      <div className="flex items-center py-px" style={{ paddingInlineStart: `${DIR_INDENT}px` }}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={t(open ? 'entry.nav.collapse' : 'entry.nav.expand', { name: space.name })}
          onClick={onToggle}
          className="xz-twisty size-6"
          data-testid="space-dir-toggle"
        >
          <Disclosure open={open} />
        </button>
        <Link
          to="/spaces/$spaceSlug/home"
          params={{ spaceSlug: space.slug }}
          className="group flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-hover"
        >
          <SpaceIcon icon={space.icon} kind={space.kind} color={space.color} className="size-6" />
          <span className="xz-tree-l1 truncate">{space.name}</span>
          <span className="shrink-0 text-fg-muted text-xs">{t(`space.kind.${space.kind}`)}</span>
          <ArrowUpRight
            className="ms-auto size-4 shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        </Link>
      </div>
      {open ? (
        <DirTree
          spaceId={space.id}
          level={2}
          indent={DIR_INDENT}
          testId="space-dir-tree"
          onNewChild={
            canCreateIn(space)
              ? (id) => openNew(true, { spaceId: space.id, parentId: id })
              : undefined
          }
          rowMenu={canCreateIn(space)}
        />
      ) : null}
    </li>
  )
}
