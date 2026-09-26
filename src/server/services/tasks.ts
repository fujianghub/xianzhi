/**
 * 任务 service（01 §3.2、02 §9、REQ-TASK-004 · 005 · 006 · 017 · 019；T1-003 读路径 + CRUD 骨架）。
 * - 可见性：列表 visibleTasksWhere，单个对象 can('task.read')；不可见一律 404。写：task.create / task.write（viewer 与归档空间 403）。
 * - 派生列 description_plain / tsv 在写 title / descriptionPm 的同一事务里由 taskDerivedSet 生成（CLAUDE 不变量 1）。
 * - 视图别名 view / due 按用户时区（src/shared/tz.ts）在服务端计算，前端不换算。
 * - 列表不返回 descriptionPm（CLAUDE 不变量 6）。
 * 后续：T1-037 幂等 / 恢复 / 永久删 / 回收站；T1-038 watchers / 子任务层级 / rebuild；T1-004 事件。
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'
import type { z } from 'zod'
import type { SpaceRole, TaskStatus, WorkspaceRole } from '../../shared/schemas/enums.ts'
import type {
  batchTasksSchema,
  createTaskSchema,
  listTasksQuery,
  patchTaskSchema,
} from '../../shared/schemas/tasks.ts'
import { dayRange, weekRange } from '../../shared/tz.ts'
import {
  type Actor,
  assertCan,
  can,
  type SpaceRef,
  type TaskRef,
  visibleTasksWhere,
} from '../authz.ts'
import type { Db, DbOrTx } from '../db/index.ts'
import { member as memberTable, user as userTable } from '../db/schema/auth.ts'
import {
  cycles,
  events,
  spaceMembers,
  spaces,
  tags,
  tasks,
  taskTags,
  taskWatchers,
} from '../db/schema/business.ts'
import { purgeTasks } from '../jobs/gc.ts'
import { decodeCursor, encodeCursor } from '../lib/cursor.ts'
import { AppError } from '../lib/errors.ts'
import { audit } from './audit.ts'
import { taskDerivedSet } from './derived.ts'
import { emit } from './events.ts'
import { publishChange } from './realtime.ts'
import { assertOwnTags, ownTagIdsSql } from './tags.ts'

type TaskRow = typeof tasks.$inferSelect
const CLOSED: TaskStatus[] = ['done', 'cancelled']

export interface TaskCtx {
  actor: Actor
  workspaceId: string
  /** 用户时区与周起始（session 用户；API Key 同样取其用户设置）。 */
  timezone: string
  weekStartsOn: number
  /** 测试注入「现在」。 */
  now?: Date
  /** 永久删除要删附件文件。 */
  dataDir?: string
  ip?: string | null
  userAgent?: string | null
  /** 外层事务内调用（batch）时置 true，提交后由外层统一 publishChange。 */
  silentRealtime?: boolean
}

export interface TaskView {
  id: string
  spaceId: string
  spaceSlug: string
  parentId: string | null
  title: string
  status: TaskStatus
  priority: number
  dueAt: string | null
  scheduledAt: string | null
  completedAt: string | null
  estimateMinutes: number | null
  assigneeId: string | null
  assignee: { id: string; displayName: string } | null
  creatorId: string
  cycleId: string | null
  recurrence: unknown
  sortKey: string
  tags: { id: string; name: string; color: string }[]
  hasDescription: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  /** 仅详情返回。 */
  descriptionPm?: unknown
}

// ---------- 读取与鉴权 ----------

async function loadTask(db: DbOrTx, ctx: TaskCtx, id: string) {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.workspaceId, ctx.workspaceId)))
    .limit(1)
  if (!row) return null
  const sp = await spaceRefOne(db, ctx.actor, row.spaceId)
  if (!sp) return null
  const ref: TaskRef = {
    id: row.id,
    creatorId: row.creatorId,
    assigneeId: row.assigneeId,
    deletedAt: row.deletedAt,
    space: sp.ref,
  }
  return { row, space: sp, ref }
}

async function requireTask(db: DbOrTx, ctx: TaskCtx, id: string) {
  const t = await loadTask(db, ctx, id)
  if (!t || !can(ctx.actor, 'task.read', t.ref)) throw AppError.notFound('任务不存在')
  return t
}

/** 空间 + 当前用户的空间角色，一条查询（REQ-TASK-023：列表接口查询数 ≤ 3）。 */
async function spaceRefOne(db: DbOrTx, actor: Actor, spaceId: string) {
  const [r] = await db
    .select({ s: spaces, role: spaceMembers.role })
    .from(spaces)
    .leftJoin(
      spaceMembers,
      and(eq(spaceMembers.spaceId, spaces.id), eq(spaceMembers.userId, actor.id)),
    )
    .where(eq(spaces.id, spaceId))
    .limit(1)
  if (!r) return null
  const ref: SpaceRef = {
    id: r.s.id,
    visibility: r.s.visibility as SpaceRef['visibility'],
    isPersonal: r.s.isPersonal,
    createdBy: r.s.createdBy,
    archivedAt: r.s.archivedAt,
    deletedAt: r.s.deletedAt,
    memberRole: (r.role as SpaceRole | null) ?? null,
  }
  return { row: r.s, ref }
}

