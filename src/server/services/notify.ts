/**
 * 通知扇出（01 §4、§4.1；CLAUDE.md 不变量 3；REQ-NOTIF-002 · 011 · 016）：只由 `notify.fanout` 作业调用。
 * 接收者 → 去掉操作者 → 停用者跳过 → can(<target>.read) → 偏好（缺行用默认表）→ in_app 行（ON CONFLICT DO NOTHING / 5 分钟合并）
 * → 投递：in_app 记 sent；sse 进程内推送不落行；email 发信并落行；webpush 为 Phase 2，落 skipped。
 */
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { EventKind } from '../../shared/schemas/enums.ts'
import { type Actor, can, type SpaceRef, type TaskRef } from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { member, user } from '../db/schema/auth.ts'
import {
  comments,
  entries,
  events,
  notificationDeliveries,
  notificationPreferences,
  notifications,
  spaceMembers,
  tasks,
  taskWatchers,
} from '../db/schema/business.ts'
import type { EventBus } from '../lib/event-bus.ts'
import { sendMail } from '../mail/index.ts'
import { loadActor } from './actors.ts'
import { loadEntry, loadSpaceRef } from './entries.ts'
import { loadCommentRef } from './refs.ts'

type Channel = 'in_app' | 'sse' | 'webpush' | 'email'
type Payload = Record<string, unknown>

/** 01 §4 默认通道（缺偏好行时用）。 */
export const DEFAULT_CHANNELS: Record<EventKind, Channel[]> = {
  'entry.updated': [],
  'task.assigned': ['in_app', 'sse', 'webpush'],
  'task.unassigned': ['in_app', 'sse'],
  'task.due_soon': ['in_app', 'sse', 'webpush', 'email'],
  'task.completed': ['in_app', 'sse'],
  'task.uncompleted': [],
  'task.commented': ['in_app', 'sse', 'webpush'],
  'entry.commented': ['in_app', 'sse', 'webpush'],
  'mention.created': ['in_app', 'sse', 'webpush', 'email'],
  'space.invited': ['in_app', 'email'],
  'member.joined': ['in_app'],
  'workspace.owner_transferred': ['in_app', 'email'],
  'cycle.review_due': ['in_app', 'webpush', 'email'],
  'system.export_done': ['in_app', 'sse', 'email'], // sse：前端据此弹状态 Toast（REQ-UI-008，01 §4 注 2026-09-24）
  'system.backup_failed': ['in_app', 'email'],
  'system.outbox_stalled': ['in_app', 'email'],
}

/** 不合并的种类（01 §4.1「不合并」）。 */
const NO_MERGE = new Set<EventKind>([
  'mention.created',
  'space.invited',
  'workspace.owner_transferred',
  'system.export_done',
])
const MERGE_WINDOW_MS = 5 * 60 * 1000

const s = (p: Payload, k: string) => String(p[k] ?? '')

