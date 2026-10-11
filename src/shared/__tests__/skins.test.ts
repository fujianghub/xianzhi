/** 皮肤 token 生成（ADR-0059）：17 个实测主题包的 palette（只含色值）+ 边界输入。 */
import { describe, expect, it } from 'vitest'
import { contrastRatio, over, parseColor } from '../contrast.ts'
import {
  inferMode,
  normalizeFocal,
  normalizePalette,
  type SkinRecord,
  skinCss,
  skinTokens,
  slugSkinId,
} from '../skins.ts'
import palettes from './fixtures/skin-palettes.json' with { type: 'json' }

const rec = (id: string, mode: 'light' | 'dark', palette: Record<string, string>): SkinRecord => ({
  schema: 1,
  id,
  name: id,
  description: '',
  author: '',
  mode,
  version: '1.0.0',
  palette,
  focal: '50% 50%',
  art: true,
  source: { kind: 'file', ref: 'x' },
  installedAt: '2026-10-11T00:00:00Z',
})

const r = (fg: string, bg: string) => contrastRatio(parseColor(fg), parseColor(bg))

describe('REQ-UI-061 皮肤 token 对比度', () => {
  for (const [id, p] of Object.entries(palettes)) {
    it(`REQ-UI-061 ${id}：文字 / 主色 / 危险色在最坏玻璃底与纸面上达标`, () => {
      const mode = p.mode === 'dark' ? 'dark' : 'light'
      const { vars: v } = skinTokens(rec(slugSkinId(id), mode, p.palette))
      const worst = over(
        parseColor(v['--xz-glass-thin'] as string),
        over(parseColor(v['--xz-glow-1'] as string), parseColor(v['--xz-bg'] as string)),
      )
      const hexOf = ([a, b, c]: number[]) =>
        `#${[a, b, c]
          .map((x) =>
            Math.round(x as number)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`
      const backs = [hexOf(worst), v['--xz-surface-solid'] as string, v['--xz-bg'] as string]
      for (const b of backs) {
        expect(r(v['--xz-fg'] as string, b)).toBeGreaterThanOrEqual(7)
        expect(r(v['--xz-fg-muted'] as string, b)).toBeGreaterThanOrEqual(4.5)
        expect(r(v['--xz-fg-faint'] as string, b)).toBeGreaterThanOrEqual(3)
        expect(r(v['--xz-primary-text'] as string, b)).toBeGreaterThanOrEqual(4.5)
      }
      expect(r(v['--xz-primary-fg'] as string, v['--xz-primary'] as string)).toBeGreaterThanOrEqual(
        4.5,
      )
      expect(
        r(v['--xz-primary-fg'] as string, v['--xz-primary-bright'] as string),
      ).toBeGreaterThanOrEqual(4.5)
      if (v['--xz-danger']) {
        expect(r(v['--xz-danger'] as string, v['--xz-bg'] as string)).toBeGreaterThanOrEqual(4.5)
        expect(
          r(v['--xz-danger'] as string, v['--xz-danger-soft'] as string),
        ).toBeGreaterThanOrEqual(4.5)
        expect(r(v['--xz-danger-fg'] as string, v['--xz-danger'] as string)).toBeGreaterThanOrEqual(
          4.5,
        )
      }
      // 底板明度留在本模式范围内（九色板 / 图标色沿用该模式原值，按原模式底板校过）
      const L = contrastRatio(parseColor(v['--xz-bg'] as string), [0, 0, 0, 1])
      if (mode === 'dark') expect(L).toBeLessThan(1.8)
      else expect(L).toBeGreaterThan(15)
    })
  }

  it('REQ-UI-061 缺色 / 极端色也能生成达标 token', () => {
    for (const [mode, palette] of [
      ['dark', {}],
      ['light', {}],
      ['dark', { canvas: '#ffffff', text: '#ffffff', accent: '#000000' }],
      ['light', { canvas: '#000000', text: '#fefefe', accent: '#ffff00' }],
    ] as const) {
      const { vars: v } = skinTokens(rec('x', mode, palette))
      expect(r(v['--xz-fg'] as string, v['--xz-surface-solid'] as string)).toBeGreaterThanOrEqual(7)
      expect(r(v['--xz-primary-fg'] as string, v['--xz-primary'] as string)).toBeGreaterThanOrEqual(
        4.5,
      )
    }
  })
})