async function requireReadableSpace(db: DbOrTx, actor: Actor, spaceId: string) {
  const sp = await spaceRefOne(db, actor, spaceId)
  if (!sp || !can(actor, 'space.read', sp.ref)) throw AppError.notFound('空间不存在') // 02 §4：不可见筛选 → 404
  return sp
}

// ---------- 序列化 ----------

const LEFT_MEMBER = '已离开的成员'

type JoinedRow = { t: TaskRow; slug: string; assigneeName: string | null }

/** 任务 + 空间 slug + 指派人显示名（仍是工作区成员才有名字）：一条查询。 */
function selectJoined(db: DbOrTx, ctx: TaskCtx) {
  return db
    .select({
      t: tasks,
      slug: spaces.slug,
      assigneeName: sql<
        string | null
      >`coalesce(nullif(${userTable.displayName}, ''), ${userTable.name})`,
    })
    .from(tasks)
    .innerJoin(spaces, eq(spaces.id, tasks.spaceId))
    .leftJoin(
      memberTable,
      and(
        eq(memberTable.userId, tasks.assigneeId),
        eq(memberTable.organizationId, ctx.workspaceId),
      ),
    )
    .leftJoin(userTable, eq(userTable.id, memberTable.userId))
}

/** 附标签（一条查询）并序列化。 */
/** 附标签等；标签只取 `actorId` 本人的（ADR-0017：标签按人隔离）。 */
async function decorate(
  db: DbOrTx,
  actorId: string,
  joined: JoinedRow[],
  withBody = false,
): Promise<TaskView[]> {
  if (!joined.length) return []
  const tagRows = await db
    .select({ taskId: taskTags.taskId, id: tags.id, name: tags.name, color: tags.color })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(
      and(
        inArray(
          taskTags.taskId,
          joined.map((j) => j.t.id),
        ),
        eq(tags.createdBy, actorId),
      ),
    )
    .orderBy(asc(tags.name))
  const tagsOf = new Map<string, TaskView['tags']>()
  for (const t of tagRows) {
    const list = tagsOf.get(t.taskId) ?? []
    list.push({ id: t.id, name: t.name, color: t.color })
    tagsOf.set(t.taskId, list)
  }
  return joined.map(({ t: r, slug, assigneeName }) => {
    const v: TaskView = {
      id: r.id,
      spaceId: r.spaceId,
      spaceSlug: slug,
      parentId: r.parentId,
      title: r.title,
      status: r.status as TaskStatus,
      priority: r.priority,
      dueAt: r.dueAt?.toISOString() ?? null,
      scheduledAt: r.scheduledAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      estimateMinutes: r.estimateMinutes,
      assigneeId: r.assigneeId,
      assignee: r.assigneeId
        ? { id: r.assigneeId, displayName: assigneeName ?? LEFT_MEMBER }
        : null,
      creatorId: r.creatorId,
      cycleId: r.cycleId,
      recurrence: r.recurrence ?? null,
      sortKey: r.sortKey,
      tags: tagsOf.get(r.id) ?? [],
      hasDescription: r.descriptionPm !== null,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }
    if (withBody) v.descriptionPm = r.descriptionPm ?? null
    return v
  })
}

// ---------- 列表 ----------

/** 排序列；dueAt 可空，用 infinity 兜底让游标元组比较成立（空值排最后）。 */
const SORT_EXPR = {
  updatedAt: sql`${tasks.updatedAt}`,
  createdAt: sql`${tasks.createdAt}`,
  dueAt: sql`coalesce(${tasks.dueAt}, 'infinity'::timestamptz)`,
  priority: sql`${tasks.priority}`,
  title: sql`${tasks.title}`,
  sortKey: sql`${tasks.sortKey}`,
} as const
type SortField = keyof typeof SORT_EXPR

function cursorValue(field: SortField, r: TaskRow): string | number {
  switch (field) {
    case 'priority':
      return r.priority
    case 'title':
      return r.title
    case 'sortKey':
      return r.sortKey
    case 'dueAt':
      return r.dueAt ? r.dueAt.toISOString() : 'infinity'
    default:
      return r[field].toISOString()
  }
}

function cursorParam(field: SortField, v: string | number | null): SQL {
  if (field === 'priority') return sql`${Number(v)}::smallint`
  if (field === 'title') return sql`${String(v)}`
  if (field === 'sortKey') return sql`${String(v)} collate "C"`
  return sql`${String(v)}::timestamptz`
}

/** 「我的」任务：指派给我，或未指派且由我创建（今日视图的人员范围，02 §9 注）。 */
const mine = (me: string) =>
  or(eq(tasks.assigneeId, me), and(isNull(tasks.assigneeId), eq(tasks.creatorId, me)))!

