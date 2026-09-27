/**
 * 页面登记「在这里按 e / 新建记录」的上下文（ADR-0018、REQ-ENTRY-022）：挂载时登记、卸载或变化时只撤自己那份。
 * 空间页 → { spaceId, parentId: null }（进该空间目录根）；记录页 → 同级（见 entryPageContext）。
 */
import { useEffect } from 'react'
import { type NewEntryDefaults, useNewEntry } from '../lib/stores.ts'

export function useNewEntryContext(d: NewEntryDefaults | null | undefined) {
  const register = useNewEntry((s) => s.register)
  const key = d ? JSON.stringify(d) : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: 按内容（key）而非引用重登记
  useEffect(() => {
    if (!d) return
    return register(d)
  }, [key, register])
}

/**
 * 记录页的「同级」上下文：同一空间；在目录里 → 同一父页下（根级 = null）；不在目录 → 也不进目录。
 */
export function entryPageContext(e: {
  spaceId: string
  parentId: string | null
  treeOrder: string | null
}): NewEntryDefaults {
  return e.treeOrder !== null
    ? { spaceId: e.spaceId, parentId: e.parentId ?? null }
    : { spaceId: e.spaceId }
}
