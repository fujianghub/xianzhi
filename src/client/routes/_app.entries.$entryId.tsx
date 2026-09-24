/**
 * 记录编辑（08 §2.9）：paper 纸面 760 居中（`?wide=1` 1080）；标题就地编辑 + kind 徽章 + 固定 + fields 表单（自动保存）；
 * 正文走协同（编辑器 chunk 懒加载）；Aside 由 `?aside=` 选页（T1-017）。
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { ChevronDown, Pin } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AsideTab, EntryAside } from '../components/domain/EntryAside.tsx'
import { InlineEdit } from '../components/ui/inline-edit.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useEntryActions } from '../hooks/useEntries.ts'
import type { Me } from '../hooks/useMe.ts'
import { ApiError } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { type Entry, entryQuery } from '../lib/entry-queries.ts'
import { pushRecent } from '../lib/recent.ts'
import { optOneOf, optUuid } from '../lib/search.ts'
import { useAsideSlot, useCommandContext, useCommentDraft } from '../lib/stores.ts'

const EntryEditor = lazy(() => import('../editor/EntryEditor.tsx'))
const FieldsPanel = lazy(() => import('../components/domain/EntryFieldsPanel.tsx'))

type Search = { aside?: AsideTab; wide?: '1'; c?: string }

export const Route = createFileRoute('/_app/entries/$entryId')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    aside: optOneOf(['outline', 'backlinks', 'comments', 'props', 'history'] as const)(s.aside),
    wide: s.wide === '1' || s.wide === 1 ? '1' : undefined,
    c: optUuid(s.c),
  }),
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(entryQuery(params.entryId))
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 422)) throw notFound()
      throw err
    }
  },
  component: EntryPage,
})

function EntryPage() {
  const { t } = useTranslation()
  const { entryId } = Route.useParams()
  const search = Route.useSearch()
  const nav = useNavigate({ from: '/entries/$entryId' })
  const { me } = Route.useRouteContext() as { me: Me }
  const q = useQuery(entryQuery(entryId))
  const e = q.data as Entry | undefined
  const actions = useEntryActions()
  const setAside = useAsideSlot((s) => s.set)
  const [fieldsOpen, setFieldsOpen] = useState(false)
  // 写权限由服务端票据最终判定（onAuthenticated scope）；此处按角色给乐观值
  const canWrite = !!e && (e.authorId === me.id || me.workspaceRole !== 'guest')
  const tab: AsideTab = search.aside ?? 'outline'
  const tabRef = useRef(tab)
  tabRef.current = tab

  useEffect(() => {
    if (!e) return
    setAside(
      <EntryAside
        entry={e}
        tab={tab}
        canWrite={canWrite}
        me={me}
        onTab={(k) =>
          void nav({
            search: (s) => ({ ...s, aside: k === 'outline' ? undefined : k }),
            replace: true,
          })
        }
      />,
    )
  }, [e, tab, canWrite, setAside, nav, me])
  // 浮动工具条发起锚定评论 → 切到评论页签
  const pendingComment = useCommentDraft((s) => s.pending)
  useEffect(() => {
    if (pendingComment && tabRef.current !== 'comments')
      void nav({ search: (s) => ({ ...s, aside: 'comments' }), replace: true })
  }, [pendingComment, nav])
  const setPending = useCommentDraft((s) => s.setPending)
  useEffect(() => () => setPending(null), [setPending])
  useEffect(() => () => setAside(null), [setAside])
  const setCmdBase = useCommandContext((s) => s.setBase)
  useEffect(() => {
    setCmdBase({ kind: 'entry', id: entryId })
    pushRecent(entryId)
    return () => setCmdBase(null)
  }, [entryId, setCmdBase])

  return (
    <article
      className={cn(
        'paper mx-auto rounded-xl px-6 py-8 shadow-card sm:px-10',
        search.wide ? 'max-w-[1080px]' : 'max-w-[760px]',
      )}
      data-testid="entry-page"
    >
      {e ? (
        <>
          <div className="mb-2 flex items-center gap-2 text-xs">
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-fg">
              {t(`entry.kind.${e.kind}`)}
            </span>
            <span className="text-fg-muted">{t(`entry.visibility.${e.visibility}`)}</span>
            <div className="ml-auto flex items-center gap-1">
              {canWrite ? (
                <button
                  type="button"
                  aria-pressed={e.pinned}
                  data-testid="entry-pin"
                  onClick={() => void actions.patch(e, { pinned: !e.pinned })}
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-full px-2 hover:bg-hover',
                    e.pinned ? 'text-primary' : 'text-fg-muted',
                  )}
                >
                  <Pin className="size-3.5" />
                  {t(e.pinned ? 'entry.unpin' : 'entry.pin')}
                </button>
              ) : null}
            </div>
          </div>
          {canWrite ? (
            <InlineEdit
              value={e.title}
              label={t('entry.title')}
              onSave={(v) =>
                v.trim() && v !== e.title ? actions.patch(e, { title: v.trim() }) : undefined
              }
              className="mb-4 font-semibold text-3xl leading-tight"
              testId="entry-title"
            />
          ) : (
            <h1 className="mb-4 font-semibold text-3xl leading-tight" data-testid="entry-title">
              {e.title || t('entry.untitled')}
            </h1>
          )}
          {e.kind !== 'note' ? (
            <div className="mb-6">
              <button
                type="button"
                aria-expanded={fieldsOpen}
                onClick={() => setFieldsOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-fg-muted text-xs hover:text-fg"
                data-testid="entry-fields-toggle"
              >
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform duration-(--xz-dur-fast)',
                    !fieldsOpen && '-rotate-90',
                  )}
                />
                {t('entry.fieldsLabel')}
              </button>
              {fieldsOpen ? (
                <Suspense fallback={<Skeleton className="mt-2 h-16 w-full" />}>
                  <div className="mt-3">
                    <FieldsPanel entry={e} disabled={!canWrite} />
                  </div>
                </Suspense>
              ) : null}
            </div>
          ) : null}
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <EntryEditor
              entryId={entryId}
              kind={e.kind}
              user={{ id: me.id, name: me.displayName || me.name }}
              canWrite={canWrite}
            />
          </Suspense>
        </>
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </article>
  )
}
