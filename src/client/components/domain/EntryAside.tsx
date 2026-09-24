/**
 * 记录 Aside（04 §4、08 §2.9、T1-017）：`?aside=outline|backlinks|comments|props|history`。
 * 大纲：实时标题，点击跳转；属性：可见性、所在空间（移动，REQ-ENTRY-011）、标记版本（REQ-COLLAB-007）、作者与时间。
 * 反链 / 历史属 Phase 2（REQ-COLLAB-008 等），评论随 T1-023 接入。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import type { Entry } from '../../lib/entry-queries.ts'
import { spacesQuery } from '../../lib/space-queries.ts'
import { useCommentDraft, useOutline } from '../../lib/stores.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { RelativeTime } from '../ui/relative-time.tsx'
import { Comments } from './Comments.tsx'

export const ASIDE_TABS = ['outline', 'props', 'backlinks', 'comments', 'history'] as const
export type AsideTab = (typeof ASIDE_TABS)[number]

interface Snapshot {
  id: string
  label: string | null
  createdAt: string
}

export function EntryAside({
  entry,
  tab,
  onTab,
  canWrite,
  me,
}: {
  entry: Entry
  tab: AsideTab
  onTab: (t: AsideTab) => void
  canWrite: boolean
  me: { id: string; workspaceRole: string }
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4" data-testid="entry-aside">
      <div role="tablist" aria-label={t('ui.nav.views')} className="flex flex-wrap gap-1">
        {ASIDE_TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            data-testid={`aside-tab-${k}`}
            onClick={() => onTab(k)}
            className={cn(
              'h-7 rounded-full px-2.5 text-xs',
              tab === k ? 'bg-selected font-medium' : 'text-fg-muted hover:bg-hover',
            )}
          >
            {t(`entry.aside.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'outline' ? <Outline /> : null}
        {tab === 'props' ? <Props entry={entry} canWrite={canWrite} /> : null}
        {tab === 'comments' ? <EntryComments entry={entry} me={me} /> : null}
        {tab === 'backlinks' || tab === 'history' ? (
          <p className="text-fg-muted text-sm">{t('entry.aside.comingSoon')}</p>
        ) : null}
      </div>
    </div>
  )
}

function Outline() {
  const { t } = useTranslation()
  const items = useOutline((s) => s.items)
  const jump = useOutline((s) => s.jump)
  if (!items.length) return <p className="text-fg-muted text-sm">{t('entry.aside.outlineEmpty')}</p>
  return (
    <ol className="flex flex-col gap-0.5 text-sm" data-testid="outline">
      {items.map((h) => (
        <li key={h.pos} style={{ paddingInlineStart: `${(h.level - 1) * 12}px` }}>
          <button
            type="button"
            className="w-full truncate rounded px-1.5 py-1 text-left hover:bg-hover"
            onClick={() => jump?.(h.pos)}
          >
            {h.text || '…'}
          </button>
        </li>
      ))}
    </ol>
  )
}

function Props({ entry, canWrite }: { entry: Entry; canWrite: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const actions = useEntryActions()
  const spaces = useQuery(spacesQuery())
  const snaps = useQuery({
    queryKey: ['entry', entry.id, 'snapshots'],
    queryFn: () =>
      unwrap<{ items: Snapshot[] }>(api.entries[':id'].snapshots.$get({ param: { id: entry.id } })),
  })
  const [label, setLabel] = useState('')
  const mark = useMutation({
    mutationFn: (l: string) =>
      unwrap<Snapshot>(
        api.entries[':id'].snapshots.$post({ param: { id: entry.id }, json: { label: l } }),
      ),
    onSuccess: () => {
      toast.success(t('entry.aside.marked'))
      setLabel('')
      void qc.invalidateQueries({ queryKey: ['entry', entry.id, 'snapshots'] })
    },
    onError: () => toast.error(t('task.saveFailed')),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (label.trim()) mark.mutate(label.trim())
  }
  const current = spaces.data?.find((s) => s.id === entry.spaceId)
  const personal = !!current?.isPersonal
  const row = 'flex flex-col gap-1 text-sm'
  const labelCls = 'text-fg-muted text-xs'
  return (
    <div className="flex flex-col gap-4" data-testid="entry-props">
      <div className={row}>
        <span className={labelCls}>{t('entry.props.kind')}</span>
        <span>{t(`entry.kind.${entry.kind}`)}</span>
      </div>
      <label className={row}>
        <span className={labelCls}>{t('entry.props.visibility')}</span>
        <select
          value={entry.visibility}
          disabled={!canWrite || personal}
          data-testid="entry-visibility"
          onChange={(e) =>
            void actions.patch(entry, { visibility: e.target.value as Entry['visibility'] })
          }
          className="h-8 rounded-md border border-border bg-surface px-2"
        >
          {(['private', 'space', 'workspace'] as const).map((v) => (
            <option key={v} value={v}>
              {t(`entry.visibility.${v}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={row}>
        <span className={labelCls}>{t('entry.aside.moveSpace')}</span>
        <select
          value={entry.spaceId}
          disabled={!canWrite}
          data-testid="entry-space"
          onChange={(e) => {
            const target = spaces.data?.find((s) => s.id === e.target.value)
            if (!target) return
            void actions
              .patch(entry, {
                spaceId: target.id,
                // 个人空间只能 private；离开个人空间默认 space（REQ-ENTRY-003）
                ...(target.isPersonal
                  ? { visibility: 'private' as const }
                  : personal
                    ? { visibility: 'space' as const }
                    : {}),
              })
              .then(() =>
                toast.success(
                  t('entry.aside.moved', {
                    space: target.isPersonal ? t('space.personal') : target.name,
                  }),
                ),
              )
          }}
          className="h-8 rounded-md border border-border bg-surface px-2"
        >
          {(spaces.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.isPersonal ? t('space.personal') : s.name}
            </option>
          ))}
        </select>
      </label>
      <div className={row}>
        <span className={labelCls}>{t('entry.aside.author')}</span>
        <span>{entry.author.displayName}</span>
      </div>
      <div className={row}>
        <span className={labelCls}>{t('entry.aside.updatedAt')}</span>
        <RelativeTime date={entry.updatedAt} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className={row}>
          <span className={labelCls}>{t('entry.props.words')}</span>
          <span>{entry.wordCount ?? 0}</span>
        </div>
        <div className={row}>
          <span className={labelCls}>{t('entry.props.version')}</span>
          <span>{entry.ydocVersion}</span>
        </div>
      </div>
      {canWrite ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <span className={labelCls}>{t('entry.aside.markVersion')}</span>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('entry.aside.markVersionPlaceholder')}
            aria-label={t('entry.aside.markVersion')}
            maxLength={80}
            data-testid="snapshot-label"
          />
          <Button type="submit" size="sm" loading={mark.isPending} disabled={!label.trim()}>
            {t('entry.aside.markVersion')}
          </Button>
        </form>
      ) : null}
      {snaps.data?.items.some((s) => s.label) ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid="snapshot-list">
          {snaps.data.items
            .filter((s) => s.label)
            .map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{s.label}</span>
                <RelativeTime date={s.createdAt} className="shrink-0 text-fg-muted text-xs" />
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  )
}

function EntryComments({ entry, me }: { entry: Entry; me: { id: string; workspaceRole: string } }) {
  const pending = useCommentDraft((s) => s.pending)
  const setPending = useCommentDraft((s) => s.setPending)
  const removeMark = useCommentDraft((s) => s.removeMark)
  return (
    <Comments
      targetType="entry"
      targetId={entry.id}
      spaceId={entry.spaceId}
      me={me}
      pending={pending}
      onPendingDone={() => setPending(null)}
      onPendingCancel={(threadId) => {
        removeMark?.(threadId)
        setPending(null)
      }}
      canResolveAll={
        entry.authorId === me.id || me.workspaceRole === 'owner' || me.workspaceRole === 'admin'
      }
    />
  )
}
