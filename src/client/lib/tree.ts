/**
 * 目录树纯函数（ADR-0012、REQ-KB-005）：组树 / 展平 / 拖放投影 / 键盘移动 → 服务端 `{ parentId, after }`。
 * 拖放投影沿用 dnd-kit 可排序树的做法：拖动时按水平位移换算深度，夹在「前一项深度 + 1」与「后一项深度」之间。
 */
export interface TreeNodeLite {
  id: string
  title: string
  kind: string
  typeId?: string | null
  parentId: string | null
  treeOrder: string
}
export interface FlatItem extends TreeNodeLite {
  depth: number
  hasChildren: boolean
  /** 直接子项数（折叠时显示在行尾，ADR-0015） */
  childCount: number
}
export interface MovePlan {
  parentId: string | null
  after: string | null
}

const byOrder = (a: TreeNodeLite, b: TreeNodeLite) =>
  a.treeOrder < b.treeOrder ? -1 : a.treeOrder > b.treeOrder ? 1 : a.id < b.id ? -1 : 1

export function childrenMap(nodes: readonly TreeNodeLite[]): Map<string | null, TreeNodeLite[]> {
  const m = new Map<string | null, TreeNodeLite[]>()
  for (const n of nodes) m.set(n.parentId, [...(m.get(n.parentId) ?? []), n])
  for (const list of m.values()) list.sort(byOrder)
  return m
}

/** 深度优先展平；`collapsed` 中的节点不展开其子树；`skip` 的子树整体跳过（拖动中的项）。 */
export function flatten(
  nodes: readonly TreeNodeLite[],
  collapsed: ReadonlySet<string> = new Set(),
  skipChildrenOf?: string,
): FlatItem[] {
  const kids = childrenMap(nodes)
  const out: FlatItem[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const n of kids.get(parent) ?? []) {
      const childCount = kids.get(n.id)?.length ?? 0
      const has = childCount > 0
      out.push({ ...n, depth, hasChildren: has, childCount })
      if (has && !collapsed.has(n.id) && n.id !== skipChildrenOf) walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** 过滤：保留标题命中的节点及其祖先。 */
export function filterTree(nodes: readonly TreeNodeLite[], q: string): TreeNodeLite[] {
  const s = q.trim().toLowerCase()
  if (!s) return [...nodes]
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const keep = new Set<string>()
  for (const n of nodes) {
    if (!n.title.toLowerCase().includes(s)) continue
    let cur: TreeNodeLite | undefined = n
    while (cur && !keep.has(cur.id)) {
      keep.add(cur.id)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
  }
  return nodes.filter((n) => keep.has(n.id))
}

function arrayMove<T>(a: T[], from: number, to: number): T[] {
  const r = [...a]
  const [x] = r.splice(from, 1)
  if (x !== undefined) r.splice(to, 0, x)
  return r
}

/**
 * 拖放投影：`items` 为拖动开始时的展平列表（已跳过被拖项子树），返回落点深度与父页，以及服务端 `after`。
 */
export function projectDrop(
  items: readonly FlatItem[],
  activeId: string,
  overId: string,
  offsetX: number,
  indent: number,
): (MovePlan & { depth: number }) | null {
  const from = items.findIndex((i) => i.id === activeId)
  const to = items.findIndex((i) => i.id === overId)
  const active = items[from]
  if (from < 0 || to < 0 || !active) return null
  const moved = arrayMove([...items], from, to)
  const prev = moved[to - 1]
  const next = moved[to + 1]
  const projected = active.depth + Math.round(offsetX / indent)
  const maxDepth = prev ? prev.depth + 1 : 0
  const minDepth = next ? next.depth : 0
  const depth = Math.max(minDepth, Math.min(projected, maxDepth))
  let parentId: string | null = null
  if (depth > 0 && prev) {
    if (depth === prev.depth) parentId = prev.parentId
    else if (depth > prev.depth) parentId = prev.id
    else
      parentId =
        moved
          .slice(0, to)
          .reverse()
          .find((i) => i.depth === depth)?.parentId ?? null
  }
  // after = 落点之前、同父页的最近一项
  const after =
    moved
      .slice(0, to)
      .reverse()
      .find((i) => i.parentId === parentId && i.depth === depth && i.id !== activeId)?.id ?? null
  if (parentId === active.parentId && after === prevSiblingId(items, active)) return null // 没动
  return { parentId, after, depth }
}

function prevSiblingId(items: readonly FlatItem[], node: FlatItem): string | null {
  const sibs = items.filter((i) => i.parentId === node.parentId)
  const i = sibs.findIndex((s) => s.id === node.id)
  return i > 0 ? (sibs[i - 1]?.id ?? null) : null
}

/** 键盘 / 按钮移动（上移 / 下移 / 缩进 / 取消缩进）。不可移动时返回 null。 */
export function keyboardMove(
  nodes: readonly TreeNodeLite[],
  id: string,
  op: 'up' | 'down' | 'indent' | 'outdent',
): MovePlan | null {
  const kids = childrenMap(nodes)
  const node = nodes.find((n) => n.id === id)
  if (!node) return null
  const sibs = kids.get(node.parentId) ?? []
  const i = sibs.findIndex((s) => s.id === id)
  switch (op) {
    case 'up':
      if (i <= 0) return null
      return { parentId: node.parentId, after: i >= 2 ? (sibs[i - 2]?.id ?? null) : null }
    case 'down':
      if (i < 0 || i >= sibs.length - 1) return null
      return { parentId: node.parentId, after: sibs[i + 1]?.id ?? null }
    case 'indent': {
      const prev = sibs[i - 1]
      if (!prev) return null
      const pk = kids.get(prev.id) ?? []
      return { parentId: prev.id, after: pk.at(-1)?.id ?? null }
    }
    case 'outdent': {
      if (!node.parentId) return null
      const parent = nodes.find((n) => n.id === node.parentId)
      return { parentId: parent?.parentId ?? null, after: node.parentId }
    }
  }
}

/** 根级末尾（「加入目录」用）。 */
export const appendRoot = (nodes: readonly TreeNodeLite[]): MovePlan => ({
  parentId: null,
  after: childrenMap(nodes).get(null)?.at(-1)?.id ?? null,
})
