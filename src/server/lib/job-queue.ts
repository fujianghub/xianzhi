/**
 * 作业队列抽象（02 §8）：API 进程只负责入队与查询状态；执行在 worker（jobs/index.ts startWorker）。
 * 生产用 pg-boss（只发不收的实例，懒启动）；测试可注入 inlineQueue 就地执行。
 */
import type { PgBoss } from 'pg-boss'

export type JobState = 'queued' | 'active' | 'completed' | 'failed'
export interface JobInfo {
  id: string
  name: string
  state: JobState
  data: Record<string, unknown>
  output: Record<string, unknown> | null
  createdAt: string
  completedAt: string | null
}
export interface JobQueue {
  send(name: string, data: Record<string, unknown>): Promise<string>
  get(name: string, id: string): Promise<JobInfo | null>
}

const STATE: Record<string, JobState> = {
  created: 'queued',
  retry: 'queued',
  active: 'active',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'failed',
}

export function pgBossQueue(start: () => Promise<PgBoss>): JobQueue {
  let boss: Promise<PgBoss> | undefined
  const get = () => {
    boss ??= start().catch((err) => {
      boss = undefined
      throw err
    })
    return boss
  }
  return {
    async send(name, data) {
      const b = await get()
      await b.createQueue(name).catch(() => undefined) // 已存在则忽略（worker 会以正式参数创建）
      const id = await b.send(name, data, { retryLimit: 0 })
      if (!id) throw new Error(`入队失败：${name}`)
      return id
    },
    async get(name, id) {
      const j = await (await get()).getJobById<Record<string, unknown>>(name, id)
      if (!j) return null
      return {
        id: j.id,
        name: j.name,
        state: STATE[j.state] ?? 'queued',
        data: (j.data ?? {}) as Record<string, unknown>,
        output: (j.output ?? null) as Record<string, unknown> | null,
        createdAt: new Date(j.createdOn).toISOString(),
        completedAt: j.completedOn ? new Date(j.completedOn).toISOString() : null,
      }
    },
  }
}

/** 测试用：send 时立即执行处理函数，结果存内存（状态机与 pg-boss 一致：completed / failed）。 */
export function inlineQueue(
  handlers: Record<string, (data: Record<string, unknown>, jobId: string) => Promise<unknown>>,
): JobQueue & { jobs: Map<string, JobInfo> } {
  const jobs = new Map<string, JobInfo>()
  return {
    jobs,
    async send(name, data) {
      const id = crypto.randomUUID()
      const info: JobInfo = {
        id,
        name,
        state: 'active',
        data,
        output: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      }
      jobs.set(id, info)
      try {
        const out = await handlers[name]?.(data, id)
        info.output = (out ?? null) as Record<string, unknown> | null
        info.state = 'completed'
      } catch (err) {
        info.output = { message: String(err instanceof Error ? err.message : err) }
        info.state = 'failed'
      }
      info.completedAt = new Date().toISOString()
      return id
    },
    async get(name, id) {
      const j = jobs.get(id)
      return j && j.name === name ? j : null
    },
  }
}
