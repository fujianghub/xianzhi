/** 全部记录（08 §2.8；跨空间 + 个人）。 */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { EntriesPage, type EntriesSearch } from '../components/domain/EntriesPage.tsx'
import { validateEntriesSearch } from '../lib/search.ts'

export const Route = createFileRoute('/_app/entries/')({
  validateSearch: validateEntriesSearch,
  component: AllEntries,
})

function AllEntries() {
  const { t } = useTranslation()
  const search = Route.useSearch()
  const nav = useNavigate({ from: '/entries/' })
  const setSearch = useCallback(
    (patch: Partial<EntriesSearch>) =>
      void nav({ search: (s) => ({ ...s, ...patch }), replace: true }),
    [nav],
  )
  return <EntriesPage search={search} setSearch={setSearch} title={t('entry.all')} />
}
