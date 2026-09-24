/** 最近访问（08 §2.11：空 q 显示最近访问）：本机 localStorage，最多 20 个 id（任务与记录混排，新的在前）。 */
const KEY = 'xz:recent'
const MAX = 20

export function recentIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

export function pushRecent(id: string): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, MAX)),
    )
  } catch {
    /* 隐私模式等：忽略 */
  }
}
