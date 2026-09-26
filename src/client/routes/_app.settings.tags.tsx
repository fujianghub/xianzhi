/**
 * 标签管理（ADR-0014、REQ-TAG-004 · 005 · 006）：新建（选色）· 改名 · 改色 · 合并到另一标签 · 删除 · 用量 · 查看记录。
 * 可管理 = 管理员或创建者（服务端 `can('tag.manage')`，列表每项带 canManage）；不可管理的行只读。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Merge, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ColorPicker } from '../components/domain/ColorPicker.tsx'
import { PALETTE_CLASS, type PaletteName } from '../components/domain/SpaceIcon.tsx'
import { tagsQuery } from '../components/domain/TagPicker.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog } from '../components/ui/confirm-dialog.tsx'
import { InlineEdit } from '../components/ui/inline-edit.tsx'
import { Input } from '../components/ui/input.tsx'
import { PageHeader } from '../components/ui/page-header.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { newId } from '../lib/uuid.ts'

export const Route = createFileRoute('/_app/settings/tags')({ component: TagsPage })

interface TagFull {
  id: string
  name: string
  color: string
  canManage: boolean
  usage: { entries: number; tasks: number }
}

function useTagMutations() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const done = () => {
    void qc.invalidateQueries({ queryKey: tagsQuery.queryKey })
    void qc.invalidateQueries({ queryKey: ['entries'] })
  }
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
  const create = useMutation({
    mutationFn: (v: { name: string; color: PaletteName }) =>
      unwrap<TagFull>(api.tags.$post({ json: v }, { headers: { 'idempotency-key': newId() } })),
    onSuccess: done,
    onError: fail,
  })
  const patch = useMutation({
    mutationFn: (v: { id: string; name?: string; color?: string }) =>
      unwrap<TagFull>(
        api.tags[':id'].$patch({
          param: { id: v.id },
          json: { name: v.name, color: v.color } as never,
        }),
      ),
    onSuccess: () => {
      toast.success(t('settings.tags.saved'))
      done()
    },
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap<void>(api.tags[':id'].$delete({ param: { id } })),
    onSuccess: () => {
      toast.success(t('settings.tags.deleted'))
      done()
    },
    onError: fail,
  })
  const merge = useMutation({
    mutationFn: (v: { id: string; intoId: string }) =>
      unwrap<TagFull>(
        api.tags[':id'].merge.$post({ param: { id: v.id }, json: { intoId: v.intoId } }),
      ),
    onSuccess: (r) => {
      toast.success(t('settings.tags.merged', { name: r.name }))
      done()
    },
    onError: fail,
  })
  return { create, patch, remove, merge }
}

function TagsPage() {
  const { t } = useTranslation()
  const q = useQuery(tagsQuery)
  const tags = (q.data ?? []) as TagFull[]
  const m = useTagMutations()
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState<PaletteName>('green')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    m.create.mutate({ name: name.trim(), color }, { onSuccess: () => setName('') })
  }
  const shown = tags.filter((x) => x.name.toLowerCase().includes(filter.trim().toLowerCase()))
  return (
    <div className="flex flex-col gap-6" data-testid="tags-page">
      <PageHeader title={t('settings.tags.title')} description={t('settings.tags.hint')} />
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <ColorPicker value={color} onChange={setColor} label={t('settings.tags.color')} />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.tags.newPlaceholder')}
          aria-label={t('settings.tags.new')}
          maxLength={40}
          className="h-9 w-64"
          data-testid="tag-new-name"
        />
        <Button type="submit" size="sm" loading={m.create.isPending} disabled={!name.trim()}>
          {t('settings.tags.new')}
        </Button>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('settings.tags.search')}
          aria-label={t('settings.tags.search')}
          className="ml-auto h-9 w-48"
        />
      </form>
      {q.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {!q.isPending && !tags.length ? (
        <p className="text-fg-muted text-sm">{t('settings.tags.empty')}</p>
      ) : null}
      <ul className="flex flex-col divide-y divide-divider rounded-xl border border-divider">
        {shown.map((tag) => (
          <TagRow key={tag.id} tag={tag} all={tags} m={m} />
        ))}
      </ul>
    </div>
  )
}

function TagRow({
  tag,
  all,
  m,
}: {
  tag: TagFull
  all: TagFull[]
  m: ReturnType<typeof useTagMutations>
}) {
  const { t } = useTranslation()
  const [mergeInto, setMergeInto] = useState<TagFull | null>(null)
  const [del, setDel] = useState(false)
  const ro = !tag.canManage
  return (
    <li
      className="flex flex-wrap items-center gap-3 px-3 py-2"
      data-testid="tag-row"
      data-tag-name={tag.name}
    >
      <ColorPicker
        value={tag.color as PaletteName}
        onChange={(c) => m.patch.mutate({ id: tag.id, color: c })}
        label={t('settings.tags.color')}
        disabled={ro}
      />
      <div className="min-w-40 flex-1">
        {ro ? (
          <span className="text-sm" title={t('settings.tags.readonly')}>
            {tag.name}
          </span>
        ) : (
          <InlineEdit
            value={tag.name}
            label={t('settings.tags.name')}
            onSave={(v) =>
              v.trim() && v.trim() !== tag.name
                ? m.patch.mutateAsync({ id: tag.id, name: v.trim() })
                : undefined
            }
            className="text-sm"
            testId="tag-name"
          />
        )}
      </div>
      <span className="text-fg-muted text-xs tabular-nums">
        {t('settings.tags.usage', { entries: tag.usage.entries, tasks: tag.usage.tasks })}
      </span>
      <Link
        to="/entries"
        search={{ tag: tag.name }}
        className="text-primary-text text-xs hover:underline"
      >
        {t('settings.tags.viewEntries')}
      </Link>
      {ro ? null : (
        <>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={t('settings.tags.merge')}
                aria-label={t('settings.tags.merge')}
                className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover"
                data-testid="tag-merge"
              >
                <Merge className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-64 w-52 overflow-y-auto p-1">
              {all
                .filter((x) => x.id !== tag.id)
                .map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => setMergeInto(x)}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover"
                    data-testid="tag-merge-target"
                  >
                    <span
                      aria-hidden
                      className={cn('size-3 rounded-full', PALETTE_CLASS[x.color as PaletteName])}
                    />
                    <span className="truncate">{x.name}</span>
                  </button>
                ))}
            </PopoverContent>
          </Popover>
          <button
            type="button"
            title={t('settings.tags.delete')}
            aria-label={t('settings.tags.delete')}
            onClick={() => setDel(true)}
            className="grid size-8 place-items-center rounded-md text-danger hover:bg-hover"
            data-testid="tag-delete"
          >
            <Trash2 className="size-4" />
          </button>
        </>
      )}
      <ConfirmDialog
        open={!!mergeInto}
        onOpenChange={(v) => !v && setMergeInto(null)}
        title={t('settings.tags.mergeTitle', { from: tag.name, to: mergeInto?.name ?? '' })}
        description={t('settings.tags.mergeBody', { from: tag.name, to: mergeInto?.name ?? '' })}
        confirmLabel={t('settings.tags.merge')}
        onConfirm={() =>
          mergeInto
            ? m.merge
                .mutateAsync({ id: tag.id, intoId: mergeInto.id })
                .then(() => setMergeInto(null))
            : undefined
        }
      />
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('settings.tags.deleteTitle', { name: tag.name })}
        description={t('settings.tags.deleteBody')}
        confirmLabel={t('settings.tags.delete')}
        onConfirm={() => m.remove.mutateAsync(tag.id).then(() => setDel(false))}
      />
    </li>
  )
}
