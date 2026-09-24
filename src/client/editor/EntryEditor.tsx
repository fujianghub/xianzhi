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
import { GripVertical } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import type { EntryKind } from '../../shared/schemas/enums.ts'
import { paletteOf } from '../components/ui/avatar.tsx'
import { Button } from '../components/ui/button.tsx'
import { api, unwrap } from '../lib/api.ts'
import { type OutlineItem, useCommentDraft, useOutline, useStatus } from '../lib/stores.ts'
import { BubbleBar } from './BubbleBar.tsx'
import { EntryPicker } from './EntryPicker.tsx'
import { fullKit } from './kit.ts'
import { MobileToolbar } from './MobileToolbar.tsx'
import type { SlashCtx } from './slash.tsx'
import { pickFiles, uploadFiles } from './upload.ts'

type Block = null | 'noAccess' | 'tooLarge' | 'tooMany'

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
          if (ed && !ed.isDestroyed) uploadFiles(ed, files, at, { entryId, ydoc })
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
    const threadId = crypto.randomUUID()
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