/** 01 §4.1 模板（zh-CN）。返回 null = 该种类不进 notifications。 */
export function renderNotification(
  kind: EventKind,
  p: Payload,
  mergedCount = 1,
): { title: string; body: string | null; url: string } | null {
  const taskUrl = `/spaces/${s(p, 'spaceSlug')}/tasks/${s(p, 'taskId')}`
  switch (kind) {
    case 'task.assigned':
      return {
        title: `${s(p, 'actorName')} 把任务 ${s(p, 'title')} 指派给你`,
        body: p.dueAt ? `截止 ${s(p, 'dueAt')}` : '无截止',
        url: taskUrl,
      }
    case 'task.unassigned':
      return mergedCount > 1
        ? {
            title: `${s(p, 'prevAssigneeName')} 离开，${mergedCount} 个任务待重新指派`,
            body: null,
            url: `/spaces/${s(p, 'spaceSlug')}?view=list&assignee=none`,
          }
        : {
            title: `任务 ${s(p, 'title')} 的负责人已离开`,
            body: `原负责人 ${s(p, 'prevAssigneeName')}，请重新指派`,
            url: taskUrl,
          }
    case 'task.due_soon':
      return {
        title: `任务 ${s(p, 'title')} 将在 ${s(p, 'hoursLeft')} 小时后截止`,
        body: `截止 ${s(p, 'dueAt')}`,
        url: taskUrl,
      }
    case 'task.completed':
      return mergedCount > 1
        ? {
            title: `${s(p, 'actorName')} 完成了 ${mergedCount} 个任务`,
            body: null,
            url: `/spaces/${s(p, 'spaceSlug')}?view=list&status=done`,
          }
        : { title: `${s(p, 'actorName')} 完成了任务 ${s(p, 'title')}`, body: null, url: taskUrl }
    case 'task.commented':
      return {
        title: `${s(p, 'actorName')} 评论了任务 ${s(p, 'title')}`,
        body: s(p, 'summary'),
        url: `${taskUrl}#c-${s(p, 'commentId')}`,
      }
    case 'entry.commented':
      return {
        title: `${s(p, 'actorName')} 评论了记录 ${s(p, 'title')}`,
        body: s(p, 'summary'),
        url: `/entries/${s(p, 'entryId')}#c-${s(p, 'commentId')}`,
      }
    case 'mention.created':
      return {
        title: `${s(p, 'actorName')} 在 ${s(p, 'title')} 中提到了你`,
        body: s(p, 'summary'),
        url: s(p, 'url'),
      }
    case 'space.invited':
      return {
        title: `${s(p, 'actorName')} 邀请你加入空间 ${s(p, 'spaceName')}`,
        body: `你的角色：${s(p, 'role')}`,
        url: `/spaces/${s(p, 'spaceSlug')}`,
      }
    case 'member.joined':
      return mergedCount > 1
        ? { title: `${mergedCount} 位新成员已加入`, body: null, url: '/settings/workspace/members' }
        : {
            title: `${s(p, 'displayName')} 已加入工作区`,
            body: `角色 ${s(p, 'role')}，由 ${s(p, 'inviterName')} 邀请`,
            url: '/settings/workspace/members',
          }
    case 'workspace.owner_transferred':
      return {
        title: `工作区所有权已从 ${s(p, 'fromName')} 转给 ${s(p, 'toName')}`,
        body: '原 owner 降为 admin',
        url: '/settings/workspace',
      }
    case 'cycle.review_due':
      return {
        title: `${s(p, 'title')} 已结束，停在枝头回望一下吧`,
        body: `本周期完成 ${s(p, 'doneCount')}/${s(p, 'totalCount')} 个任务`,
        url: `/cycles/${s(p, 'cycleId')}`,
      }
    case 'system.export_done':
      return {
        title: `导出已完成：${s(p, 'fileName')}`,
        body: `${s(p, 'sizeBytes')} · ${s(p, 'expiresAt')} 前可下载`,
        url: `/jobs/${s(p, 'jobId')}`,
      }
    case 'system.backup_failed':
      return {
        title: `${s(p, 'backupDate')} 备份失败`,
        body: s(p, 'errorSummary'),
        url: `/settings/workspace/audit?job=${s(p, 'jobId')}`,
      }
    case 'system.outbox_stalled':
      return {
        title: `通知队列积压：${s(p, 'pendingCount')} 条超过 1 小时未处理`,
        body: `最早事件 ${s(p, 'oldestCreatedAt')}`,
        url: '/settings/workspace/audit',
      }
    default:
      return null
  }
}

type EventRow = typeof events.$inferSelect

async function admins(db: DbOrTx, workspaceId: string): Promise<string[]> {
  return (
    await db
      .select({ id: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, workspaceId), inArray(member.role, ['owner', 'admin'])))
  ).map((r) => r.id)
}

