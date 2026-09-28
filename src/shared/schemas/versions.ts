/**
 * 保存版本（ADR-0026、REQ-COLLAB-017）：客户端经 Hocuspocus stateless 消息请 collab 以内存里的权威文档
 * 落库并打快照（同一 WebSocket，之前的编辑已按序到达）；collab 回同一 id 的回执。
 * 版本名不入库：由快照 createdAt 按查看者本地时间格式化为 `YYYYMMDD-HHmmss`。
 */
import { z } from 'zod'

export const SAVE_VERSION = 'save-version'
export const SAVE_VERSION_REPLY = 'save-version:reply'
/** stateless 请求体上限（字节）；超出直接回 invalid。 */
export const SAVE_VERSION_MAX_BYTES = 1024
/** 同一用户同一记录两次保存的最小间隔。 */
export const SAVE_VERSION_THROTTLE_MS = 5000

export const saveVersionRequestSchema = z
  .object({ t: z.literal(SAVE_VERSION), id: z.string().regex(/^[A-Za-z0-9-]{1,40}$/) })
  .strict()

export type SaveVersionFailure = 'invalid' | 'readonly' | 'unchanged' | 'throttled' | 'error'

export type SaveVersionResult =
  | { ok: true; snapshotId: string; createdAt: string }
  | { ok: false; reason: SaveVersionFailure }

export type SaveVersionReply = { t: typeof SAVE_VERSION_REPLY; id: string } & SaveVersionResult

const pad = (n: number) => String(n).padStart(2, '0')

/** 版本名：本地时间 `YYYYMMDD-HHmmss`（年月日-时分秒）。 */
export function versionStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`
}