/** GET /tasks（REQ-TASK-004 · 005 · 006 · 017）。 */
export async function listTasks(db: DbOrTx, ctx: TaskCtx, q: z.infer<typeof listTasksQuery>) {
  const me = ctx.actor.id
  const now = ctx.now ?? new Date()
  if (q.view === 'inbox' && q.status)
    throw AppError.validation([{ path: 'status', message: 'view=inbox 时不能再筛 status' }])
  if (q.view && q.deleted)
    throw AppError.validation([{ path: 'view', message: 'view 不能与 deleted 同用' }])
  let range: { from: Date; to: Date } | null = null
  if (q.from || q.to) {
    if (!q.from || !q.to)
      throw AppError.validation([
        { path: q.from ? 'to' : 'from', message: 'from 与 to 须同时给出' },
      ])
    if (q.view || q.deleted)
      throw AppError.validation([{ path: 'from', message: '日历区间不能与 view / deleted 同用' }])
    range = { from: new Date(q.from), to: new Date(q.to) }
    const span = range.to.getTime() - range.from.getTime()
    if (span <= 0 || span > 62 * 86_400_000)
      throw AppError.validation([{ path: 'to', message: '区间须满足 from < to 且不超过 62 天' }])
  }
  const conds: SQL[] = [eq(tasks.workspaceId, ctx.workspaceId)]
  if (q.deleted) {
    // 回收站（T1-037 细化）：本人创建的软删任务；owner/admin 全部
    conds.push(isNotNull(tasks.deletedAt))
    if (!can(ctx.actor, 'workspace.manage', null)) conds.push(eq(tasks.creatorId, me))
  } else conds.push(visibleTasksWhere(ctx.actor))

  if (q.spaceId) {
    await requireReadableSpace(db, ctx.actor, q.spaceId)
    conds.push(eq(tasks.spaceId, q.spaceId))
  }
  if (q.status) conds.push(inArray(tasks.status, q.status))
  if (q.assigneeId) conds.push(eq(tasks.assigneeId, q.assigneeId === 'me' ? me : q.assigneeId))
  if (q.creatorId) conds.push(eq(tasks.creatorId, q.creatorId === 'me' ? me : q.creatorId))
  if (q.cycleId) conds.push(eq(tasks.cycleId, q.cycleId))
  if (q.parentId) conds.push(eq(tasks.parentId, q.parentId))
  if (q.tag)
    conds.push(
      sql`exists (select 1 from ${taskTags} tt join ${tags} t on t.id = tt.tag_id where tt.task_id = ${tasks.id} and t.created_by = ${ctx.actor.id} and t.name in (${sql.join(
        q.tag.map((name) => sql`${name}`),
        sql`, `,
      )}))`,
    )
  if (q.dueBefore) conds.push(lt(tasks.dueAt, new Date(q.dueBefore)))
  if (q.dueAfter) conds.push(gte(tasks.dueAt, new Date(q.dueAfter)))
  if (q.q)
    conds.push(or(ilike(tasks.title, `%${q.q}%`), ilike(tasks.descriptionPlain, `%${q.q}%`))!)
  if (range)
    // 日历（REQ-TASK-024）：截止或计划开始落在区间内都算；可见性已由 visibleTasksWhere 保证
    conds.push(
      or(
        and(gte(tasks.dueAt, range.from), lt(tasks.dueAt, range.to)),
        and(gte(tasks.scheduledAt, range.from), lt(tasks.scheduledAt, range.to)),
      )!,
    )

  if (q.view === 'today') {
    // 逾期未完成 ∪ 今日到期 ∪ 今日开始（08 §2.3）；dueAt < 明日 00:00 已覆盖前两者
    const { start, end } = dayRange(ctx.timezone, now)
    conds.push(notInArray(tasks.status, CLOSED), mine(me))
    conds.push(
      or(lt(tasks.dueAt, end), and(gte(tasks.scheduledAt, start), lt(tasks.scheduledAt, end)))!,
    )
  } else if (q.view === 'inbox') {
    conds.push(eq(tasks.status, 'inbox'), or(eq(tasks.creatorId, me), eq(tasks.assigneeId, me))!)
  }
  if (q.due === 'today' || q.due === 'week') {
    const { start, end } =
      q.due === 'today'
        ? dayRange(ctx.timezone, now)
        : weekRange(ctx.timezone, ctx.weekStartsOn, now)
    conds.push(gte(tasks.dueAt, start), lt(tasks.dueAt, end))
  } else if (q.due === 'overdue') {
    conds.push(lt(tasks.dueAt, now), notInArray(tasks.status, CLOSED))
  }

  const primary = (q.sort[0] ?? { field: 'updatedAt', dir: 'desc' }) as {
    field: SortField
    dir: 'asc' | 'desc'
  }
  const expr = SORT_EXPR[primary.field]
  const c = decodeCursor(q.cursor, 2)
  if (q.cursor && !c) throw AppError.validation([{ path: 'cursor', message: '游标无效' }])
  const pageConds = [...conds]
  if (c) {
    const [v, id] = c
    const cmp = primary.dir === 'desc' ? sql`<` : sql`>`
    pageConds.push(
      sql`(${expr}, ${tasks.id}) ${cmp} (${cursorParam(primary.field, v ?? null)}, ${String(id)}::uuid)`,
    )
  }
  const order =
    primary.dir === 'desc' ? [sql`${expr} desc`, desc(tasks.id)] : [sql`${expr} asc`, asc(tasks.id)]
  const rows = await selectJoined(db, ctx)
    .where(and(...pageConds))
    .orderBy(...order)
    .limit(q.limit + 1)
  const page = rows.slice(0, q.limit)
  const last = page[page.length - 1]
  const nextCursor =
    rows.length > q.limit && last
      ? encodeCursor([cursorValue(primary.field, last.t), last.t.id])
      : null
  const items = await decorate(db, ctx.actor.id, page)
  if (!q.withTotal) return { items, nextCursor }
  const [t] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(...conds))
  return { items, nextCursor, total: t?.n ?? 0 }
}

