/**
 * 乐观更新模板（04 §6、02 §11、REQ-UI-010 · REQ-TASK-012）：
 * 立即改缓存 → 发请求；成功用服务端返回值覆盖；409 CONFLICT_STALE 用 problem.current 覆盖缓存并提示；
 * 其他失败回滚快照并 Toast。前端所有单对象写操作走它。
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { ApiError } from './api.ts'

export interface OptimisticOptions<T> {
  qc: QueryClient
  /** 该对象所在的缓存键（详情 + 若干列表），逐个应用 apply */
  keys: QueryKey[]
  /** 在一份缓存数据上应用改动（列表与详情形态不同，调用方自己处理），返回新数据 */
  apply: (data: unknown, key: QueryKey) => unknown
  /** 服务端返回的新对象 / 409 的 current 如何写回缓存 */
  settle?: (data: unknown, server: T, key: QueryKey) => unknown
  request: () => Promise<T>
  onError?: (message: string, err: unknown) => void
  onConflict?: (current: T) => void
}

export async function optimisticPatch<T>(o: OptimisticOptions<T>): Promise<T> {
  const snapshots = o.keys.map((k) => [k, o.qc.getQueryData(k)] as const)
  for (const k of o.keys) {
    await o.qc.cancelQueries({ queryKey: k })
    o.qc.setQueryData(k, (old: unknown) => (old === undefined ? old : o.apply(old, k)))
  }
  const writeBack = (server: T) => {
    for (const k of o.keys)
      o.qc.setQueryData(k, (old: unknown) =>
        old === undefined || !o.settle ? old : o.settle(old, server, k),
      )
  }
  try {
    const res = await o.request()
    writeBack(res)
    return res
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.status === 409 &&
      err.code === 'CONFLICT_STALE' &&
      err.problem.current
    ) {
      const current = err.problem.current as T
      // 先回到快照再写入服务端最新值，避免本地改动残留
      for (const [k, v] of snapshots) o.qc.setQueryData(k, v)
      writeBack(current)
      o.onConflict?.(current)
    } else {
      for (const [k, v] of snapshots) o.qc.setQueryData(k, v)
      o.onError?.(err instanceof ApiError ? err.message : String(err), err)
    }
    throw err
  }
}
