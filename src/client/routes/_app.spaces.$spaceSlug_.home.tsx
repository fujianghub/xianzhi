/**
 * 空间概览（ADR-0012、REQ-KB-003、08 §2.5b）：进入空间的默认页（侧栏 / 卡片链接到此）。
 * 按空间类型给出不同面板：
 * - project / work（产品开发）：未关闭 Bug（按严重度）· 最近迭代 · 最新版本 · 决策与优化 · 最近更新；
 * - learning（学习）：学习计划进度 · 最近笔记 · 最近更新。
 * 每个面板「查看全部」跳到记录页并带上类型 / 字段过滤与表格视图；快捷新建带好类型与内置模板。
 * 个人空间（ADR-0015、REQ-KB-007）换成个人工作台：「空间目录」（大类 → 空间 → 目录树，逐级展开、目录懒加载）
 * + 个人记录 + 各空间最近更新；快捷新建为随笔 / 笔记 / 计划。
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowUpRight, Clock, FolderTree, Layers, type LucideIcon, UserRound } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DirTree, TWISTY_CENTER } from '../components/domain/DirTree.tsx'
import { KbHeader } from '../components/domain/KbHeader.tsx'
import { IconChip, KindBadge, KindIcon } from '../components/domain/KindIcon.tsx'
import { SpaceIcon } from '../components/domain/SpaceIcon.tsx'
import { SpaceTag } from '../components/domain/SpaceTag.tsx'
import { Button } from '../components/ui/button.tsx'
import { Disclosure } from '../components/ui/disclosure.tsx'
import { RelativeTime } from '../components/ui/relative-time.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { TreeGuides } from '../components/ui/tree-guides.tsx'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import type { Entry, EntryKind, EntryPage } from '../lib/entry-queries.ts'
import {
  groupSpaces,
  type Space,
  spaceGroupsQuery,
  spaceQuery,
  spacesQuery,
} from '../lib/space-queries.ts'
import { useNewEntry } from '../lib/stores.ts'

export const Route = createFileRoute('/_app/spaces/$spaceSlug_/home')({
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

/** 严重度排序与色调（Bug 面板）。 */
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-red-bg text-red-fg',
  high: 'bg-orange-bg text-orange-fg',
  medium: 'bg-yellow-bg text-yellow-fg',
  low: 'bg-gray-bg text-gray-fg',
}

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
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-hover"
      >
        <KindBadge kind={e.kind} />
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

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
const chip = (icon: LucideIcon, tone: string) => <IconChip icon={icon} tone={tone} size="md" />

function KbHome() {
  const { spaceSlug } = Route.useParams()
  const { data: space } = useQuery(spaceQuery(spaceSlug))
  if (!space) return null
  return space.isPersonal ? <PersonalHome space={space} /> : <SpaceHome space={space} />
}

