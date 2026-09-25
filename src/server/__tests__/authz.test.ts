/**
 * REQ-WS-007 角色矩阵：每个动作 × 工作区角色(owner/admin/member/guest/anon) × 空间角色(admin/member/viewer/无)。
 * 期望值是手写字面量（01 §5），不从 can() 推导。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SpaceRole, WorkspaceRole } from '../../shared/schemas/enums.ts'
import {
  ACTIONS,
  type Actor,
  can,
  type EntryRef,
  effectiveSpaceRole,
  type MaybeActor,
  type SpaceRef,
  type TaskRef,
} from '../authz.ts'

const ME = 'user-me'
const OTHER = 'user-other'
const WS_ROLES = ['owner', 'admin', 'member', 'guest', 'anon'] as const
const SPACE_ROLES = ['admin', 'member', 'viewer', 'none'] as const
type WsRole = (typeof WS_ROLES)[number]
type SpRole = (typeof SPACE_ROLES)[number]

const actorOf = (r: WsRole): MaybeActor =>
  r === 'anon' ? null : { id: ME, workspaceRole: r as WorkspaceRole }

const space = (o: Partial<SpaceRef> & { memberRole: SpaceRole | null }): SpaceRef => ({
  id: 's1',
  visibility: 'members',
  isPersonal: false,
  createdBy: OTHER,
  archivedAt: null,
  deletedAt: null,
  ...o,
})
const task = (s: SpaceRef, o: Partial<TaskRef> = {}): TaskRef => ({
  id: 't1',
  creatorId: OTHER,
  assigneeId: null,
  deletedAt: null,
  space: s,
  ...o,
})
const entry = (s: SpaceRef, o: Partial<EntryRef> = {}): EntryRef => ({
  id: 'e1',
  authorId: OTHER,
  visibility: 'space',
  deletedAt: null,
  archivedAt: null,
  space: s,
  ...o,
})

/** 期望表：行 = 工作区角色，列 = 空间角色 admin/member/viewer/none。 */
type Matrix = Record<WsRole, [boolean, boolean, boolean, boolean]>
const T = true
const F = false

function expectMatrix(
  name: string,
  m: Matrix,
  run: (actor: MaybeActor, spaceRole: SpRole) => boolean,
) {
  describe(name, () => {
    for (const ws of WS_ROLES) {
      for (const [i, sp] of SPACE_ROLES.entries()) {
        it(`REQ-WS-007 ${name} ${ws}×${sp} = ${m[ws][i]}`, () => {
          expect(run(actorOf(ws), sp)).toBe(m[ws][i])
        })
      }
    }
  })
}
const memberRole = (sp: SpRole): SpaceRole | null => (sp === 'none' ? null : sp)

// ---------- 工作区级动作（与空间角色无关） ----------
const ADMIN_ONLY: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [F, F, F, F],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}
const OWNER_ONLY: Matrix = {
  owner: [T, T, T, T],
  admin: [F, F, F, F],
  member: [F, F, F, F],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}
const NOT_GUEST: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, T, T, T],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}
const SELF_ONLY: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, T, T, T],
  guest: [T, T, T, T],
  anon: [F, F, F, F],
}
const NEVER: Matrix = {
  owner: [F, F, F, F],
  admin: [F, F, F, F],
  member: [F, F, F, F],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}

