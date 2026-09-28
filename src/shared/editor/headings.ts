/**
 * 标题收集与章节编号（ADR-0024 §4、REQ-READ-004）：正文装饰、Aside 大纲、目录块三处同一算法。
 * 编号只是显示层（不写进正文）；跳级压缩：h1 → h2 → h4 编为 1 / 1.1 / 1.1.1，文档从 h2 起也从 1 开始。
 */

/** 与 ProseMirror Node 结构兼容的最小形状（前端传 editor.state.doc，单测传假节点）。 */
export interface HeadingSource {
  descendants: (
    f: (
      n: { type: { name: string }; attrs: Record<string, unknown>; textContent: string },
      pos: number,
    ) => boolean | undefined,
  ) => void
}

export interface HeadingItem {
  level: number
  text: string
  pos: number
  /** 章节编号，如 "2.1" */
  num: string
  /** 编号层级（1 起）：大纲缩进与「目录深度」按它算，而不是按 h 级别 */
  depth: number
}

/** 按层级序列算编号与层级。 */
export function numberHeadings(levels: number[]): { num: string; depth: number }[] {
  const stack: { level: number; n: number }[] = []
  return levels.map((level) => {
    // 弹出更深的层级；若新标题落在被弹出者的同一深度（如 h4 之后的 h3），续接其计数而不是从 1 重来
    let popped: { level: number; n: number } | undefined
    while (stack.length && (stack[stack.length - 1] as { level: number }).level > level)
      popped = stack.pop()
    const top = stack[stack.length - 1]
    if (top && top.level === level) top.n += 1
    else stack.push({ level, n: popped ? popped.n + 1 : 1 })
    return { num: stack.map((s) => s.n).join('.'), depth: stack.length }
  })
}

/** 收集全部标题（含 callout / details / 表格里的），不进标题内部。 */
export function collectHeadings(doc: HeadingSource): HeadingItem[] {
  const raw: { level: number; text: string; pos: number }[] = []
  doc.descendants((n, pos) => {
    if (n.type.name !== 'heading') return true
    raw.push({ level: Number(n.attrs.level), text: n.textContent, pos })
    return false
  })
  const nums = numberHeadings(raw.map((h) => h.level))
  return raw.map((h, i) => ({ ...h, ...(nums[i] as { num: string; depth: number }) }))
}
