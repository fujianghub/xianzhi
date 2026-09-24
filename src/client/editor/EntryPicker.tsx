/** 记录选择器（03 §11.1「记录卡片 / 记录链接」）：按标题搜索当前可见记录；选中后回调。`[[` 触发（Phase 2）复用此组件。 */
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/command.tsx'
import { api, unwrap } from '../lib/api.ts'

interface Row {
  id: string
  title: string
  kind: string
}

export function EntryPicker({
  open,
  onOpenChange,
  excludeId,
  onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  excludeId?: string
  onPick: (e: Row) => void
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const { data } = useQuery({
    queryKey: ['entries', 'picker', q],
    queryFn: () =>
      unwrap<{ items: Row[] }>(
        api.entries.$get({ query: { limit: '10', ...(q.trim() ? { q: q.trim() } : {}) } as never }),
      ),
    enabled: open,
    staleTime: 10_000,
  })
  const rows = (data?.items ?? []).filter((r) => r.id !== excludeId)
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t('editor.pickEntry')}>
      <CommandInput
        value={q}
        onValueChange={setQ}
        placeholder={t('editor.pickEntryPlaceholder')}
        data-testid="entry-picker-input"
      />
      <CommandList>
        <CommandEmpty>{t('editor.slash.empty')}</CommandEmpty>
        {rows.map((r) => (
          <CommandItem
            key={r.id}
            value={`${r.title} ${r.id}`}
            onSelect={() => {
              onPick(r)
              onOpenChange(false)
            }}
          >
            <FileText className="size-4 text-fg-muted" />
            <span className="truncate">{r.title}</span>
            <span className="ml-auto text-fg-muted text-xs">{t(`entry.kind.${r.kind}`)}</span>
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
