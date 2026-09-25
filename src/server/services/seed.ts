/**
 * 示例数据（08 §7、T0-030）：固定 id `01920000-0000-7000-8000-0000000NNNNN` + upsert（ON CONFLICT DO NOTHING），二次执行行数不变；
 * 生产环境禁止（NODE_ENV=production 直接抛错）。日期相对执行当天（今日 / 过期视图非空）。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { count, eq, ne } from 'drizzle-orm'
import * as Y from 'yjs'
import { YDOC_FRAGMENT } from '../../collab/derive.ts'
import { appendPmJson } from '../../collab/ydoc-json.ts'
import { entryTemplate } from '../../shared/editor/templates.ts'
import { type EntryKind, PALETTE_COLORS, type TaskStatus } from '../../shared/schemas/enums.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { pmToPlain } from '../../shared/schemas/pm.ts'
import type { Auth } from '../auth.ts'
import type { Db } from '../db/index.ts'
import { account, member, organization, user } from '../db/schema/auth.ts'
import {
  attachments,
  auditLog,
  comments,
  cycles,
  entries,
  entryTags,
  events,
  links,
  mentions,
  notifications,
  spaceMembers,
  spaces,
  tags,
  tasks,
  taskTags,
  taskWatchers,
} from '../db/schema/business.ts'
import { dataPath } from '../lib/files.ts'
import { weightedTsv, writeEntryDerived } from './derived.ts'

export const sid = (n: number) => `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`

export const SEED = {
  workspace: { id: sid(10), name: '示例乐团', slug: 'demo' },
  users: {
    owner: {
      id: sid(1),
      email: 'owner@demo.local',
      name: '乐团主理人',
      password: 'demo-owner',
      role: 'owner',
    },
    member: {
      id: sid(2),
      email: 'member@demo.local',
      name: '小提琴手',
      password: 'demo-member',
      role: 'member',
    },
    guest: {
      id: sid(3),
      email: 'guest@demo.local',
      name: '客座乐手',
      password: 'demo-guest',
      role: 'guest',
    },
  },
  spaces: {
    A: sid(20),
    B: sid(21),
    personalOwner: sid(22),
    personalMember: sid(23),
    personalGuest: sid(24),
  },
} as const

type UKey = keyof typeof SEED.users
const DAY = 86_400_000

const PARAGRAPHS = [
  '这一周主要围绕编辑器内核做验证：协同落库、派生列与快照三条链路都已经跑通，下一步是把前端壳子接上。',
  '在讨论方案时我们对比了三种存储模型，最终选择以 Yjs 二进制为唯一真源，其余列全部派生，任何时候都可以重建。',
  '记录一个容易忽略的细节：UUID v7 的前缀是时间戳，拿来做短标识会在同一分钟内冲突，应该取末尾的随机段。',
  '复盘时发现估时偏乐观的主要原因是低估了依赖升级的成本，后续把每个依赖的大版本变化单独列成任务。',
  '学习计划按周推进，每周选一个主题深入，周末写一段回望总结；回望不求长，但要写清楚下一步要做什么。',
  '把问题拆成可以验证的小步：先写一个会失败的测试，再让它通过，最后整理代码，这样回退的成本最低。',
]
const filler = (seed: number, min = 200): string[] => {
  const out: string[] = []
  let len = 0
  for (let i = 0; len < min; i++) {
    const p = PARAGRAPHS[(seed + i) % PARAGRAPHS.length] as string
    out.push(p)
    len += p.length
  }
  return out
}
const para = (text: string): PmNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })

function ydocOf(doc: PmNode): Buffer {
  const y = new Y.Doc({ gc: false })
  appendPmJson(y.getXmlFragment(YDOC_FRAGMENT), doc)
  const bytes = Buffer.from(Y.encodeStateAsUpdate(y))
  y.destroy()
  return bytes
}

/** 1×1 透明 PNG。 */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

export interface SeedDeps {
  db: Db
  auth: Auth
  dataDir: string
  nodeEnv: string
  now?: Date
}