/** GET /tasks/:id：含 descriptionPm；不可见 → 404。 */
export async function getTask(db: DbOrTx, ctx: TaskCtx, id: string): Promise<TaskView> {
  await requireTask(db, ctx, id)
  const joined = await selectJoined(db, ctx).where(eq(tasks.id, id)).limit(1)
  const [v] = await decorate(db, ctx.actor.id, joined, true)
  if (!v) throw AppError.notFound('任务不存在')
  return v
}

// ---------- 写入校验 ----------

async function personalSpaceId(db: DbOrTx, ctx: TaskCtx): Promise<string> {
  const [s] = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.workspaceId, ctx.workspaceId),
        eq(spaces.createdBy, ctx.actor.id),
        eq(spaces.isPersonal, true),
      ),
    )
    .limit(1)
  if (!s) throw AppError.notFound('个人空间不存在')
  return s.id
}

/** 指派人须是工作区成员且能读该空间（01 §5：不能把任务指给看不到它的人）。 */
async function assertAssignable(
  db: DbOrTx,
  ctx: TaskCtx,
  userId: string,
  space: SpaceRef,
  path = 'assigneeId',
) {
  const [m] = await db
    .select({ role: memberTable.role })
    .from(memberTable)
    .where(and(eq(memberTable.organizationId, ctx.workspaceId), eq(memberTable.userId, userId)))
    .limit(1)
  const [sm] = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, userId)))
    .limit(1)
  const who: Actor = { id: userId, workspaceRole: (m?.role ?? 'guest') as WorkspaceRole }
  const ok =
    !!m &&
    can(who, 'space.read', { ...space, memberRole: (sm?.role as SpaceRole | undefined) ?? null })
  if (!ok) throw AppError.validation([{ path, message: '该用户不是这个空间的可见成员' }])
}

async function assertCycle(db: DbOrTx, ctx: TaskCtx, cycleId: string) {
  const [c] = await db
    .select({ id: cycles.id, ownerId: cycles.ownerId })
    .from(cycles)
    .where(and(eq(cycles.id, cycleId), eq(cycles.workspaceId, ctx.workspaceId)))
    .limit(1)
  if (!c || !can(ctx.actor, 'cycle.write', c))
    throw AppError.validation([{ path: 'cycleId', message: '周期不存在' }])
}

/** 只能打自己的标签（ADR-0017）。 */
const assertTags = (db: DbOrTx, ctx: TaskCtx, tagIds: string[]) => assertOwnTags(db, ctx, tagIds)

/** 子任务最多 2 层（01 §3.2、REQ-TASK-008）：父任务本身不能有父任务；自己有子任务时不能再挂到别人下面。 */
async function assertParent(
  db: DbOrTx,
  ctx: TaskCtx,
  parentId: string,
  spaceId: string,
  selfId?: string,
) {
  if (parentId === selfId)
    throw AppError.validation([{ path: 'parentId', message: '不能以自己为父任务' }])
  const p = await loadTask(db, ctx, parentId)
  if (!p || p.row.deletedAt || !can(ctx.actor, 'task.read', p.ref))
    throw AppError.validation([{ path: 'parentId', message: '父任务不存在' }])
  if (p.row.spaceId !== spaceId)
    throw AppError.validation([{ path: 'parentId', message: '父任务须在同一空间' }])
  if (p.row.parentId) throw AppError.validation([{ path: 'parentId', message: '子任务最多 2 层' }])
  if (selfId && (await hasChildren(db, selfId)))
    throw AppError.validation([{ path: 'parentId', message: '有子任务的任务不能再作为子任务' }])
}

async function hasChildren(db: DbOrTx, id: string): Promise<boolean> {
  const [c] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.parentId, id), isNull(tasks.deletedAt)))
    .limit(1)
  return !!c
}

/** (space, status) 列末尾的新键：新建 / 换列的任务落在列底。 */
async function columnEndKey(db: DbOrTx, spaceId: string, status: string): Promise<string> {
  const [r] = await db
    .select({ k: max(tasks.sortKey) })
    .from(tasks)
    .where(and(eq(tasks.spaceId, spaceId), eq(tasks.status, status)))
  return generateKeyBetween(r?.k ?? null, null)
}

// ---------- 事件（01 §4、CLAUDE 不变量 3：service 内同事务 emit） ----------

async function displayNameOf(db: DbOrTx, userId: string): Promise<string> {
  const [u] = await db
    .select({ name: userTable.name, displayName: userTable.displayName })
    .from(userTable)
    .where(eq(userTable.id, userId))
  return u?.displayName || u?.name || ''
}

interface TaskEventBase {
  id: string
  title: string
  spaceId: string
  spaceSlug: string
  dueAt: Date | null
  cycleId: string | null
}

