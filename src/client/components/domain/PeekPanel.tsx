/**
 * Peek 预览（04 §6、T1-030、REQ-UI-007）：右侧非 modal Sheet（宽 480、无 Scrim、不抢焦点、不锁滚动），不改 URL；
 * Esc 关闭；Enter 升级为完整详情（此时才改 URL）。任务复用 `GET /tasks/:id`（Query 缓存），记录用 `GET /entries/:id/preview`。
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  AlignLeft,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Circle,
  CornerLeftUp,
  Flag,
  ListChecks,
  ListTodo,
  type LucideIcon,
  Tag as TagIcon,
  Timer,
  UserRound,
} from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { PmNode } from '../../../shared/schemas/pm.ts'
import { api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { useKindLabel } from '../../lib/entry-types.ts'
import { type PeekTarget, usePeek } from '../../lib/stores.ts'
import { dueTone } from '../../lib/task-groups.ts'
import { flattenPages, taskQuery, tasksInfiniteQuery } from '../../lib/task-queries.ts'
import { dueLabel } from '../../lib/time.ts'
import { Button } from '../ui/button.tsx'
import { RelativeTime, useUserTimeZone } from '../ui/relative-time.tsx'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { PmView } from './PmView.tsx'
import { PriorityIcon } from './PriorityIcon.tsx'
import { PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'
import { SpaceTag } from './SpaceTag.tsx'
import { ListDot } from './TaskListDot.tsx'

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

/** Peek 属性行：图标 + 名称 + 值（空值显示「—」，ADR-0050：预览显示全部属性） */
function Prop({
  icon: Icon,
  label,
  children,
  wide,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn('flex min-w-0 items-start gap-2 py-1', wide && 'col-span-2')}>
      <dt className="flex w-16 shrink-0 items-center gap-1.5 pt-px text-fg-muted text-xs">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm">
        {children ?? <span className="text-fg-faint">—</span>}
      </dd>
    </div>
  )
}

/**
 * 任务预览（ADR-0050）：任务本身内容不多，预览就把它全部摊开——
 * 空间 · 状态 → 标题（父任务）→ 全部属性 → 完整描述（不截断）→ 子任务 → 创建 / 更新 / 完成时间。
 */
