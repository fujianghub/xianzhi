import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PALETTE_COLORS } from '../../shared/schemas/enums.ts'
import { BLOCK } from '../components/calendar/parts.tsx'
import { PALETTE_CLASS, PALETTE_DOT } from '../components/domain/SpaceIcon.tsx'

const css = (f: string) => readFileSync(new URL(`../styles/${f}`, import.meta.url), 'utf8')

describe('ADR-0010 鲜艳色板', () => {
  it('REQ-UI-035 9 色；每色 solid / bg / fg 两主题都有 token 并映射到 Tailwind；类名表齐全', () => {
    expect([...PALETTE_COLORS]).toEqual([
      'blue',
      'orange',
      'yellow',
      'red',
      'green',
      'purple',
      'pink',
      'cyan',
      'gray',
    ])
    const tokens = css('tokens.css')
    const app = css('app.css')
    for (const c of PALETTE_COLORS) {
      for (const k of ['solid', 'bg', 'fg']) {
        // 日场 + 夜场各一处
        expect(tokens.match(new RegExp(`--xz-palette-${c}-${k}:`, 'g'))?.length, `${c}-${k}`).toBe(
          2,
        )
        expect(app).toContain(`--color-${c}-${k}: var(--xz-palette-${c}-${k});`)
      }
      expect(PALETTE_CLASS[c]).toBe(`bg-${c}-bg text-${c}-fg`)
      expect(PALETTE_DOT[c]).toBe(`bg-${c}-solid`)
      // 日历色块 = 浅底 + 同色深字 + 鲜艳色条
      expect(BLOCK[c]).toBe(`bg-${c}-bg text-${c}-fg border-${c}-solid`)
    }
    expect(tokens).not.toMatch(/--xz-palette-(moss|amber|indigo|ochre|teal|plum|pine)-/)
  })
})
