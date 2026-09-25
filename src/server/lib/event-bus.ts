/**
 * 进程内 EventBus（02 §6、07 §4、01 §5「权限变更的广播」）：
 * - `user.revoked(userId)`：成员移除 / 停用 / 改密 / 吊销会话 → collab 断 WS（4403）、SSE 关连接
 * - `entry.access_changed({ entryIds?, spaceId?, userIds? })`：collab 对受影响连接重跑 can()
 * - `notify(userId, frame)`：pg-boss 扇出后推 SSE（T0-025）
 * - `entry.restore({ entryId, snapshotId, actorId })`：API 鉴权 + 审计后请 collab 把快照状态写回在线文档（REQ-COLLAB-008）
 * - `data.changed({ spaceId, keys })`：任务 / 记录写提交后，给在线且可读该空间的用户推 `invalidate`（REQ-NOTIF-004）
 * 单实例够用；多实例换 PG LISTEN/NOTIFY。写事务提交后再 publish。
 */
import { EventEmitter } from 'node:events'

export interface BusEvents {
  'user.revoked': { userId: string }
  'entry.access_changed': { entryIds?: string[]; spaceId?: string; userIds?: string[] }
  notify: { userId: string; frame: { type: string; data: unknown } }
  'data.changed': { spaceIds: string[]; keys: unknown[][] }
  'entry.restore': { entryId: string; snapshotId: string; actorId: string }
}

export class EventBus {
  private readonly ee = new EventEmitter({ captureRejections: false })
  constructor() {
    this.ee.setMaxListeners(1000)
  }
  publish<K extends keyof BusEvents>(kind: K, payload: BusEvents[K]): void {
    this.ee.emit(kind, payload)
  }
  subscribe<K extends keyof BusEvents>(kind: K, fn: (payload: BusEvents[K]) => void): () => void {
    this.ee.on(kind, fn)
    return () => this.ee.off(kind, fn)
  }
  listenerCount(kind: keyof BusEvents): number {
    return this.ee.listenerCount(kind)
  }
}

let singleton: EventBus | undefined
export function getEventBus(): EventBus {
  if (!singleton) singleton = new EventBus()
  return singleton
}
export function setEventBus(bus: EventBus): void {
  singleton = bus
}
