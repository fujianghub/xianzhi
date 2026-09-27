/**
 * 空间列表（08 §2.5、REQ-SPACE-001 · 004 · 008、REQ-KB-001 · 002）：个人空间 + 按大类分区的卡片（大类按顺序，「未分类」最后，
 * 空大类显示「在此新建」）；管理员可「管理大类」；归档折叠区（`?archived=1` 展开）。
 * 批量管理（ADR-0021、REQ-SPACE-010 · 011）：「批量管理」进入多选，卡片整卡可点选、Shift 连选、每个大类可「全选本组」，
 * 底部操作条归档 / 移到大类 / 删除；只可选本人管理的非个人空间；Esc 或「完成」退出。
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CheckSquare, FolderCog, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SpaceBatchBar } from '../components/domain/SpaceBatchBar.tsx'
import { SpaceCard, type SpaceSelection } from '../components/domain/SpaceCard.tsx'
import { SpaceGroupsDialog } from '../components/domain/SpaceGroupsDialog.tsx'
import { PALETTE_DOT, type PaletteName } from '../components/domain/SpaceIcon.tsx'
import { Button } from '../components/ui/button.tsx'
import { Disclosure } from '../components/ui/disclosure.tsx'
import { PageHeader } from '../components/ui/page-header.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { isAdmin, type Me } from '../hooks/useMe.ts'
import { groupSpaces, type Space, spaceGroupsQuery, useSpaces } from '../hooks/useSpaces.ts'
import { cn } from '../lib/cn.ts'
import { optOneOf } from '../lib/search.ts'
import { useCreateSpaceDialog } from '../lib/stores.ts'

export const Route = createFileRoute('/_app/spaces/')({
  validateSearch: (s: Record<string, unknown>): { archived?: '1' } => ({
    archived: optOneOf(['1'] as const)(s.archived),
  }),
  component: SpacesPage,
})

const GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'

/** 批量管理里可选的空间：本人是（有效）空间管理员，且不是个人空间 */
const selectable = (s: Space) => !s.isPersonal && s.myRole === 'admin'

function Grid({
  items,
  label,
  testId,
  selectionOf,
}: {
  items: Space[]
  label: string
  testId: string
  selectionOf?: (s: Space) => SpaceSelection
}) {
  return (
    <ul className={GRID} aria-label={label} data-testid={testId}>
      {items.map((s, i) => (
        <SpaceCard key={s.id} space={s} index={i} selection={selectionOf?.(s)} />
      ))}
    </ul>
  )
}

