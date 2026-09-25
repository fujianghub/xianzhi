/** 分类记录（08 §2.8，`/spaces/$spaceSlug/entries`；ADR-0012 类型视图）：与任务页平级（不嵌套在任务视图里）。 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { EntriesPage, type EntriesSearch } from '../components/domain/EntriesPage.tsx'
import { KbHeader } from '../components/domain/KbHeader.tsx'
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
    <div className="mx-auto max-w-[100rem]">
      <KbHeader space={space} active="entries" />
      <div className="mt-4">
        <EntriesPage
          search={search}
          setSearch={setSearch}
          spaceId={space.id}
          title={space.isPersonal ? t('space.personal') : space.name}
          hideTitle
        />
      </div>
    </div>
  )
}
