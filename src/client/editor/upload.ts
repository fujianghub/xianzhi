/**
 * 图片 / 附件上传（03 §11.4 · §11.5、REQ-EDITOR-004 · 017）：拖入 / 粘贴 / 斜杠三入口同一流程。
 * 占位用本地 Decoration（不落库、远端不可见），成功后在占位处插入 `image{src:xz:attachment/<id>}` 或 `attachment` 节点；
 * 并发 ≤ 3；软限 10MB（ydoc 编码大小）与单篇 200 张图片在插入前检查。
 * 偏差（CHANGELOG 注）：一期占位不插 blob: 图片节点，失败直接移除占位并 Toast，不做「重试 / 删除」按钮与离线队列。
 */
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Extension } from '@tiptap/react'
import i18n from 'i18next'
import { toast } from 'sonner'
import * as Y from 'yjs'
import { ATTACHMENT_LIMITS } from '../../shared/schemas/attachments.ts'
import { newId } from '../lib/uuid.ts'

export const DOC_SOFT_LIMIT = 10 * 1024 * 1024
export const MAX_IMAGES = 200
const CONCURRENCY = 3

interface PhMeta {
  add?: { id: string; pos: number; label: string }
  remove?: string
}
const key = new PluginKey<DecorationSet>('giUpload')

export const UploadPlaceholder = Extension.create({
  name: 'giUpload',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc)
            const m = tr.getMeta(key) as PhMeta | undefined
            if (m?.add) {
              const el = document.createElement('div')
              el.className = 'xz-upload-ph'
              el.dataset.testid = 'upload-placeholder'
              el.textContent = m.add.label
              next = next.add(tr.doc, [Decoration.widget(m.add.pos, el, { id: m.add.id })])
            }
            if (m?.remove)
              next = next.remove(next.find(undefined, undefined, (s) => s.id === m.remove))
            return next
          },
        },
        props: { decorations: (s) => key.getState(s) },
      }),
    ]
  },
})

const phPos = (editor: Editor, id: string) =>
  key.getState(editor.state)?.find(undefined, undefined, (s) => s.id === id)[0]?.from ?? null

// 简单信号量：全局最多 3 个并发上传
let running = 0
const waiting: (() => void)[] = []
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r))
  running++
  try {
    return await fn()
  } finally {
    running--
    waiting.shift()?.()
  }
}

interface Uploaded {
  id: string
  filename: string
  mime: string
  size: number
  width: number | null
  height: number | null
  blurhash: string | null
}

/** 上传目标：记录正文（给 ydoc，按其编码大小做软限）或任务描述（liteKit，按 JSON 大小，ADR-0043） */
export type UploadCtx =
  | { entryId: string; ydoc: Y.Doc }
  | { taskId: string; imagesOnly: true; maxJsonBytes: number; onInserted?: () => void }

async function post(file: File, ctx: UploadCtx): Promise<Uploaded> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('targetType', 'entryId' in ctx ? 'entry' : 'task')
  fd.append('targetId', 'entryId' in ctx ? ctx.entryId : ctx.taskId)
  const r = await fetch('/api/v1/attachments', {
    method: 'POST',
    body: fd,
    credentials: 'same-origin',
    headers: { 'idempotency-key': newId() },
  })
  if (!r.ok) throw new Error(String(r.status))
  return (await r.json()) as Uploaded
}

const countImages = (editor: Editor) => {
  let n = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') n++
  })
  return n
}

/** 软限阈值；开发 / 验证实例允许 e2e 通过 window.__GI_DOC_SOFT_LIMIT__ 调低（生产构建剔除）。 */
const softLimit = (): number => {
  if (import.meta.env.DEV) {
    const v = (window as { __GI_DOC_SOFT_LIMIT__?: number }).__GI_DOC_SOFT_LIMIT__
    if (typeof v === 'number') return v
  }
  return DOC_SOFT_LIMIT
}

/**
 * 插入前的软限检查；超限 Toast 并返回 false（REQ-EDITOR-017）。
 * 正文按 ydoc 编码大小；任务描述（无 ydoc）按 PM JSON 大小对照服务端上限（ADR-0043）。
 */
export function canInsertAttachment(
  editor: Editor,
  doc: Y.Doc | { maxJsonBytes: number },
  images: number,
): boolean {
  const over =
    doc instanceof Y.Doc
      ? Y.encodeStateAsUpdate(doc).byteLength > softLimit()
      : new Blob([JSON.stringify(editor.getJSON())]).size > doc.maxJsonBytes
  if (over) {
    toast.error(i18n.t('editor.tooLargeSoft'))
    return false
  }
  if (images > 0 && countImages(editor) + images > MAX_IMAGES) {
    toast.error(i18n.t('editor.imageLimit'))
    return false
  }
  return true
}

export function uploadFiles(editor: Editor, files: File[], at: number, ctx: UploadCtx) {
  const valid = files.filter((f) => {
    const img = f.type.startsWith('image/')
    // 任务描述只收图片（liteKit 无附件节点）
    if (!img && 'imagesOnly' in ctx) {
      toast.error(i18n.t('editor.imagesOnly', { name: f.name }))
      return false
    }
    const cap = img
      ? ATTACHMENT_LIMITS.image
      : f.type === 'application/pdf'
        ? ATTACHMENT_LIMITS.pdf
        : ATTACHMENT_LIMITS.other
    if (f.size > cap) {
      toast.error(i18n.t('editor.uploadFailed', { name: f.name }))
      return false
    }
    return true
  })
  const images = valid.filter((f) => f.type.startsWith('image/')).length
  if (!valid.length || !canInsertAttachment(editor, 'ydoc' in ctx ? ctx.ydoc : ctx, images)) return
  for (const file of valid) {
    const id = newId()
    editor.view.dispatch(
      editor.state.tr.setMeta(key, {
        add: {
          id,
          pos: Math.min(at, editor.state.doc.content.size),
          label: `${i18n.t('editor.uploading')} ${file.name}`,
        },
      } satisfies PhMeta),
    )
    void slot(() => post(file, ctx))
      .then((a) => {
        const pos = phPos(editor, id)
        editor.view.dispatch(editor.state.tr.setMeta(key, { remove: id } satisfies PhMeta))
        if (pos === null || editor.isDestroyed) return
        const node = a.mime.startsWith('image/')
          ? {
              type: 'image',
              attrs: {
                src: `xz:attachment/${a.id}`,
                alt: a.filename,
                width: a.width,
                height: a.height,
                blurhash: a.blurhash,
              },
            }
          : {
              type: 'attachment',
              attrs: { attachmentId: a.id, name: a.filename, size: a.size, mime: a.mime },
            }
        editor.chain().insertContentAt(pos, node).run()
        // 任务描述不走 Yjs：插入后由调用方保存（失焦保存可能早已发生）
        if ('onInserted' in ctx) ctx.onInserted?.()
      })
      .catch(() => {
        if (!editor.isDestroyed)
          editor.view.dispatch(editor.state.tr.setMeta(key, { remove: id } satisfies PhMeta))
        toast.error(i18n.t('editor.uploadFailed', { name: file.name }))
      })
  }
}

/** 斜杠菜单「图片 / 附件」：打开文件选择器。 */
export function pickFiles(accept: string, onPick: (files: File[]) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = accept
  input.onchange = () => onPick(Array.from(input.files ?? []))
  input.click()
}
