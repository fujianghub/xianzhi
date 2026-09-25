/**
 * 客户端 UUID（v4）。`crypto.randomUUID` 只在安全上下文（HTTPS / localhost）存在，
 * 按局域网 IP 走 HTTP 访问时为 undefined；`uuid` 的 v4 用 getRandomValues，任何上下文可用。
 * 客户端禁止直接调 `crypto.randomUUID`（lint:drift 检查，见 debug/2026-09-25-randomuuid-insecure-context）。
 */
import { v4 } from 'uuid'

export const newId = (): string => v4()
