/**
 * 记录选择器（03 §11.1「记录卡片 / 记录链接」）：按标题搜索当前可见记录；选中后回调。`[[` 触发（Phase 2）复用此组件。
 * ADR-0019（REQ-EDITOR-023）：
 * - `preferSpaceId`：先查当前空间、再查全部，合并去重，当前空间的排在前面；
 * - `onCreate`（仅编辑器传）：有输入且结果已到齐、没有同名记录时，末尾出现「新建《q》」，建好后按选中处理。
 */
import { useQuery } from '@tanstack/react-query'
import { FilePlus2, FileText } from 'lucide-react'
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
import { useKindLabel } from '../lib/entry-types.ts'

export interface PickerRow {
  id: string
  title: string
  kind: string
  typeId?: string | null
}

export function EntryPicker({
  open,
  onOpenChange,
  excludeId,
  onPick,
  kind,
  preferSpaceId,
  onCreate,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  excludeId?: string
  onPick: (e: PickerRow) => void
  /** 只列这些类型（逗号分隔，ADR-0012 关联面板） */
  kind?: string
  /** 当前空间优先（ADR-0019） */
  preferSpaceId?: string
  /** 找不到时新建（ADR-0019，编辑器 `[[` 用）：返回新记录 */
  onCreate?: (title: string) => Promise<PickerRow>
}) {
  const { t } = useTranslation()
  const kindLabel = useKindLabel()
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const search = (spaceId?: string) => ({
    queryKey: ['entries', 'picker', q, kind ?? '', spaceId ?? ''],
    queryFn: () =>
      unwrap<{ items: PickerRow[] }>(
        api.entries.$get({
          query: {
            limit: '10',
            ...(q.trim() ? { q: q.trim() } : {}),
            ...(kind ? { kind } : {}),
            ...(spaceId ? { spaceId } : {}),
          } as never,
        }),
      ),
    staleTime: 10_000,
  })
  const local = useQuery({ ...search(preferSpaceId), enabled: open && !!preferSpaceId })
  const all = useQuery({ ...search(), enabled: open })
  const seen = new Set<string>()
  const rows = [...(local.data?.items ?? []), ...(all.data?.items ?? [])].filter((r) => {
    if (r.id === excludeId || seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })
  const title = q.trim()
  // 结果到齐（当前输入对应的请求都不在途）且没有同名记录，才给「新建」——避免加载中回车重复创建
  const settled = !all.isFetching && (!preferSpaceId || !local.isFetching)
  const canCreate = !!onCreate && !!title && settled && !rows.some((r) => r.title.trim() === title)
  const create = async () => {
    if (!onCreate || creating) return
    setCreating(true)
    try {
      const r = await onCreate(title)
      onPick(r)
      onOpenChange(false)
      setQ('')
    } finally {
      setCreating(false)
    }
  }
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t('editor.pickEntry')}>
      <CommandInput
        value={q}
        onValueChange={setQ}
        placeholder={t('editor.pickEntryPlaceholder')}
        data-testid="entry-picker-input"
      />
      <CommandList>
        {canCreate ? null : <CommandEmpty>{t('editor.slash.empty')}</CommandEmpty>}
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
            <span className="ml-auto text-fg-muted text-xs">
              {kindLabel(r.kind ?? 'note', r.typeId).label}
            </span>
          </CommandItem>
        ))}
        {canCreate ? (
          <CommandItem
            value={`__create__ ${title}`}
            disabled={creating}
            onSelect={() => void create()}
            data-testid="entry-picker-create"
          >
            <FilePlus2 className="size-4 text-primary-text" />
            <span className="truncate">{t('editor.pickCreate', { title })}</span>
          </CommandItem>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