/** 01 §4 默认接收者。 */
export async function recipientsFor(db: DbOrTx, ev: EventRow): Promise<string[]> {
  const p = ev.payload as Payload
  const scopeUsers = (ev.visibilityScope as { userIds?: string[] } | null)?.userIds ?? []
  switch (ev.kind as EventKind) {
    case 'task.assigned':
    case 'task.due_soon':
      return [s(p, 'assigneeId')]
    case 'task.unassigned': {
      const spaceId = (ev.visibilityScope as { spaceId?: string } | null)?.spaceId
      const spaceAdmins = spaceId
        ? (
            await db
              .select({ id: spaceMembers.userId })
              .from(spaceMembers)
              .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.role, 'admin')))
          ).map((r) => r.id)
        : []
      const leaving = s(p, 'prevAssigneeId')
      const live = spaceAdmins.filter((u) => u !== leaving)
      return live.length ? live : admins(db, ev.workspaceId)
    }
    case 'task.completed':
      return (
        await db
          .select({ id: taskWatchers.userId })
          .from(taskWatchers)
          .where(eq(taskWatchers.taskId, ev.targetId ?? ''))
      ).map((r) => r.id)
    case 'task.commented':
    case 'entry.commented': {
      const threadId = s(p, 'threadId')
      const participants = (
        await db
          .selectDistinct({ id: comments.authorId })
          .from(comments)
          .where(eq(comments.threadId, threadId))
      ).map((r) => r.id)
      let author: string | undefined
      if (ev.kind === 'task.commented')
        author = (
          await db
            .select({ id: tasks.creatorId })
            .from(tasks)
            .where(eq(tasks.id, s(p, 'taskId')))
        )[0]?.id
      else
        author = (
          await db
            .select({ id: entries.authorId })
            .from(entries)
            .where(eq(entries.id, s(p, 'entryId')))
        )[0]?.id
      // REQ-TASK-014：任务的 watcher 也收评论通知（01 §4 注 2026-09-24）
      const watchers =
        ev.kind === 'task.commented'
          ? (
              await db
                .select({ id: taskWatchers.userId })
                .from(taskWatchers)
                .where(eq(taskWatchers.taskId, s(p, 'taskId')))
            ).map((r) => r.id)
          : []
      return [...new Set([...(author ? [author] : []), ...participants, ...watchers])]
    }
    case 'member.joined':
      return (await admins(db, ev.workspaceId)).filter((u) => u !== s(p, 'inviterId'))
    case 'workspace.owner_transferred':
      return [s(p, 'fromUserId'), s(p, 'toUserId')]
    case 'cycle.review_due':
      return [s(p, 'ownerId')]
    case 'system.backup_failed':
    case 'system.outbox_stalled':
      return scopeUsers.length ? scopeUsers : admins(db, ev.workspaceId)
    case 'mention.created':
    case 'space.invited':
    case 'system.export_done':
      return scopeUsers
    default:
      return []
  }
}

async function taskRef(db: DbOrTx, actor: Actor, taskId: string): Promise<TaskRef | null> {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId))
  if (!t) return null
  const sp = await loadSpaceRef(db, actor, t.spaceId)
  if (!sp) return null
  return {
    id: t.id,
    creatorId: t.creatorId,
    assigneeId: t.assigneeId,
    deletedAt: t.deletedAt,
    space: sp.ref as SpaceRef,
  }
}

/** 扇出前 can(<target>.read)（REQ-NOTIF-011）；不可读 → false。 */
async function canReceive(db: DbOrTx, actor: Actor, ev: EventRow): Promise<boolean> {
  const p = ev.payload as Payload
  if (ev.kind === 'mention.created' && p.targetType === 'comment') {
    // 评论中的提及：按评论所在目标（任务 / 记录）的读权限过滤（REQ-COMMENT-006、REQ-NOTIF-011）
    const c = await loadCommentRef(db, actor, ev.workspaceId, s(p, 'targetId'))
    if (!c || c.row.deletedAt) return false
    return c.ref.target.kind === 'task'
      ? can(actor, 'task.read', c.ref.target.ref)
      : can(actor, 'entry.read', c.ref.target.ref)
  }
  if (ev.kind === 'mention.created' && p.targetType === 'entry') {
    const e = await loadEntry(db, actor, s(p, 'targetId'))
    return !!e && can(actor, 'entry.read', e.ref)
  }
  const taskId =
    ev.targetType === 'task' ? ev.targetId : ev.kind === 'task.commented' ? s(p, 'taskId') : null
  if (taskId) {
    const t = await taskRef(db, actor, taskId)
    return !!t && can(actor, 'task.read', t)
  }
  const entryId =
    ev.targetType === 'entry' ? ev.targetId : ev.kind === 'entry.commented' ? s(p, 'entryId') : null
  if (entryId) {
    const e = await loadEntry(db, actor, entryId)
    return !!e && can(actor, 'entry.read', e.ref)
  }
  if (ev.kind === 'space.invited') {
    const sp = await loadSpaceRef(db, actor, s(p, 'spaceId'))
    return !!sp && can(actor, 'space.read', sp.ref)
  }
  return true
}

async function channelsFor(db: DbOrTx, userId: string, kind: EventKind): Promise<Channel[]> {
  const [pref] = await db
    .select({ channels: notificationPreferences.channels })
    .from(notificationPreferences)
    .where(
      and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.eventKind, kind)),
    )
  return (pref?.channels as Channel[] | undefined) ?? DEFAULT_CHANNELS[kind] ?? []
}

export interface FanoutDeps {
  db: Db
  bus?: EventBus
  appUrl: string
}

export interface FanoutResult {
  recipients: number
  inserted: number
  merged: number
  skipped: number
  /** 需要发邮件的通知（由 notify.email 作业发送） */
  emailNotificationIds: string[]
}