export async function seed(deps: SeedDeps): Promise<Record<string, number>> {
  if (deps.nodeEnv === 'production') throw new Error('生产环境禁止执行 seed（08 §7）')
  const { db } = deps
  const now = deps.now ?? new Date()
  const today = new Date(now)
  today.setHours(10, 0, 0, 0)
  const at = (days: number, hour = 10) =>
    new Date(today.getTime() + days * DAY + (hour - 10) * 3600_000)

  const other = await db
    .select({ id: organization.id })
    .from(organization)
    .where(ne(organization.id, SEED.workspace.id))
    .limit(1)
  if (other[0]) throw new Error('库中已有其他工作区；seed 只用于空库（xz_e2e / 本机演示库）')

  const ctx = await deps.auth.$context
  const U = SEED.users
  const W = SEED.workspace.id

  // ---- 工作区、用户、成员 ----
  await db
    .insert(organization)
    .values({ id: W, name: SEED.workspace.name, slug: SEED.workspace.slug, createdAt: now })
    .onConflictDoNothing()
  for (const [i, key] of (['owner', 'member', 'guest'] as UKey[]).entries()) {
    const u = U[key]
    await db
      .insert(user)
      .values({
        id: u.id,
        email: u.email,
        name: u.name,
        displayName: u.name,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
    const has = await db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.id, sid(40 + i)))
    if (!has[0]) {
      await db
        .insert(account)
        .values({
          id: sid(40 + i),
          accountId: u.id,
          providerId: 'credential',
          userId: u.id,
          password: await ctx.password.hash(u.password),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
    }
    await db
      .insert(member)
      .values({ id: sid(30 + i), organizationId: W, userId: u.id, role: u.role, createdAt: now })
      .onConflictDoNothing()
  }

  // ---- 空间 ----
  const S = SEED.spaces
  const spaceRows: (typeof spaces.$inferInsert)[] = [
    {
      id: S.A,
      workspaceId: W,
      name: '产品开发',
      slug: 'product',
      kind: 'project',
      visibility: 'workspace',
      color: 'green',
      icon: 'rocket',
      sortKey: 'a1',
      createdBy: U.owner.id,
    },
    {
      id: S.B,
      workspaceId: W,
      name: '学习计划',
      slug: 'learning',
      kind: 'learning',
      visibility: 'members',
      color: 'amber',
      icon: 'book-open',
      sortKey: 'a2',
      createdBy: U.owner.id,
    },
    {
      id: S.personalOwner,
      workspaceId: W,
      name: '个人',
      slug: `me-${U.owner.id.replace(/-/g, '').slice(-8)}`,
      kind: 'work',
      visibility: 'members',
      isPersonal: true,
      sortKey: 'a0',
      createdBy: U.owner.id,
    },
    {
      id: S.personalMember,
      workspaceId: W,
      name: '个人',
      slug: `me-${U.member.id.replace(/-/g, '').slice(-8)}`,
      kind: 'work',
      visibility: 'members',
      isPersonal: true,
      sortKey: 'a0',
      createdBy: U.member.id,
    },
    {
      id: S.personalGuest,
      workspaceId: W,
      name: '个人',
      slug: `me-${U.guest.id.replace(/-/g, '').slice(-8)}`,
      kind: 'work',
      visibility: 'members',
      isPersonal: true,
      sortKey: 'a0',
      createdBy: U.guest.id,
    },
  ]
  await db.insert(spaces).values(spaceRows).onConflictDoNothing()
  await db
    .insert(spaceMembers)
    .values([
      { spaceId: S.A, userId: U.owner.id, role: 'admin' },
      { spaceId: S.A, userId: U.member.id, role: 'member' },
      { spaceId: S.B, userId: U.owner.id, role: 'admin' },
      { spaceId: S.B, userId: U.guest.id, role: 'viewer' },
      { spaceId: S.personalOwner, userId: U.owner.id, role: 'admin' },
      { spaceId: S.personalMember, userId: U.member.id, role: 'admin' },
      { spaceId: S.personalGuest, userId: U.guest.id, role: 'admin' },
    ])
    .onConflictDoNothing()

  // ---- 标签（9 色，ADR-0010） ----
  const TAG_NAMES = ['前端', '后端', '设计', '性能', '安全', '文档', '阅读', '复盘', '灵感']
  await db
    .insert(tags)
    .values(
      PALETTE_COLORS.map((color, i) => ({
        id: sid(500 + i),
        workspaceId: W,
        name: TAG_NAMES[i] as string,
        color,
      })),
    )
    .onConflictDoNothing()

  // ---- 周期 ----
  const monday = new Date(today)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)
  const isoWeek = (d: Date) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    const dayNum = t.getUTCDay() || 7
    t.setUTCDate(t.getUTCDate() + 4 - dayNum)
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
    return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y0.getTime()) / DAY + 1) / 7)).padStart(2, '0')}`
  }
  const cycleCur = sid(600)
  const cyclePrev = sid(601)
  const goalTasks = [sid(100), sid(101), sid(102), sid(103), sid(104)]
  await db
    .insert(cycles)
    .values([
      {
        id: cycleCur,
        workspaceId: W,
        ownerId: U.owner.id,
        kind: 'week',
        startDate: ymd(monday),
        endDate: ymd(addDays(monday, 6)),
        title: isoWeek(monday),
        status: 'active',
        goals: [
          { id: sid(610), text: '打通编辑器最小闭环', done: false, taskIds: goalTasks.slice(0, 2) },
          { id: sid(611), text: '完成通知出箱与 SSE', done: true, taskIds: goalTasks.slice(2, 4) },
          {
            id: sid(612),
            text: '读完《设计数据密集型应用》第 5 章',
            done: false,
            taskIds: goalTasks.slice(4),
          },
        ],
      },
      {
        id: cyclePrev,
        workspaceId: W,
        ownerId: U.owner.id,
        kind: 'week',
        startDate: ymd(addDays(monday, -7)),
        endDate: ymd(addDays(monday, -1)),
        title: isoWeek(addDays(monday, -7)),
        status: 'reviewed',
        goals: [{ id: sid(613), text: '搭好脚手架', done: true, taskIds: [] }],
        reviewEntryId: sid(212),
      },
    ])
    .onConflictDoNothing()

  // ---- 任务（30 条） ----
  const statuses: TaskStatus[] = [
    'todo',
    'doing',
    'blocked',
    'todo',
    'doing',
    'blocked',
    'todo',
    'inbox',
    'inbox',
    'inbox',
    'todo',
    'doing',
    'done',
    'done',
    'done',
    'cancelled',
    'cancelled',
    'cancelled',
    'todo',
    'doing',
    'blocked',
    'inbox',
    'done',
    'cancelled',
    'todo',
    'doing',
    'blocked',
    'inbox',
    'done',
    'cancelled',
  ]
  const TITLES = [
    '搭建 Hono 骨架',
    '接入 Better Auth',
    '角色矩阵测试',
    '协同票据',
    '编辑器模板',
    '派生列重建',
    '玻璃 token',
    '主题切换',
    '设计画廊',
    '登录页',
    '邀请邮件',
    '成员管理',
    '审计游标',
    '通知扇出',
    'SSE 心跳',
    '备份加密',
    '恢复演练',
    '种子数据',
    '快照保留',
    'CI 流水线',
    '性能预算',
    '可访问性检查',
    '读完第 5 章',
    '整理读书笔记',
    '周复盘',
    '修复 slug 冲突',
    '优化列表查询',
    '补充 REQ 追溯',
    '移动端底部导航',
    '清理回收站',
  ]
  const taskRows: (typeof tasks.$inferInsert)[] = []
  const watcherRows: (typeof taskWatchers.$inferInsert)[] = []
  for (let i = 0; i < 30; i++) {
    const id = sid(100 + i)
    const status = statuses[i] as TaskStatus
    const inB = i >= 22 && i <= 24 // 学习相关放空间 B
    const personal = i === 27 || i === 28
    const spaceId = personal ? S.personalMember : inB ? S.B : S.A
    // guest 只被指派 1 条（空间 B，08 §7）；其余在 owner / member 间分布
    const assignee =
      i === 22
        ? U.guest.id
        : inB
          ? U.owner.id
          : personal
            ? U.member.id
            : i % 2 === 0
              ? U.owner.id
              : U.member.id
    const creator = personal ? U.member.id : U.owner.id
    let dueAt: Date | null = null
    let scheduledAt: Date | null = null
    if (i <= 2)
      dueAt = at(-2 - i) // 3 条过期（status 均未完成）
    else if (i <= 6)
      dueAt = at(0, 18) // 4 条今日到期
    else if (i <= 8)
      scheduledAt = at(0, 9) // 2 条今日开始
    else if (i <= 20) dueAt = at(3 + i)
    const recurrence =
      i === 9 || i === 10
        ? { freq: 'weekly', interval: 1, byWeekday: [1] }
        : i === 11
          ? { freq: 'monthly', interval: 1, byMonthday: 31 }
          : null
    const parentMap: Record<number, number> = { 13: 12, 14: 12, 16: 15, 17: 16, 19: 18 } // 3 组子任务，其中 15→16→17 为 2 层
    const title = TITLES[i] as string
    const desc =
      i % 4 === 0
        ? { type: 'doc', content: [para(`${title}：${PARAGRAPHS[i % PARAGRAPHS.length]}`)] }
        : null
    const plain = desc ? pmToPlain(desc as PmNode) : null
    taskRows.push({
      id,
      workspaceId: W,
      spaceId,
      parentId: parentMap[i] !== undefined ? sid(100 + (parentMap[i] as number)) : null,
      title,
      descriptionPm: desc,
      descriptionPlain: plain,
      status,
      priority: i % 5,
      dueAt,
      scheduledAt,
      completedAt: status === 'done' ? at(-1) : null,
      assigneeId: assignee,
      creatorId: creator,
      cycleId: goalTasks.includes(id) ? cycleCur : null,
      recurrence,
      sortKey: `a${String(i).padStart(2, '0')}`,
      // tsvector 列的 TS 类型是 string；插入时用 SQL 表达式
      tsv: weightedTsv(title, plain ?? '') as unknown as string,
    })
    watcherRows.push({ taskId: id, userId: creator })
    if (assignee !== creator) watcherRows.push({ taskId: id, userId: assignee })
  }
  // 父任务先插（外键无约束，但保持顺序可读）
  await db.insert(tasks).values(taskRows).onConflictDoNothing()
  await db.insert(taskWatchers).values(watcherRows).onConflictDoNothing()
  await db
    .insert(taskTags)
    .values([0, 5, 10, 15, 20].map((i, k) => ({ taskId: sid(100 + i), tagId: sid(500 + k) })))
    .onConflictDoNothing()

  // ---- 附件（1×1 PNG） ----
  const attId = sid(700)
  const storageKey = `uploads/${W}/seed/${attId}.png`
  await mkdir(dirname(dataPath(deps.dataDir, storageKey)), { recursive: true })
  await writeFile(dataPath(deps.dataDir, storageKey), PNG_1x1)

  // ---- 记录（每 kind 2 篇） ----
  const kinds: EntryKind[] = [
    'decision',
    'bug',
    'iteration',
    'changelog',
    'journal',
    'note',
    'review',
  ]
  const entryRows: {
    id: string
    kind: EntryKind
    title: string
    visibility: 'private' | 'space' | 'workspace'
    fields: Record<string, unknown>
    spaceId: string
    authorId: string
    doc: PmNode
  }[] = []
  const E = (n: number) => sid(200 + n)
  const titles: Record<EntryKind, [string, string]> = {
    decision: ['ADR：正文以 Yjs 为真源', 'ADR：派生列可随时重建'],
    bug: ['个人空间 slug 冲突', 'CHECK 约束参数化导致迁移失败'],
    iteration: ['第 38 周迭代', '第 39 周迭代'],
    changelog: ['v0.1.0', 'v0.2.0'],
    journal: ['周三随想', '周五的回望'],
    note: ['读书摘录：日志即数据库', '关于命名的一点想法'],
    review: [`${isoWeek(addDays(monday, -7))} 复盘`, `${isoWeek(monday)} 复盘（草稿）`],
    // 新 kind 不进 seed 分布（08 §7 每 kind 2 篇为既有 7 种），仅满足类型
    optimize: ['', ''],
    plan: ['', ''],
  }
  kinds.forEach((kind, k) => {
    for (const j of [0, 1]) {
      const n = k * 2 + j
      const id = E(n)
      const base = entryTemplate(kind)
      const extra: PmNode[] = filler(n).map(para)
      const content: PmNode[] = [...(base.content ?? []), ...extra]
      // 3 篇含双链，2 篇含 @提及，1 篇含图片 + mermaid + 公式
      if (n === 2 || n === 4 || n === 9)
        content.push({
          type: 'paragraph',
          content: [
            { type: 'text', text: '相关：' },
            { type: 'entryLink', attrs: { id: E(0), title: titles.decision[0] } },
          ],
        })
      if (n === 6 || n === 10)
        content.push({
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: U.member.id, label: U.member.name } },
            { type: 'text', text: ' 请看一下这一段。' },
          ],
        })
      if (n === 11) {
        content.push({ type: 'image', attrs: { src: `xz:attachment/${attId}`, alt: '占位图' } })
        content.push({ type: 'mermaid', attrs: { code: 'graph LR; 记录-->派生列; 记录-->快照' } })
        content.push({ type: 'mathBlock', attrs: { latex: 'E = mc^2' } })
      }
      const visibility = n === 8 ? 'private' : n === 3 || n === 5 ? 'space' : 'workspace'
      const fields: Record<string, unknown> =
        kind === 'decision'
          ? j === 0
            ? { status: 'superseded', decidedAt: ymd(addDays(today, -20)) }
            : { status: 'accepted', supersedesId: E(0), decidedAt: ymd(addDays(today, -3)) }
          : kind === 'bug'
            ? {
                severity: j === 0 ? 'high' : 'critical',
                status: 'fixed',
                commit: j === 0 ? 'a1b2c3d' : 'e4f5a6b',
                debugDir:
                  j === 0
                    ? 'debug/2026-09-23-personal-slug-uuidv7'
                    : 'debug/2026-09-23-drizzle-check-literals',
              }
            : kind === 'iteration'
              ? {
                  periodStart: ymd(addDays(monday, j === 0 ? -7 : 0)),
                  periodEnd: ymd(addDays(monday, j === 0 ? -1 : 6)),
                  version: `v0.${j + 1}`,
                }
              : kind === 'changelog'
                ? { version: `0.${j + 1}.0`, releasedAt: ymd(addDays(today, j === 0 ? -14 : -1)) }
                : kind === 'journal'
                  ? { mood: j === 0 ? 3 : 4 }
                  : kind === 'review'
                    ? { cycleId: j === 0 ? cyclePrev : cycleCur }
                    : {}
      const personal = kind === 'journal' || kind === 'review'
      entryRows.push({
        id,
        kind,
        title: titles[kind][j] as string,
        // 个人空间里的记录只能是 private，且作者是空间主人（REQ-ENTRY-003）
        visibility: personal ? 'private' : visibility,
        fields,
        spaceId: personal ? S.personalOwner : n === 3 ? S.B : S.A,
        authorId: personal ? U.owner.id : n === 5 || n === 10 ? U.member.id : U.owner.id,
        doc: { type: 'doc', content },
      })
    }
  })
  let newEntries = 0
  for (const e of entryRows) {
    const r = await db
      .insert(entries)
      .values({
        id: e.id,
        workspaceId: W,
        spaceId: e.spaceId,
        kind: e.kind,
        title: e.title,
        fields: e.fields,
        visibility: e.visibility,
        authorId: e.authorId,
        ydoc: ydocOf(e.doc),
        ydocVersion: 1,
        pinned: e.id === E(0),
      })
      .onConflictDoNothing()
      .returning({ id: entries.id })
    if (r[0]) {
      newEntries++
      const [row] = await db
        .select({ ydoc: entries.ydoc })
        .from(entries)
        .where(eq(entries.id, e.id))
      if (row) await writeEntryDerived(db, e.id, row.ydoc)
    }
  }
  await db
    .insert(entryTags)
    .values([
      { entryId: E(0), tagId: sid(501) },
      { entryId: E(2), tagId: sid(503) },
      { entryId: E(9), tagId: sid(506) },
    ])
    .onConflictDoNothing()
  await db
    .insert(attachments)
    .values({
      id: attId,
      workspaceId: W,
      ownerId: U.owner.id,
      targetType: 'entry',
      targetId: E(11),
      filename: 'pixel.png',
      mime: 'image/png',
      size: PNG_1x1.length,
      sha256: 'seed-pixel',
      storageKey,
      width: 1,
      height: 1,
    })
    .onConflictDoNothing()
  await db
    .insert(links)
    .values(
      [2, 4, 9].map((n, k) => ({
        id: sid(400 + k),
        workspaceId: W,
        fromType: 'entry',
        fromId: E(n),
        toType: 'entry',
        toId: E(0),
        kind: 'mentions',
        createdBy: U.owner.id,
      })),
    )
    .onConflictDoNothing()
  await db
    .insert(links)
    .values({
      id: sid(403),
      workspaceId: W,
      fromType: 'entry',
      fromId: E(1),
      toType: 'entry',
      toId: E(0),
      kind: 'relates',
      createdBy: U.owner.id,
    })
    .onConflictDoNothing()
  await db
    .insert(mentions)
    .values([
      { id: sid(410), entryId: E(6), userId: U.member.id },
      { id: sid(411), entryId: E(10), userId: U.member.id },
    ])
    .onConflictDoNothing()

  // ---- 评论线程（2 篇，含 1 个 orphaned） ----
  const cdoc = (text: string) => ({ type: 'doc', content: [para(text)] })
  const commentRows: (typeof comments.$inferInsert)[] = [
    {
      id: sid(300),
      workspaceId: W,
      targetType: 'entry',
      targetId: E(0),
      threadId: sid(300),
      authorId: U.member.id,
      bodyPm: cdoc('这个决定的后果里要补上迁移成本。'),
      bodyPlain: '这个决定的后果里要补上迁移成本。',
    },
    {
      id: sid(301),
      workspaceId: W,
      targetType: 'entry',
      targetId: E(0),
      threadId: sid(300),
      parentId: sid(300),
      authorId: U.owner.id,
      bodyPm: cdoc('已补充，见第三节。'),
      bodyPlain: '已补充，见第三节。',
      resolvedAt: now,
      resolvedBy: U.owner.id,
    },
    {
      id: sid(302),
      workspaceId: W,
      targetType: 'entry',
      targetId: E(2),
      threadId: sid(302),
      authorId: U.owner.id,
      bodyPm: cdoc('这段被删掉了，但讨论保留。'),
      bodyPlain: '这段被删掉了，但讨论保留。',
      orphaned: true,
    },
  ]
  await db.insert(comments).values(commentRows).onConflictDoNothing()

  // ---- 事件与通知：owner 6 条（2 未读、1 提及）；member 3 条 ----
  const ev = (
    n: number,
    kind: string,
    targetType: string,
    targetId: string | null,
    payload: Record<string, unknown>,
    actorId: string | null,
  ) =>
    ({
      id: sid(800 + n),
      workspaceId: W,
      kind,
      actorId,
      targetType,
      targetId,
      payload,
      createdAt: at(-1 - n / 10),
      processedAt: at(-1 - n / 10),
    }) as typeof events.$inferInsert
  await db
    .insert(events)
    .values([
      ev(
        0,
        'task.assigned',
        'task',
        sid(100),
        {
          taskId: sid(100),
          title: TITLES[0],
          actorId: U.member.id,
          actorName: U.member.name,
          assigneeId: U.owner.id,
          spaceSlug: 'product',
        },
        U.member.id,
      ),
      ev(
        1,
        'task.completed',
        'task',
        sid(112),
        {
          taskId: sid(112),
          title: TITLES[12],
          actorId: U.member.id,
          actorName: U.member.name,
          spaceSlug: 'product',
          completedAt: at(-1).toISOString(),
        },
        U.member.id,
      ),
      ev(
        2,
        'mention.created',
        'entry',
        E(10),
        {
          targetType: 'entry',
          targetId: E(10),
          title: titles.note[1],
          actorId: U.member.id,
          actorName: U.member.name,
          summary: '@乐团主理人 看一下命名',
          url: `/entries/${E(10)}`,
        },
        U.member.id,
      ),
      ev(
        3,
        'entry.commented',
        'entry',
        E(0),
        {
          entryId: E(0),
          title: titles.decision[0],
          commentId: sid(300),
          threadId: sid(300),
          actorId: U.member.id,
          actorName: U.member.name,
          summary: '这个决定的后果里要补上迁移成本。',
        },
        U.member.id,
      ),
      ev(
        4,
        'member.joined',
        'member',
        null,
        {
          userId: U.member.id,
          displayName: U.member.name,
          email: U.member.email,
          role: 'member',
          inviterId: U.owner.id,
          inviterName: U.owner.name,
        },
        U.member.id,
      ),
      ev(
        5,
        'system.export_done',
        'system',
        null,
        {
          jobId: 'seed-export',
          scope: 'workspace',
          format: 'zip',
          fileName: 'demo.zip',
          sizeBytes: 20480,
          expiresAt: at(6).toISOString(),
        },
        null,
      ),
      ev(
        6,
        'task.assigned',
        'task',
        sid(101),
        {
          taskId: sid(101),
          title: TITLES[1],
          actorId: U.owner.id,
          actorName: U.owner.name,
          assigneeId: U.member.id,
          spaceSlug: 'product',
        },
        U.owner.id,
      ),
      ev(
        7,
        'mention.created',
        'entry',
        E(6),
        {
          targetType: 'entry',
          targetId: E(6),
          title: titles.journal[0],
          actorId: U.owner.id,
          actorName: U.owner.name,
          summary: '@小提琴手 请看一下这一段。',
          url: `/entries/${E(6)}`,
        },
        U.owner.id,
      ),
      ev(
        8,
        'task.due_soon',
        'task',
        sid(103),
        {
          taskId: sid(103),
          title: TITLES[3],
          assigneeId: U.member.id,
          spaceSlug: 'product',
          dueAt: at(0, 18).toISOString(),
          hoursLeft: 8,
        },
        null,
      ),
    ])
    .onConflictDoNothing()
  const n = (
    k: number,
    userId: string,
    evN: number,
    kind: string,
    title: string,
    url: string,
    read: boolean,
  ) =>
    ({
      id: sid(900 + k),
      userId,
      eventId: sid(800 + evN),
      kind,
      title,
      url,
      readAt: read ? at(-1) : null,
      createdAt: at(-1 - evN / 10),
    }) as typeof notifications.$inferInsert
  await db
    .insert(notifications)
    .values([
      n(
        0,
        U.owner.id,
        0,
        'task.assigned',
        `${U.member.name} 把任务 ${TITLES[0]} 指派给你`,
        `/spaces/product/tasks/${sid(100)}`,
        false,
      ),
      n(
        1,
        U.owner.id,
        2,
        'mention.created',
        `${U.member.name} 在 ${titles.note[1]} 中提到了你`,
        `/entries/${E(10)}`,
        false,
      ),
      n(
        2,
        U.owner.id,
        1,
        'task.completed',
        `${U.member.name} 完成了任务 ${TITLES[12]}`,
        `/spaces/product/tasks/${sid(112)}`,
        true,
      ),
      n(
        3,
        U.owner.id,
        3,
        'entry.commented',
        `${U.member.name} 评论了记录 ${titles.decision[0]}`,
        `/entries/${E(0)}#c-${sid(300)}`,
        true,
      ),
      n(
        4,
        U.owner.id,
        4,
        'member.joined',
        `${U.member.name} 已加入工作区`,
        '/settings/workspace/members',
        true,
      ),
      n(5, U.owner.id, 5, 'system.export_done', '导出已完成：demo.zip', '/jobs/seed-export', true),
      n(
        6,
        U.member.id,
        6,
        'task.assigned',
        `${U.owner.name} 把任务 ${TITLES[1]} 指派给你`,
        `/spaces/product/tasks/${sid(101)}`,
        false,
      ),
      n(
        7,
        U.member.id,
        7,
        'mention.created',
        `${U.owner.name} 在 ${titles.journal[0]} 中提到了你`,
        `/entries/${E(6)}`,
        false,
      ),
      n(
        8,
        U.member.id,
        8,
        'task.due_soon',
        `任务 ${TITLES[3]} 将在 8 小时后截止`,
        `/spaces/product/tasks/${sid(103)}`,
        true,
      ),
    ])
    .onConflictDoNothing()

  // ---- 审计：登录 / 邀请 / 角色变更 ----
  await db
    .insert(auditLog)
    .values([
      {
        id: sid(950),
        workspaceId: W,
        actorId: U.owner.id,
        action: 'auth.login',
        targetType: 'user',
        targetId: U.owner.email,
        ip: '127.0.0.1',
        createdAt: at(-2),
      },
      {
        id: sid(951),
        workspaceId: W,
        actorId: U.owner.id,
        action: 'member.invited',
        targetType: 'invitation',
        targetId: 'seed',
        meta: { email: U.member.email, role: 'member' },
        createdAt: at(-2),
      },
      {
        id: sid(952),
        workspaceId: W,
        actorId: U.owner.id,
        action: 'member.role_changed',
        targetType: 'user',
        targetId: U.guest.id,
        meta: { from: 'member', to: 'guest' },
        createdAt: at(-1),
      },
    ])
    .onConflictDoNothing()

  const countOf = async (
    t: typeof tasks | typeof entries | typeof notifications | typeof spaces | typeof tags,
  ) => (await db.select({ n: count() }).from(t))[0]?.n ?? 0
  return {
    newEntries,
    tasks: await countOf(tasks),
    entries: await countOf(entries),
    spaces: await countOf(spaces),
    tags: await countOf(tags),
    notifications: await countOf(notifications),
  }
}
