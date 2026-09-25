/**
 * T1-001 空间 CRUD / 归档 / 回收站 / 成员 / 排序（REQ-SPACE-001 ~ 008，api 层）+ 端点 × 工作区角色矩阵。
 * REQ-SPACE-004 · 007 的「任务 403 / 404」与记录接口一起断言（T1-003 起任务接口就绪）。
 */
import { and, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../db/index.ts'
import {
  auditLog,
  entries,
  events,
  notifications,
  spaceMembers,
  spaces,
} from '../db/schema/business.ts'
import { gcSoftDeleted } from '../jobs/gc.ts'
import { getEventBus } from '../lib/event-bus.ts'
import { fanoutEvent, sendNotificationEmail } from '../services/notify.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, mailbox, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface SpaceJson {
  id: string
  slug: string
  sortKey: string
  myRole: string | null
  isMember: boolean
  memberCount: number
  archivedAt: string | null
  deletedAt: string | null
  daysLeft?: number
  updatedAt: string
  icon: string | null
}

describe('T1-001 spaces', () => {
  let app: App
  let workspaceId = ''
  const u: Record<'owner' | 'admin' | 'member' | 'member2' | 'guest', U> = {} as never

  const req = (who: U | null, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders(who ? { cookie: who.cookie } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const create = async (who: U, body: Record<string, unknown>) => {
    const r = await req(who, 'POST', '/spaces', { kind: 'project', ...body })
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(201)
    return (await r.json()) as SpaceJson
  }
  const list = async (who: U, qs = '') =>
    ((await (await req(who, 'GET', `/spaces${qs}`)).json()) as { items: SpaceJson[] }).items

  async function invite(email: string, role: 'admin' | 'member' | 'guest'): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'space-password-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'space-password-1')).cookie }
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    workspaceId = r.workspaceId
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.admin = await invite('a@xz.local', 'admin')
    u.member = await invite('m@xz.local', 'member')
    u.member2 = await invite('m2@xz.local', 'member')
    u.guest = await invite('g@xz.local', 'guest')
  })

  it('REQ-SPACE-001 member 创建 201 且为 space admin；重复 slug 409 CONFLICT_UNIQUE；guest 403；中文名自动 slug', async () => {
    const s = await create(u.member, { name: 'Alpha Project', slug: 'alpha' })
    expect(s).toMatchObject({ slug: 'alpha', myRole: 'admin', isMember: true, memberCount: 1 })
    const [sm] = await db()
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, s.id), eq(spaceMembers.userId, u.member.id)))
    expect(sm?.role).toBe('admin')
    const dup = await req(u.admin, 'POST', '/spaces', { name: 'X', slug: 'alpha', kind: 'work' })
    expect(dup.status).toBe(409)
    expect((await problemOf(dup)).code).toBe('CONFLICT_UNIQUE')
    const g = await req(u.guest, 'POST', '/spaces', { name: 'G', kind: 'work' })
    expect(g.status).toBe(403)
    const auto = await create(u.member, { name: 'Alpha Project' })
    expect(auto.slug).toBe('alpha-project')
    const again = await create(u.member, { name: 'Alpha Project' })
    expect(again.slug).toBe('alpha-project-2')
    const zh = await create(u.member, { name: '学习计划' })
    expect(zh.slug).toMatch(/^s-[a-z0-9]{4,6}$/)
  })

  it('REQ-SPACE-008 颜色只收 8 个 token 名、图标只收 emoji / Lucide 名，否则 422 VALIDATION', async () => {
    const bad = await req(u.member, 'POST', '/spaces', {
      name: 'C',
      kind: 'work',
      color: '#ff0000',
    })
    expect(bad.status).toBe(422)
    expect((await problemOf(bad)).code).toBe('VALIDATION')
    const badIcon = await req(u.member, 'POST', '/spaces', {
      name: 'C',
      kind: 'work',
      icon: 'not an icon!',
    })
    expect(badIcon.status).toBe(422)
    const twoEmoji = await req(u.member, 'POST', '/spaces', {
      name: 'C',
      kind: 'work',
      icon: '🚀🚀x',
    })
    expect(twoEmoji.status).toBe(422)
    expect((await create(u.member, { name: 'E1', icon: '🚀' })).icon).toBe('🚀')
    expect((await create(u.member, { name: 'E2', icon: '👩‍💻' })).icon).toBe('👩‍💻')
    expect((await create(u.member, { name: 'E3', icon: 'book-open', color: 'green' })).icon).toBe(
      'book-open',
    )
  })

  it('REQ-SPACE-002 visibility=members：非成员 GET 404 且列表不含；成员按 id 与 slug 均可读', async () => {
    const s = await create(u.member, { name: 'Secret', slug: 'secret', visibility: 'members' })
    expect((await req(u.member2, 'GET', `/spaces/${s.id}`)).status).toBe(404)
    expect((await req(u.member2, 'GET', '/spaces/secret')).status).toBe(404)
    expect((await list(u.member2)).map((x) => x.id)).not.toContain(s.id)
    expect((await req(u.member, 'GET', '/spaces/secret')).status).toBe(200)
    // owner/admin 可读（01 §5），但他人的个人空间不进列表
    expect((await req(u.admin, 'GET', `/spaces/${s.id}`)).status).toBe(200)
    const personal = (await list(u.owner)).filter((x) => (x as { isPersonal?: boolean }).isPersonal)
    expect(personal).toHaveLength(1)
  })

  it('REQ-SPACE-003 space member 改名 403、space admin 200；space admin 删除 403；过期 ifUpdatedAt 409 带 current', async () => {
    const s = await create(u.member, { name: 'Team', slug: 'team' })
    expect(
      (
        await req(u.member, 'POST', `/spaces/${s.id}/members`, {
          userId: u.member2.id,
          role: 'member',
        })
      ).status,
    ).toBe(201)
    const deny = await req(u.member2, 'PATCH', `/spaces/${s.id}`, {
      name: 'x',
      ifUpdatedAt: s.updatedAt,
    })
    expect(deny.status).toBe(403)
    const ok = await req(u.member, 'PATCH', `/spaces/${s.id}`, {
      name: 'Team 2',
      ifUpdatedAt: s.updatedAt,
    })
    expect(ok.status).toBe(200)
    const stale = await req(u.member, 'PATCH', `/spaces/${s.id}`, {
      name: 'Team 3',
      ifUpdatedAt: s.updatedAt,
    })
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as { current: { name: string } }).current.name).toBe('Team 2')
    expect((await req(u.member, 'DELETE', `/spaces/${s.id}`)).status).toBe(403)
    expect((await req(u.member, 'DELETE', `/spaces/${s.id}?permanent=1`)).status).toBe(403)
    // 成员管理：改角色 → member2 升为 space admin 后可改名；移出后 member2 失去显式成员身份
    expect(
      (await req(u.member, 'PATCH', `/spaces/${s.id}/members/${u.member2.id}`, { role: 'admin' }))
        .status,
    ).toBe(200)
    const cur = (await (await req(u.member2, 'GET', `/spaces/${s.id}`)).json()) as SpaceJson
    expect(cur.myRole).toBe('admin')
    expect(
      (
        await req(u.member2, 'PATCH', `/spaces/${s.id}`, {
          name: 'Team 4',
          ifUpdatedAt: cur.updatedAt,
        })
      ).status,
    ).toBe(200)
    const seen: unknown[] = []
    const off = getEventBus().subscribe('entry.access_changed', (p) => seen.push(p))
    expect((await req(u.member, 'DELETE', `/spaces/${s.id}/members/${u.member2.id}`)).status).toBe(
      204,
    )
    off()
    expect(seen).toContainEqual({ spaceId: s.id, userIds: [u.member2.id] })
    expect((await req(u.member, 'DELETE', `/spaces/${s.id}/members/${u.member2.id}`)).status).toBe(
      404,
    )
    const members = (await (await req(u.member, 'GET', `/spaces/${s.id}/members`)).json()) as {
      items: { userId: string; role: string }[]
    }
    expect(members.items).toEqual([expect.objectContaining({ userId: u.member.id, role: 'admin' })])
  })

  it('REQ-SPACE-004 归档：默认列表不含、archived=1 含；其中记录的创建与修改 403；取消归档后恢复可写', async () => {
    const s = await create(u.member, { name: 'Arch', slug: 'arch' })
    const e = await req(u.member, 'POST', '/entries', { kind: 'note', title: 'n', spaceId: s.id })
    expect(e.status).toBe(201)
    const { id: entryId } = (await e.json()) as { id: string }
    const entry = (await (await req(u.member, 'GET', `/entries/${entryId}`)).json()) as {
      id: string
      updatedAt: string
    }
    const task = (await (
      await req(u.member, 'POST', '/tasks', { title: 't', spaceId: s.id, status: 'todo' })
    ).json()) as { id: string; updatedAt: string }
    expect((await req(u.member, 'POST', `/spaces/${s.id}/archive`)).status).toBe(200)
    // 任务写 403（T1-003 起任务接口就绪）
    expect(
      (
        await req(u.member, 'PATCH', `/tasks/${task.id}`, {
          title: 'x',
          ifUpdatedAt: task.updatedAt,
        })
      ).status,
    ).toBe(403)
    expect((await req(u.member, 'POST', '/tasks', { title: 't2', spaceId: s.id })).status).toBe(403)
    expect((await list(u.member)).map((x) => x.id)).not.toContain(s.id)
    expect((await list(u.member, '?archived=1')).map((x) => x.id)).toContain(s.id)
    const archivedCreate = await req(u.member, 'POST', '/entries', {
      kind: 'note',
      title: 'n2',
      spaceId: s.id,
    })
    expect(archivedCreate.status, await archivedCreate.clone().text()).toBe(403)
    const archivedPatch = await req(u.member, 'PATCH', `/entries/${entry.id}`, {
      title: 'x',
      ifUpdatedAt: entry.updatedAt,
    })
    expect(archivedPatch.status, await archivedPatch.clone().text()).toBe(403)
    expect((await req(u.member, 'GET', `/entries/${entry.id}`)).status).toBe(200) // 只读仍可看
    expect((await req(u.member, 'POST', `/spaces/${s.id}/unarchive`)).status).toBe(200)
    expect(
      (
        await req(u.member, 'PATCH', `/entries/${entry.id}`, {
          title: 'x',
          ifUpdatedAt: entry.updatedAt,
        })
      ).status,
    ).toBe(200)
    // 个人空间不可归档
    const mine = (await list(u.member)).find((x) => (x as { isPersonal?: boolean }).isPersonal)
    expect((await req(u.member, 'POST', `/spaces/${mine?.id}/archive`)).status).toBe(403)
  })

  it('REQ-SPACE-005 PATCH /spaces/reorder 只改被拖项一行 sort_key，列表顺序随之变化', async () => {
    const a = await create(u.owner, { name: 'R-A', slug: 'r-a' })
    const b = await create(u.owner, { name: 'R-B', slug: 'r-b' })
    const c = await create(u.owner, { name: 'R-C', slug: 'r-c' })
    const snapshot = async () =>
      new Map(
        (
          await db()
            .select({ id: spaces.id, k: spaces.sortKey })
            .from(spaces)
            .where(eq(spaces.workspaceId, workspaceId))
        ).map((r) => [r.id, r.k]),
      )
    const before = await snapshot()
    const r = await req(u.owner, 'PATCH', '/spaces/reorder', { id: c.id, after: a.id })
    expect(r.status).toBe(200)
    const after = await snapshot()
    const changed = [...after].filter(([id, k]) => before.get(id) !== k).map(([id]) => id)
    expect(changed).toEqual([c.id])
    const order = (await list(u.owner))
      .map((x) => x.id)
      .filter((id) => [a.id, b.id, c.id].includes(id))
    expect(order).toEqual([a.id, c.id, b.id])
    // 放到最前
    expect((await req(u.owner, 'PATCH', '/spaces/reorder', { id: b.id, after: null })).status).toBe(
      200,
    )
    const all = await list(u.owner)
    expect(all[0]?.id, JSON.stringify(all.map((x) => [x.slug, x.sortKey]))).toBe(b.id)
    // 非 space admin 不能拖他人空间
    expect(
      (await req(u.member2, 'PATCH', '/spaces/reorder', { id: a.id, after: null })).status,
    ).toBe(403)
  })

  it('REQ-SPACE-006 space admin 加成员 → events.space.invited；被邀者收到 in_app 与 email；guest 只能是 viewer', async () => {
    const s = await create(u.member, { name: 'Invite', slug: 'invite', visibility: 'members' })
    const r = await req(u.member, 'POST', `/spaces/${s.id}/members`, {
      userId: u.member2.id,
      role: 'member',
    })
    expect(r.status).toBe(201)
    const [ev] = await db()
      .select()
      .from(events)
      .where(and(eq(events.kind, 'space.invited'), eq(events.targetId, s.id)))
    expect(ev?.payload).toMatchObject({ spaceSlug: 'invite', role: 'member', actorName: 'm' })
    mailbox.length = 0
    const deps = { db: db(), bus: getEventBus(), appUrl: 'http://localhost:3010' }
    const fr = await fanoutEvent(deps, ev?.id ?? '')
    for (const nid of fr.emailNotificationIds) await sendNotificationEmail(deps, nid)
    const [n] = await db()
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, ev?.id ?? ''))
    expect(n).toMatchObject({ userId: u.member2.id, url: '/spaces/invite' })
    expect(mailbox.map((m) => m.to)).toEqual(['m2@xz.local'])
    // 被邀者现在可读
    expect((await req(u.member2, 'GET', `/spaces/${s.id}`)).status).toBe(200)
    const g = await req(u.member, 'POST', `/spaces/${s.id}/members`, {
      userId: u.guest.id,
      role: 'member',
    })
    expect(g.status).toBe(422)
    expect(
      (
        await req(u.member, 'POST', `/spaces/${s.id}/members`, {
          userId: u.guest.id,
          role: 'viewer',
        })
      ).status,
    ).toBe(201)
    expect((await req(u.guest, 'GET', `/spaces/${s.id}`)).status).toBe(200)
  })

  it('REQ-SPACE-007 软删：其记录 404、回收站仅 owner/admin 可见并带剩余天数；member 永久删 403；恢复；owner 永久删清除内容并审计', async () => {
    const s = await create(u.member, { name: 'Trash', slug: 'trash-me' })
    const e = (await (
      await req(u.member, 'POST', '/entries', { kind: 'note', title: 'n', spaceId: s.id })
    ).json()) as { id: string }
    expect((await req(u.owner, 'DELETE', `/spaces/${s.id}`)).status).toBe(204)
    expect((await req(u.member, 'GET', `/entries/${e.id}`)).status).toBe(404)
    expect((await req(u.member, 'GET', `/tasks?spaceId=${s.id}`)).status).toBe(404)
    expect((await req(u.owner, 'GET', `/spaces/${s.id}`)).status).toBe(404)
    expect((await list(u.owner)).map((x) => x.id)).not.toContain(s.id)
    const trash = await list(u.owner, '?deleted=1')
    expect(trash.find((x) => x.id === s.id)).toMatchObject({ daysLeft: 30 })
    expect(await list(u.member, '?deleted=1')).toEqual([])
    expect((await req(u.member, 'POST', `/spaces/${s.id}/restore`)).status).toBe(403)
    expect((await req(u.member, 'DELETE', `/spaces/${s.id}?permanent=1`)).status).toBe(403)
    expect((await req(u.admin, 'POST', `/spaces/${s.id}/restore`)).status).toBe(200)
    expect((await req(u.member, 'GET', `/entries/${e.id}`)).status).toBe(200)
    expect((await req(u.admin, 'DELETE', `/spaces/${s.id}?permanent=1`)).status).toBe(204)
    expect(await db().select().from(spaces).where(eq(spaces.id, s.id))).toHaveLength(0)
    expect(await db().select().from(entries).where(eq(entries.id, e.id))).toHaveLength(0)
    const [a] = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'space.permanently_deleted'), eq(auditLog.targetId, s.id)))
    expect(a?.meta).toMatchObject({ slug: 'trash-me', entries: 1, wasDeleted: false })
  })

  it('REQ-SPACE-007 gc：软删满 30 天的空间连同其记录被清除（旧逻辑会因子对象未软删而永远跳过）', async () => {
    const s = await create(u.owner, { name: 'Old', slug: 'old-trash' })
    await req(u.owner, 'POST', '/entries', { kind: 'note', title: 'n', spaceId: s.id })
    expect((await req(u.owner, 'DELETE', `/spaces/${s.id}`)).status).toBe(204)
    const out = await gcSoftDeleted({
      db: db(),
      dataDir: './data/test-spaces',
      now: new Date(Date.now() + 31 * 86_400_000),
    })
    expect(out.spaces).toBeGreaterThanOrEqual(1)
    expect(await db().select().from(spaces).where(eq(spaces.id, s.id))).toHaveLength(0)
    expect(await db().select().from(entries).where(eq(entries.spaceId, s.id))).toHaveLength(0)
  })

  it('REQ-SPACE-003 · 007 角色矩阵：workspace 可见空间上各端点 × owner/admin/member/guest', async () => {
    const s = await create(u.owner, { name: 'Matrix', slug: 'matrix' })
    const fresh = async () =>
      ((await (await req(u.owner, 'GET', `/spaces/${s.id}`)).json()) as SpaceJson).updatedAt
    const cases: [keyof typeof u, number, number, number, number][] = [
      // who,      GET, PATCH, POST members, DELETE members
      ['owner', 200, 200, 201, 204],
      ['admin', 200, 200, 201, 204],
      ['member', 200, 403, 403, 403],
      ['guest', 404, 404, 404, 404],
    ]
    for (const [who, get, patch, add, rm] of cases) {
      expect((await req(u[who], 'GET', `/spaces/${s.id}`)).status, `${who} GET`).toBe(get)
      expect(
        (
          await req(u[who], 'PATCH', `/spaces/${s.id}`, {
            name: `M-${who}`,
            ifUpdatedAt: await fresh(),
          })
        ).status,
        `${who} PATCH`,
      ).toBe(patch)
      expect(
        (
          await req(u[who], 'POST', `/spaces/${s.id}/members`, {
            userId: u.member2.id,
            role: 'member',
          })
        ).status,
        `${who} add`,
      ).toBe(add)
      if (add !== 201)
        await req(u.owner, 'POST', `/spaces/${s.id}/members`, {
          userId: u.member2.id,
          role: 'member',
        })
      expect(
        (await req(u[who], 'DELETE', `/spaces/${s.id}/members/${u.member2.id}`)).status,
        `${who} remove`,
      ).toBe(rm)
    }
    // 删除：只有 owner/admin
    expect((await req(u.member, 'DELETE', `/spaces/${s.id}`)).status).toBe(403)
    expect((await req(u.guest, 'DELETE', `/spaces/${s.id}`)).status).toBe(404)
    expect((await req(u.admin, 'DELETE', `/spaces/${s.id}`)).status).toBe(204)
    expect((await req(null, 'GET', '/spaces')).status).toBe(401)
  })
})