expectMatrix('workspace.manage', ADMIN_ONLY, (a) => can(a, 'workspace.manage', null))
expectMatrix('member.suspend', ADMIN_ONLY, (a) => can(a, 'member.suspend', { id: OTHER }))
expectMatrix('member.unsuspend', ADMIN_ONLY, (a) => can(a, 'member.unsuspend', { id: OTHER }))
expectMatrix('member.revoke_sessions', ADMIN_ONLY, (a) =>
  can(a, 'member.revoke_sessions', { id: OTHER }),
)
expectMatrix('member.transfer_content', ADMIN_ONLY, (a) =>
  can(a, 'member.transfer_content', { id: OTHER }),
)
expectMatrix('workspace.owner_transfer', OWNER_ONLY, (a) =>
  can(a, 'workspace.owner_transfer', null),
)
expectMatrix('user.manage', OWNER_ONLY, (a) => can(a, 'user.manage', { id: OTHER }))
expectMatrix('user.manage(list)', OWNER_ONLY, (a) => can(a, 'user.manage', null))
expectMatrix('user.manage(self)', NEVER, (a) => can(a, 'user.manage', { id: ME }))
expectMatrix('space.create', NOT_GUEST, (a) => can(a, 'space.create', null))
expectMatrix('me.delete(self)', SELF_ONLY, (a) => can(a, 'me.delete', { id: ME }))
expectMatrix('me.delete(other)', NEVER, (a) => can(a, 'me.delete', { id: OTHER }))
expectMatrix('notification.read(self)', SELF_ONLY, (a) => can(a, 'notification.read', { id: ME }))
expectMatrix('notification.write(other)', NEVER, (a) => can(a, 'notification.write', { id: OTHER }))
expectMatrix('cycle.read(own)', SELF_ONLY, (a) => can(a, 'cycle.read', { id: 'c', ownerId: ME }))
expectMatrix('cycle.read(other)', ADMIN_ONLY, (a) =>
  can(a, 'cycle.read', { id: 'c', ownerId: OTHER }),
)
expectMatrix('cycle.write(own)', SELF_ONLY, (a) => can(a, 'cycle.write', { id: 'c', ownerId: ME }))
expectMatrix('cycle.write(other)', NEVER, (a) => can(a, 'cycle.write', { id: 'c', ownerId: OTHER }))
// ADR-0009：个人日历仅本人，admin 也不可见
expectMatrix('calendar.read(own)', SELF_ONLY, (a) =>
  can(a, 'calendar.read', { id: 'k', ownerId: ME }),
)
expectMatrix('calendar.read(other)', NEVER, (a) =>
  can(a, 'calendar.read', { id: 'k', ownerId: OTHER }),
)
expectMatrix('calendar.write(own)', SELF_ONLY, (a) =>
  can(a, 'calendar.write', { id: 'k', ownerId: ME }),
)
expectMatrix('calendar.write(other)', NEVER, (a) =>
  can(a, 'calendar.write', { id: 'k', ownerId: OTHER }),
)
// ADR-0008：审批注册申请 = owner/admin
expectMatrix('member.approve', ADMIN_ONLY, (a) => can(a, 'member.approve', null))
// ADR-0012：大类由管理员维护
expectMatrix('group.manage', ADMIN_ONLY, (a) => can(a, 'group.manage', null))

// ADR-0011 §2 模板：personal 仅本人；workspace 全员可读、管理员创建 / 管理，创建者可管自己的
const NON_GUEST: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, T, T, T],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}
const tpl = (scope: 'personal' | 'workspace', ownerId: string) => ({ id: 'tp', ownerId, scope })
expectMatrix('template.read(personal, own)', SELF_ONLY, (a) =>
  can(a, 'template.read', tpl('personal', ME)),
)
expectMatrix('template.read(personal, other)', NEVER, (a) =>
  can(a, 'template.read', tpl('personal', OTHER)),
)
expectMatrix('template.read(workspace, other)', SELF_ONLY, (a) =>
  can(a, 'template.read', tpl('workspace', OTHER)),
)
expectMatrix('template.create(personal)', NON_GUEST, (a) =>
  can(a, 'template.create', tpl('personal', ME)),
)
expectMatrix('template.create(workspace)', ADMIN_ONLY, (a) =>
  can(a, 'template.create', tpl('workspace', ME)),
)
expectMatrix('template.manage(personal, own)', NON_GUEST, (a) =>
  can(a, 'template.manage', tpl('personal', ME)),
)
expectMatrix('template.manage(personal, other)', NEVER, (a) =>
  can(a, 'template.manage', tpl('personal', OTHER)),
)
expectMatrix('template.manage(workspace, other)', ADMIN_ONLY, (a) =>
  can(a, 'template.manage', tpl('workspace', OTHER)),
)
expectMatrix('template.manage(workspace, own)', NON_GUEST, (a) =>
  can(a, 'template.manage', tpl('workspace', ME)),
)