function SpacesPage() {
  const { t } = useTranslation()
  const { me } = Route.useRouteContext() as { me: Me }
  const { archived } = Route.useSearch()
  const nav = useNavigate({ from: '/spaces/' })
  const openCreate = useCreateSpaceDialog((s) => s.setOpen)
  const { data, isPending, isError, refetch } = useSpaces()
  const groups = useQuery(spaceGroupsQuery)
  const arch = useSpaces(true, archived === '1')
  const [manage, setManage] = useState(false)
  const personal = (data ?? []).filter((s) => s.isPersonal)
  const sections = useMemo(() => groupSpaces(data ?? [], groups.data ?? []), [data, groups.data])
  const canCreate = me.workspaceRole !== 'guest'
  const total = sections.reduce((n, s) => n + s.items.length, 0)

  // 批量管理：页面顺序（分区依次 + 展开的归档区）用于 Shift 连选与全选
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const anchor = useRef<string | null>(null)
  const ordered = useMemo(
    () => [...sections.flatMap((sec) => sec.items), ...(archived === '1' ? (arch.data ?? []) : [])],
    [sections, archived, arch.data],
  )
  const pickable = ordered.filter(selectable)
  const anySelectable = pickable.length > 0
  const exitSelecting = () => {
    setSelecting(false)
    setSelected([])
    anchor.current = null
  }
  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return
      setSelecting(false)
      setSelected([])
      anchor.current = null
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting])
  const selSet = new Set(selected)
  const toggle = (s: Space, e: React.MouseEvent) => {
    const on = !selSet.has(s.id)
    let ids = [s.id]
    if (e.shiftKey && anchor.current) {
      const a = pickable.findIndex((x) => x.id === anchor.current)
      const b = pickable.findIndex((x) => x.id === s.id)
      if (a >= 0 && b >= 0)
        ids = pickable.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id)
    }
    anchor.current = s.id
    setSelected((cur) =>
      on ? [...new Set([...cur, ...ids])] : cur.filter((id) => !ids.includes(id)),
    )
  }
  const selectionOf = selecting
    ? (s: Space): SpaceSelection => ({
        selected: selSet.has(s.id),
        selectable: selectable(s),
        onToggle: (e) => toggle(s, e),
      })
    : undefined
  const selectSection = (items: Space[]) => {
    const ids = items.filter(selectable).map((s) => s.id)
    const all = ids.every((id) => selSet.has(id))
    setSelected((cur) =>
      all ? cur.filter((id) => !ids.includes(id)) : [...new Set([...cur, ...ids])],
    )
  }

  return (
    <section className="mx-auto max-w-[96rem]" data-testid="spaces-page">
      <PageHeader
        title={t('ui.page.spaces')}
        actions={
          <div className="flex gap-2">
            {anySelectable || selecting ? (
              <Button
                size="sm"
                variant={selecting ? 'secondary' : 'ghost'}
                aria-pressed={selecting}
                onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
                data-testid="spaces-batch-toggle"
              >
                <CheckSquare className="size-4" />
                {t(selecting ? 'space.batch.exit' : 'space.batch.enter')}
              </Button>
            ) : null}
            {isAdmin(me) ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setManage(true)}
                data-testid="groups-manage"
              >
                <FolderCog className="size-4" />
                {t('space.groups.manage')}
              </Button>
            ) : null}
            {canCreate ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => openCreate(true, null)}
                data-testid="spaces-new"
              >
                <Plus className="size-4" />
                {t('space.newSpace')}
              </Button>
            ) : null}
          </div>
        }
      />

      {selecting ? (
        <p className="-mt-2 mb-4 text-fg-muted text-sm" data-testid="spaces-batch-hint">
          {t('space.batch.hint')}
        </p>
      ) : null}
      {isPending ? (
        <ul className={GRID} aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 骨架占位无身份
            <li key={i}>
              <Skeleton className="h-28 rounded-lg" />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <div className="paper rounded-lg p-6 text-center" role="alert">
          <p className="text-fg-muted text-sm">{t('space.loadError')}</p>
          <Button className="mt-3" onClick={() => refetch()}>
            {t('ui.action.retry')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {personal.length ? (
            <div>
              <h2 className="mb-3 font-medium text-fg-muted text-sm">{t('space.personal')}</h2>
              <Grid
                items={personal}
                label={t('space.personal')}
                testId="spaces-personal"
                selectionOf={selectionOf}
              />
            </div>
          ) : null}
          {total === 0 && !(groups.data ?? []).length ? (
            <div className="mx-auto mt-6 max-w-md text-center" data-testid="spaces-empty">
              <h2 className="font-semibold text-lg">{t('space.empty')}</h2>
              <p className="mt-2 text-fg-muted text-sm">{t('space.emptyHint')}</p>
            </div>
          ) : null}
          {sections.map((sec) => {
            const key = sec.group?.id ?? 'none'
            const name = sec.group?.name ?? t('space.ungrouped')
            return (
              <div key={key} data-testid="spaces-section" data-group-id={key}>
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={cn(
                      'size-2.5 rounded-full',
                      PALETTE_DOT[(sec.group?.color as PaletteName | null) ?? 'gray'],
                    )}
                    aria-hidden
                  />
                  <h2 className="font-medium text-sm">{name}</h2>
                  <span className="text-fg-muted text-xs">
                    {t('space.groups.count', { count: sec.items.length })}
                  </span>
                  {selecting && sec.items.some(selectable) ? (
                    <button
                      type="button"
                      className="ms-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-fg-muted text-xs hover:bg-hover hover:text-fg"
                      onClick={() => selectSection(sec.items)}
                      data-testid="spaces-select-section"
                    >
                      <CheckSquare className="size-3.5" />
                      {t('space.batch.selectSection')}
                    </button>
                  ) : null}
                  {canCreate && sec.group && !selecting ? (
                    <button
                      type="button"
                      className="ms-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-fg-muted text-xs hover:bg-hover hover:text-fg"
                      onClick={() => openCreate(true, sec.group?.id ?? null)}
                      data-testid="spaces-new-here"
                    >
                      <Plus className="size-3.5" />
                      {t('space.groups.newHere')}
                    </button>
                  ) : null}
                </div>
                {sec.items.length ? (
                  <Grid
                    items={sec.items}
                    label={name}
                    testId="spaces-grid"
                    selectionOf={selectionOf}
                  />
                ) : (
                  <p className="text-fg-muted text-sm">{t('space.empty')}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-10">
        <button
          type="button"
          className="flex items-center gap-1 font-medium text-fg-muted text-sm hover:text-fg"
          aria-expanded={archived === '1'}
          onClick={() => nav({ search: archived === '1' ? {} : { archived: '1' }, replace: true })}
          data-testid="spaces-archived-toggle"
        >
          <Disclosure open={archived === '1'} />
          {t('space.archived')}
        </button>
        {archived === '1' ? (
          <div className="mt-3">
            {arch.isPending ? (
              <Skeleton className="h-28 rounded-lg" />
            ) : arch.data?.length ? (
              <Grid
                items={arch.data}
                label={t('space.archived')}
                testId="spaces-archived"
                selectionOf={selectionOf}
              />
            ) : (
              <p className="text-fg-muted text-sm">{t('space.archivedEmpty')}</p>
            )}
          </div>
        ) : null}
      </div>
      {selecting ? (
        <SpaceBatchBar
          selected={selected}
          chosen={ordered.filter((s) => selSet.has(s.id))}
          setSelected={setSelected}
          onSelectAll={() => setSelected(pickable.map((s) => s.id))}
          canDelete={isAdmin(me)}
        />
      ) : null}
      <SpaceGroupsDialog open={manage} onOpenChange={setManage} />
    </section>
  )
}
