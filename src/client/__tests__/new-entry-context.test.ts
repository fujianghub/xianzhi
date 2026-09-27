import { describe, expect, it } from 'vitest'
import { entryPageContext } from '../hooks/useNewEntryContext.ts'
import { pickNewEntryDefaults, useNewEntry } from '../lib/stores.ts'

describe('新建记录上下文（ADR-0018）', () => {
  it('REQ-ENTRY-022 一次性默认值优先；否则取最后登记的页面上下文；撤销只撤自己那份；打开时冻结', () => {
    expect(pickNewEntryDefaults(undefined, [])).toEqual({})
    const st = useNewEntry.getState()
    const offSpace = st.register({ spaceId: 's1', parentId: null })
    const offEntry = useNewEntry.getState().register({ spaceId: 's1', parentId: 'p1' })
    useNewEntry.getState().setOpen(true)
    expect(useNewEntry.getState().defaults).toEqual({ spaceId: 's1', parentId: 'p1' })
    // 打开期间上下文变化不影响已冻结的默认值
    offEntry()
    expect(useNewEntry.getState().defaults).toEqual({ spaceId: 's1', parentId: 'p1' })
    useNewEntry.getState().setOpen(false)
    // 一次性默认值只作用于这一次；下次按 e 回到页面上下文（修旧位置沿用）
    useNewEntry.getState().setOpen(true, { spaceId: 's2', parentId: 'x' })
    expect(useNewEntry.getState().defaults).toEqual({ spaceId: 's2', parentId: 'x' })
    useNewEntry.getState().setOpen(false)
    useNewEntry.getState().setOpen(true)
    expect(useNewEntry.getState().defaults).toEqual({ spaceId: 's1', parentId: null })
    useNewEntry.getState().setOpen(false)
    offSpace()
    useNewEntry.getState().setOpen(true)
    expect(useNewEntry.getState().defaults).toEqual({})
    useNewEntry.getState().setOpen(false)
  })

  it('REQ-ENTRY-022 记录页 = 同级：在目录里 → 同一父页（根级 null）；不在目录 → 也不进目录', () => {
    expect(entryPageContext({ spaceId: 's', parentId: 'p', treeOrder: 'a0' })).toEqual({
      spaceId: 's',
      parentId: 'p',
    })
    expect(entryPageContext({ spaceId: 's', parentId: null, treeOrder: 'a0' })).toEqual({
      spaceId: 's',
      parentId: null,
    })
    expect(entryPageContext({ spaceId: 's', parentId: null, treeOrder: null })).toEqual({
      spaceId: 's',
    })
  })
})
