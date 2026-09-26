/**
 * 目录树层级引导线（ADR-0015、REQ-KB-006）：给第 depth 级的行画 depth 条祖先竖线，
 * 第 k 条位于 `x0 + k * indent`（= 第 k 级祖先展开指示的中心）；最近一级更深，当前行的最近一级为主色。
 * 行容器须 `position: relative` 且行间无间隙，竖线才能连成一条。
 */
export function TreeGuides({
  depth,
  x0,
  indent,
  active,
}: {
  depth: number
  x0: number
  indent: number
  active?: boolean
}) {
  if (depth <= 0) return null
  return Array.from({ length: depth }, (_, k) => (
    <span
      // biome-ignore lint/suspicious/noArrayIndexKey: 竖线按层级固定，无重排
      key={k}
      className="xz-guide"
      style={{ insetInlineStart: `${x0 + k * indent}px` }}
      data-near={k === depth - 1 || undefined}
      data-active={(active && k === depth - 1) || undefined}
      aria-hidden
    />
  ))
}

/** 字重按层级递减：L0 600 · L1 500 · 其余 400（app.css）。 */
export const treeLevelClass = (depth: number) =>
  depth === 0 ? 'xz-tree-l0' : depth === 1 ? 'xz-tree-l1' : ''

/** 展平列表中每项相对其父项的序号（展开入场错峰用）。 */
export function staggerIndex<T extends { id: string; parentId: string | null }>(
  items: readonly T[],
): Map<string, number> {
  const pos = new Map(items.map((it, i) => [it.id, i]))
  return new Map(
    items.map((it, i) => [it.id, it.parentId ? i - (pos.get(it.parentId) ?? i) - 1 : 0]),
  )
}