// ---------- 空间：visibility=members ----------
// member 需显式行；guest 只在显式行时（且为 viewer 视角）；owner/admin 恒真
const MEMBERS_SPACE_READ: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, T, T, F],
  guest: [T, T, T, F],
  anon: [F, F, F, F],
}
const MEMBERS_SPACE_WRITE: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, T, F, F],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}
const MEMBERS_SPACE_MANAGE: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, F, F, F],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}

expectMatrix('space.read members', MEMBERS_SPACE_READ, (a, sp) =>
  can(a, 'space.read', space({ memberRole: memberRole(sp) })),
)
expectMatrix('space.manage members', MEMBERS_SPACE_MANAGE, (a, sp) =>
  can(a, 'space.manage', space({ memberRole: memberRole(sp) })),
)
expectMatrix('space.delete', ADMIN_ONLY, (a, sp) =>
  can(a, 'space.delete', space({ memberRole: memberRole(sp) })),
)
expectMatrix('space.delete personal', NEVER, (a, sp) =>
  can(a, 'space.delete', space({ isPersonal: true, memberRole: memberRole(sp) })),
)
expectMatrix('task.read members', MEMBERS_SPACE_READ, (a, sp) =>
  can(a, 'task.read', task(space({ memberRole: memberRole(sp) }))),
)
expectMatrix('task.write members', MEMBERS_SPACE_WRITE, (a, sp) =>
  can(a, 'task.write', task(space({ memberRole: memberRole(sp) }))),
)
expectMatrix('entry.create members', MEMBERS_SPACE_WRITE, (a, sp) =>
  can(a, 'entry.create', space({ memberRole: memberRole(sp) })),
)
expectMatrix('tag.create', NOT_GUEST, (a) => can(a, 'tag.create', null))
expectMatrix('tag.manage', ADMIN_ONLY, (a) => can(a, 'tag.manage', null))
expectMatrix('task.create members', MEMBERS_SPACE_WRITE, (a, sp) =>
  can(a, 'task.create', space({ memberRole: memberRole(sp) })),
)
expectMatrix('comment.create(task) members', MEMBERS_SPACE_READ, (a, sp) =>
  can(a, 'comment.create', task(space({ memberRole: memberRole(sp) }))),
)

// ---------- 空间：visibility=workspace ----------
// member 无需显式行（REQ-WS-009：guest 仍需显式加入）
const WS_SPACE_READ: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, T, T, T],
  guest: [T, T, T, F],
  anon: [F, F, F, F],
}
const WS_SPACE_WRITE: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, T, T, T],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}
expectMatrix('space.read workspace', WS_SPACE_READ, (a, sp) =>
  can(a, 'space.read', space({ visibility: 'workspace', memberRole: memberRole(sp) })),
)
expectMatrix('task.write workspace', WS_SPACE_WRITE, (a, sp) =>
  can(a, 'task.write', task(space({ visibility: 'workspace', memberRole: memberRole(sp) }))),
)
expectMatrix('entry.create workspace', WS_SPACE_WRITE, (a, sp) =>
  can(a, 'entry.create', space({ visibility: 'workspace', memberRole: memberRole(sp) })),
)
expectMatrix('task.create workspace', WS_SPACE_WRITE, (a, sp) =>
  can(a, 'task.create', space({ visibility: 'workspace', memberRole: memberRole(sp) })),
)
expectMatrix('entry.read workspace-visible', WS_SPACE_READ, (a, sp) =>
  can(
    a,
    'entry.read',
    entry(space({ visibility: 'workspace', memberRole: memberRole(sp) }), {
      visibility: 'workspace',
    }),
  ),
)