/** 处理一个事件；可重跑（REQ-NOTIF-016）。 */
export async function fanoutEvent(deps: FanoutDeps, eventId: string): Promise<FanoutResult> {
  const res: FanoutResult = {
    recipients: 0,
    inserted: 0,
    merged: 0,
    skipped: 0,
    emailNotificationIds: [],
  }
  const [ev] = await deps.db.select().from(events).where(eq(events.id, eventId))
  if (!ev) return res
  const kind = ev.kind as EventKind
  if (kind === 'task.uncompleted') {
    res.merged = await markUncompleted(deps, ev)
    return res
  }
  if (!DEFAULT_CHANNELS[kind] || renderNotification(kind, ev.payload as Payload) === null)
    return res
  const targets = [...new Set(await recipientsFor(deps.db, ev))].filter(
    (u) => u && u !== ev.actorId,
  ) // 操作者不收自己的
  res.recipients = targets.length
  const frames: { userId: string; frame: { type: string; data: unknown } }[] = []

  for (const userId of targets) {
    const a = await loadActor(deps.db, userId)
    if (!a || a.actor.suspended || !(await canReceive(deps.db, a.actor, ev))) {
      res.skipped++
      continue
    }
    const channels = await channelsFor(deps.db, userId, kind)
    if (!channels.includes('in_app') && !channels.includes('sse') && !channels.includes('email')) {
      res.skipped++
      continue
    }
    const outcome = await deps.db.transaction(async (tx) => {
      // 已处理过（重跑）：本事件已有行，或已被合并进他行
      const dup = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            sql`(${notifications.eventId} = ${ev.id} or ${notifications.meta} -> 'mergedEventIds' ? ${ev.id})`,
          ),
        )
        .limit(1)
      if (dup[0]) return null
      // 5 分钟合并（01 §4）：同 (user, target, kind) 未读
      if (!NO_MERGE.has(kind)) {
        const [prev] = await tx
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, userId),
              eq(notifications.kind, kind),
              isNull(notifications.readAt),
              gt(notifications.createdAt, new Date(Date.now() - MERGE_WINDOW_MS)),
              sql`${notifications.meta} ->> 'mergeKey' = ${mergeKey(ev)}`,
            ),
          )
          .limit(1)
        if (prev) {
          const meta = (prev.meta ?? {}) as {
            mergedEventIds?: string[]
            count?: number
            mergeKey?: string
          }
          const cnt = (meta.count ?? 1) + 1
          const r = renderNotification(kind, ev.payload as Payload, cnt)
          if (!r) return null
          await tx
            .update(notifications)
            .set({
              title: r.title,
              body: r.body,
              url: r.url,
              createdAt: new Date(),
              meta: {
                ...meta,
                count: cnt,
                mergedEventIds: [...(meta.mergedEventIds ?? []), ev.id],
              },
            })
            .where(eq(notifications.id, prev.id))
          return { id: prev.id, title: r.title, url: r.url, merged: true }
        }
      }
      const r = renderNotification(kind, ev.payload as Payload)
      if (!r) return null
      const [row] = await tx
        .insert(notifications)
        .values({
          userId,
          eventId: ev.id,
          kind,
          title: r.title,
          body: r.body,
          url: r.url,
          meta: { count: 1, mergeKey: mergeKey(ev) },
        })
        .onConflictDoNothing({ target: [notifications.userId, notifications.eventId] })
        .returning({ id: notifications.id })
      if (!row) return null
      const deliveries: (typeof notificationDeliveries.$inferInsert)[] = []
      if (channels.includes('in_app'))
        deliveries.push({
          notificationId: row.id,
          channel: 'in_app',
          status: 'sent',
          sentAt: new Date(),
        })
      if (channels.includes('webpush'))
        deliveries.push({
          notificationId: row.id,
          channel: 'webpush',
          status: 'skipped',
          error: 'webpush: Phase 2',
        })
      if (channels.includes('email'))
        deliveries.push({ notificationId: row.id, channel: 'email', status: 'pending' })
      if (deliveries.length) await tx.insert(notificationDeliveries).values(deliveries)
      return { id: row.id, title: r.title, url: r.url, merged: false, body: r.body }
    })
    if (!outcome) {
      res.skipped++
      continue
    }
    if (outcome.merged) res.merged++
    else res.inserted++
    // 铃铛实时：每条 in_app 通知都推 invalidate（02 §6，属缓存失效而非「通知投递」，不受 sse 通道开关影响）
    if (channels.includes('in_app'))
      frames.push({ userId, frame: { type: 'invalidate', data: { keys: [['notifications']] } } })
    if (channels.includes('sse'))
      frames.push({
        userId,
        frame: {
          type: 'notification',
          data: {
            notificationId: outcome.id,
            kind,
            title: outcome.title,
            url: outcome.url,
            createdAt: new Date().toISOString(),
          },
        },
      })
    if (channels.includes('email') && !outcome.merged) res.emailNotificationIds.push(outcome.id)
  }
  // 提交后推 SSE；邮件由 notify.email 作业发送（不阻塞站内通知与后续扇出）
  for (const f of frames) deps.bus?.publish('notify', f)
  return res
}

