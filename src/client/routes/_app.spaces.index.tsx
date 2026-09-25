/**
 * 分类列表（08 §2.5、REQ-SPACE-001 · 004 · 008、REQ-KB-001 · 002）：个人空间 + 按大类分区的卡片（大类按顺序，「其他」最后，
 * 空大类显示「在此新建」）；管理员可「管理大类」；归档折叠区（`?archived=1` 展开）。
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { FolderCog, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SpaceCard } from '../components/domain/SpaceCard.tsx'
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

function Grid({ items, label, testId }: { items: Space[]; label: string; testId: string }) {
  return (
    <ul className={GRID} aria-label={label} data-testid={testId}>
      {items.map((s, i) => (
        <SpaceCard key={s.id} space={s} index={i} />
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

  return (
    <section className="mx-auto max-w-[96rem]" data-testid="spaces-page">
      <PageHeader
        title={t('ui.page.spaces')}
        actions={
          <div className="flex gap-2">
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
              <Grid items={personal} label={t('space.personal')} testId="spaces-personal" />
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
                  {canCreate && sec.group ? (
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
                  <Grid items={sec.items} label={name} testId="spaces-grid" />
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
              <Grid items={arch.data} label={t('space.archived')} testId="spaces-archived" />
            ) : (
              <p className="text-fg-muted text-sm">{t('space.archivedEmpty')}</p>
            )}
          </div>
        ) : null}
      </div>
      <SpaceGroupsDialog open={manage} onOpenChange={setManage} />
    </section>
  )
}
