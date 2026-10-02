/**
 * 记录编辑（08 §2.9）：paper 纸面居中，版心 / 字体 / 行距 / 纸张等取阅读偏好（ADR-0024；`?wide=1` 仍强制 1080）；
 * 标题就地编辑 + kind 徽章 + 固定 + 属性面板（常显、点值即改，ADR-0035）；正文走协同（编辑器 chunk 懒加载）；Aside 由 `?aside=` 选页（T1-017）。
 * 阅读胶囊（字体 / 纸张 / 排版 / 目录）与「专注」在正文上方的吸顶工具栏里（ADR-0025）；⌘⇧↵ 在此捕获。
 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Pin, Star } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AsideTab, EntryAside } from '../components/domain/EntryAside.tsx'
import EntryProperties from '../components/domain/EntryFieldsPanel.tsx'
import { EntryMenu } from '../components/domain/EntryMenu.tsx'
import { KindBadge } from '../components/domain/KindIcon.tsx'
import { InlineEdit } from '../components/ui/inline-edit.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useEntryActions } from '../hooks/useEntries.ts'
import type { Me } from '../hooks/useMe.ts'
import { entryPageContext, useNewEntryContext } from '../hooks/useNewEntryContext.ts'
import { useSharedTarget } from '../hooks/useSharedElement.ts'
import { ApiError } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { type Entry, entryQuery } from '../lib/entry-queries.ts'
import { readingAttrs, useFocusMode, useReading } from '../lib/reading.ts'
import { pushRecent } from '../lib/recent.ts'
import { optOneOf, optUuid } from '../lib/search.ts'
import { spaceQuery } from '../lib/space-queries.ts'
import { useAsideSlot, useCommandContext, useCommentDraft } from '../lib/stores.ts'

const EntryEditor = lazy(() => import('../editor/EntryEditor.tsx'))

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
  const sharedTarget = useSharedTarget(entryId)
  const setAside = useAsideSlot((s) => s.set)
  const [docBarSlot, setDocBarSlot] = useState<HTMLDivElement | null>(null)
  // 写权限由服务端票据最终判定（onAuthenticated scope）；此处按角色给乐观值
  const canWrite = !!e && (e.authorId === me.id || me.workspaceRole !== 'guest')
  // 在记录页按 e = 建同级页（语雀式，ADR-0018）；对话框里可改为子页
  useNewEntryContext(e ? entryPageContext(e) : null)
  const prefs = useReading((s) => s.prefs)
  const focus = useFocusMode((s) => s.on)
  const setFocus = useFocusMode((s) => s.set)
  // 专注只属于当前记录页：离开即退出
  useEffect(() => () => setFocus(false), [setFocus])
  // mod+shift+enter 在正文里会先被编辑器当作换行吃掉：捕获阶段先拦下（全局热键表里的同名项只作 ⌘K 提示）
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter' || !ev.shiftKey || !(ev.metaKey || ev.ctrlKey) || ev.isComposing)
        return
      ev.preventDefault()
      ev.stopPropagation()
      setFocus(!useFocusMode.getState().on)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setFocus])
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
      className="paper xz-reading mx-auto rounded-xl px-6 py-8 shadow-[inset_0_1px_0_var(--xz-edge),var(--xz-shadow-card)] sm:px-10"
      {...readingAttrs(prefs, search.wide ? 'full' : prefs.width)}
      data-testid="entry-page"
    >
      {e ? (
        <>
          {focus ? null : <Breadcrumb entry={e} />}
          <div className={cn('mb-2 flex items-center gap-2 text-xs', focus && 'hidden')}>
            <KindBadge kind={e.kind} typeId={e.typeId} size="md" />
            <span className="text-fg-muted">{t(`entry.visibility.${e.visibility}`)}</span>
            {e.archivedAt ? (
              <span
                className="rounded-full bg-surface-2 px-2 py-0.5 text-fg-muted"
                data-testid="entry-archived-badge"
              >
                {t('entry.menu.archivedBadge')}
              </span>
            ) : null}
            {e.favorited ? (
              <Star
                className="size-3.5 fill-current text-warning"
                aria-label={t('entry.nav.favorite')}
              />
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              {canWrite ? (
                <button
                  type="button"
                  aria-pressed={e.pinned}
                  data-testid="entry-pin"
                  onClick={() => void actions.patch(e, { pinned: !e.pinned })}
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-full px-2 hover:bg-hover',
                    e.pinned ? 'text-primary-text' : 'text-fg-muted',
                  )}
                >
                  <Pin className="size-3.5" />
                  {t(e.pinned ? 'entry.unpin' : 'entry.pin')}
                </button>
              ) : null}
              <EntryMenu entry={e} canWrite={canWrite} navigateAfterDelete />
            </div>
          </div>
          <div ref={sharedTarget}>
            {canWrite ? (
              <InlineEdit
                value={e.title}
                label={t('entry.title')}
                onSave={(v) =>
                  v.trim() && v !== e.title ? actions.patch(e, { title: v.trim() }) : undefined
                }
                className="-mx-[5px] mb-4 w-[calc(100%+10px)] font-semibold text-3xl leading-tight tracking-tight"
                testId="entry-title"
              />
            ) : (
              <h1
                className="mb-4 font-semibold text-3xl leading-tight tracking-tight"
                data-testid="entry-title"
              >
                {e.title || t('entry.untitled')}
              </h1>
            )}
          </div>
          {/* 属性面板（ADR-0035，REQ-ENTRY-024）：标题下常显，在文档栏之前；专注时隐藏 */}
          {focus ? null : <EntryProperties entry={e} disabled={!canWrite} />}
          {/* 文档栏插槽（ADR-0029）：阅读 / 保存 / 字数，由编辑器 portal 进来；预留高度避免加载时跳动 */}
          <div ref={setDocBarSlot} className="xz-doc-bar-slot" />
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <EntryEditor
              entryId={entryId}
              kind={e.kind}
              user={{ id: me.id, name: me.displayName || me.name }}
              canWrite={canWrite}
              place={{ spaceId: e.spaceId, treeOrder: e.treeOrder }}
              docBarSlot={docBarSlot}
            />
          </Suspense>
        </>
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </article>
  )
}

/** 面包屑（ADR-0012、REQ-KB-005）：空间 › 目录祖先（读不到的祖先截断）。个人空间不显示。 */
function Breadcrumb({ entry }: { entry: Entry }) {
  const { t } = useTranslation()
  const space = useQuery(spaceQuery(entry.spaceSlug))
  if (!space.data || space.data.isPersonal) return null
  return (
    <nav
      aria-label={t('kb.tree.breadcrumb')}
      className="mb-3 flex flex-wrap items-center gap-1 text-fg-muted text-xs"
      data-testid="entry-breadcrumb"
    >
      <Link
        to={entry.treeOrder !== null ? '/spaces/$spaceSlug/tree' : '/spaces/$spaceSlug/home'}
        params={{ spaceSlug: entry.spaceSlug }}
        className="hover:text-fg"
      >
        {space.data.name}
      </Link>
      {(entry.path ?? []).map((p) => (
        <span key={p.id} className="flex items-center gap-1">
          <ChevronRight className="size-3" aria-hidden />
          <Link
            to="/entries/$entryId"
            params={{ entryId: p.id }}
            className="max-w-48 truncate hover:text-fg"
          >
            {p.title || t('entry.untitled')}
          </Link>
        </span>
      ))}
    </nav>
  )
}
