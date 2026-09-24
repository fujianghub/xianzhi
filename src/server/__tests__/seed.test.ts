/** T0-030：pnpm xz seed（08 §7）。 */
import { rm } from 'node:fs/promises'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getAuth } from '../auth.ts'
import { getDb } from '../db/index.ts'
import { user } from '../db/schema/auth.ts'
import {
  auditLog,
  cycles,
  entries,
  notifications,
  spaceMembers,
  spaces,
  tags,
  tasks,
  taskWatchers,
} from '../db/schema/business.ts'
import { tableCounts } from '../services/backup.ts'
import { SEED, seed } from '../services/seed.ts'
import { truncateAll } from './db.ts'
import { buildApp, signIn } from './helpers.ts'

const db = () => getDb()
const DATA = './data/test-seed'

describe('seed', () => {
  beforeAll(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await rm(DATA, { recursive: true, force: true })
  })

  it('08 §7 二次执行行数不变（固定 id upsert 幂等）；生产环境拒绝', async () => {
    await expect(
      seed({ db: db(), auth: getAuth(), dataDir: DATA, nodeEnv: 'production' }),
    ).rejects.toThrow(/生产环境/)
    await seed({ db: db(), auth: getAuth(), dataDir: DATA, nodeEnv: 'test' })
    const first = await tableCounts(process.env.DATABASE_URL as string)
    const r2 = await seed({ db: db(), auth: getAuth(), dataDir: DATA, nodeEnv: 'test' })
    expect(r2.newEntries).toBe(0)
    expect(await tableCounts(process.env.DATABASE_URL as string)).toEqual(first)
    expect(first).toMatchObject({
      user: 3,
      organization: 1,
      member: 3,
      spaces: 5,
      tasks: 30,
      entries: 14,
      tags: 8,
    })
  })

  it('08 §7 分布：六种 status 各 ≥ 3、优先级 0–4、3 过期 / 4 今日到期 / 2 今日开始、重复 3 条、子任务 2 层、watcher 全覆盖、5 条带标签', async () => {
    const rows = await db().select().from(tasks)
    const byStatus = rows.reduce<Record<string, number>>((m, t) => {
      m[t.status] = (m[t.status] ?? 0) + 1
      return m
    }, {})
    for (const st of ['inbox', 'todo', 'doing', 'blocked', 'done', 'cancelled'])
      expect(byStatus[st] ?? 0, st).toBeGreaterThanOrEqual(3)
    expect(new Set(rows.map((t) => t.priority))).toEqual(new Set([0, 1, 2, 3, 4]))
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start.getTime() + 86_400_000)
    const open = (t: (typeof rows)[number]) => t.status !== 'done' && t.status !== 'cancelled'
    expect(rows.filter((t) => t.dueAt && t.dueAt < start && open(t))).toHaveLength(3)
    expect(rows.filter((t) => t.dueAt && t.dueAt >= start && t.dueAt < end)).toHaveLength(4)
    expect(
      rows.filter((t) => t.scheduledAt && t.scheduledAt >= start && t.scheduledAt < end),
    ).toHaveLength(2)
    expect(rows.filter((t) => t.recurrence)).toHaveLength(3)
    const byId = new Map(rows.map((t) => [t.id, t]))
    const depth = (t: (typeof rows)[number]): number =>
      t.parentId ? 1 + depth(byId.get(t.parentId) as (typeof rows)[number]) : 0
    expect(Math.max(...rows.map(depth))).toBe(2)
    expect(
      new Set(
        rows
          .filter((t) => t.parentId === null && rows.some((c) => c.parentId === t.id))
          .map((t) => t.id),
      ).size,
    ).toBe(3)
    const watched = new Set(
      (await db().select({ id: taskWatchers.taskId }).from(taskWatchers)).map((r) => r.id),
    )
    expect(rows.every((t) => watched.has(t.id))).toBe(true)
    const [tt] = await db()
      .execute<{ n: number }>(sql`select count(distinct task_id)::int n from task_tags`)
      .then((r) => r.rows)
    expect(tt?.n).toBe(5)
    // guest：只加入空间 B 为 viewer，被指派 1 条空间 B 的任务
    const guestTasks = rows.filter((t) => t.assigneeId === SEED.users.guest.id)
    expect(guestTasks).toHaveLength(1)
    expect(guestTasks[0]?.spaceId).toBe(SEED.spaces.B)
    const gm = await db()
      .select()
      .from(spaceMembers)
      .where(eq(spaceMembers.userId, SEED.users.guest.id))
    expect(
      gm.map((m) => `${m.spaceId === SEED.spaces.B ? 'B' : 'personal'}:${m.role}`).sort(),
    ).toEqual(['B:viewer', 'personal:admin'])
  })

  it('08 §7 记录每 kind 2 篇、个人空间内 4 篇均 private / 2 space、派生列已生成；周期 active + reviewed；8 色标签；通知 owner 6（2 未读、1 提及）/ member 3；审计 3 类', async () => {
    const e = await db().select().from(entries)
    const perKind = e.reduce<Record<string, number>>((m, x) => {
      m[x.kind] = (m[x.kind] ?? 0) + 1
      return m
    }, {})
    expect(Object.values(perKind)).toEqual([2, 2, 2, 2, 2, 2, 2])
    // 个人空间里的 journal / review 按 REQ-ENTRY-003 只能 private（08 §7 注 2026-09-24）
    expect(e.filter((x) => x.visibility === 'private')).toHaveLength(4)
    expect(e.filter((x) => x.visibility === 'space')).toHaveLength(2)
    expect(e.every((x) => (x.plain ?? '').length >= 200 && x.derivedError === null)).toBe(true)
    const sup = e.find((x) => (x.fields as { supersedesId?: string }).supersedesId)
    expect(sup?.kind).toBe('decision')
    expect(
      e.find(
        (x) =>
          (x.plain ?? '').includes('[图片]') &&
          (x.plain ?? '').includes('[图表]') &&
          (x.plain ?? '').includes('[公式]'),
      ),
    ).toBeDefined()
    const cs = await db().select().from(cycles)
    expect(cs.map((c) => c.status).sort()).toEqual(['active', 'reviewed'])
    expect((await db().select({ c: tags.color }).from(tags)).map((t) => t.c).sort()).toEqual([
      'amber',
      'gray',
      'indigo',
      'moss',
      'ochre',
      'pine',
      'plum',
      'teal',
    ])
    const own = await db()
      .select()
      .from(notifications)
      .where(eq(notifications.userId, SEED.users.owner.id))
    expect(own).toHaveLength(6)
    expect(own.filter((n) => n.readAt === null)).toHaveLength(2)
    expect(own.filter((n) => n.kind === 'mention.created')).toHaveLength(1)
    expect(
      (
        await db()
          .select({ n: count() })
          .from(notifications)
          .where(eq(notifications.userId, SEED.users.member.id))
      )[0]?.n,
    ).toBe(3)
    expect(
      (await db().select({ a: auditLog.action }).from(auditLog)).map((r) => r.a).sort(),
    ).toEqual(['auth.login', 'member.invited', 'member.role_changed'])
    expect(
      (
        await db()
          .select({ n: count() })
          .from(spaces)
          .where(and(eq(spaces.isPersonal, true), isNull(spaces.deletedAt)))
      )[0]?.n,
    ).toBe(3)
  })

  it('08 §7 seed 账号可登录（owner@demo.local / demo-owner），/me 为 owner', async () => {
    const app = buildApp().app
    const { res, cookie } = await signIn(app, 'owner@demo.local', 'demo-owner')
    expect(res.status).toBe(200)
    const me = (await (await app.request('/api/v1/me', { headers: { cookie } })).json()) as {
      workspaceRole: string
      email: string
    }
    expect(me).toMatchObject({ workspaceRole: 'owner', email: 'owner@demo.local' })
    expect((await signIn(app, 'guest@demo.local', 'demo-guest')).res.status).toBe(200)
    expect((await db().select().from(user)).length).toBe(3)
  })
})
