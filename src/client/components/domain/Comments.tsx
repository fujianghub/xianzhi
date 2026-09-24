/**
 * 评论（T1-023 · T1-024、REQ-COMMENT-002 · 004 · 006）：按线程分组（根 + 回复），liteKit 评论子集输入（Enter 发送、
 * Shift+Enter 换行、@ 提及空间可读成员）；解决 / 取消解决、删除；orphaned 线程标「原文已删除」仍列出。
 * 记录内锚定评论：`pending` 由编辑器浮动工具条创建（已套 comment 标记），这里写首条评论；取消则移除标记。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, RotateCcw, Trash2 } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { CommentView } from '../../../server/services/comments.ts'
import type { Me } from '../../hooks/useMe.ts'
import { memberName, useSpaceCandidates } from '../../hooks/useMembers.ts'
import { api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { Avatar } from '../ui/avatar.tsx'
import { Button } from '../ui/button.tsx'
import { RelativeTime } from '../ui/relative-time.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { PmView } from './PmView.tsx'

const LiteEditor = lazy(() => import('../../editor/LiteEditor.tsx'))

export interface PendingAnchor {
  threadId: string
  quote: string
}

export function Comments({
  targetType,
  targetId,
  spaceId,
  me,
  pending,
  onPendingDone,
  onPendingCancel,
  canResolveAll,
}: {
  targetType: 'task' | 'entry'
  targetId: string
  spaceId?: string
  me: Pick<Me, 'id'>
  pending?: PendingAnchor | null
  onPendingDone?: () => void
  onPendingCancel?: (threadId: string) => void
  /** 目标作者或 owner/admin：可解决任意线程（01 §5；最终由服务端判定） */
  canResolveAll?: boolean
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const key = ['comments', targetType, targetId]
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap<{ items: CommentView[] }>(
        api.comments.$get({ query: { targetType, targetId, limit: '200' } as never }),
      ).then((r) => r.items),
  })
  const candidates = useSpaceCandidates(spaceId).map((m) => ({
    id: m.userId,
    label: memberName(m),
  }))
  const [showResolved, setShowResolved] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: key })

  const post = async (bodyPm: unknown, extra: { threadId?: string; parentId?: string } = {}) => {
    try {
      await unwrap(
        api.comments.$post(
          { json: { targetType, targetId, bodyPm, ...extra } as never },
          { headers: { 'idempotency-key': crypto.randomUUID() } },
        ),
      )
      await refresh()
      return true
    } catch {
      toast.error(t('comment.failed'))
      return false
    }
  }
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await refresh()
    } catch {
      toast.error(t('comment.failed'))
    }
  }

  const items = q.data ?? []
  const roots = items.filter((c) => !c.parentId)
  const repliesOf = (threadId: string, rootId: string) =>
    items.filter((c) => c.threadId === threadId && c.id !== rootId)
  const open = roots.filter((r) => !r.resolvedAt)
  const resolved = roots.filter((r) => r.resolvedAt)

  const editor = (props: {
    placeholder: string
    onSubmit: (d: unknown) => Promise<boolean>
    autofocus?: boolean
    testId?: string
  }) => (
    <Suspense fallback={<Skeleton className="h-16 w-full" />}>
      <div className="rounded-md border border-border bg-surface px-3 py-2">
        <LiteEditor
          value={null}
          variant="comment"
          placeholder={props.placeholder}
          onSubmit={props.onSubmit}
          autofocus={props.autofocus}
          testId={props.testId ?? 'comment-input'}
          mentionCandidates={candidates}
          className="min-h-8 text-sm"
        />
      </div>
    </Suspense>
  )

  const thread = (root: CommentView) => (
    <li
      key={root.id}
      id={`c-${root.id}`}
      className="paper rounded-lg border border-divider p-3"
      data-testid="comment-thread"
      data-thread={root.threadId}
      data-orphaned={root.orphaned ? 'true' : undefined}
    >
      {root.orphaned ? (
        <p className="mb-2 rounded bg-warning-soft px-2 py-1 text-xs" data-testid="orphaned-badge">
          {t('comment.orphaned')}
        </p>
      ) : null}
      {[root, ...repliesOf(root.threadId, root.id)].map((c) => (
        <div key={c.id} id={`c-${c.id}`} className="group mb-2 flex gap-2 last:mb-0">
          <Avatar id={c.author.id} name={c.author.displayName} size={24} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium">{c.author.displayName}</span>
              <RelativeTime date={c.createdAt} className="text-fg-muted" />
              {c.author.id === me.id && !c.deleted ? (
                <button
                  type="button"
                  aria-label={t('ui.action.delete')}
                  onClick={() =>
                    void act(() => unwrap(api.comments[':id'].$delete({ param: { id: c.id } })))
                  }
                  className="ml-auto grid size-6 place-items-center rounded text-fg-muted opacity-0 hover:bg-hover focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </div>
            {c.deleted ? (
              <p className="text-fg-muted text-sm italic">{t('comment.deleted')}</p>
            ) : (
              <PmView doc={c.bodyPm} className="xz-prose text-sm" />
            )}
          </div>
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2">
        {root.resolvedAt ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void act(() =>
                unwrap(api.comments[':id'].unresolve.$post({ param: { id: root.id } })),
              )
            }
          >
            <RotateCcw className="size-3.5" />
            {t('comment.unresolve')}
          </Button>
        ) : (
          (canResolveAll || root.author.id === me.id) && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="comment-resolve"
              onClick={() =>
                void act(() =>
                  unwrap(api.comments[':id'].resolve.$post({ param: { id: root.id } })),
                )
              }
            >
              <Check className="size-3.5" />
              {t('comment.resolve')}
            </Button>
          )
        )}
      </div>
      {!root.resolvedAt ? (
        <div className="mt-2">
          {editor({
            placeholder: t('comment.reply'),
            onSubmit: (d) => post(d, { threadId: root.threadId, parentId: root.id }),
            testId: 'comment-reply',
          })}
        </div>
      ) : null}
    </li>
  )

  return (
    <div className="flex flex-col gap-3" data-testid="comments">
      {pending ? (
        <div className="paper rounded-lg border border-primary p-3" data-testid="comment-pending">
          <blockquote className="mb-2 line-clamp-3 border-divider border-l-2 pl-2 text-fg-muted text-xs">
            {pending.quote}
          </blockquote>
          {editor({
            placeholder: t('comment.placeholder'),
            autofocus: true,
            onSubmit: async (d) => {
              const ok = await post(d, { threadId: pending.threadId })
              if (ok) onPendingDone?.()
              return ok
            },
          })}
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => onPendingCancel?.(pending.threadId)}
          >
            {t('ui.action.cancel')}
          </Button>
        </div>
      ) : null}
      {q.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <>
          {open.length ? <ul className="flex flex-col gap-3">{open.map(thread)}</ul> : null}
          {!open.length && !pending ? (
            <p className="text-fg-muted text-sm">{t('comment.empty')}</p>
          ) : null}
          {resolved.length ? (
            <div>
              <button
                type="button"
                onClick={() => setShowResolved((v) => !v)}
                className={cn('text-fg-muted text-xs hover:text-fg')}
              >
                {t('comment.resolvedCount', { count: resolved.length })}
              </button>
              {showResolved ? (
                <ul className="mt-2 flex flex-col gap-3 opacity-80">{resolved.map(thread)}</ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {!pending
        ? editor({
            placeholder: t('comment.placeholder'),
            onSubmit: (d) => post(d),
            testId: 'comment-new',
          })
        : null}
    </div>
  )
}
