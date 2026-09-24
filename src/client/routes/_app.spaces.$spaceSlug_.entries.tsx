/** 空间记录列表（08 §2.8，`/spaces/$spaceSlug/entries`）：与任务页平级（不嵌套在任务视图里）。 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { EntriesPage, type EntriesSearch } from '../components/domain/EntriesPage.tsx'
import { SpaceIcon } from '../components/domain/SpaceIcon.tsx'
import { ApiError } from '../lib/api.ts'
import { validateEntriesSearch } from '../lib/search.ts'
import { spaceQuery } from '../lib/space-queries.ts'

export const Route = createFileRoute('/_app/spaces/$spaceSlug_/entries')({
  validateSearch: validateEntriesSearch,
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(spaceQuery(params.spaceSlug))
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 422)) throw notFound()
      throw err
    }
  },
  component: SpaceEntries,
})

function SpaceEntries() {
  const { t } = useTranslation()
  const { spaceSlug } = Route.useParams()
  const search = Route.useSearch()
  const nav = useNavigate({ from: '/spaces/$spaceSlug/entries' })
  const { data: space } = useQuery(spaceQuery(spaceSlug))
  const setSearch = useCallback(
    (patch: Partial<EntriesSearch>) =>
      void nav({ search: (s) => ({ ...s, ...patch }), replace: true }),
    [nav],
  )
  if (!space) return null
  return (
    <EntriesPage
      search={search}
      setSearch={setSearch}
      spaceId={space.id}
      title={space.isPersonal ? t('space.personal') : space.name}
      header={
        <>
          <SpaceIcon
            icon={space.icon}
            kind={space.kind}
            color={space.color}
            isPersonal={space.isPersonal}
            className="size-9 text-base"
          />
          <nav className="flex gap-1 text-sm" aria-label={t('ui.nav.views')}>
            <Link
              to="/spaces/$spaceSlug"
              params={{ spaceSlug }}
              className="rounded-full px-3 py-1 hover:bg-hover"
            >
              {t('task.tasks')}
            </Link>
            <span className="rounded-full bg-selected px-3 py-1 font-medium" aria-current="page">
              {t('ui.page.entries')}
            </span>
          </nav>
        </>
      }
    />
  )
}
