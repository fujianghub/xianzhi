/** 01 §4.1 事件 payload：每 kind 一例正例 + 缺字段反例；kind 与 enums 一致。 */
import { describe, expect, it } from 'vitest'
import { EVENT_KINDS, type EventKind } from '../schemas/enums.ts'
import { type EventInput, eventInputSchema, eventPayloads } from '../schemas/events.ts'

const U = '01920000-0000-7000-8000-000000000001'
const base = { workspaceId: 'ws', actorId: 'u1', targetType: 'task' as const, targetId: U }

const samples: { [K in EventKind]: Extract<EventInput, { kind: K }>['payload'] } = {
  'entry.updated': {
    entryId: U,
    title: 't',
    kind: 'note',
    actorId: 'u1',
    actorName: 'A',
    spaceSlug: 's',
    ydocVersion: 3,
    wordCount: 10,
    summary: 'x',
  },
  'task.assigned': {
    taskId: U,
    title: 't',
    actorId: 'u1',
    actorName: 'A',
    assigneeId: 'u2',
    spaceSlug: 's',
  },
  'task.unassigned': {
    taskId: U,
    title: 't',
    prevAssigneeId: 'u2',
    prevAssigneeName: 'B',
    reason: 'member_removed',
    spaceSlug: 's',
  },
  'task.due_soon': {
    taskId: U,
    title: 't',
    assigneeId: 'u2',
    spaceSlug: 's',
    dueAt: '2026-09-24T00:00:00+08:00',
    hoursLeft: 24,
  },
  'task.completed': {
    taskId: U,
    title: 't',
    actorId: 'u1',
    actorName: 'A',
    spaceSlug: 's',
    completedAt: '2026-09-23T00:00:00Z',
  },
  'task.uncompleted': {
    taskId: U,
    title: 't',
    actorId: 'u1',
    actorName: 'A',
    spaceSlug: 's',
    prevStatus: 'doing',
  },
  'task.commented': {
    taskId: U,
    title: 't',
    commentId: U,
    threadId: U,
    actorId: 'u1',
    actorName: 'A',
    spaceSlug: 's',
    summary: 'x',
  },
  'entry.commented': {
    entryId: U,
    title: 't',
    commentId: U,
    threadId: U,
    actorId: 'u1',
    actorName: 'A',
    summary: 'x',
  },
  'mention.created': {
    targetType: 'entry',
    targetId: U,
    title: 't',
    actorId: 'u1',
    actorName: 'A',
    summary: 'x',
    url: '/entries/x',
  },
  'space.invited': {
    spaceId: U,
    spaceName: 'S',
    spaceSlug: 's',
    actorId: 'u1',
    actorName: 'A',
    role: 'member',
  },
  'member.joined': {
    userId: 'u2',
    displayName: 'B',
    email: 'b@xz.local',
    role: 'member',
    inviterId: 'u1',
    inviterName: 'A',
  },
  'member.requested': {
    requestId: U,
    userId: 'u9',
    displayName: 'P',
    username: 'p',
    email: 'p@xz.local',
  },
  'calendar.reminder': {
    eventId: U,
    ownerId: 'u1',
    title: '周会',
    allDay: false,
    occurrenceStart: '2026-09-28T06:00:00Z',
    alarm: 10,
    date: '2026-09-28',
  },
  'workspace.owner_transferred': { fromUserId: 'u1', fromName: 'A', toUserId: 'u2', toName: 'B' },
  'cycle.review_due': {
    cycleId: U,
    kind: 'week',
    title: '2026-W39',
    ownerId: 'u1',
    startDate: '2026-09-21',
    endDate: '2026-09-27',
    doneCount: 3,
    totalCount: 5,
  },
  'system.export_done': {
    jobId: 'j1',
    scope: 'workspace',
    format: 'zip',
    fileName: 'x.zip',
    sizeBytes: 100,
    expiresAt: '2026-09-30T00:00:00Z',
  },
  'system.backup_failed': {
    jobId: 'j1',
    backupDate: '2026-09-23',
    errorCode: 'E',
    errorSummary: 'x',
  },
  'system.outbox_stalled': {
    oldestEventId: U,
    oldestCreatedAt: '2026-09-23T00:00:00Z',
    pendingCount: 12,
  },
}

describe('event payloads', () => {
  it('kind 集合与 EVENT_KINDS 一致', () => {
    expect(Object.keys(eventPayloads).sort()).toEqual([...EVENT_KINDS].sort())
  })
  for (const kind of EVENT_KINDS) {
    it(`${kind} 正例通过、去掉首个必填字段失败`, () => {
      const payload = samples[kind]
      expect(
        eventInputSchema.safeParse({ ...base, kind, payload } as unknown as EventInput).success,
        kind,
      ).toBe(true)
      const firstKey = Object.keys(payload)[0] as keyof typeof payload
      const { [firstKey]: _omit, ...rest } = payload
      const r = eventInputSchema.safeParse({
        ...base,
        kind,
        payload: rest,
      } as unknown as EventInput)
      expect(r.success, `${kind} without ${String(firstKey)}`).toBe(false)
    })
  }
  it('未知 kind / summary 超 120 字 / 非法 targetType 失败', () => {
    expect(
      eventInputSchema.safeParse({
        ...base,
        kind: 'task.exploded',
        payload: {},
      } as unknown as EventInput).success,
    ).toBe(false)
    const long = { ...samples['entry.commented'], summary: 'x'.repeat(121) }
    expect(
      eventInputSchema.safeParse({
        ...base,
        kind: 'entry.commented',
        payload: long,
      } as unknown as EventInput).success,
    ).toBe(false)
    expect(
      eventInputSchema.safeParse({
        ...base,
        targetType: 'planet',
        kind: 'member.joined',
        payload: samples['member.joined'],
      } as unknown as EventInput).success,
    ).toBe(false)
  })
})
