/**
 * 粘贴单个网址（ADR-0054 §D、REQ-LINK-008，参考简斋 linkAutoTitle）：
 * - 空选区、不在代码里粘贴一个裸网址 → 先插入「网址文字 + link 标记」，随后异步取标题替换文字（仍带同一链接）；
 * - 本站记录链接（/entries/<id>）→ 取记录标题后换成记录链接节点（entryLink）；
 * - 替换前核对：那段文字仍是原网址、仍带同一 href（用户在等待期间改过就不动）；取不到标题保持网址。
 * 有选区时交给 Link 的 linkOnPaste（给选中文字加链接）。
 */
import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import { api, unwrap } from '../lib/api.ts'
import { entryIdFromUrl, fetchLinkPreview, isWebUrl } from '../lib/link-preview.ts'

/** 找到「文字 = 网址、带 href = 网址的 link 标记」的第一段 */
export function findBareLink(editor: Editor, url: string): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null
  editor.state.doc.descendants((n, pos) => {
    if (hit) return false
    if (
      n.isText &&
      n.text === url &&
      n.marks.some((m) => m.type.name === 'link' && m.attrs.href === url)
    ) {
      hit = { from: pos, to: pos + url.length }
      return false
    }
    return true
  })
  return hit
}

/** 把那段裸网址链接的文字换成 title（保留链接） */
export function replaceLinkText(editor: Editor, url: string, title: string): boolean {
  if (editor.isDestroyed || !title || title === url) return false
  const r = findBareLink(editor, url)
  if (!r) return false
  const link = editor.schema.marks.link
  if (!link) return false
  const tr = editor.state.tr.insertText(title, r.from, r.to)
  tr.addMark(r.from, r.from + title.length, link.create({ href: url }))
  editor.view.dispatch(tr)
  return true
}

/** 把那段裸网址链接换成记录链接节点 */
function replaceWithEntryLink(editor: Editor, url: string, id: string, title: string) {
  if (editor.isDestroyed) return
  const r = findBareLink(editor, url)
  const type = editor.schema.nodes.entryLink
  if (!r || !type) return
  editor.view.dispatch(editor.state.tr.replaceWith(r.from, r.to, type.create({ id, title })))
}

export function handleUrlPaste(editor: Editor, view: EditorView, text: string): boolean {
  const url = text.trim()
  if (!url || /\s/.test(url) || !isWebUrl(url)) return false
  if (!view.state.selection.empty) return false
  if (view.state.selection.$from.parent.type.spec.code || editor.isActive('code')) return false
  const link = editor.schema.marks.link
  if (!link) return false
  editor
    .chain()
    .focus()
    .insertContent([{ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }])
    // 光标停在链接之后、不继续带链接标记
    .unsetMark('link')
    .run()
  const entryId = entryIdFromUrl(url)
  if (entryId) {
    void unwrap<{ title: string }>(api.entries[':id'].preview.$get({ param: { id: entryId } }))
      .then((p) => replaceWithEntryLink(editor, url, entryId, p.title))
      .catch(() => undefined)
    return true
  }
  void fetchLinkPreview(url)
    .then((p) => replaceLinkText(editor, url, p.title))
    .catch(() => undefined)
  return true
}