// ---------- 记录可见性（members 空间） ----------
const PRIVATE_OTHER: Matrix = NEVER // private 仅作者，admin 也不行
const PRIVATE_MINE: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, T, T, F],
  guest: [T, T, T, F],
  anon: [F, F, F, F],
}
expectMatrix('entry.read private(other)', PRIVATE_OTHER, (a, sp) =>
  can(a, 'entry.read', entry(space({ memberRole: memberRole(sp) }), { visibility: 'private' })),
)
expectMatrix('entry.read private(mine)', PRIVATE_MINE, (a, sp) =>
  can(
    a,
    'entry.read',
    entry(space({ memberRole: memberRole(sp) }), { visibility: 'private', authorId: ME }),
  ),
)
expectMatrix('entry.read space', MEMBERS_SPACE_READ, (a, sp) =>
  can(a, 'entry.read', entry(space({ memberRole: memberRole(sp) }))),
)
expectMatrix('comment.create(entry)', MEMBERS_SPACE_READ, (a, sp) =>
  can(a, 'comment.create', entry(space({ memberRole: memberRole(sp) }))),
)

// entry.write：owner/admin ✓；member 为作者或空间 admin；guest ✗
const ENTRY_WRITE_OTHER: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, F, F, F],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}
const ENTRY_WRITE_MINE: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, T, T, F],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}
expectMatrix('entry.write other-author', ENTRY_WRITE_OTHER, (a, sp) =>
  can(a, 'entry.write', entry(space({ memberRole: memberRole(sp) }))),
)
expectMatrix('entry.write mine', ENTRY_WRITE_MINE, (a, sp) =>
  can(a, 'entry.write', entry(space({ memberRole: memberRole(sp) }), { authorId: ME })),
)
// entry.delete：owner/admin ✓；member 仅作者；guest ✗
const ENTRY_DELETE_OTHER: Matrix = ADMIN_ONLY
expectMatrix('entry.delete other-author', ENTRY_DELETE_OTHER, (a, sp) =>
  can(a, 'entry.delete', entry(space({ memberRole: memberRole(sp) }))),
)
expectMatrix('entry.delete mine', ENTRY_WRITE_MINE, (a, sp) =>
  can(a, 'entry.delete', entry(space({ memberRole: memberRole(sp) }), { authorId: ME })),
)

// comment.resolve：owner/admin ✓；member 为目标作者或评论作者；guest ✗
const RESOLVE_NONE: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [F, F, F, F],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}
const RESOLVE_MINE: Matrix = {
  owner: [T, T, T, T],
  admin: [T, T, T, T],
  member: [T, T, T, F],
  guest: [F, F, F, F],
  anon: [F, F, F, F],
}
expectMatrix('comment.resolve unrelated', RESOLVE_NONE, (a, sp) =>
  can(a, 'comment.resolve', {
    id: 'c',
    authorId: OTHER,
    target: { kind: 'entry', ref: entry(space({ memberRole: memberRole(sp) })) },
  }),
)
expectMatrix('comment.resolve comment-author', RESOLVE_MINE, (a, sp) =>
  can(a, 'comment.resolve', {
    id: 'c',
    authorId: ME,
    target: { kind: 'entry', ref: entry(space({ memberRole: memberRole(sp) })) },
  }),
)
expectMatrix('comment.resolve target-author', RESOLVE_MINE, (a, sp) =>
  can(a, 'comment.resolve', {
    id: 'c',
    authorId: OTHER,
    target: { kind: 'task', ref: task(space({ memberRole: memberRole(sp) }), { creatorId: ME }) },
  }),
)

// attachment.read：跟随 target；孤儿附件仅 owner
expectMatrix('attachment.read entry-target', MEMBERS_SPACE_READ, (a, sp) =>
  can(a, 'attachment.read', {
    id: 'a',
    ownerId: OTHER,
    target: { kind: 'entry', ref: entry(space({ memberRole: memberRole(sp) })) },
  }),
)
expectMatrix('attachment.read orphan(other owner)', NEVER, (a) =>
  can(a, 'attachment.read', { id: 'a', ownerId: OTHER, target: null }),
)
expectMatrix('attachment.read orphan(mine)', SELF_ONLY, (a) =>
  can(a, 'attachment.read', { id: 'a', ownerId: ME, target: null }),
)
expectMatrix('attachment.read avatar', SELF_ONLY, (a) =>
  can(a, 'attachment.read', { id: 'a', ownerId: OTHER, target: { kind: 'user', userId: OTHER } }),
)

