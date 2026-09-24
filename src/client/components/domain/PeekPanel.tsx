/**
 * Peek 预览（04 §6、T1-030、REQ-UI-007）：右侧非 modal Sheet（宽 480、无 Scrim、不抢焦点、不锁滚动），不改 URL；
 * Esc 关闭；Enter 升级为完整详情（此时才改 URL）。任务复用 `GET /tasks/:id`（Query 缓存），记录用 `GET /entries/:id/preview`。
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { PmNode } from '../../../shared/schemas/pm.ts'
import { api, unwrap } from '../../lib/api.ts'
import { type PeekTarget, usePeek } from '../../lib/stores.ts'
import { taskQuery } from '../../lib/task-queries.ts'
import { dueLabel } from '../../lib/time.ts'
import { Button } from '../ui/button.tsx'
import { RelativeTime, useUserTimeZone } from '../ui/relative-time.tsx'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { PriorityIcon } from './PriorityIcon.tsx'

const plainOf = (n: PmNode | null | undefined): string =>
  !n
    ? ''
    : n.type === 'text'
      ? (n.text ?? '')
      : (n.content ?? []).map(plainOf).join(n.type === 'paragraph' ? '\n' : '')

const editable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

export default function PeekPanel() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { target, close } = usePeek()

  const upgrade = (p: PeekTarget) => {
    close()
    if (p.kind === 'task')
      void nav({
        to: '/spaces/$spaceSlug/tasks/$taskId',
        params: { spaceSlug: p.spaceSlug, taskId: p.id },
      })
    else void nav({ to: '/entries/$entryId', params: { entryId: p.id } })
  }
  // Enter 升级：捕获阶段先于列表自身的 Enter（悬停打开时焦点行可能不是被预览的对象）
  useEffect(() => {
    if (!target) return
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.isComposing || editable(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      upgrade(target)
    }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  })

  return (
    <Sheet modal={false} open={!!target} onOpenChange={(v) => !v && close()}>
      <SheetContent modal={false} data-testid="peek-panel" className="w-[min(100vw,30rem)]">
        {target?.kind === 'task' ? <TaskPeek id={target.id} /> : null}
        {target?.kind === 'entry' ? <EntryPeek id={target.id} /> : null}
        {target ? (
          <div className="mt-6 flex items-center gap-2 text-fg-muted text-xs">
            <Button
              size="sm"
              variant="primary"
              onClick={() => upgrade(target)}
              data-testid="peek-open"
            >
              {t('peek.open')}
            </Button>
            <span>{t('peek.hint')}</span>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function TaskPeek({ id }: { id: string }) {
  const { t } = useTranslation()
  const { tz, locale } = useUserTimeZone()
  const { data: task, isPending } = useQuery(taskQuery(id))
  if (isPending || !task)
    return (
      <>
        <SheetTitle className="sr-only">{t('peek.title')}</SheetTitle>
        <Skeleton className="h-40 w-full" />
      </>
    )
  const desc = plainOf(task.descriptionPm as PmNode | null)
  return (
    <>
      <p className="text-fg-muted text-xs">{task.spaceSlug}</p>
      <SheetTitle className="mt-1 pr-8">{task.title}</SheetTitle>
      <SheetDescription className="sr-only">{t('peek.title')}</SheetDescription>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-fg-muted text-xs">{t('task.statusLabel')}</dt>
          <dd>{t(`task.status.${task.status}`)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted text-xs">{t('task.priorityLabel')}</dt>
          <dd className="flex items-center gap-1.5">
            <PriorityIcon priority={task.priority} />
            {t(`task.priority.${task.priority}`)}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted text-xs">{t('task.dueAt')}</dt>
          <dd>{task.dueAt ? dueLabel(new Date(task.dueAt), new Date(), locale, tz) : '—'}</dd>
        </div>
        <div>
          <dt className="text-fg-muted text-xs">{t('task.assignee')}</dt>
          <dd>{task.assignee?.displayName ?? t('task.unassigned')}</dd>
        </div>
      </dl>
      {desc ? <p className="mt-4 line-clamp-[12] whitespace-pre-line text-sm">{desc}</p> : null}
    </>
  )
}

interface Preview {
  title: string
  kind: string
  excerpt: string
  author: { displayName: string }
  updatedAt?: string
}
function EntryPeek({ id }: { id: string }) {
  const { t } = useTranslation()
  const { data, isPending } = useQuery({
    queryKey: ['entry', id, 'preview'],
    queryFn: () => unwrap<Preview>(api.entries[':id'].preview.$get({ param: { id } })),
    staleTime: 60_000,
  })
  if (isPending || !data)
    return (
      <>
        <SheetTitle className="sr-only">{t('peek.title')}</SheetTitle>
        <Skeleton className="h-40 w-full" />
      </>
    )
  return (
    <>
      <p className="text-fg-muted text-xs">
        {t(`entry.kind.${data.kind}`)} · {data.author.displayName}
        {data.updatedAt ? (
          <>
            {' · '}
            <RelativeTime date={data.updatedAt} />
          </>
        ) : null}
      </p>
      <SheetTitle className="mt-1 pr-8">{data.title}</SheetTitle>
      <SheetDescription className="sr-only">{t('peek.title')}</SheetDescription>
      {data.excerpt ? <p className="mt-4 whitespace-pre-line text-sm">{data.excerpt}</p> : null}
    </>
  )
}
