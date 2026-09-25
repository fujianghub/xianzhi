/**
 * 历史版本（03 §5、REQ-COLLAB-008）：快照只存 state vector + delete set，取旧状态必须以 gc:false 的当前文档为源
 * （`Y.createDocFromSnapshot`；CLAUDE.md 不变量 7）。
 * 恢复 =「把旧状态作为一次普通修改写进当前文档」，不覆盖 ydoc：顶层块按 LCS 对齐，未变的块保留 CRDT 身份，
 * 其余删掉 / 从旧文档克隆插入；于是 ydoc_version 前进、快照不减、协同端实时收到。
 */
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror'
import * as Y from 'yjs'
import { keyOf, lcsPairs } from '../shared/editor/diff.ts'
import { unwrapUnknownPm } from '../shared/editor/unknown.ts'
import type { PmNode } from '../shared/schemas/pm.ts'
import { loadYdoc, YDOC_FRAGMENT } from './derive.ts'

export function docAtSnapshot(origin: Y.Doc, snapshot: Uint8Array): Y.Doc {
  return Y.createDocFromSnapshot(origin, Y.decodeSnapshot(snapshot), new Y.Doc({ gc: false }))
}

/** 快照时刻的正文（PM JSON，已还原 unknownBlock，与 pm_json 同口径）。 */
export function snapshotPmJson(ydoc: Uint8Array, snapshot: Uint8Array): PmNode {
  const origin = loadYdoc(ydoc)
  try {
    const old = docAtSnapshot(origin, snapshot)
    try {
      return unwrapUnknownPm(
        yXmlFragmentToProsemirrorJSON(old.getXmlFragment(YDOC_FRAGMENT)) as PmNode,
      )
    } finally {
      old.destroy()
    }
  } finally {
    origin.destroy()
  }
}

const blockKeys = (frag: Y.XmlFragment): string[] =>
  (yXmlFragmentToProsemirrorJSON(frag).content ?? []).map(keyOf)

/**
 * 把 `doc` 的正文改回 `snapshot` 时刻的状态（调用方负责放进一次 transact）。
 * 返回统计，供日志 / 测试。
 */
export function restoreFragment(
  doc: Y.Doc,
  snapshot: Uint8Array,
): { kept: number; removed: number; inserted: number } {
  const old = docAtSnapshot(doc, snapshot)
  try {
    const frag = doc.getXmlFragment(YDOC_FRAGMENT)
    const oldFrag = old.getXmlFragment(YDOC_FRAGMENT)
    const pairs = lcsPairs(blockKeys(frag), blockKeys(oldFrag))
    const matchedOld = new Set(pairs.values())
    const curLen = frag.length
    let removed = 0
    for (let i = curLen - 1; i >= 0; i--) {
      if (pairs.has(i)) continue
      frag.delete(i, 1)
      removed++
    }
    let pos = 0
    let inserted = 0
    oldFrag.toArray().forEach((node, j) => {
      if (!matchedOld.has(j)) {
        frag.insert(pos, [(node as Y.XmlElement | Y.XmlText).clone()])
        inserted++
      }
      pos++
    })
    return { kept: pairs.size, removed, inserted }
  } finally {
    old.destroy()
  }
}
