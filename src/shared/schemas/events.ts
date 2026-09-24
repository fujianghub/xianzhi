/**
 * 事件 payload（01 §4.1，T0-012）：以 kind 为判别键；`emit()` 入参与 worker 出参共用，不符即抛错。
 * payload 自包含：渲染通知 / 活动流 / 邮件不回查业务表。
 */
import { z } from 'zod'
import { EVENT_KINDS, EVENT_TARGET_TYPES, type EventKind } from './enums.ts'

const id = z.string().min(1)
const uuid = z.uuid()
const summary = z.string().max(120)

export const eventPayloads = {
  'entry.updated': z.object({
    entryId: uuid,
    title: z.string(),
    kind: z.string(),
    actorId: id,
    actorName: z.string(),
    spaceSlug: z.string(),
    ydocVersion: z.number().int(),
    wordCount: z.number().int(),
    summary,
  }),
  'task.assigned': z.object({
    taskId: uuid,
    title: z.string(),
    actorId: id,
    actorName: z.string(),
    assigneeId: id,
    prevAssigneeId: id.optional(),
    spaceSlug: z.string(),
    dueAt: z.string().optional(),
  }),
  'task.unassigned': z.object({
    taskId: uuid,
    title: z.string(),
    prevAssigneeId: id,
    prevAssigneeName: z.string(),
    reason: z.enum(['member_removed', 'member_suspended']),
    spaceSlug: z.string(),
    dueAt: z.string().optional(),
  }),
  'task.due_soon': z.object({
    taskId: uuid,
    title: z.string(),
    assigneeId: id,
    spaceSlug: z.string(),
    dueAt: z.string(),
    hoursLeft: z.number(),
  }),
  'task.completed': z.object({
    taskId: uuid,
    title: z.string(),
    actorId: id,
    actorName: z.string(),
    spaceSlug: z.string(),
    completedAt: z.string(),
    /** 完成前的状态，供撤销回退（02 §9 uncomplete；注 2026-09-24） */
    prevStatus: z.string().optional(),
    cycleId: uuid.optional(),
  }),
  'task.uncompleted': z.object({
    taskId: uuid,
    title: z.string(),
    actorId: id,
    actorName: z.string(),
    spaceSlug: z.string(),
    prevStatus: z.string(),
  }),
  'task.commented': z.object({
    taskId: uuid,
    title: z.string(),
    commentId: uuid,
    threadId: uuid,
    actorId: id,
    actorName: z.string(),
    spaceSlug: z.string(),
    summary,
  }),
  'entry.commented': z.object({
    entryId: uuid,
    title: z.string(),
    commentId: uuid,
    threadId: uuid,
    actorId: id,
    actorName: z.string(),
    summary,
  }),
  'mention.created': z.object({
    targetType: z.enum(['entry', 'comment']),
    targetId: uuid,
    title: z.string(),
    commentId: uuid.optional(),
    actorId: id,
    actorName: z.string(),
    summary,
    url: z.string(),
  }),
  'space.invited': z.object({
    spaceId: uuid,
    spaceName: z.string(),
    spaceSlug: z.string(),
    actorId: id,
    actorName: z.string(),
    role: z.string(),
  }),
  'member.joined': z.object({
    userId: id,
    displayName: z.string(),
    email: z.string(),
    role: z.string(),
    inviterId: id,
    inviterName: z.string(),
  }),
  'workspace.owner_transferred': z.object({
    fromUserId: id,
    fromName: z.string(),
    toUserId: id,
    toName: z.string(),
  }),
  'cycle.review_due': z.object({
    cycleId: uuid,
    kind: z.string(),
    title: z.string(),
    ownerId: id,
    startDate: z.string(),
    endDate: z.string(),
    doneCount: z.number().int(),
    totalCount: z.number().int(),
  }),
  'system.export_done': z.object({
    jobId: z.string(),
    scope: z.string(),
    format: z.string(),
    fileName: z.string(),
    sizeBytes: z.number().int(),
    expiresAt: z.string(),
  }),
  'system.backup_failed': z.object({
    jobId: z.string(),
    backupDate: z.string(),
    errorCode: z.string(),
    errorSummary: z.string(),
  }),
  'system.outbox_stalled': z.object({
    oldestEventId: uuid,
    oldestCreatedAt: z.string(),
    pendingCount: z.number().int(),
  }),
} as const

export type EventPayload<K extends EventKind> = z.infer<(typeof eventPayloads)[K]>

/** 编译期保证 eventPayloads 的键与 EVENT_KINDS 一致。 */
const _kindsCheck: Record<EventKind, z.ZodType> = eventPayloads
void _kindsCheck
void EVENT_KINDS

export const visibilityScopeSchema = z.object({
  spaceId: uuid.optional(),
  userIds: z.array(id).optional(),
})

const eventBase = z.object({
  workspaceId: id,
  actorId: id.nullable().optional(),
  targetType: z.enum(EVENT_TARGET_TYPES),
  targetId: uuid.nullable().optional(),
  visibilityScope: visibilityScopeSchema.optional(),
})

/** 判别联合：`{ kind, payload, ...base }` */
export const eventInputSchema = z.discriminatedUnion(
  'kind',
  Object.entries(eventPayloads).map(([kind, payload]) =>
    eventBase.extend({ kind: z.literal(kind), payload }),
  ) as unknown as [z.ZodObject<z.ZodRawShape>, ...z.ZodObject<z.ZodRawShape>[]],
)

export type EventInput = {
  [K in EventKind]: z.infer<typeof eventBase> & { kind: K; payload: EventPayload<K> }
}[EventKind]