function SpaceHome({ space }: { space: Space }) {
  const { t } = useTranslation()
  const spaceSlug = space.slug
  const openNew = useNewEntry((s) => s.setOpen)
  const id = space.id
  const learning = space.kind === 'learning'
  const bugs = useEntryList(id, { kind: 'bug', fields: 'status=open' }, 100)
  const iterations = useEntryList(id, { kind: 'iteration', sort: '-createdAt' }, 3)
  const releases = useEntryList(id, { kind: 'changelog', sort: '-createdAt' }, 3)
  const decisions = useEntryList(id, { kind: 'decision,optimize' }, 5)
  const plans = useEntryList(id, { kind: 'plan' }, 20)
  const notes = useEntryList(id, { kind: 'note,journal,review' }, 6)
  const recent = useEntryList(id, {}, 8)

  const more = (query: Record<string, string>) => (
    <Link
      to="/spaces/$spaceSlug/entries"
      params={{ spaceSlug }}
      search={query}
      className="text-primary-text hover:underline"
    >
      {t('kb.viewAll')}
    </Link>
  )
  const quick = (kind: EntryKind, templateId?: string) => (
    <Button
      key={`${kind}-${templateId ?? ''}`}
      size="sm"
      variant="ghost"
      className="group"
      onClick={() => openNew(true, { spaceId: space.id, kind, templateId })}
      data-testid={`kb-quick-${kind}`}
    >
      <KindIcon kind={kind} size="sm" />
      {t(`entry.kind.${kind}`)}
    </Button>
  )
  const bySeverity = SEVERITIES.map((s) => ({
    s,
    n: (bugs.data ?? []).filter((e) => e.fields.severity === s).length,
  }))
  const topBugs = [...(bugs.data ?? [])]
    .sort(
      (a, b) =>
        SEVERITIES.indexOf(a.fields.severity as never) -
          SEVERITIES.indexOf(b.fields.severity as never) || b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 6)

  return (
    <section className="mx-auto max-w-[100rem]" data-testid="kb-home">
      <KbHeader space={space} active="home" />
      <div className="mt-4 flex flex-wrap gap-1" data-testid="kb-quick">
        {learning
          ? [
              quick('plan', 'builtin:learning-plan'),
              quick('note', 'builtin:study-note'),
              quick('journal', 'builtin:learning-weekly'),
            ]
          : [
              quick('bug', 'builtin:bug-fix'),
              quick('iteration'),
              quick('changelog'),
              quick('decision'),
              quick('optimize', 'builtin:product-optimize'),
            ]}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {learning ? (
          <>
            <Panel
              title={t('kb.panel.plans')}
              icon={<KindIcon kind="plan" />}
              count={plans.data?.length}
              more={more({ kind: 'plan', view: 'table' })}
              testId="kb-panel-plans"
            >
              {plans.isPending ? (
                <Skeleton className="h-20 w-full" />
              ) : plans.data?.length ? (
                <ul className="flex flex-col gap-3">
                  {plans.data.map((e) => {
                    const p = Math.max(0, Math.min(100, Number(e.fields.progress ?? 0)))
                    return (
                      <li key={e.id}>
                        <Link
                          to="/entries/$entryId"
                          params={{ entryId: e.id }}
                          className="block rounded-md px-2 py-1 hover:bg-hover"
                        >
                          <div className="flex items-center gap-2 text-sm">
                            <span className="min-w-0 flex-1 truncate">{e.title}</span>
                            <span className="text-fg-muted text-xs">
                              {t(`entry.fieldValue.${str(e.fields.status)}`, {
                                defaultValue: str(e.fields.status),
                              })}
                              {e.fields.endDate ? ` · ${str(e.fields.endDate)}` : ''}
                            </span>
                          </div>
                          <div
                            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"
                            role="progressbar"
                            aria-valuenow={p}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={e.title}
                          >
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${p}%` }}
                            />
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="px-2 text-fg-muted text-sm">{t('kb.empty.plans')}</p>
              )}
            </Panel>
            <Panel
              title={t('kb.panel.notes')}
              icon={<KindIcon kind="note" />}
              more={more({ kind: 'note,journal,review' })}
              testId="kb-panel-notes"
            >
              <List items={notes.data} loading={notes.isPending} empty={t('kb.empty.notes')} />
            </Panel>
          </>
        ) : (
          <>
            <Panel
              title={t('kb.panel.bugs')}
              icon={<KindIcon kind="bug" />}
              count={bugs.data?.length}
              more={more({ kind: 'bug', fields: 'status=open', view: 'table' })}
              testId="kb-panel-bugs"
            >
              <div className="flex flex-wrap gap-1.5" data-testid="kb-bug-severity">
                {bySeverity.map(({ s, n }) => (
                  <Link
                    key={s}
                    to="/spaces/$spaceSlug/entries"
                    params={{ spaceSlug }}
                    search={{ kind: 'bug', fields: `status=open,severity=${s}`, view: 'table' }}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs tabular-nums',
                      SEVERITY_TONE[s],
                    )}
                    data-severity={s}
                  >
                    {t(`entry.fieldValue.${s}`)} {n}
                  </Link>
                ))}
              </div>
              <List
                items={topBugs}
                loading={bugs.isPending}
                empty={t('kb.empty.bugs')}
                meta={(e) => (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 text-[11px]',
                      SEVERITY_TONE[str(e.fields.severity)],
                    )}
                  >
                    {t(`entry.fieldValue.${str(e.fields.severity)}`, { defaultValue: '' })}
                  </span>
                )}
              />
            </Panel>
            <Panel
              title={t('kb.panel.iterations')}
              icon={<KindIcon kind="iteration" />}
              more={more({ kind: 'iteration', view: 'table' })}
              testId="kb-panel-iterations"
            >
              <List
                items={iterations.data}
                loading={iterations.isPending}
                empty={t('kb.empty.iterations')}
                meta={(e) => (
                  <span className="shrink-0 text-fg-muted text-xs">
                    {[
                      str(e.fields.version),
                      [str(e.fields.periodStart), str(e.fields.periodEnd)]
                        .filter(Boolean)
                        .join(' ~ '),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              />
            </Panel>
            <Panel
              title={t('kb.panel.releases')}
              icon={<KindIcon kind="changelog" />}
              more={more({ kind: 'changelog', view: 'table' })}
              testId="kb-panel-releases"
            >
              <List
                items={releases.data}
                loading={releases.isPending}
                empty={t('kb.empty.releases')}
                meta={(e) => (
                  <span className="shrink-0 font-mono text-fg-muted text-xs">
                    {[str(e.fields.version), str(e.fields.releasedAt)].filter(Boolean).join(' · ')}
                  </span>
                )}
              />
            </Panel>
            <Panel
              title={t('kb.panel.decisions')}
              icon={<KindIcon kind="decision" />}
              more={more({ kind: 'decision,optimize', view: 'table' })}
              testId="kb-panel-decisions"
            >
              <List
                items={decisions.data}
                loading={decisions.isPending}
                empty={t('kb.empty.decisions')}
                meta={(e) => (
                  <span className="shrink-0 text-fg-muted text-xs">
                    {t(`entry.fieldValue.${str(e.fields.status)}`, {
                      defaultValue: str(e.fields.status),
                    })}
                  </span>
                )}
              />
            </Panel>
          </>
        )}
        <Panel
          title={t('kb.panel.recent')}
          icon={chip(Clock, 'green')}
          more={more({})}
          testId="kb-panel-recent"
        >
          <List items={recent.data} loading={recent.isPending} empty={t('kb.empty.recent')} />
        </Panel>
      </div>
    </section>
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
  const all = useEntryList('', {}, 8)
  const quick = (kind: EntryKind, templateId?: string) => (
    <Button
      key={kind}
      size="sm"
      variant="ghost"
      className="group"
      onClick={() => openNew(true, { spaceId: space.id, kind, templateId })}
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
        <DirTree spaceId={space.id} level={2} indent={DIR_INDENT} testId="space-dir-tree" />
      ) : null}
    </li>
  )
}
