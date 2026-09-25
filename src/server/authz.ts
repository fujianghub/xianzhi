/**
 * 授权唯一入口（CLAUDE.md 不变量 2；01 §5）。
 * - `can(actor, action, resource)` 纯函数：只依赖 (actor, workspaceRole, spaceRole, resource 元数据)，无 DB。
 * - `visibleSpacesWhere / visibleTasksWhere / visibleEntriesWhere(actor)` 生成 Drizzle 条件，与 can() 共用同一规则。
 * 业务代码禁止直接比较角色；REQ-WS-007 矩阵测试覆盖全部 动作 × 角色 组合。
 */
import { and, eq, exists, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { EntryVisibility, SpaceRole, WorkspaceRole } from '../shared/schemas/enums.ts'
import {
  calendarEvents,
  calendars,
  entries,
  spaceMembers,
  spaces,
  tasks,
} from './db/schema/business.ts'

// ---------- 类型 ----------

/** 当前操作者。anon = null。 */
export interface Actor {
  id: string
  workspaceRole: WorkspaceRole
  /** 停用（Better Auth banned）；一切为 false */
  suspended?: boolean
}
export type MaybeActor = Actor | null

export interface SpaceRef {
  id: string
  visibility: 'workspace' | 'members'
  isPersonal: boolean
  createdBy: string
  archivedAt: Date | null
  deletedAt: Date | null
  /** 操作者在该空间的显式角色（space_members），无则 null */
  memberRole: SpaceRole | null
}

export interface TaskRef {
  id: string
  creatorId: string
  assigneeId: string | null
  deletedAt: Date | null
  space: SpaceRef
}

export interface EntryRef {
  id: string
  authorId: string
  visibility: EntryVisibility
  deletedAt: Date | null
  archivedAt: Date | null
  space: SpaceRef
}

export interface CommentRef {
  id: string
  authorId: string
  /** 评论所在目标（task / entry） */
  target: { kind: 'task'; ref: TaskRef } | { kind: 'entry'; ref: EntryRef }
}

export interface AttachmentRef {
  id: string
  ownerId: string
  target:
    | { kind: 'task'; ref: TaskRef }
    | { kind: 'entry'; ref: EntryRef }
    | { kind: 'comment'; ref: CommentRef }
    | { kind: 'user'; userId: string }
    | null
}

export interface CycleRef {
  id: string
  ownerId: string
}

/** 个人日历 / 日程（ADR-0009）：只有 owner 可读写，admin 也不可见（隐私）。 */
export interface CalendarRef {
  id: string
  ownerId: string
}

export interface UserRef {
  id: string
}

/** 动作 → 资源类型（01 §5 矩阵）。 */
export interface ActionMap {
  'workspace.manage': null
  'workspace.owner_transfer': null
  'member.suspend': UserRef
  'member.unsuspend': UserRef
  'member.revoke_sessions': UserRef
  'member.transfer_content': UserRef
  'me.delete': UserRef
  'space.create': null
  'tag.create': null
  'tag.manage': null
  'space.read': SpaceRef
  'space.manage': SpaceRef
  'space.delete': SpaceRef
  'entry.create': SpaceRef
  'task.create': SpaceRef
  'task.read': TaskRef
  'task.write': TaskRef
  'entry.read': EntryRef
  'entry.write': EntryRef
  'entry.delete': EntryRef
  'comment.create': TaskRef | EntryRef
  'comment.resolve': CommentRef
  'attachment.read': AttachmentRef
  'cycle.read': CycleRef
  'cycle.write': CycleRef
  'calendar.read': CalendarRef
  'calendar.write': CalendarRef
  'member.approve': null
  'notification.read': UserRef
  'notification.write': UserRef
}
export type Action = keyof ActionMap
export const ACTIONS = [
  'workspace.manage',
  'workspace.owner_transfer',
  'member.suspend',
  'member.unsuspend',
  'member.revoke_sessions',
  'member.transfer_content',
  'me.delete',
  'space.create',
  'tag.create',
  'tag.manage',
  'space.read',
  'space.manage',
  'space.delete',
  'entry.create',
  'task.create',
  'task.read',
  'task.write',
  'entry.read',
  'entry.write',
  'entry.delete',
  'comment.create',
  'comment.resolve',
  'attachment.read',
  'cycle.read',
  'cycle.write',
  'calendar.read',
  'calendar.write',
  'member.approve',
  'notification.read',
  'notification.write',
] as const satisfies readonly Action[]

// ---------- 规则 ----------

const SPACE_ROLE_RANK: Record<SpaceRole, number> = { viewer: 1, member: 2, admin: 3 }

const isWorkspaceAdmin = (a: Actor) => a.workspaceRole === 'owner' || a.workspaceRole === 'admin'

/**
 * 有效空间角色（01 §5：Workspace 角色 × Space 角色取较高者；guest 只有显式加入的 viewer）。
 * - owner/admin → admin
 * - member：visibility=workspace 的空间默认 member；显式行可升为 admin（不降级）
 * - guest：只看显式行，且封顶 viewer
 * 返回 null = 无任何访问权。
 */
export function effectiveSpaceRole(actor: Actor, space: SpaceRef): SpaceRole | null {
  if (isWorkspaceAdmin(actor)) return 'admin'
  if (actor.workspaceRole === 'guest') return space.memberRole ? 'viewer' : null
  // member
  const derived: SpaceRole | null = space.visibility === 'workspace' ? 'member' : null
  const explicit = space.memberRole
  if (!derived) return explicit
  if (!explicit) return derived
  return SPACE_ROLE_RANK[explicit] > SPACE_ROLE_RANK[derived] ? explicit : derived
}

/** 某工作区角色在空间里能被授予的最高角色（01 §5：guest 封顶 viewer）。加空间成员时用它校验请求的角色。 */
export function spaceRoleCap(workspaceRole: WorkspaceRole): SpaceRole {
  return workspaceRole === 'guest' ? 'viewer' : 'admin'
}
export const spaceRoleWithin = (role: SpaceRole, cap: SpaceRole) =>
  SPACE_ROLE_RANK[role] <= SPACE_ROLE_RANK[cap]

const spaceAlive = (s: SpaceRef) => s.deletedAt === null
const spaceWritable = (s: SpaceRef) => spaceAlive(s) && s.archivedAt === null

function canReadSpace(actor: Actor, s: SpaceRef): boolean {
  if (!spaceAlive(s)) return false
  return effectiveSpaceRole(actor, s) !== null
}

function canReadEntry(actor: Actor, e: EntryRef): boolean {
  if (e.deletedAt !== null) return false // 软删对所有人不可读
  if (!canReadSpace(actor, e.space)) return false
  switch (e.visibility) {
    case 'private':
      return e.authorId === actor.id
    case 'space':
      return true // 已通过 space.read
    case 'workspace':
      // guest 仍只限显式加入的空间（REQ-WS-009）；已由 canReadSpace 保证
      return true
  }
}

function canReadTask(actor: Actor, t: TaskRef): boolean {
  if (t.deletedAt !== null) return false
  return canReadSpace(actor, t.space)
}

function canWriteTask(actor: Actor, t: TaskRef): boolean {
  if (t.deletedAt !== null || !spaceWritable(t.space)) return false
  const role = effectiveSpaceRole(actor, t.space)
  return role === 'admin' || role === 'member'
}

function canWriteEntry(actor: Actor, e: EntryRef): boolean {
  if (!canReadEntry(actor, e) || !spaceWritable(e.space)) return false
  if (isWorkspaceAdmin(actor)) return true
  if (actor.workspaceRole === 'guest') return false
  return e.authorId === actor.id || effectiveSpaceRole(actor, e.space) === 'admin'
}

function canDeleteEntry(actor: Actor, e: EntryRef): boolean {
  if (e.deletedAt !== null || !spaceAlive(e.space)) return false
  if (isWorkspaceAdmin(actor)) return true
  if (actor.workspaceRole === 'guest') return false
  return e.authorId === actor.id && canReadEntry(actor, e)
}

function canReadTarget(actor: Actor, target: CommentRef['target']): boolean {
  return target.kind === 'task' ? canReadTask(actor, target.ref) : canReadEntry(actor, target.ref)
}

// ---------- 入口 ----------

export function can<A extends Action>(
  actor: MaybeActor,
  action: A,
  resource: ActionMap[A],
): boolean {
  if (!actor || actor.suspended) return false
  const admin = isWorkspaceAdmin(actor)
  switch (action) {
    case 'workspace.manage':
    case 'member.suspend':
    case 'member.unsuspend':
    case 'member.revoke_sessions':
    case 'member.transfer_content':
    case 'member.approve':
      return admin
    case 'workspace.owner_transfer':
      return actor.workspaceRole === 'owner'
    case 'me.delete':
    case 'notification.read':
    case 'notification.write':
      return (resource as UserRef).id === actor.id
    case 'space.create':
    case 'tag.create':
      return actor.workspaceRole !== 'guest'
    case 'tag.manage':
      return admin
    case 'space.read':
      return canReadSpace(actor, resource as SpaceRef)
    case 'space.manage': {
      const s = resource as SpaceRef
      if (!spaceAlive(s)) return false
      if (admin) return true
      if (actor.workspaceRole === 'guest') return false
      return effectiveSpaceRole(actor, s) === 'admin'
    }
    case 'space.delete': {
      const s = resource as SpaceRef
      return admin && !s.isPersonal && spaceAlive(s)
    }
    case 'task.create':
    case 'entry.create': {
      // 与 task.write 同规则：space member+ 且空间可写（01 §5 未单列，按「member：读写所在空间」）
      const s = resource as SpaceRef
      if (!spaceWritable(s)) return false
      const role = effectiveSpaceRole(actor, s)
      return role === 'admin' || role === 'member'
    }
    case 'task.read':
      return canReadTask(actor, resource as TaskRef)
    case 'task.write':
      return canWriteTask(actor, resource as TaskRef)
    case 'entry.read':
      return canReadEntry(actor, resource as EntryRef)
    case 'entry.write':
      return canWriteEntry(actor, resource as EntryRef)
    case 'entry.delete':
      return canDeleteEntry(actor, resource as EntryRef)
    case 'comment.create': {
      const r = resource as TaskRef | EntryRef
      return 'authorId' in r ? canReadEntry(actor, r) : canReadTask(actor, r)
    }
    case 'comment.resolve': {
      const c = resource as CommentRef
      if (!canReadTarget(actor, c.target)) return false
      if (admin) return true
      if (actor.workspaceRole === 'guest') return false
      const targetAuthor = c.target.kind === 'task' ? c.target.ref.creatorId : c.target.ref.authorId
      return c.authorId === actor.id || targetAuthor === actor.id
    }
    case 'attachment.read': {
      const a = resource as AttachmentRef
      if (!a.target) return a.ownerId === actor.id // 孤儿附件仅 owner
      switch (a.target.kind) {
        case 'task':
          return canReadTask(actor, a.target.ref)
        case 'entry':
          return canReadEntry(actor, a.target.ref)
        case 'comment':
          return canReadTarget(actor, a.target.ref.target)
        case 'user':
          return true // 头像：工作区内可见
      }
      return false
    }
    case 'cycle.read': {
      const c = resource as CycleRef
      return c.ownerId === actor.id || admin
    }
    case 'cycle.write':
      return (resource as CycleRef).ownerId === actor.id
    case 'calendar.read':
    case 'calendar.write':
      return (resource as CalendarRef).ownerId === actor.id
  }
  return false
}

export class ForbiddenError extends Error {
  readonly action: Action
  constructor(action: Action) {
    super(`forbidden: ${action}`)
    this.name = 'ForbiddenError'
    this.action = action
  }
}

export function assertCan<A extends Action>(
  actor: MaybeActor,
  action: A,
  resource: ActionMap[A],
): void {
  if (!can(actor, action, resource)) throw new ForbiddenError(action)
}

// ---------- 列表条件（与 can() 同规则；01 §5 不变量 3） ----------

/** 操作者是否在空间成员表中（子查询）。 */
const inSpaceMembers = (actor: Actor, spaceIdCol: SQL | typeof spaces.id) =>
  exists(
    sql`(select 1 from ${spaceMembers} where ${spaceMembers.spaceId} = ${spaceIdCol} and ${spaceMembers.userId} = ${actor.id})`,
  )

/** 可读空间（不含软删；归档仍可读）。 */
export function visibleSpacesWhere(actor: MaybeActor): SQL {
  if (!actor || actor.suspended) return sql`false`
  const alive = isNull(spaces.deletedAt)
  if (isWorkspaceAdmin(actor)) return alive
  if (actor.workspaceRole === 'guest') return and(alive, inSpaceMembers(actor, spaces.id))!
  return and(alive, or(eq(spaces.visibility, 'workspace'), inSpaceMembers(actor, spaces.id)))!
}

/** 可读任务：任务未软删 ∧ 其空间可读。 */
export function visibleTasksWhere(actor: MaybeActor): SQL {
  if (!actor || actor.suspended) return sql`false`
  const spaceOk = exists(
    sql`(select 1 from ${spaces} where ${spaces.id} = ${tasks.spaceId} and ${visibleSpacesWhere(actor)})`,
  )
  return and(isNull(tasks.deletedAt), spaceOk)!
}

/** 可读记录：未软删 ∧ 空间可读 ∧ (private 仅作者)。 */
export function visibleEntriesWhere(actor: MaybeActor): SQL {
  if (!actor || actor.suspended) return sql`false`
  const spaceOk = exists(
    sql`(select 1 from ${spaces} where ${spaces.id} = ${entries.spaceId} and ${visibleSpacesWhere(actor)})`,
  )
  const vis = or(sql`${entries.visibility} <> 'private'`, eq(entries.authorId, actor.id))!
  return and(isNull(entries.deletedAt), spaceOk, vis)!
}

/** 可读日历：仅本人（与 can('calendar.read') 同规则）。 */
export function visibleCalendarsWhere(actor: MaybeActor): SQL {
  if (!actor || actor.suspended) return sql`false`
  return eq(calendars.ownerId, actor.id)
}

/** 可读日程：本人 ∧ 未软删。 */
export function visibleCalendarEventsWhere(actor: MaybeActor): SQL {
  if (!actor || actor.suspended) return sql`false`
  return and(eq(calendarEvents.ownerId, actor.id), isNull(calendarEvents.deletedAt))!
}
