/**
 * 记录正文编辑器（T0-023 · T1-014 ~ 018；03 §4.3；REQ-COLLAB-001 · 004 · 005 · 010 · 011 · 012 · 013）：
 * 1) 先探测 IndexedDB：可用则 y-indexeddb 恢复本地缓存并立即渲染（首屏不等网络；多标签页共享同库，Yjs 合并无重复）；
 *    不可用（隐私模式 / 被禁用）降级为仅内存并提示「离线保存不可用」，协同照常；
 * 2) HocuspocusProvider 按文档取 5 分钟票据（每次重连 token() 重取），指数退避重连（1s → ×2 → 30s 封顶，带抖动）；
 * 3) 连接状态 → StatusPill；关闭码按 reason 前缀处理（03 §4.2 注）。Y.Doc gc:false（CLAUDE.md 不变量 7）。
 */
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { EditorContent, useEditor } from '@tiptap/react'
import { FileCode, GripVertical } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import type { EntryKind } from '../../shared/schemas/enums.ts'
import { paletteOf } from '../components/ui/avatar.tsx'
import { Button } from '../components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { api, unwrap } from '../lib/api.ts'
import { type OutlineItem, useCommentDraft, useOutline, useStatus } from '../lib/stores.ts'
import { newId } from '../lib/uuid.ts'
import { BubbleBar } from './BubbleBar.tsx'
import { EntryPicker } from './EntryPicker.tsx'
import { SOURCE_EVENT, TEMPLATE_EVENT } from './extensions.ts'
import { fullKit } from './kit.ts'
import { MobileToolbar } from './MobileToolbar.tsx'
import { markdownToHtml } from './paste.ts'
import type { SlashCtx } from './slash.tsx'
import { pickFiles, uploadFiles } from './upload.ts'

type Block = null | 'noAccess' | 'tooLarge' | 'tooMany'

const SourceDialog = lazy(() => import('./SourceDialog.tsx'))
const TemplateInsert = lazy(() => import('./TemplateInsert.tsx'))

/** IndexedDB 可用性探测（隐私模式 / 禁用存储时 open 抛错或 onerror；500ms 无响应视为不可用）。 */
export function probeIndexedDb(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(false)
      const req = indexedDB.open('xz:probe')
      const timer = setTimeout(() => resolve(false), 500)
      req.onsuccess = () => {
        clearTimeout(timer)
        req.result.close()
        resolve(true)
      }
      req.onerror = () => {
        clearTimeout(timer)
        resolve(false)
      }
    } catch {
      resolve(false)
    }
  })
}