/**
 * task.uncompleted 不新发通知（01 §4.1）：把 5 分钟内、由同一任务的 task.completed 生成且未被合并的通知
 * 原地改为「{actor} 撤销了完成」。已合并成「完成了 n 个任务」的不改（仍准确描述了多数任务）。返回改动条数。
 */
async function markUncompleted(deps: FanoutDeps, ev: EventRow): Promise<number> {
  const p = ev.payload as Payload
  const rows = await deps.db
    .update(notifications)
    .set({ title: `${s(p, 'actorName')} 撤销了完成：${s(p, 'title')}` })
    .where(
      and(
        eq(notifications.kind, 'task.completed'),
        gt(notifications.createdAt, new Date(Date.now() - MERGE_WINDOW_MS)),
        sql`coalesce((${notifications.meta} ->> 'count')::int, 1) = 1`,
        sql`${notifications.eventId} in (select id from ${events} where kind = 'task.completed' and target_id = ${ev.targetId})`,
      ),
    )
    .returning({ id: notifications.id, userId: notifications.userId })
  for (const r of rows)
    deps.bus?.publish('notify', {
      userId: r.userId,
      frame: { type: 'invalidate', data: { keys: [['notifications']] } },
    })
  return rows.length
}

/** 合并键：同目标同种类；member.joined / task.completed / task.unassigned 按「人」聚合（01 §4.1）。 */
function mergeKey(ev: EventRow): string {
  const p = ev.payload as Payload
  switch (ev.kind as EventKind) {
    case 'task.completed':
      return `actor:${s(p, 'actorId')}`
    case 'task.unassigned':
      return `prev:${s(p, 'prevAssigneeId')}`
    case 'member.joined':
      return 'workspace'
    case 'task.commented':
    case 'entry.commented':
      return `thread:${s(p, 'threadId')}`
    case 'system.backup_failed':
    case 'system.outbox_stalled':
      return `day:${ev.createdAt.toISOString().slice(0, 10)}`
    default:
      return `${ev.targetType}:${ev.targetId ?? ''}`
  }
}

/**
 * 发送一条通知的邮件（07 §2.6：标题 + ≤ 100 字摘要 + 不带 token 的深链 + 偏好链接）；回写 notification_deliveries。
 * 幂等：已 sent 的不重发。
 */
export async function sendNotificationEmail(
  deps: { db: Db; appUrl: string },
  notificationId: string,
): Promise<'sent' | 'skipped' | 'failed'> {
  const [row] = await deps.db
    .select({
      n: notifications,
      email: user.email,
      status: notificationDeliveries.status,
      did: notificationDeliveries.id,
    })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .innerJoin(user, eq(user.id, notifications.userId))
    .where(
      and(
        eq(notificationDeliveries.notificationId, notificationId),
        eq(notificationDeliveries.channel, 'email'),
      ),
    )
    .limit(1)
  if (!row || row.status === 'sent') return 'skipped'
  const base = deps.appUrl.replace(/\/$/, '')
  const text = [
    row.n.title,
    row.n.body ? row.n.body.slice(0, 100) : '',
    `打开：${base}${row.n.url}`,
    `管理通知偏好：${base}/settings/notifications`,
  ]
    .filter(Boolean)
    .join('\n')
  try {
    await sendMail({ to: row.email, subject: `${row.n.title} · 衔枝`, text })
    await deps.db
      .update(notificationDeliveries)
      .set({ status: 'sent', sentAt: new Date(), error: null })
      .where(eq(notificationDeliveries.id, row.did))
    return 'sent'
  } catch (err) {
    await deps.db
      .update(notificationDeliveries)
      .set({
        status: 'failed',
        error: String(err instanceof Error ? err.message : err).slice(0, 300),
      })
      .where(eq(notificationDeliveries.id, row.did))
    throw err
  }
}