describe('REQ-UI-056 主题包规范化', () => {
  it('REQ-UI-056 palette 只收 hex，"native unchanged" 等丢弃', () => {
    expect(
      normalizePalette({ canvas: '#0B1728', border: 'native unchanged', text: 'red', x: '#fff' }),
    ).toEqual({ canvas: '#0b1728' })
  })
  it('REQ-UI-056 焦点只认百分比，其余居中', () => {
    expect(normalizeFocal('62% 58%')).toBe('62% 58%')
    expect(normalizeFocal('center')).toBe('50% 50%')
    expect(normalizeFocal('150% 3.4%')).toBe('100% 3%')
    expect(normalizeFocal('1%;}body{x:1')).toBe('50% 50%')
  })
  it('REQ-UI-056 id 规范化 / 保留字', () => {
    expect(slugSkinId('Theme_1790220895883')).toBe('theme-1790220895883')
    expect(slugSkinId('../etc')).toBe('etc')
    expect(slugSkinId('none')).toBe('')
    expect(slugSkinId('***')).toBe('')
  })
  it('REQ-UI-056 mode 缺失时按 canvas 明度推断', () => {
    expect(inferMode({ canvas: '#0b1728' })).toBe('dark')
    expect(inferMode({ canvas: '#fffaf6' })).toBe('light')
    expect(inferMode({})).toBe('light')
  })
})

describe('REQ-UI-059 皮肤样式表', () => {
  it('REQ-UI-059 选择器按 id 限定，含减弱透明度块与背景图地址', () => {
    const css = skinCss(rec('orbital-halo', 'dark', { canvas: '#0b1728', accent: '#91d9f2' }))
    expect(css).toContain(':root[data-skin="orbital-halo"] {')
    expect(css).toContain('color-scheme: dark;')
    expect(css).toContain('--xz-skin-art: url("/api/v1/skins/orbital-halo/art?v=1.0.0");')
    expect(css).toContain('@media (prefers-reduced-transparency: reduce), print')
    expect(css).toContain(':root[data-transparency="reduce"][data-skin="orbital-halo"]')
    expect(css).not.toMatch(/!important|<|javascript:/)
  })
  it('REQ-UI-059 非法 id / 版本拒绝生成', () => {
    expect(() => skinCss({ ...rec('a', 'dark', {}), id: 'a"]{}' })).toThrow()
    expect(() => skinCss({ ...rec('a', 'dark', {}), version: '1;}' })).toThrow()
  })
  it('REQ-UI-059 无背景图 = 纯配色', () => {
    expect(skinCss({ ...rec('qq', 'light', {}), art: false })).toContain('--xz-skin-art: none;')
  })
})

describe('REQ-UI-065 图片强度', () => {
  const alpha = (v: string) => Number(/,\s*([\d.]+)\)$/.exec(v)?.[1] ?? 1)
  it('REQ-UI-065 三档材质：遮罩 / 玻璃 / 卡片由淡到浓递减；淡档卡片实底、无光晕；基础块 = 中档', () => {
    for (const mode of ['dark', 'light'] as const) {
      const t = skinTokens(rec('x', mode, { canvas: mode === 'dark' ? '#0b1728' : '#fffaf6' }))
      const { soft, medium, strong } = t.levels
      for (const k of ['--xz-skin-veil', '--xz-glass-thin', '--xz-glass', '--xz-glass-thick']) {
        expect(alpha(soft[k] as string)).toBeGreaterThan(alpha(medium[k] as string))
        expect(alpha(medium[k] as string)).toBeGreaterThan(alpha(strong[k] as string))
      }
      expect(soft['--xz-paper-bg']).toBe('var(--xz-surface-solid)')
      expect(alpha(strong['--xz-paper-bg'] as string)).toBeLessThan(
        alpha(medium['--xz-paper-bg'] as string),
      )
      expect(soft['--xz-skin-halo']).toBe('transparent')
      expect(medium['--xz-skin-halo']).not.toBe('transparent')
      for (const [k, v] of Object.entries(medium)) expect(t.vars[k], k).toBe(v)
    }
  })

  it('REQ-UI-065 样式表含淡 / 浓档块；减弱透明度块压过档位（同特异度且在后）', () => {
    const css = skinCss(rec('orbital-halo', 'dark', { canvas: '#0b1728' }))
    const soft = css.indexOf(':root[data-skin="orbital-halo"][data-skin-art="soft"]')
    const strong = css.indexOf(':root[data-skin="orbital-halo"][data-skin-art="strong"]')
    const media = css.indexOf(
      ':root[data-skin="orbital-halo"][data-skin-art] {',
      css.indexOf('@media'),
    )
    const reduce = css.indexOf(
      ':root[data-transparency="reduce"][data-skin="orbital-halo"][data-skin-art]',
    )
    expect(soft).toBeGreaterThan(0)
    expect(strong).toBeGreaterThan(soft)
    expect(media).toBeGreaterThan(strong)
    expect(reduce).toBeGreaterThan(strong)
  })
})
