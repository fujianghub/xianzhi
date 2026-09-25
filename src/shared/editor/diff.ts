/**
 * 顶层块级对比（REQ-COLLAB-008）：collab 恢复与前端「对比当前」共用同一 LCS，保证「预览所见 = 恢复所得」。
 * 块相等 = PM JSON 规范化序列化相等（键排序，不受 jsonb 重排影响）。
 */
import type { PmNode } from '../schemas/pm.ts'

/** 最长公共子序列的配对（a 下标 → b 下标）。块数通常几十到几百，O(n·m) 足够。 */
export function lcsPairs(a: string[], b: string[]): Map<number, number> {
  const n = a.length
  const m = b.length
  const dp = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[at(i, j)] =
        a[i] === b[j]
          ? (dp[at(i + 1, j + 1)] ?? 0) + 1
          : Math.max(dp[at(i + 1, j)] ?? 0, dp[at(i, j + 1)] ?? 0)
  const pairs = new Map<number, number>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.set(i, j)
      i++
      j++
    } else if ((dp[at(i + 1, j)] ?? 0) >= (dp[at(i, j + 1)] ?? 0)) i++
    else j++
  }
  return pairs
}

export type BlockOp = 'same' | 'add' | 'del'

/**
 * 当前 → 目标（快照）的块级差异，按阅读顺序合并：
 * `add` = 目标有、当前无（恢复后会出现）；`del` = 当前有、目标无（恢复后会消失）。
 */
export function diffBlocks(current: PmNode[], target: PmNode[]): { node: PmNode; op: BlockOp }[] {
  const pairs = lcsPairs(current.map(keyOf), target.map(keyOf))
  const out: { node: PmNode; op: BlockOp }[] = []
  let i = 0
  let j = 0
  const flush = (ci: number, tj: number) => {
    for (; i < ci; i++) out.push({ node: current[i] as PmNode, op: 'del' })
    for (; j < tj; j++) out.push({ node: target[j] as PmNode, op: 'add' })
  }
  for (const [ci, tj] of pairs) {
    flush(ci, tj)
    out.push({ node: target[j] as PmNode, op: 'same' })
    i++
    j++
  }
  flush(current.length, target.length)
  return out
}

/** 规范化序列化（对象键排序）：pm_json 经 jsonb 存取后键序会变（jsonb 按键长 + 字典序重排）。 */
export function keyOf(n: unknown): string {
  return JSON.stringify(n, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  )
}
