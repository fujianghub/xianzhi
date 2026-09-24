/**
 * 派生列（01 §3.4、03 §4.2；CLAUDE.md 不变量 1）：`onStoreDocument` 与 `pnpm xz rebuild-derived` 共用同一函数，
 * 因而两条路径逐字节相同（REQ-ENTRY-010）。tsv 由 SQL `to_tsvector('simple', tsvText)` 生成。
 */

import { yDocToProsemirrorJSON } from 'y-prosemirror'
import * as Y from 'yjs'
import { tsvText, wordCount } from '../server/lib/tokenize.ts'
import { unwrapUnknownPm } from '../shared/editor/unknown.ts'
import type { PmNode } from '../shared/schemas/pm.ts'
import { pmToPlain } from '../shared/schemas/pm.ts'

export const YDOC_FRAGMENT = 'default'
export const EDITOR_SCHEMA_VERSION = 1

export interface Derived {
  pmJson: PmNode
  plain: string
  wordCount: number
  tsvText: string
}

/** 空文档（新建记录时写入；模板在 onLoadDocument 注入，03 §6）。 */
export function emptyYdoc(): Buffer {
  const doc = new Y.Doc({ gc: false })
  doc.getXmlFragment(YDOC_FRAGMENT)
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}

export function loadYdoc(bytes: Uint8Array): Y.Doc {
  const doc = new Y.Doc({ gc: false })
  if (bytes.length) Y.applyUpdate(doc, bytes)
  return doc
}

/** 正文（fullKit）纯文本：图片 / mermaid / 公式给占位（03 §4.2）。 */
export function fullPlain(doc: PmNode): string {
  const out: string[] = []
  const walk = (n: PmNode) => {
    switch (n.type) {
      case 'text':
        out.push(n.text ?? '')
        break
      case 'hardBreak':
        out.push('\n')
        break
      case 'image':
        out.push('[图片]')
        break
      case 'mermaid':
        out.push('[图表]')
        break
      case 'math':
      case 'mathBlock':
      case 'mathInline':
        out.push('[公式]')
        break
      case 'mention':
        out.push(`@${String((n.attrs as { label?: unknown } | undefined)?.label ?? '')}`)
        break
      case 'entryLink':
        out.push(String((n.attrs as { title?: unknown } | undefined)?.title ?? ''))
        break
      default:
        break
    }
    for (const c of n.content ?? []) walk(c)
    if (
      [
        'paragraph',
        'heading',
        'listItem',
        'taskItem',
        'codeBlock',
        'callout',
        'tableRow',
        'blockquote',
      ].includes(n.type)
    )
      out.push('\n')
    if (n.type === 'tableCell' || n.type === 'tableHeader') out.push('\t')
  }
  walk(doc)
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function deriveFromYdoc(bytes: Uint8Array): Derived {
  const doc = loadYdoc(bytes)
  try {
    // 客户端包装的未知节点（unknownBlock{raw}）还原为原节点：pm_json 永远是「真实」结构（03 §3.3、REQ-EDITOR-016）
    const pmJson = unwrapUnknownPm(yDocToProsemirrorJSON(doc, YDOC_FRAGMENT) as PmNode)
    const plain = fullPlain(pmJson)
    return { pmJson, plain, wordCount: wordCount(plain), tsvText: tsvText(plain) }
  } finally {
    doc.destroy()
  }
}

/** 任务描述 / 评论（liteKit，01 §3.2 §3.9）：service 同事务写入。 */
export function deriveFromPm(pmJson: PmNode | null): { plain: string; tsvText: string } {
  if (!pmJson) return { plain: '', tsvText: '' }
  const plain = pmToPlain(pmJson)
  return { plain, tsvText: tsvText(plain) }
}
