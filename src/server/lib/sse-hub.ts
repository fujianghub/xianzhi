/**
 * SSE 连接中心（02 §6、07 §5、REQ-NOTIF-003）：
 * - 每用户 ≤ 3 条连接，第 4 条建立时关闭最旧的
 * - 每用户进程内单调递增 eventSeq 作为数据帧 `id:`；心跳注释行不带 id
 * - 环形缓冲保留最近 5 分钟的帧，`Last-Event-ID` 重连补发 seq > lastId；超出缓冲发 `reset` 帧让前端整体重取
 * - 首连（无 lastEventId）发 `hello` 帧（id = 当前 seq）作补发基线；lastEventId > seq（进程重启）→ `reset`
 * - `user.revoked` → 关闭该用户全部连接
 */
export interface SseFrame {
  id: number
  event: string
  data: unknown
  at: number
}

export interface SseSink {
  send(frame: { id?: number; event?: string; data?: unknown; comment?: string }): void
  close(): void
}

interface UserState {
  seq: number
  buffer: SseFrame[]
  sinks: { sink: SseSink; openedAt: number; spaceId?: string }[]
}

export const SSE_LIMITS = { maxConnections: 3, bufferMs: 5 * 60 * 1000, heartbeatMs: 25_000 }

export class SseHub {
  private users = new Map<string, UserState>()
  private readonly now: () => number
  constructor(now: () => number = Date.now) {
    this.now = now
  }

  private state(userId: string): UserState {
    let s = this.users.get(userId)
    if (!s) {
      s = { seq: 0, buffer: [], sinks: [] }
      this.users.set(userId, s)
    }
    return s
  }

  private prune(s: UserState): void {
    const cutoff = this.now() - SSE_LIMITS.bufferMs
    while (s.buffer.length && (s.buffer[0]?.at ?? 0) < cutoff) s.buffer.shift()
  }

  /** 注册连接；返回注销函数。lastEventId 为重连补发起点。 */
  connect(
    userId: string,
    sink: SseSink,
    opts: { lastEventId?: number; spaceId?: string } = {},
  ): () => void {
    const s = this.state(userId)
    while (s.sinks.length >= SSE_LIMITS.maxConnections) {
      const oldest = s.sinks.shift()
      // 先告知被挤掉（前端据此停止自动重连，否则 4 个标签页会互相挤掉、无限重连）
      oldest?.sink.send({ event: 'evicted', data: { reason: 'too-many-connections' } })
      oldest?.sink.close()
    }
    const entry = { sink, openedAt: this.now(), spaceId: opts.spaceId }
    s.sinks.push(entry)
    if (opts.lastEventId !== undefined && Number.isFinite(opts.lastEventId)) {
      this.prune(s)
      const first = s.buffer[0]
      // lastEventId > seq：服务端重启过（seq 进程内），期间的帧已不可知 → reset
      const covered =
        opts.lastEventId === s.seq ||
        (opts.lastEventId < s.seq && first !== undefined && first.id <= opts.lastEventId + 1)
      if (!covered) sink.send({ id: s.seq, event: 'reset', data: { reason: 'buffer-exceeded' } })
      else
        for (const f of s.buffer)
          if (f.id > opts.lastEventId) sink.send({ id: f.id, event: f.event, data: f.data })
    } else {
      // 首连给出当前 seq 作为基线：之后即使一帧未收到就断线，重连也能按 lastEventId 补发
      sink.send({ id: s.seq, event: 'hello', data: null })
    }
    return () => {
      const i = s.sinks.indexOf(entry)
      if (i >= 0) s.sinks.splice(i, 1)
    }
  }

  /** 推一帧给该用户全部连接，并进缓冲。 */
  push(userId: string, event: string, data: unknown): number {
    const s = this.state(userId)
    const frame: SseFrame = { id: ++s.seq, event, data, at: this.now() }
    s.buffer.push(frame)
    this.prune(s)
    for (const { sink } of s.sinks) sink.send({ id: frame.id, event, data })
    return frame.id
  }

  disconnectUser(userId: string): void {
    const s = this.users.get(userId)
    if (!s) return
    for (const { sink } of s.sinks.splice(0)) sink.close()
  }

  /** 当前有连接的用户（data.changed 广播时按权限过滤）。 */
  onlineUserIds(): string[] {
    return [...this.users.entries()].filter(([, s]) => s.sinks.length > 0).map(([id]) => id)
  }

  heartbeat(): void {
    for (const s of this.users.values())
      for (const { sink } of s.sinks) sink.send({ comment: 'ping' })
  }

  connections(userId: string): number {
    return this.users.get(userId)?.sinks.length ?? 0
  }
}
