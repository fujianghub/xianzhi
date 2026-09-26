/**
 * 记录「关联」页签（ADR-0012 §4、REQ-LINK-002 · 003 · 005）：
 * - 迭代 / 变更：「本期修复的 Bug」= 本记录 → Bug 的 `resolves` 出链，可「关联 Bug」；
 * - Bug：「修复于」= 迭代 / 变更 → 本 Bug 的 `resolves` 反链，可「标记修复于…」（链接建在迭代上，需对其可写）；
 * - 关联：其余手动出链（相关 / 阻塞 / 起因于 / 解决），可增删；
 * - 反链：所有指向本记录的链接（含正文里的引用 mentions），读不到的来源已被服务端过滤。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { LinkView } from '../../../server/services/links.ts'
import { LINK_KINDS, type LinkKind } from '../../../shared/schemas/enums.ts'
import { EntryPicker } from '../../editor/EntryPicker.tsx'
import { ApiError, api, unwrap } from '../../lib/api.ts'
import type { Entry } from '../../lib/entry-queries.ts'
import { newId } from '../../lib/uuid.ts'
import { Button } from '../ui/button.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { KindBadge } from './KindIcon.tsx'

const MANUAL_KINDS = LINK_KINDS.filter((k) => k !== 'mentions')

export function EntryRelations({ entry, canWrite }: { entry: Entry; canWrite: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const outQ = useQuery({
    queryKey: ['links', 'out', entry.id],
    queryFn: () =>
      unwrap<{ items: LinkView[] }>(
        api.links.$get({ query: { fromType: 'entry', fromId: entry.id } }),
      ).then((r) => r.items),
  })
  const backQ = useQuery({
    queryKey: ['links', 'back', entry.id],
    queryFn: () =>
      unwrap<{ items: LinkView[] }>(
        api.entries[':id'].backlinks.$get({ param: { id: entry.id } }),
      ).then((r) => r.items),
  })
  const [picker, setPicker] = useState<null | { mode: 'resolves-out' | 'resolves-in' | 'manual' }>(
    null,
  )
  const [manualKind, setManualKind] = useState<LinkKind>('relates')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['links'] })
  const onError = (err: unknown) =>
    toast.error(
      err instanceof ApiError
        ? t(`errors.${err.code}`, { defaultValue: err.message })
        : t('task.saveFailed'),
    )
  const add = useMutation({
    mutationFn: (v: { fromId: string; toId: string; kind: LinkKind }) =>
      unwrap<LinkView>(
        api.links.$post(
          {
            json: {
              fromType: 'entry',
              fromId: v.fromId,
              toType: 'entry',
              toId: v.toId,
              kind: v.kind,
            },
          },
          { headers: { 'idempotency-key': newId() } },
        ),
      ),
    onSuccess: refresh,
    onError,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.links[':id'].$delete({ param: { id } })),
    onSuccess: refresh,
    onError,
  })
  const out = outQ.data ?? []
  const back = backQ.data ?? []
  const isRelease = entry.kind === 'iteration' || entry.kind === 'changelog'
  const fixedBugs = out.filter((l) => l.kind === 'resolves' && l.to.kind === 'bug')
  const fixedIn = back.filter(
    (l) => l.kind === 'resolves' && (l.from.kind === 'iteration' || l.from.kind === 'changelog'),
  )
  const manual = out.filter((l) => l.kind !== 'mentions' && !fixedBugs.includes(l))

  const row = (l: LinkView, side: 'to' | 'from', removable: boolean, label?: string) => {
    const end = l[side]
    return (
      <li
        key={`${l.id}-${side}`}
        className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-hover"
        data-testid="relation-row"
        data-link-kind={l.kind}
      >
        {label ? <span className="shrink-0 text-[11px] text-fg-faint">{label}</span> : null}
        {end.kind && end.type === 'entry' ? (
          <KindBadge kind={end.kind} className="shrink-0" />
        ) : null}
        {end.type === 'entry' && end.id ? (
          <Link
            to="/entries/$entryId"
            params={{ entryId: end.id }}
            className="min-w-0 flex-1 truncate hover:text-primary-text"
          >
            {end.title || t('entry.untitled')}
          </Link>
        ) : end.type === 'task' && end.id && end.spaceSlug ? (
          <Link
            to="/spaces/$spaceSlug/tasks/$taskId"
            params={{ spaceSlug: end.spaceSlug, taskId: end.id }}
            className="min-w-0 flex-1 truncate hover:text-primary-text"
          >
            {end.title}
          </Link>
        ) : (
          <a
            href={end.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate"
          >
            {end.title}
          </a>
        )}
        {end.kind === 'bug' || end.fields?.severity ? (
          <span className="shrink-0 text-fg-muted text-xs">
            {t(`entry.fieldValue.${String(end.fields?.status ?? '')}`, { defaultValue: '' })}
          </span>
        ) : null}
        {removable && canWrite && l.kind !== 'mentions' ? (
          <button
            type="button"
            className="grid size-6 place-items-center rounded text-fg-muted opacity-0 hover:bg-active hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={t('link.remove')}
            onClick={() => remove.mutate(l.id)}
            data-testid="relation-remove"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </li>
    )
  }
  const section = (
    title: string,
    body: React.ReactNode,
    action?: React.ReactNode,
    testId?: string,
  ) => (
    <section className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex items-center gap-2">
        <h3 className="text-fg-muted text-xs">{title}</h3>
        <div className="ms-auto">{action}</div>
      </div>
      {body}
    </section>
  )
  const empty = (s: string) => <p className="px-1.5 text-fg-faint text-xs">{s}</p>

  if (outQ.isPending || backQ.isPending) return <Skeleton className="h-24 w-full" />
  return (
    <div className="flex flex-col gap-5" data-testid="entry-relations">
      {isRelease
        ? section(
            t('link.fixedBugs'),
            fixedBugs.length ? (
              <ul>{fixedBugs.map((l) => row(l, 'to', true))}</ul>
            ) : (
              empty(t('link.none'))
            ),
            canWrite ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPicker({ mode: 'resolves-out' })}
                data-testid="link-add-bug"
              >
                <Plus className="size-4" />
                {t('link.addBug')}
              </Button>
            ) : null,
            'relations-fixed-bugs',
          )
        : null}
      {entry.kind === 'bug'
        ? section(
            t('link.fixedIn'),
            fixedIn.length ? (
              <ul>{fixedIn.map((l) => row(l, 'from', true))}</ul>
            ) : (
              empty(t('link.notFixedYet'))
            ),
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPicker({ mode: 'resolves-in' })}
              data-testid="link-fixed-in"
            >
              <Plus className="size-4" />
              {t('link.markFixedIn')}
            </Button>,
            'relations-fixed-in',
          )
        : null}
      {section(
        t('link.related'),
        manual.length ? (
          <ul>{manual.map((l) => row(l, 'to', true, t(`link.kind.${l.kind}`)))}</ul>
        ) : (
          empty(t('link.none'))
        ),
        canWrite ? (
          <div className="flex items-center gap-1">
            <select
              value={manualKind}
              onChange={(e) => setManualKind(e.target.value as LinkKind)}
              aria-label={t('link.kindLabel')}
              className="h-7 rounded-md border border-border bg-surface px-1 text-xs"
            >
              {MANUAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`link.kind.${k}`)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPicker({ mode: 'manual' })}
              data-testid="link-add"
            >
              <Plus className="size-4" />
              {t('link.add')}
            </Button>
          </div>
        ) : null,
        'relations-manual',
      )}
      {section(
        t('link.backlinks'),
        back.length ? (
          <ul>{back.map((l) => row(l, 'from', false, t(`link.back.${l.kind}`)))}</ul>
        ) : (
          empty(t('link.noBacklinks'))
        ),
        undefined,
        'relations-backlinks',
      )}
      <EntryPicker
        open={!!picker}
        onOpenChange={(v) => !v && setPicker(null)}
        excludeId={entry.id}
        kind={
          picker?.mode === 'resolves-out'
            ? 'bug'
            : picker?.mode === 'resolves-in'
              ? 'iteration,changelog'
              : undefined
        }
        onPick={(e) => {
          const mode = picker?.mode
          setPicker(null)
          if (mode === 'resolves-out')
            add.mutate({ fromId: entry.id, toId: e.id, kind: 'resolves' })
          else if (mode === 'resolves-in')
            add.mutate({ fromId: e.id, toId: entry.id, kind: 'resolves' })
          else add.mutate({ fromId: entry.id, toId: e.id, kind: manualKind })
        }}
      />
    </div>
  )
}
