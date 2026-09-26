import { describe, expect, it } from 'vitest'
import { BUILTIN_ENTRY_KINDS } from '../../shared/schemas/enums.ts'
import { ENTRY_KIND_TONE, entryKindClass } from '../components/domain/EntryCard.tsx'
import { PALETTE } from '../components/domain/SpaceIcon.tsx'

describe('记录类型色', () => {
  // 自定义类型（ADR-0016）的颜色由用户选，不在固定映射里
  it('REQ-UI-033 每种内置记录类型都映射到 04 §2.1 色板，且彼此不同', () => {
    const tones = BUILTIN_ENTRY_KINDS.map((k) => ENTRY_KIND_TONE[k])
    for (const t of tones) expect(PALETTE).toContain(t)
    expect(new Set(tones).size).toBe(BUILTIN_ENTRY_KINDS.length)
    expect(entryKindClass('decision')).toBe('bg-blue-bg text-blue-fg')
    expect(entryKindClass('unknown')).toBe('bg-gray-bg text-gray-fg')
  })
})