/** task.assigned（REQ-TASK-007）：新指派人自动为 watcher 已在写入时处理；自指派由扇出排除操作者。 */
async function emitAssigned(
  tx: DbOrTx,
  ctx: TaskCtx,
  t: TaskEventBase,
  assigneeId: string,
  prevAssigneeId: string | null,
) {
  await emit(tx, {
    kind: 'task.assigned',
    workspaceId: ctx.workspaceId,
    actorId: ctx.actor.id,
    targetType: 'task',
    targetId: t.id,
    visibilityScope: { spaceId: t.spaceId, userIds: [assigneeId] },
    payload: {
      taskId: t.id,
      title: t.title,
      actorId: ctx.actor.id,
      actorName: await displayNameOf(tx, ctx.actor.id),
      assigneeId,
      ...(prevAssigneeId ? { prevAssigneeId } : {}),
      spaceSlug: t.spaceSlug,
      ...(t.dueAt ? { dueAt: t.dueAt.toISOString() } : {}),
    },
  })
}

/** 状态进出 done 时的事件（REQ-TASK-002 · 021）：completed 载荷带 prevStatus 供撤销回退。 */
async function emitStatusChange(
  tx: DbOrTx,
  ctx: TaskCtx,
  t: TaskEventBase,
  from: TaskStatus,
  to: TaskStatus,
  completedAt: Date,
) {
  if (from !== 'done' && to === 'done')
    await emit(tx, {
      kind: 'task.completed',
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      targetType: 'task',
      targetId: t.id,
      visibilityScope: { spaceId: t.spaceId },
      payload: {
        taskId: t.id,
        title: t.title,
        actorId: ctx.actor.id,
        actorName: await displayNameOf(tx, ctx.actor.id),
        spaceSlug: t.spaceSlug,
        completedAt: completedAt.toISOString(),
        prevStatus: from,
        ...(t.cycleId ? { cycleId: t.cycleId } : {}),
      },
    })
  else if (from === 'done' && to !== 'done')
    await emit(tx, {
      kind: 'task.uncompleted',
      workspaceId: ctx.workspaceId,
      actorId: ctx.actor.id,
      targetType: 'task',
      targetId: t.id,
      visibilityScope: { spaceId: t.spaceId },
      payload: {
        taskId: t.id,
        title: t.title,
        actorId: ctx.actor.id,
        actorName: await displayNameOf(tx, ctx.actor.id),
        spaceSlug: t.spaceSlug,
        prevStatus: to,
      },
    })
}

// ---------- 创建 / 修改 / 删除 ----------

/** POST /tasks：缺省落个人空间；task.create（viewer / 归档空间 403）。事件与 watchers 在 T1-004 / T1-038。 */
export async function createTask(
  db: DbOrTx,
  ctx: TaskCtx,
  input: z.infer<typeof createTaskSchema>,
): Promise<TaskView> {
  const spaceId = input.spaceId ?? (await personalSpaceId(db, ctx))
  const sp = await requireReadableSpace(db, ctx.actor, spaceId)
  assertCan(ctx.actor, 'task.create', sp.ref)
  if (input.assigneeId) await assertAssignable(db, ctx, input.assigneeId, sp.ref)
  if (input.cycleId) await assertCycle(db, ctx, input.cycleId)
  if (input.tagIds) await assertTags(db, ctx, input.tagIds)
  if (input.parentId) await assertParent(db, ctx, input.parentId, spaceId)
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tasks)
      .values({
        workspaceId: ctx.workspaceId,
        spaceId,
        parentId: input.parentId ?? null,
        title: input.title,
        descriptionPm: input.descriptionPm ?? null,
        status: input.status,
        priority: input.priority,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        completedAt: input.status === 'done' ? new Date() : null,
        estimateMinutes: input.estimateMinutes ?? null,
        assigneeId: input.assigneeId ?? null,
        creatorId: ctx.actor.id,
        cycleId: input.cycleId ?? null,
        recurrence: input.recurrence ?? null,
        sortKey: await columnEndKey(tx, spaceId, input.status),
        ...taskDerivedSet(input.title, input.descriptionPm ?? null),
      })
      .returning({ id: tasks.id })
    if (!row) throw new Error('insert tasks failed')
    if (input.tagIds?.length)
      await tx
        .insert(taskTags)
        .values([...new Set(input.tagIds)].map((tagId) => ({ taskId: row.id, tagId })))
        .onConflictDoNothing()
    // 创建者、指派人自动关注（01 §3.2、REQ-TASK-001；增删接口在 T1-038）
    const watchers = [...new Set([ctx.actor.id, input.assigneeId].filter((x): x is string => !!x))]
    await tx
      .insert(taskWatchers)
      .values(watchers.map((userId) => ({ taskId: row.id, userId })))
      .onConflictDoNothing()
    const base: TaskEventBase = {
      id: row.id,
      title: input.title,
      spaceId,
      spaceSlug: sp.row.slug,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      cycleId: input.cycleId ?? null,
    }
    if (input.assigneeId) await emitAssigned(tx, ctx, base, input.assigneeId, null)
    return row.id
  })
  publishChange(ctx, [spaceId], [['tasks']])
  return getTask(db, ctx, id)
}