function TaskPeek({ id }: { id: string }) {
  const { t } = useTranslation()
  const { tz, locale } = useUserTimeZone()
  const { data: task, isPending } = useQuery(taskQuery(id))
  const parent = useQuery({ ...taskQuery(task?.parentId ?? ''), enabled: !!task?.parentId })
  // 与详情同一查询键：打开详情时子任务已在缓存里
  const subs = useInfiniteQuery({
    ...tasksInfiniteQuery({ parentId: id, sort: 'createdAt' }, 50),
    enabled: !!task && !task.parentId,
  })
  if (isPending || !task)
    return (
      <>
        <SheetTitle className="sr-only">{t('peek.title')}</SheetTitle>
        <Skeleton className="h-40 w-full" />
      </>
    )
  const subtasks = flattenPages(subs.data)
  const subDone = subtasks.filter((x) => x.status === 'done').length
  const when = (iso: string | null) =>
    iso ? dueLabel(new Date(iso), new Date(), locale, tz) : null
  return (
    <article className="flex flex-col gap-4" data-testid="task-peek">
      <header className="flex flex-col gap-2 pe-8">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <SpaceTag slug={task.spaceSlug} />
          <span className="xz-peek-status" data-status={task.status}>
            {t(`task.status.${task.status}`)}
          </span>
        </div>
        <SheetTitle
          className={cn(
            'text-pretty font-semibold text-lg leading-snug',
            task.status === 'done' && 'text-fg-muted line-through',
          )}
        >
          {task.title}
        </SheetTitle>
        {task.parentId ? (
          <p className="flex min-w-0 items-center gap-1 text-fg-muted text-xs">
            <CornerLeftUp className="size-3.5 shrink-0" aria-hidden />
            {t('peek.parent')}
            <span className="truncate text-fg">{parent.data?.title ?? '…'}</span>
          </p>
        ) : null}
        <SheetDescription className="sr-only">{t('peek.title')}</SheetDescription>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 rounded-lg bg-surface-2 px-3 py-2">
        <Prop icon={Flag} label={t('task.priorityLabel')}>
          {task.priority ? (
            <span className="flex items-center gap-1.5">
              <PriorityIcon priority={task.priority} />
              {t(`task.priority.${task.priority}`)}
            </span>
          ) : null}
        </Prop>
        <Prop icon={UserRound} label={t('task.assignee')}>
          {task.assignee?.displayName ?? null}
        </Prop>
        <Prop icon={CalendarDays} label={t('task.dueAt')}>
          {task.dueAt ? (
            <span
              className="xz-due"
              data-tone={task.status === 'done' ? 'done' : dueTone(task.dueAt, tz)}
            >
              {when(task.dueAt)}
            </span>
          ) : null}
        </Prop>
        <Prop icon={CalendarClock} label={t('task.scheduledAt')}>
          {when(task.scheduledAt)}
        </Prop>
        <Prop icon={ListTodo} label={t('taskLists.list')}>
          {task.list ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <ListDot list={task.list} />
              <span className="truncate">{task.list.name}</span>
            </span>
          ) : null}
        </Prop>
        <Prop icon={Timer} label={t('peek.estimate')}>
          {task.estimateMinutes ? t('peek.minutes', { n: task.estimateMinutes }) : null}
        </Prop>
        <Prop icon={TagIcon} label={t('task.tags')} wide>
          {task.tags.length ? (
            <span className="flex flex-wrap gap-1">
              {task.tags.map((tag) => (
                <span
                  key={tag.id}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs',
                    PALETTE_CLASS[tag.color as PaletteName] ?? 'bg-surface',
                  )}
                >
                  {tag.name}
                </span>
              ))}
            </span>
          ) : null}
        </Prop>
      </dl>

      <section className="flex flex-col gap-1.5">
        <h3 className="flex items-center gap-1.5 font-medium text-fg-muted text-xs">
          <AlignLeft className="size-3.5" aria-hidden />
          {t('task.description')}
        </h3>
        {task.descriptionPm && plainOf(task.descriptionPm as PmNode).trim() ? (
          <PmView doc={task.descriptionPm} className="xz-prose xz-prose-compact" />
        ) : (
          <p className="text-fg-faint text-sm">{t('peek.noDescription')}</p>
        )}
      </section>

      {subtasks.length ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 font-medium text-fg-muted text-xs">
            <ListChecks className="size-3.5" aria-hidden />
            {t('task.subtask')}
            <span className="tabular-nums">
              {subDone}/{subtasks.length}
            </span>
          </h3>
          <ul className="flex flex-col gap-1" data-testid="peek-subtasks">
            {subtasks.map((x) => (
              <li key={x.id} className="flex min-w-0 items-center gap-2 text-sm">
                {x.status === 'done' ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <Circle className="size-4 shrink-0 text-fg-faint" aria-hidden />
                )}
                <span
                  className={cn('truncate', x.status === 'done' && 'text-fg-muted line-through')}
                >
                  {x.title}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="flex flex-wrap gap-x-3 gap-y-1 border-divider border-t pt-3 text-fg-muted text-xs">
        <span>
          {t('peek.created')} <RelativeTime date={task.createdAt} />
        </span>
        <span>
          {t('peek.updated')} <RelativeTime date={task.updatedAt} />
        </span>
        {task.completedAt ? (
          <span>
            {t('peek.completed')} <RelativeTime date={task.completedAt} />
          </span>
        ) : null}
      </footer>
    </article>
  )
}

interface Preview {
  title: string
  kind: string
  typeId?: string | null
  excerpt: string
  author: { displayName: string }
  updatedAt?: string
}
function EntryPeek({ id }: { id: string }) {
  const { t } = useTranslation()
  const kindLabel = useKindLabel()
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
        {kindLabel(data.kind, data.typeId).label} · {data.author.displayName}
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