// ---------- 归档 / 软删 / 停用 ----------
describe('archived / deleted / suspended', () => {
  const owner: Actor = { id: ME, workspaceRole: 'owner' }
  const archived = space({ memberRole: 'admin', archivedAt: new Date() })
  it('REQ-WS-008 归档空间可读但不可写（403 语义）', () => {
    expect(can(owner, 'space.read', archived)).toBe(true)
    expect(can(owner, 'task.write', task(archived))).toBe(false)
    expect(can(owner, 'entry.write', entry(archived))).toBe(false)
    expect(can(owner, 'entry.create', archived)).toBe(false)
    expect(can(owner, 'task.read', task(archived))).toBe(true)
  })
  it('REQ-WS-008 软删对象对所有人不可读（404 语义）', () => {
    const deleted = space({ memberRole: 'admin', deletedAt: new Date() })
    expect(can(owner, 'space.read', deleted)).toBe(false)
    expect(
      can(owner, 'task.read', task(space({ memberRole: 'admin' }), { deletedAt: new Date() })),
    ).toBe(false)
    expect(
      can(owner, 'entry.read', entry(space({ memberRole: 'admin' }), { deletedAt: new Date() })),
    ).toBe(false)
  })
  it('REQ-WS-004 停用成员一切为 false', () => {
    const suspended: Actor = { id: ME, workspaceRole: 'owner', suspended: true }
    for (const action of ACTIONS) {
      // 用最宽松的资源
      const s = space({ memberRole: 'admin', visibility: 'workspace' })
      const res: Record<string, unknown> = {
        'workspace.manage': null,
        'workspace.owner_transfer': null,
        'space.create': null,
        'tag.create': null,
        'tag.manage': null,
        'space.read': s,
        'space.manage': s,
        'space.delete': s,
        'entry.create': s,
        'task.create': s,
        'task.read': task(s),
        'task.write': task(s),
        'entry.read': entry(s, { authorId: ME }),
        'entry.write': entry(s, { authorId: ME }),
        'entry.delete': entry(s, { authorId: ME }),
        'comment.create': entry(s),
        'comment.resolve': { id: 'c', authorId: ME, target: { kind: 'entry', ref: entry(s) } },
        'attachment.read': { id: 'a', ownerId: ME, target: null },
        'cycle.read': { id: 'c', ownerId: ME },
        'cycle.write': { id: 'c', ownerId: ME },
        'calendar.read': { id: 'k', ownerId: ME },
        'calendar.write': { id: 'k', ownerId: ME },
        'member.approve': null,
        'user.manage': { id: OTHER },
        'template.read': { id: 'tp', ownerId: ME, scope: 'workspace' },
        'template.create': { id: '', ownerId: ME, scope: 'personal' },
        'template.manage': { id: 'tp', ownerId: ME, scope: 'personal' },
        'group.manage': null,
      }
      const r = action in res ? res[action] : { id: ME }
      // biome-ignore lint/suspicious/noExplicitAny: 枚举遍历
      expect(can(suspended, action, r as any), action).toBe(false)
    }
  })
  it('effectiveSpaceRole：较高者；guest 封顶 viewer', () => {
    const member: Actor = { id: ME, workspaceRole: 'member' }
    expect(
      effectiveSpaceRole(member, space({ visibility: 'workspace', memberRole: 'viewer' })),
    ).toBe('member')
    expect(
      effectiveSpaceRole(member, space({ visibility: 'workspace', memberRole: 'admin' })),
    ).toBe('admin')
    expect(
      effectiveSpaceRole(member, space({ visibility: 'members', memberRole: null })),
    ).toBeNull()
    const guest: Actor = { id: ME, workspaceRole: 'guest' }
    expect(effectiveSpaceRole(guest, space({ visibility: 'workspace', memberRole: 'admin' }))).toBe(
      'viewer',
    )
    expect(
      effectiveSpaceRole(guest, space({ visibility: 'workspace', memberRole: null })),
    ).toBeNull()
  })
})

describe('coverage', () => {
  it('REQ-WS-007 每个动作至少一张矩阵', () => {
    // 上面 expectMatrix 的名字以动作开头；逐个核对源码，新增动作忘写矩阵即失败
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    for (const action of ACTIONS) expect(src, action).toContain(`expectMatrix('${action}`)
  })
})