/** PATCH /tasks/:id：task.write；ifUpdatedAt 乐观锁 → 409 带 current（T1-037 补测）；换空间需目标 task.create。 */
export async function patchTask(
  db: DbOrTx,
  ctx: TaskCtx,
  id: string,
  patch: z.infer<typeof patchTaskSchema>,
): Promise<TaskView> {
  const t = await requireTask(db, ctx, id)
  assertCan(ctx.actor, 'task.write', t.ref)
  if (t.row.updatedAt.toISOString() !== new Date(patch.ifUpdatedAt).toISOString())
    throw new AppError(409, 'CONFLICT_STALE', '任务已被他人修改', {
      current: await getTask(db, ctx, id),
    })
  let targetSpace = t.space
  if (patch.spaceId && patch.spaceId !== t.row.spaceId) {
    targetSpace = await requireReadableSpace(db, ctx.actor, patch.spaceId)
    assertCan(ctx.actor, 'task.create', targetSpace.ref)
  }
  const spaceId = targetSpace.row.id
  if (spaceId !== t.row.spaceId) {
    // 父子须同空间：带着父任务（且未同时解除）或带着子任务都不能单独换空间
    if ((t.row.parentId && patch.parentId !== null) || (await hasChildren(db, id)))
      throw AppError.validation([
        { path: 'spaceId', message: '有父任务或子任务的任务不能单独换空间' },
      ])
  }
  const assigneeId = patch.assigneeId === undefined ? t.row.assigneeId : patch.assigneeId
  if (assigneeId && (patch.assigneeId !== undefined || spaceId !== t.row.spaceId))
    await assertAssignable(db, ctx, assigneeId, targetSpace.ref)
  if (patch.cycleId) await assertCycle(db, ctx, patch.cycleId)
  if (patch.tagIds) await assertTags(db, ctx, patch.tagIds)
  if (patch.parentId) await assertParent(db, ctx, patch.parentId, spaceId, id)

  const status = patch.status ?? (t.row.status as TaskStatus)
  const set: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date(), spaceId }
  if (patch.title !== undefined) set.title = patch.title
  if (patch.descriptionPm !== undefined) set.descriptionPm = patch.descriptionPm
  const now = new Date()
  if (patch.status !== undefined && patch.status !== t.row.status) {
    set.status = patch.status
    set.completedAt = patch.status === 'done' ? now : null
  }
  if (patch.priority !== undefined) set.priority = patch.priority
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt ? new Date(patch.dueAt) : null
  if (patch.scheduledAt !== undefined)
    set.scheduledAt = patch.scheduledAt ? new Date(patch.scheduledAt) : null
  if (patch.estimateMinutes !== undefined) set.estimateMinutes = patch.estimateMinutes
  if (patch.assigneeId !== undefined) set.assigneeId = patch.assigneeId
  if (patch.cycleId !== undefined) set.cycleId = patch.cycleId
  if (patch.recurrence !== undefined) set.recurrence = patch.recurrence
  if (patch.parentId !== undefined) set.parentId = patch.parentId
  if (patch.sortKey !== undefined) set.sortKey = patch.sortKey
  else if (set.status !== undefined || spaceId !== t.row.spaceId)
    set.sortKey = await columnEndKey(db, spaceId, status) // 换列 / 换空间落列底
  if (patch.title !== undefined || patch.descriptionPm !== undefined)
    Object.assign(
      set,
      taskDerivedSet(
        patch.title ?? t.row.title,
        patch.descriptionPm === undefined ? t.row.descriptionPm : patch.descriptionPm,
      ),
    )
  await db.transaction(async (tx) => {
    await tx.update(tasks).set(set).where(eq(tasks.id, id))
    const base: TaskEventBase = {
      id,
      title: set.title ?? t.row.title,
      spaceId,
      spaceSlug: targetSpace.row.slug,
      dueAt: set.dueAt === undefined ? t.row.dueAt : (set.dueAt ?? null),
      cycleId: set.cycleId === undefined ? t.row.cycleId : (set.cycleId ?? null),
    }
    if (patch.assigneeId && patch.assigneeId !== t.row.assigneeId) {
      await tx
        .insert(taskWatchers)
        .values({ taskId: id, userId: patch.assigneeId })
        .onConflictDoNothing()
      await emitAssigned(tx, ctx, base, patch.assigneeId, t.row.assigneeId)
    }
    if (set.status !== undefined)
      await emitStatusChange(
        tx,
        ctx,
        base,
        t.row.status as TaskStatus,
        set.status as TaskStatus,
        now,
      )
    if (patch.tagIds) {
      // 只替换本人的标签；别人打在这个任务上的标签不动（ADR-0017）
      await tx
        .delete(taskTags)
        .where(
          and(eq(taskTags.taskId, id), sql`${taskTags.tagId} in ${ownTagIdsSql(ctx.actor.id)}`),
        )
      if (patch.tagIds.length)
        await tx
          .insert(taskTags)
          .values([...new Set(patch.tagIds)].map((tagId) => ({ taskId: id, tagId })))
          .onConflictDoNothing()
    }
  })
  publishChange(ctx, [t.row.spaceId, targetSpace.row.id], [['tasks'], ['task', id]])
  return getTask(db, ctx, id)
}

