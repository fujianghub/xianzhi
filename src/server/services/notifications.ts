/** 通知中心读取与标记（02 §9 /notifications*；REQ-NOTIF-005 · 015）：只能访问本人的；他人的 404。 */
import { and, count, desc, eq, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { EventKind } from '../../shared/schemas/enums.ts'
import type {
  listNotificationsQuery,
  putPreferencesSchema,
} from '../../shared/schemas/notifications.ts'
import type { Db } from '../db/index.ts'
import { notificationPreferences, notifications } from '../db/schema/business.ts'
import { decodeCursor, encodeCursor } from '../lib/cursor.ts'
import { AppError } from '../lib/errors.ts'
import { DEFAULT_CHANNELS } from './notify.ts'

export async function unreadCount(db: Db, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
      ),
    )
  return r?.n ?? 0
}

export async function listNotifications(
  db: Db,
  userId: string,
  q: z.infer<typeof listNotificationsQuery>,
) {
  const conds: SQL[] = [eq(notifications.userId, userId)]
  conds.push(q.archived ? isNotNull(notifications.archivedAt) : isNull(notifications.archivedAt))
  if (q.unread) conds.push(isNull(notifications.readAt))
  if (q.kind) conds.push(eq(notifications.kind, q.kind))
  const c = decodeCursor(q.cursor, 2)
  if (q.cursor && !c) throw AppError.validation([{ path: 'cursor', message: '游标无效' }])
  if (c)
    conds.push(
      sql`(${notifications.createdAt}, ${notifications.id}) < (${new Date(String(c[0]))}, ${String(c[1])}::uuid)`,
    )
  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(q.limit + 1)
  const page = rows.slice(0, q.limit)
  const last = page.at(-1)
  return {
    items: page.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      url: n.url,
      readAt: n.readAt?.toISOString() ?? null,
      archivedAt: n.archivedAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
      count: ((n.meta ?? {}) as { count?: number }).count ?? 1,
    })),
    nextCursor:
      rows.length > q.limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
    unreadCount: await unreadCount(db, userId),
  }
}

export async function markRead(db: Db, userId: string, id: string): Promise<void> {
  const r = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id })
  if (!r[0]) throw AppError.notFound()
}

export async function markAllRead(db: Db, userId: string): Promise<number> {
  const r = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id })
  return r.length
}

export async function archive(db: Db, userId: string, id: string): Promise<void> {
  const r = await db
    .update(notifications)
    .set({ archivedAt: new Date(), readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id })
  if (!r[0]) throw AppError.notFound()
}

// ---------- 偏好（REQ-NOTIF-006；01 §3.11 · §4） ----------

export interface PreferenceView {
  eventKind: EventKind
  channels: string[]
  digest: 'instant' | 'daily'
  /** 无本人行、按 01 §4 默认表返回 */
  isDefault: boolean
}

/** 有默认通道的每种 kind 一行；本人有行用本人的，缺行用默认表。 */
export async function getPreferences(db: Db, userId: string): Promise<{ items: PreferenceView[] }> {
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
  const mine = new Map(rows.map((r) => [r.eventKind, r]))
  const items = (Object.keys(DEFAULT_CHANNELS) as EventKind[]).map((kind) => {
    const r = mine.get(kind)
    return r
      ? {
          eventKind: kind,
          channels: r.channels,
          digest: r.digest as PreferenceView['digest'],
          isDefault: false,
        }
      : {
          eventKind: kind,
          channels: [...DEFAULT_CHANNELS[kind]],
          digest: 'instant' as const,
          isDefault: true,
        }
  })
  return { items }
}

/** PUT 整体覆盖（02 §9）：删本人全部行后写入给定行；未给的 kind 回到默认表。 */
export async function putPreferences(
  db: Db,
  userId: string,
  input: z.infer<typeof putPreferencesSchema>,
): Promise<{ items: PreferenceView[] }> {
  const seen = new Set<string>()
  for (const it of input.items) {
    if (seen.has(it.eventKind))
      throw AppError.validation([{ path: 'items', message: `重复的 eventKind ${it.eventKind}` }])
    seen.add(it.eventKind)
  }
  await db.transaction(async (tx) => {
    await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId))
    if (input.items.length)
      await tx.insert(notificationPreferences).values(
        input.items.map((it) => ({
          userId,
          eventKind: it.eventKind,
          channels: [...new Set(it.channels)],
          digest: it.digest,
        })),
      )
  })
  return getPreferences(db, userId)
}
