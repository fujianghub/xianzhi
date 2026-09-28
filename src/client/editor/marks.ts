/**
 * 颜色标记（ADR-0025 §7，修订 03 §3.1）：文字色 `textColor` 与背景色（highlight 的 `color`）只存 9 色板 key，
 * 渲染成 `data-text-color` / `data-color`，由 app.css 映射到 `--xz-palette-*-fg / -bg`（夜场自动）。
 * 解析只认色板 key：外部粘贴的 style 色值、任意字符串一律丢弃（03 §11.3「粘贴剥色」仍成立）。
 */
import { Mark, mergeAttributes } from '@tiptap/core'
import { Highlight } from '@tiptap/extension-highlight'
import { PALETTE_COLORS, type PaletteColor } from '../../shared/schemas/enums.ts'

export const paletteKey = (v: unknown): PaletteColor | null =>
  typeof v === 'string' && (PALETTE_COLORS as readonly string[]).includes(v)
    ? (v as PaletteColor)
    : null

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: PaletteColor) => ReturnType
      unsetTextColor: () => ReturnType
    }
  }
}

/** 背景色：沿用 highlight 标记（旧数据无 color = 默认黄），不走官方 multicolor（它会写 style 色值）。 */
export const XzHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => paletteKey(el.getAttribute('data-color')),
        renderHTML: (attrs: { color?: string | null }) =>
          paletteKey(attrs.color) ? { 'data-color': attrs.color } : {},
      },
    }
  },
})

export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => paletteKey(el.getAttribute('data-text-color')),
        renderHTML: (attrs: { color?: string | null }) =>
          paletteKey(attrs.color) ? { 'data-text-color': attrs.color } : {},
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-text-color]',
        getAttrs: (el) =>
          paletteKey((el as HTMLElement).getAttribute('data-text-color')) ? null : false,
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})