/** DELETE /tasks/:id：软删（task.write，REQ-TASK-013）。 */
export async function softDeleteTask(db: DbOrTx, ctx: TaskCtx, id: string): Promise<void> {
  const t = await requireTask(db, ctx, id)
  assertCan(ctx.actor, 'task.write', t.ref)
  await db
    .update(tasks)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(tasks.id, id))
  publishChange(ctx, [t.row.spaceId], [['tasks'], ['task', id]])
}

/**
 * 回收站里的任务：软删对象对所有人不可读（01 §5），这里按「活着时可读 + (创建者或 owner/admin)」放行，
 * 与 `GET /tasks?deleted=1` 的列出范围一致（02 §5「本人可恢复的；owner/admin 全部」）。
 */
async function requireTrashedTask(db: DbOrTx, ctx: TaskCtx, id: string) {
  const t = await loadTask(db, ctx, id)
  if (!t?.row.deletedAt) throw AppError.notFound('任务不存在')
  const alive = { ...t.ref, deletedAt: null }
  const admin = can(ctx.actor, 'workspace.manage', null)
  if (!(admin || t.row.creatorId === ctx.actor.id) || !can(ctx.actor, 'task.read', alive))
    throw AppError.notFound('任务不存在')
  return { ...t, alive }
}

/** POST /tasks/:id/restore（REQ-TASK-013）：回收站中的任务回到原空间原列；需要活着时的 task.write。 */
export async function restoreTask(db: DbOrTx, ctx: TaskCtx, id: string): Promise<TaskView> {
  const t = await requireTrashedTask(db, ctx, id)
  assertCan(ctx.actor, 'task.write', t.alive)
  await db.update(tasks).set({ deletedAt: null, updatedAt: new Date() }).where(eq(tasks.id, id))
  publishChange(ctx, [t.row.spaceId], [['tasks'], ['task', id]])
  return getTask(db, ctx, id)
}

/**
 * DELETE /tasks/:id?permanent=1（REQ-TASK-013）：仅工作区 owner/admin；先判权限再查对象（member 一律 403）。
 * 未软删的任务也可直接永久删；评论、附件一并清除；记审计 task.permanently_deleted。
 */
export async function permanentlyDeleteTask(db: Db, ctx: TaskCtx, id: string): Promise<void> {
  assertCan(ctx.actor, 'workspace.manage', null)
  const t = await loadTask(db, ctx, id)
  if (!t) throw AppError.notFound('任务不存在')
  if (!ctx.dataDir) throw new Error('permanentlyDeleteTask 需要 dataDir（删除附件文件）')
  await purgeTasks({ db, dataDir: ctx.dataDir }, [id])
  await audit(db, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.actor.id,
    action: 'task.permanently_deleted',
    targetType: 'task',
    targetId: id,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    meta: { title: t.row.title, spaceId: t.row.spaceId, wasDeleted: !!t.row.deletedAt },
  })
  publishChange(ctx, [t.row.spaceId], [['tasks'], ['task', id]])
}

// ---------- watchers（REQ-TASK-014） ----------

export interface WatcherView {
  userId: string
  displayName: string
  image: string | null
}

/** GET /tasks/:id/watchers：可读即可；只列仍是工作区成员的人。 */
export async function listWatchers(db: DbOrTx, ctx: TaskCtx, id: string): Promise<WatcherView[]> {
  await requireTask(db, ctx, id)
  const rows = await db
    .select({
      userId: taskWatchers.userId,
      name: userTable.name,
      displayName: userTable.displayName,
      image: userTable.image,
    })
    .from(taskWatchers)
    .innerJoin(userTable, eq(userTable.id, taskWatchers.userId))
    .innerJoin(
      memberTable,
      and(
        eq(memberTable.userId, taskWatchers.userId),
        eq(memberTable.organizationId, ctx.workspaceId),
      ),
    )
    .where(eq(taskWatchers.taskId, id))
    .orderBy(asc(taskWatchers.createdAt))
  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName || r.name,
    image: r.image,
  }))
}

/**
 * 关注 / 取消关注：自己 = 可读即可（viewer 也能关注）；替别人增删 = task.write，且被加的人须能读该空间。
 * 规则见 02 §9 注（2026-09-24，T1-038）。
 */
async function requireWatcherEdit(db: DbOrTx, ctx: TaskCtx, id: string, userId: string) {
  const t = await requireTask(db, ctx, id)
  if (userId !== ctx.actor.id) assertCan(ctx.actor, 'task.write', t.ref)
  return t
}

export async function addWatcher(db: DbOrTx, ctx: TaskCtx, id: string, userId: string) {
  const t = await requireWatcherEdit(db, ctx, id, userId)
  if (userId !== ctx.actor.id) await assertAssignable(db, ctx, userId, t.space.ref, 'userId')
  await db.insert(taskWatchers).values({ taskId: id, userId }).onConflictDoNothing()
  return listWatchers(db, ctx, id)
}

