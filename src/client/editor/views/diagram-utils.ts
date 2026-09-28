/**
 * 图表 / 公式渲染的公共工具（ADR-0025 §8、03 §3.2 · §12）：
 * - `neutralizeNoteListMarkers`：Mermaid note 块内的 `1.` / `-` 列表行会被当成一个 markdown 列表，
 *   宽度需折行时 splitLineToFitWidth 抛错、整图不渲染（上游 bug）；在标记与分隔符之间插 U+2060（沿用简斋）。
 * - `onIdle`：渲染放 requestIdleCallback，Safari 无此 API 时退回 setTimeout。
 * - `serial`：Mermaid 只有一份全局配置，initialize → render 必须串行，否则主题会串到别的图上。
 */

const NOTE_BLOCK_START = /^\s*note\s+(?:left|right)\s+of\s+[^:]+$/i
const NOTE_BLOCK_END = /^\s*end\s+note\s*$/i
const ORDERED_MARKER = /^(\s*)(\d+)([.)])(\s)/
const BULLET_MARKER = /^(\s*)([-*+])(\s)/
const WJ = '⁠'

export function neutralizeNoteListMarkers(source: string): string {
  if (!/\bnote\b/i.test(source)) return source
  let inNote = false
  return source
    .split('\n')
    .map((line) => {
      if (inNote) {
        if (NOTE_BLOCK_END.test(line)) {
          inNote = false
          return line
        }
        return line.replace(ORDERED_MARKER, `$1$2${WJ}$3$4`).replace(BULLET_MARKER, `$1$2${WJ}$3`)
      }
      if (NOTE_BLOCK_START.test(line)) inNote = true
      return line
    })
    .join('\n')
}

/** 在空闲时执行；返回取消函数。 */
export function onIdle(fn: () => void): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 600 })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(fn, 16)
  return () => window.clearTimeout(id)
}

let chain: Promise<unknown> = Promise.resolve()
/** 串行执行（上一次失败不影响下一次）。 */
export function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task)
  chain = next.catch(() => undefined)
  return next
}

/** 当前主题（lib/theme.ts 写 html[data-theme]）。 */
export const currentDark = () => document.documentElement.dataset.theme === 'dark'

/** 监听 html[data-theme] 变化；返回取消函数。 */
export function onThemeChange(fn: () => void): () => void {
  const mo = new MutationObserver(fn)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}

/** 把 mermaid 的解析错误压成一段可读文字（保留「第 N 行」信息）。 */
export function mermaidErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  return raw.trim().split('\n').slice(0, 4).join('\n')
}
