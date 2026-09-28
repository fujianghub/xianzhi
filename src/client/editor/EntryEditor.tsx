/**
 * 记录正文编辑器（T0-023 · T1-014 ~ 018；03 §4.3；REQ-COLLAB-001 · 004 · 005 · 010 · 011 · 012 · 013）：
 * 1) 先探测 IndexedDB：可用则 y-indexeddb 恢复本地缓存并立即渲染（首屏不等网络；多标签页共享同库，Yjs 合并无重复）；
 *    不可用（隐私模式 / 被禁用）降级为仅内存并提示「离线保存不可用」，协同照常；
 * 2) HocuspocusProvider 按文档取 5 分钟票据（每次重连 token() 重取），指数退避重连（1s → ×2 → 30s 封顶，带抖动）；
 * 3) 连接状态 → StatusPill；关闭码按 reason 前缀处理（03 §4.2 注）。Y.Doc gc:false（CLAUDE.md 不变量 7）。
 */
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider'
import { useQueryClient } from '@tanstack/react-query'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { EditorContent, useEditor } from '@tiptap/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { collectHeadings } from '../../shared/editor/headings.ts'
import type { EntryKind } from '../../shared/schemas/enums.ts'
import {
  SAVE_VERSION,
  SAVE_VERSION_REPLY,
  type SaveVersionReply,
  versionStamp,
} from '../../shared/schemas/versions.ts'
import { paletteOf } from '../components/ui/avatar.tsx'
import { Button } from '../components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { api, unwrap } from '../lib/api.ts'
import { useCommentDraft, useOutline, useStatus } from '../lib/stores.ts'
import { newId } from '../lib/uuid.ts'
import { BlockHandle, onBlockNodeChange } from './BlockMenu.tsx'
import { BubbleBar } from './BubbleBar.tsx'
import { DocBar, EditorToolbar } from './EditorToolbar.tsx'
import { EntryPicker, type PickerRow } from './EntryPicker.tsx'
import { SOURCE_EVENT, TEMPLATE_EVENT } from './extensions.ts'
import { fullKit } from './kit.ts'
import { MobileToolbar } from './MobileToolbar.tsx'
import { markdownToHtml } from './paste.ts'
import type { SlashCtx } from './slash.tsx'
import { TableMenu } from './TableMenu.tsx'
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
  place,
  docBarSlot,
}: {
  entryId: string
  kind: EntryKind
  user: { id: string; name: string }
  canWrite: boolean
  /** 本篇所在空间与目录位置：`[[` 新建的记录建在本空间、作为本篇子页（不在目录 → 也不进目录，ADR-0019） */
  place?: { spaceId: string; treeOrder: string | null }
  /** 文档栏插槽（标题下方，由记录页提供，ADR-0029） */
  docBarSlot?: HTMLElement | null
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
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

  /**
   * 保存版本（ADR-0026、REQ-COLLAB-017）：Ctrl/⌘+S 或工具栏按钮。只在已连接且已同步时发 stateless 请求
   * （重连中的离线编辑要等 SyncStep2 才到服务端，排队的请求会抢先），按请求 id 等回执，10s 超时。
   */
  const pendingSave = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const saveVersion = useCallback(() => {
    if (readOnlyRef.current) {
      toast.info(t('editor.version.readonly'))
      return
    }
    const p = provider
    if (!p?.isSynced || p.configuration.websocketProvider.status !== WebSocketStatus.Connected) {
      toast.error(t('editor.version.offline'))
      return
    }
    const id = newId()
    pendingSave.current.set(
      id,
      setTimeout(() => {
        pendingSave.current.delete(id)
        toast.error(t('editor.version.timeout'))
      }, 10_000),
    )
    p.sendStateless(JSON.stringify({ t: SAVE_VERSION, id }))
  }, [provider, t])
  const saveRef = useRef(saveVersion)
  saveRef.current = saveVersion
  // 回执：按 id 配对，成功提示版本名（本地时间 YYYYMMDD-HHmmss）并刷新历史列表
  useEffect(() => {
    if (!provider) return
    const onStateless = ({ payload }: { payload: string }) => {
      let r: SaveVersionReply
      try {
        r = JSON.parse(payload) as SaveVersionReply
      } catch {
        return
      }
      if (r?.t !== SAVE_VERSION_REPLY) return
      const timer = pendingSave.current.get(r.id)
      if (!timer) return
      clearTimeout(timer)
      pendingSave.current.delete(r.id)
      if (r.ok) {
        toast.success(t('editor.version.saved', { name: versionStamp(new Date(r.createdAt)) }))
        void qc.invalidateQueries({ queryKey: ['entry', entryId, 'snapshots'] })
      } else if (r.reason === 'unchanged') toast.info(t('editor.version.unchanged'))
      else if (r.reason === 'throttled') toast.info(t('editor.version.throttled'))
      else if (r.reason === 'readonly') toast.info(t('editor.version.readonly'))
      else toast.error(t('editor.version.failed'))
    }
    provider.on('stateless', onStateless)
    return () => {
      provider.off('stateless', onStateless)
    }
  }, [provider, qc, entryId, t])
  useEffect(
    () => () => {
      for (const timer of pendingSave.current.values()) clearTimeout(timer)
      pendingSave.current.clear()
    },
    [],
  )
  // Ctrl/⌘+S：捕获阶段先于编辑器（GiKeymap 的「已同步」提示）拦下，阻止浏览器另存为；对话框打开时不处理
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 's') return
      if (e.isComposing || document.documentElement.hasAttribute('data-dialog-open')) return
      e.preventDefault()
      e.stopPropagation()
      saveRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
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
        // 目录跳转 / 光标滚动时让出顶栏 + 吸顶工具栏（ADR-0026），不把标题藏在工具栏下
        scrollMargin: { top: 140, bottom: 48, left: 0, right: 0 },
        scrollThreshold: { top: 140, bottom: 48, left: 0, right: 0 },
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
    const compute = () => setOutline(collectHeadings(editor.state.doc))
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
      {docBarSlot
        ? createPortal(
            <DocBar
              editor={editor}
              entryId={entryId}
              readOnly={readOnly}
              others={others}
              onSource={() => setSourceOpen(true)}
              onSaveVersion={saveVersion}
            />,
            docBarSlot,
          )
        : null}
      <EditorToolbar editor={editor} readOnly={readOnly} getCtx={() => ctxRef.current} />
      {editor && !readOnly ? (
        <>
          <DragHandle editor={editor} onNodeChange={onBlockNodeChange}>
            <BlockHandle editor={editor} />
          </DragHandle>
          <BubbleBar editor={editor} onComment={startComment} />
          <TableMenu editor={editor} />
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
        preferSpaceId={place?.spaceId}
        onCreate={
          place && canWrite
            ? async (title): Promise<PickerRow> => {
                const r = await unwrap<{ id: string }>(
                  api.entries.$post(
                    {
                      json: {
                        kind: 'note',
                        title,
                        spaceId: place.spaceId,
                        ...(place.treeOrder !== null ? { parentId: entryId } : {}),
                      } as never,
                    },
                    { headers: { 'idempotency-key': newId() } },
                  ),
                )
                void qc.invalidateQueries({ queryKey: ['entries'] })
                return { id: r.id, title, kind: 'note' }
              }
            : undefined
        }
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
