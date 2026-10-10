/**
 * 记录详情坞（ADR-0054 §B）：列表里单击记录，在右侧坞内展开完整记录——标题就地改 · 属性列表 · 协同正文（可编辑），
 * 列表不离开；坞头：类型 · 「打开完整页面」· ⋯ 菜单 · 关闭。不设 Aside / 专注 / 面包屑（完整页面才有）。
 * 换页（pathname 变化）或 Esc（焦点在坞内非编辑区 / body）关闭。挂在 AppShell，≥ lg 才渲染。
 */
import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { Maximize2, X } from 'lucide-react'
import { type CSSProperties, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { useMe } from '../../hooks/useMe.ts'
import { useMediaQuery } from '../../hooks/useMediaQuery.ts'
import { ApiError } from '../../lib/api.ts'
import { DOCK_QUERY } from '../../lib/entry-dock.ts'
import { type Entry, entryQuery } from '../../lib/entry-queries.ts'
import { readingAttrs, useReading } from '../../lib/reading.ts'
import { pushRecent } from '../../lib/recent.ts'
import { useCommandContext, useEntryDock } from '../../lib/stores.ts'
import { DetailDock } from '../layout/DetailDock.tsx'
import { InlineEdit } from '../ui/inline-edit.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import EntryProperties from './EntryFieldsPanel.tsx'
import { EntryMenu } from './EntryMenu.tsx'
import { KindBadge } from './KindIcon.tsx'

const EntryEditor = lazy(() => import('../../editor/EntryEditor.tsx'))

/** AppShell 里的宿主：有打开的记录且 ≥ lg 时渲染坞；换页即关 */
export function EntryDockHost() {
  const id = useEntryDock((s) => s.id)
  const close = useEntryDock((s) => s.close)
  const wide = useMediaQuery(DOCK_QUERY)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const first = useRef(pathname)
  useEffect(() => {
    if (first.current !== pathname) close()
    first.current = pathname
  }, [pathname, close])
  if (!id || !wide) return null
  return <EntryDetailDock key={id} entryId={id} onClose={close} />
}

const HEAD_H = '2.75rem'

function EntryDetailDock({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const q = useQuery(entryQuery(entryId))
  const e = q.data as Entry | undefined
  const actions = useEntryActions()
  const prefs = useReading((s) => s.prefs)
  const [docBarSlot, setDocBarSlot] = useState<HTMLDivElement | null>(null)
  const ref = useRef<HTMLElement | null>(null)
  const canWrite = !!e && !!me && (e.authorId === me.id || me.workspaceRole !== 'guest')
  // ⌘K / 复制标题热键：坞开着时上下文为该记录（同任务详情坞，ADR-0058）
  const setCmdFocus = useCommandContext((st) => st.setFocus)
  useEffect(() => {
    pushRecent(entryId)
    setCmdFocus({ kind: 'entry', id: entryId })
    return () => setCmdFocus(null)
  }, [entryId, setCmdFocus])
  // Esc：来自坞内非编辑区（正文里 Esc 归编辑器）或 body 时关；弹层自己处理 Esc
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const on = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented || ev.isComposing) return
      const target = ev.target as HTMLElement | null
      const inDock = !!target && !!ref.current?.contains(target)
      if (!inDock && target !== document.body && target !== document.documentElement) return
      if (target?.closest('[contenteditable="true"], input, textarea, select')) return
      ev.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 422)

  return (
    <DetailDock
      ref={ref}
      label={e?.title || t('entry.untitled')}
      testId="entry-dock"
      variant="entry"
    >
      <div style={{ '--xz-dock-head-h': HEAD_H } as CSSProperties}>
        <header
          className="sticky top-0 z-(--xz-z-sticky) flex items-center gap-1 border-divider border-b bg-surface-solid px-3"
          style={{ height: HEAD_H }}
        >
          {e ? <KindBadge kind={e.kind} typeId={e.typeId} /> : null}
          <span className="ms-1 truncate text-fg-muted text-xs">
            {e ? t(`entry.visibility.${e.visibility}`) : null}
          </span>
          <div className="ms-auto flex items-center gap-0.5">
            <Tooltip content={t('dock.openFull')}>
              <Link
                to="/entries/$entryId"
                params={{ entryId }}
                aria-label={t('dock.openFull')}
                className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
                data-testid="entry-dock-full"
              >
                <Maximize2 className="size-4" />
              </Link>
            </Tooltip>
            {e ? <EntryMenu entry={e} canWrite={canWrite} onDeleted={onClose} /> : null}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('dock.close')}
              className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
              data-testid="entry-dock-close"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>
        <article
          className="xz-reading xz-dock-entry px-6 pt-5 pb-10"
          {...readingAttrs(prefs, 'full')}
          data-testid="entry-dock-body"
        >
          {notFound ? (
            <p className="py-10 text-center text-fg-muted text-sm">{t('dock.notFound')}</p>
          ) : e && me ? (
            <>
              {canWrite ? (
                <InlineEdit
                  value={e.title}
                  label={t('entry.title')}
                  onSave={(v) =>
                    v.trim() && v !== e.title ? actions.patch(e, { title: v.trim() }) : undefined
                  }
                  className="-mx-[5px] mb-3 w-[calc(100%+10px)] font-semibold text-2xl leading-tight tracking-tight"
                  testId="entry-dock-title"
                />
              ) : (
                <h2
                  className="mb-3 font-semibold text-2xl leading-tight tracking-tight"
                  data-testid="entry-dock-title"
                >
                  {e.title || t('entry.untitled')}
                </h2>
              )}
              <EntryProperties entry={e} disabled={!canWrite} />
              <div ref={setDocBarSlot} className="xz-doc-bar-slot" />
              <Suspense fallback={<Skeleton className="h-48 w-full" />}>
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
            <Skeleton className="h-48 w-full" />
          )}
        </article>
      </div>
    </DetailDock>
  )
}
