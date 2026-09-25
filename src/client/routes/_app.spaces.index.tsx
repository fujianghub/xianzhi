/** 空间列表（08 §2.5、REQ-SPACE-001 · 004 · 005 · 008）：我的空间 / 其他可见空间 / 归档折叠区（`?archived=1` 展开）。 */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SpaceCard } from '../components/domain/SpaceCard.tsx'
import { Button } from '../components/ui/button.tsx'
import { Disclosure } from '../components/ui/disclosure.tsx'
import { PageHeader } from '../components/ui/page-header.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import type { Me } from '../hooks/useMe.ts'
import { type Space, useSpaces } from '../hooks/useSpaces.ts'
import { optOneOf } from '../lib/search.ts'
import { useCreateSpaceDialog } from '../lib/stores.ts'

export const Route = createFileRoute('/_app/spaces/')({
  validateSearch: (s: Record<string, unknown>): { archived?: '1' } => ({
    archived: optOneOf(['1'] as const)(s.archived),
  }),
  component: SpacesPage,
})

function Grid({ items, label, testId }: { items: Space[]; label: string; testId: string }) {
  return (
    <ul
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      aria-label={label}
      data-testid={testId}
    >
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
  const arch = useSpaces(true, archived === '1')
  const mine = (data ?? []).filter((s) => s.isMember)
  const others = (data ?? []).filter((s) => !s.isMember)
  const canCreate = me.workspaceRole !== 'guest'

  return (
    <section className="mx-auto max-w-5xl" data-testid="spaces-page">
      <PageHeader
        title={t('ui.page.spaces')}
        actions={
          canCreate ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => openCreate(true)}
              data-testid="spaces-new"
            >
              <Plus className="size-4" />
              {t('space.newSpace')}
            </Button>
          ) : null
        }
      />

      {isPending ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
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
      ) : mine.length + others.length === 0 ? (
        <div className="mx-auto mt-12 max-w-md text-center" data-testid="spaces-empty">
          <h2 className="font-semibold text-lg">{t('space.empty')}</h2>
          <p className="mt-2 text-fg-muted text-sm">{t('space.emptyHint')}</p>
          {canCreate ? (
            <Button variant="primary" className="mt-5" onClick={() => openCreate(true)}>
              {t('space.newSpace')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {mine.length ? (
            <div>
              <h2 className="mb-3 font-medium text-fg-muted text-sm">{t('space.mine')}</h2>
              <Grid items={mine} label={t('space.mine')} testId="spaces-mine" />
            </div>
          ) : null}
          {others.length ? (
            <div>
              <h2 className="mb-3 font-medium text-fg-muted text-sm">{t('space.others')}</h2>
              <Grid items={others} label={t('space.others')} testId="spaces-others" />
            </div>
          ) : null}
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
    </section>
  )
}