export default function EntryEditor({
  entryId,
  kind,
  user,
  canWrite,
}: {
  entryId: string
  kind: EntryKind
  user: { id: string; name: string }
  canWrite: boolean
}) {
  const { t } = useTranslation()
  const setStatus = useStatus((s) => s.set)
  const [block, setBlock] = useState<Block>(null)
  const [noStorage, setNoStorage] = useState(false)
  const [readOnly, setReadOnly] = useState(!canWrite)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 每篇记录一个新的 Y.Doc
  const ydoc = useMemo(() => new Y.Doc({ gc: false }), [entryId])
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null)
  const [picker, setPicker] = useState<null | { mode: 'card' | 'link'; at: number }>(null)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [mdChoice, setMdChoice] = useState<null | { files: File[]; at: number }>(null)
  const [others, setOthers] = useState(0)
  // 在线协作者数（awareness 里除自己以外的客户端）：源码编辑整体写回，有人在线时禁用（ADR-0011 §1）
  useEffect(() => {
    const aw = provider?.awareness
    if (!aw) return
    const update = () => setOthers(Math.max(0, aw.getStates().size - 1))
    update()
    aw.on('change', update)
    return () => aw.off('change', update)
  }, [provider])
  const [tplAt, setTplAt] = useState<number | null>(null)
  useEffect(() => {
    const onSource = () => setSourceOpen(true)
    const onTemplate = (e: Event) => setTplAt((e as CustomEvent<{ at: number }>).detail.at)
    window.addEventListener(SOURCE_EVENT, onSource)
    window.addEventListener(TEMPLATE_EVENT, onTemplate)
    return () => {
      window.removeEventListener(SOURCE_EVENT, onSource)
      window.removeEventListener(TEMPLATE_EVENT, onTemplate)
    }
  }, [])
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  useEffect(() => {
    performance.mark('xz:editor:mount')
    let local: IndexeddbPersistence | null = null
    let disposed = false
    void probeIndexedDb().then((ok) => {
      if (disposed) return
      if (!ok) {
        setNoStorage(true) // REQ-COLLAB-012：仅内存，编辑仍实时同步
        return
      }
      local = new IndexeddbPersistence(`xz:entry:${entryId}`, ydoc)
      // REQ-COLLAB-005：本地缓存恢复完成即可渲染（不等网络）
      local.once('synced', () => performance.mark('xz:editor:local'))
    })
    const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/collab`
    let retry: ReturnType<typeof setTimeout> | undefined
    const p = new HocuspocusProvider({
      url,
      name: `entry:${entryId}`,
      document: ydoc,
      // REQ-COLLAB-011：指数退避重连，本地编辑留在 Y.Doc，重连后由 Yjs 合并
      delay: 1000,
      factor: 2,
      maxDelay: 30_000,
      minDelay: 500,
      jitter: true,
      maxAttempts: 0,
      token: async () =>
        (await unwrap<{ token: string }>(api.collab.token.$post({ json: { entryId } }))).token,
      onStatus: ({ status }) => {
        if (status === WebSocketStatus.Connecting) setStatus('connecting')
        else if (status === WebSocketStatus.Disconnected)
          setStatus(navigator.onLine ? 'connecting' : 'offline')
      },
      onSynced: () => {
        setStatus(readOnlyRef.current ? 'readOnly' : 'synced')
        // REQ-EDITOR-014：挂载 → 与服务端首次同步完成（正文已在编辑器里、可编辑）
        if (!performance.getEntriesByName('xz:editor:open').length) {
          performance.mark('xz:editor:synced')
          try {
            performance.measure('xz:editor:open', 'xz:editor:mount', 'xz:editor:synced')
          } catch {
            /* mount 标记可能已被清理 */
          }
        }
      },
      onAuthenticated: ({ scope }) => {
        const ro = scope === 'readonly'
        setReadOnly(ro || !canWrite)
        if (ro) setStatus('readOnly')
      },
      onAuthenticationFailed: ({ reason }) => handle(reason),
      onClose: ({ event }) => {
        if (event.reason) handle(event.reason)
      },
    } as ConstructorParameters<typeof HocuspocusProvider>[0])
    function handle(reason: string) {
      const code = reason.split(':')[0]
      if (code === '4403') {
        setBlock('noAccess')
        p.destroy()
      } else if (code === '4413') {
        setBlock('tooLarge')
        setReadOnly(true)
      } else if (code === '4429') {
        setBlock('tooMany')
        retry = setTimeout(() => {
          setBlock(null)
          void p.connect()
        }, 30_000)
      } else if (code === '4401' || code === '4409') {
        retry = setTimeout(() => void p.connect(), 500) // 票据过期 / 重放：token() 会重取
      }
    }
    const offline = () => setStatus('offline')
    const online = () => setStatus('connecting')
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    setProvider(p)
    return () => {
      disposed = true
      clearTimeout(retry)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
      p.destroy()
      void local?.destroy()
      setStatus('idle')
    }
  }, [entryId, ydoc, canWrite, setStatus])

  const color = `var(--xz-palette-${paletteOf(user.id)}-fg)`
  const ctxRef = useRef<SlashCtx>({ entryId, kind, ydoc, pickEntry: () => {} })
  ctxRef.current = {
    entryId,
    kind,
    ydoc,
    pickEntry: (mode, at) => setPicker({ mode, at }),
  }
  const editor = useEditor(
    {
      extensions: fullKit({
        ydoc,
        provider,
        user: { name: user.name, color },
        placeholder: t('entry.placeholder'),
        slash: () => ctxRef.current,
        // provider 就绪后编辑器会重建：经 ref 取当前实例，避免闭包拿到已销毁的旧编辑器
        onFiles: (files, at) => {
          const ed = editorRef.current
          if (!ed || ed.isDestroyed) return
          // .md 拖入 / 粘贴：先问「插入内容」还是「作为附件」（REQ-EDITOR-022）
          const md = files.filter((f) => /\.(md|markdown)$/i.test(f.name))
          const rest = files.filter((f) => !md.includes(f))
          if (rest.length) uploadFiles(ed, rest, at, { entryId, ydoc })
          if (md.length) setMdChoice({ files: md, at })
        },
      }),
      editable: !readOnly,
      immediatelyRender: true,
      onCreate: () => performance.mark('xz:editor:ready'),
      editorProps: {
        attributes: {
          class: 'xz-prose outline-none',
          'data-testid': 'editor',
          'aria-label': t('entry.placeholder'),
        },
      },
    },
    [provider, ydoc],
  )
  const editorRef = useRef(editor)
  editorRef.current = editor
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!readOnly)
  }, [editor, readOnly])

  // 大纲：每次文档变化后重算标题（Aside 大纲页、REQ-EDITOR-012）
  const setOutline = useOutline((s) => s.set)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const compute = () => {
      const items: OutlineItem[] = []
      editor.state.doc.descendants((n, pos) => {
        if (n.type.name === 'heading')
          items.push({ level: Number(n.attrs.level), text: n.textContent, pos })
        return n.type.name !== 'heading'
      })
      setOutline(items)
    }
    compute()
    setOutline(useOutline.getState().items, (pos) => {
      if (editor.isDestroyed) return
      editor
        .chain()
        .focus()
        .setTextSelection(pos + 1)
        .scrollIntoView()
        .run()
    })
    editor.on('update', compute)
    return () => {
      editor.off('update', compute)
      setOutline([], null)
    }
  }, [editor, setOutline])

  // 锚定评论（T1-023）：给选区套 comment(threadId) 标记，交给 Aside 评论页写首条；取消时移除该标记
  const setDraft = useCommentDraft((s) => s.setPending)
  const setRemover = useCommentDraft((s) => s.setRemover)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    setRemover((threadId) => {
      if (editor.isDestroyed) return
      const { tr, doc, schema } = editor.state
      const type = schema.marks.comment
      if (!type) return
      doc.descendants((n, pos) => {
        if (n.isText && n.marks.some((m) => m.type === type && m.attrs.threadId === threadId))
          tr.removeMark(pos, pos + n.nodeSize, type)
      })
      editor.view.dispatch(tr)
    })
    return () => setRemover(null)
  }, [editor, setRemover])
  const startComment = () => {
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    if (empty) return
    const threadId = newId()
    const quote = editor.state.doc.textBetween(from, to, ' ').slice(0, 200)
    editor.chain().focus().setMark('comment', { threadId }).run()
    setDraft({ threadId, quote })
  }

  if (block === 'noAccess') return <p className="text-danger">{t('entry.noAccess')}</p>
  return (
    <div className="relative">
      {block ? (
        <div
          className="mb-3 flex items-center gap-3 rounded-md bg-warning-soft px-3 py-2 text-sm"
          role="status"
        >
          {t(block === 'tooLarge' ? 'entry.tooLarge' : 'entry.tooMany')}
          <Button size="sm" variant="ghost" onClick={() => void provider?.connect()}>
            {t('entry.reconnect')}
          </Button>
        </div>
      ) : null}
      {noStorage ? (
        <div
          className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-sm"
          role="status"
          data-testid="offline-storage-warning"
        >
          {t('editor.offlineStorage')}
        </div>
      ) : null}
      {editor && !readOnly ? (
        <>
          <div className="mb-2 flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              data-testid="source-open"
              disabled={others > 0}
              title={others > 0 ? t('editor.source.busy') : t('editor.source.title')}
              onClick={() => setSourceOpen(true)}
              className="text-fg-muted"
            >
              <FileCode className="size-4" />
              {t('editor.source.open')}
            </Button>
          </div>
          <DragHandle editor={editor}>
            <span
              role="img"
              className="grid size-6 cursor-grab place-items-center rounded text-fg-faint hover:bg-hover"
              aria-label={t('editor.dragHandle')}
              title={t('editor.dragHandle')}
            >
              <GripVertical className="size-4" />
            </span>
          </DragHandle>
          <BubbleBar editor={editor} onComment={startComment} />
          <MobileToolbar
            editor={editor}
            onImage={() =>
              pickFiles('image/*', (files) =>
                uploadFiles(editor, files, editor.state.selection.from, { entryId, ydoc }),
              )
            }
          />
        </>
      ) : null}
      <EditorContent editor={editor} />
      <Dialog open={!!mdChoice} onOpenChange={(v) => !v && setMdChoice(null)}>
        <DialogContent className="w-[min(92vw,28rem)]" data-testid="md-file-choice">
          <DialogTitle>{t('editor.mdFile.title')}</DialogTitle>
          <DialogDescription className="mt-2 text-fg-muted text-sm">
            {t('editor.mdFile.body', {
              names: (mdChoice?.files ?? []).map((f) => f.name).join('、'),
            })}
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="ghost"
              data-testid="md-file-attach"
              onClick={() => {
                if (editor && mdChoice)
                  uploadFiles(editor, mdChoice.files, mdChoice.at, { entryId, ydoc })
                setMdChoice(null)
              }}
            >
              {t('editor.mdFile.attach')}
            </Button>
            <Button
              variant="primary"
              data-testid="md-file-insert"
              onClick={async () => {
                const c = mdChoice
                setMdChoice(null)
                if (!editor || !c) return
                const texts = await Promise.all(c.files.map((f) => f.text()))
                if (editor.isDestroyed) return
                editor
                  .chain()
                  .focus()
                  .insertContentAt(
                    Math.min(c.at, editor.state.doc.content.size),
                    markdownToHtml(texts.join('\n\n')),
                    {
                      parseOptions: { preserveWhitespace: false },
                    },
                  )
                  .run()
              }}
            >
              {t('editor.mdFile.insert')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {editor && tplAt !== null ? (
        <Suspense fallback={null}>
          <TemplateInsert
            kind={kind}
            userName={user.name}
            onClose={() => setTplAt(null)}
            onInsert={(content) => {
              if (editor.isDestroyed) return
              editor
                .chain()
                .focus()
                .insertContentAt(Math.min(tplAt, editor.state.doc.content.size), content)
                .run()
            }}
          />
        </Suspense>
      ) : null}
      {editor && sourceOpen ? (
        <Suspense fallback={null}>
          <SourceDialog
            editor={editor}
            entryId={entryId}
            open={sourceOpen && others === 0}
            onOpenChange={setSourceOpen}
          />
        </Suspense>
      ) : null}
      <EntryPicker
        open={!!picker}
        onOpenChange={(v) => {
          if (!v) setPicker(null)
        }}
        excludeId={entryId}
        onPick={(e) => {
          if (!editor || !picker) return
          const node =
            picker.mode === 'card'
              ? { type: 'entryCard', attrs: { entryId: e.id } }
              : { type: 'entryLink', attrs: { id: e.id, title: e.title } }
          editor.chain().focus().insertContentAt(picker.at, node).run()
          setPicker(null)
        }}
      />
    </div>
  )
}
