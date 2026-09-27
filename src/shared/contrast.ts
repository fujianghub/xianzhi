/**
 * WCAG 对比度计算（06 §7、REQ-UI-003）：`scripts/check-contrast.ts` 与画廊对比度表（ADR-0020）共用。
 * 颜色为 0–255 的 sRGB + 0–1 alpha；半透明前景先用 `over()` 合成到底色上再算。
 */
export type RGBA = [number, number, number, number]

/** 解析 `#rrggbb` / `rgb()` / `rgba()`；其它格式抛错（tokens.css 只用这三种）。 */
export function parseColor(v: string): RGBA {
  const s = v.trim().toLowerCase()
  let m = /^#([0-9a-f]{6})$/.exec(s)
  if (m) {
    const n = Number.parseInt(m[1] as string, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s)
  if (m) {
    const p = (m[1] as string).split(',').map((x) => Number.parseFloat(x))
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1]
  }
  throw new Error(`无法解析颜色：${v}`)
}

/** top 以其 alpha 叠在 bottom 上，结果不透明。 */
export const over = (top: RGBA, bottom: RGBA): RGBA => {
  const a = top[3]
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ]
}

const lum = ([r, g, b]: RGBA) => {
  const f = (c: number) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** 两色（均视为不透明）的对比度，1–21。 */
export const contrastRatio = (a: RGBA, b: RGBA) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (l1 + 0.05) / (l2 + 0.05)
}
