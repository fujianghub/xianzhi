/** ADR-0025 §7：HTML 导出的颜色表必须等于 tokens.css 日场的 9 色板取值（防漂移）。 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXPORT_PALETTE } from '../editor/serializers/html.ts'
import { PALETTE_COLORS } from '../schemas/enums.ts'

const css = readFileSync(new URL('../../client/styles/tokens.css', import.meta.url), 'utf8')
const light = css.slice(0, css.indexOf('[data-theme="dark"]'))
const token = (name: string) =>
  new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(light)?.[1]?.toLowerCase()

describe('export palette', () => {
  it('REQ-EDITOR-031 导出色表 = tokens.css 日场 --xz-palette-*-fg / -bg', () => {
    for (const c of PALETTE_COLORS) {
      expect(EXPORT_PALETTE[c]?.fg, `${c} fg`).toBe(token(`--xz-palette-${c}-fg`))
      expect(EXPORT_PALETTE[c]?.bg, `${c} bg`).toBe(token(`--xz-palette-${c}-bg`))
    }
  })
})