export async function removeWatcher(db: DbOrTx, ctx: TaskCtx, id: string, userId: string) {
  await requireWatcherEdit(db, ctx, id, userId)
  const r = await db
    .delete(taskWatchers)
    .where(and(eq(taskWatchers.taskId, id), eq(taskWatchers.userId, userId)))
    .returning({ userId: taskWatchers.userId })
  if (!r.length) throw AppError.notFound('该用户没有关注此任务')
}

// ---------- 完成 / 撤销完成（REQ-TASK-002 · 021） ----------

/**
 * POST /tasks/:id/complete：进入 done，写 completed_at，发 task.completed（watchers 除操作者收到）。
 * 已是 done 时幂等返回。`recurrence` 生成下一实例属 Phase 2（REQ-TASK-011）。
 */
export async function completeTask(
  db: DbOrTx,
  ctx: TaskCtx,
  id: string,
  ifUpdatedAt?: string,
): Promise<TaskView> {
  const t = await requireTask(db, ctx, id)
  assertCan(ctx.actor, 'task.write', t.ref)
  if (t.row.status === 'done') return getTask(db, ctx, id)
  return patchTask(db, ctx, id, {
    status: 'done',
    ifUpdatedAt: ifUpdatedAt ?? t.row.updatedAt.toISOString(),
  })
}

/**
 * POST /tasks/:id/uncomplete：回到完成前的状态（最近一次 task.completed 载荷里的 prevStatus，缺省 todo），
 * 发 task.uncompleted（仅活动流；扇出把 5 分钟内的完成通知原地改为「撤销了完成」）。
 */
export async function uncompleteTask(
  db: DbOrTx,
  ctx: TaskCtx,
  id: string,
  ifUpdatedAt?: string,
): Promise<TaskView> {
  const t = await requireTask(db, ctx, id)
  assertCan(ctx.actor, 'task.write', t.ref)
  if (t.row.status !== 'done')
    throw new AppError(409, 'CONFLICT_STALE', '任务未完成', { current: await getTask(db, ctx, id) })
  const [last] = await db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.kind, 'task.completed'), eq(events.targetId, id)))
    .orderBy(desc(events.createdAt))
    .limit(1)
  const prev = (last?.payload as { prevStatus?: string } | undefined)?.prevStatus
  const status = (prev && prev !== 'done' ? prev : 'todo') as TaskStatus
  return patchTask(db, ctx, id, {
    status,
    ifUpdatedAt: ifUpdatedAt ?? t.row.updatedAt.toISOString(),
  })
}

// ---------- 批量（REQ-TASK-016） ----------

export interface BatchOpResult {
  index: number
  id: string
  ok: boolean
  status: number
  code?: string
  detail?: string
  task?: TaskView | null
}

const ROLLBACK = Symbol('batch-rollback')

async function opSpaces(db: DbOrTx, ids: string[]): Promise<string[]> {
  const rows = await db.select({ spaceId: tasks.spaceId }).from(tasks).where(inArray(tasks.id, ids))
  return rows.map((r) => r.spaceId)
}

/**
 * POST /tasks/batch：整体一个事务，每条在各自的保存点里执行；任意一条失败 → 全部回滚，
 * 抛出第一条失败的状态码，Problem 体带逐条结果 `results`（成功项标 `rolledBack: true`）。
 * 看板拖拽只发一条（update：sortKey + status + ifUpdatedAt）。
 */
export async function batchTasks(
  db: Db,
  ctx: TaskCtx,
  ops: z.infer<typeof batchTasksSchema>['ops'],
): Promise<{ results: BatchOpResult[] }> {
  const results: BatchOpResult[] = []
  let failed = false
  const inner: TaskCtx = { ...ctx, silentRealtime: true }
  try {
    await db.transaction(async (tx) => {
      for (const [index, op] of ops.entries()) {
        try {
          const task = await tx.transaction(async (sp) => {
            if (op.op === 'update') return patchTask(sp, inner, op.id, op.patch)
            if (op.op === 'complete') return completeTask(sp, inner, op.id)
            await softDeleteTask(sp, inner, op.id)
            return null
          })
          results.push({ index, id: op.id, ok: true, status: op.op === 'delete' ? 204 : 200, task })
        } catch (err) {
          if (!(err instanceof AppError)) throw err
          failed = true
          results.push({
            index,
            id: op.id,
            ok: false,
            status: err.status,
            code: err.code,
            detail: err.message,
          })
        }
      }
      if (failed) throw ROLLBACK
    })
  } catch (err) {
    if (err !== ROLLBACK) throw err
  }
  if (!failed) {
    const touched = results.flatMap((r) => (r.task ? [r.task.spaceId] : []))
    // 删除项没有返回体：按操作者可见空间以外无从得知，统一失效 ['tasks'] 前缀即可
    publishChange(
      ctx,
      touched.length
        ? touched
        : await opSpaces(
            db,
            ops.map((o) => o.id),
          ),
      [['tasks']],
    )
    return { results }
  }
  const first = results.find((r) => !r.ok) as BatchOpResult
  throw new AppError(first.status, first.code as AppError['code'], '批量操作有失败项，已全部回滚', {
    results: results.map((r) =>
      r.ok ? { index: r.index, id: r.id, ok: true, status: r.status, rolledBack: true } : r,
    ),
  })
}
