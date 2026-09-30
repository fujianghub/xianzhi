/** ADR-0011 §2 · §3 记录模板：REQ-TPL-001 ~ 004（内置 / 新 kind / 套模板建记录 / 自定义与权限）；ADR-0023：REQ-TPL-006 ~ 009。 */
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { YDOC_FRAGMENT } from '../../collab/derive.ts'
import { ydocFromPm } from '../../collab/ydoc-json.ts'
import { yElementToPm } from '../../shared/editor/unknown.ts'
import { getDb } from '../db/index.ts'
import { entries } from '../db/schema/business.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']

async function join(app: App, ownerCookie: string, email: string, role: 'member' | 'guest') {
  const inv = await app.request('/api/v1/workspace/invitations', {
    method: 'POST',
    headers: jsonHeaders({ cookie: ownerCookie }),
    body: JSON.stringify({ email, role }),
  })
  const { id } = (await inv.json()) as { id: string }
  const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, name: email.split('@')[0], password: 'member-password-123' }),
  })
  const { userId } = (await acc.json()) as { userId: string }
  return { userId, cookie: (await signIn(app, email, 'member-password-123')).cookie }
}

/** 顶层块的标题文字（用于断言初始正文）。 */
async function headingsOf(id: string): Promise<string[]> {
  const [row] = await db().select({ ydoc: entries.ydoc }).from(entries).where(eq(entries.id, id))
  const doc = new Y.Doc({ gc: false })
  Y.applyUpdate(doc, row?.ydoc ?? new Uint8Array())
  const out = doc
    .getXmlFragment(YDOC_FRAGMENT)
    .toArray()
    .map((n) => yElementToPm(n as never))
    .filter((n) => n.type === 'heading')
    .map((n) => (n.content ?? []).map((t) => t.text ?? '').join(''))
  doc.destroy()
  return out
}

describe('templates', () => {
  let app: App
  let owner = ''
  let member: { userId: string; cookie: string }
  let guest: { userId: string; cookie: string }
  const req = (cookie: string, path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: jsonHeaders({ cookie }) })

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    owner = (await signIn(app, OWNER.email, OWNER.password)).cookie
    member = await join(app, owner, 'tpl-member@xz.local', 'member')
    guest = await join(app, owner, 'tpl-guest@xz.local', 'guest')
  })

  it('REQ-TPL-001 列表含 6 个内置模板（开发 2 / 学习 4），按 kind / spaceKind 过滤；列表无正文，详情带 body', async () => {
    const all = (await (await req(member.cookie, '/api/v1/templates')).json()) as {
      items: { id: string; group: string; kind: string; body?: unknown }[]
    }
    const builtin = all.items.filter((t) => t.id.startsWith('builtin:'))
    expect(builtin.map((t) => t.id).sort()).toEqual(
      [
        'builtin:bug-fix',
        'builtin:learning-plan',
        'builtin:learning-weekly',
        'builtin:product-optimize',
        'builtin:reading-note',
        'builtin:study-note',
      ].sort(),
    )
    expect(builtin.filter((t) => t.group === 'dev')).toHaveLength(2)
    expect(builtin.every((t) => t.body === undefined)).toBe(true)
    const learning = (await (
      await req(member.cookie, '/api/v1/templates?spaceKind=learning')
    ).json()) as { items: { id: string }[] }
    expect(learning.items.map((t) => t.id)).toContain('builtin:learning-plan')
    expect(learning.items.map((t) => t.id)).not.toContain('builtin:bug-fix')
    const detail = (await (
      await req(member.cookie, '/api/v1/templates/builtin:bug-fix')
    ).json()) as { body: { content: unknown[] }; kind: string }
    expect(detail.kind).toBe('bug')
    expect(detail.body.content.length).toBeGreaterThan(5)
  })

  it('REQ-TPL-002 新 kind optimize / plan 可创建且 fields 严格校验', async () => {
    const ok = await req(member.cookie, '/api/v1/entries', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'plan',
        title: 'Rust 学习计划',
        fields: { status: 'active', progress: 10 },
      }),
    })
    expect(ok.status).toBe(201)
    const bad = await req(member.cookie, '/api/v1/entries', {
      method: 'POST',
      body: JSON.stringify({ kind: 'optimize', title: '首屏优化', fields: { status: 'maybe' } }),
    })
    expect(bad.status).toBe(422)
  })

  it('REQ-TPL-003 套内置模板建记录：初始正文即模板骨架、占位符已替换；blank 为空白且不注入 kind 骨架', async () => {
    const r = await req(member.cookie, '/api/v1/entries', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'bug',
        title: '登录按钮无响应',
        fields: { severity: 'high', status: 'new' },
        templateId: 'builtin:bug-fix',
      }),
    })
    expect(r.status).toBe(201)
    const { id } = (await r.json()) as { id: string }
    const heads = await headingsOf(id)
    expect(heads).toContain('复现步骤')
    expect(heads).toContain('迭代跟进')
    const [row] = await db().select({ ydoc: entries.ydoc }).from(entries).where(eq(entries.id, id))
    const text = Buffer.from(row?.ydoc ?? []).toString('utf8')
    expect(text).not.toContain('{{date}}')
    expect(text).toContain('tpl-member')

    const blank = await req(member.cookie, '/api/v1/entries', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'decision',
        title: '空白决策',
        fields: { status: 'proposed' },
        templateId: 'builtin:blank',
      }),
    })
    const blankId = ((await blank.json()) as { id: string }).id
    expect(await headingsOf(blankId)).toEqual([])
    const [b] = await db().select({ v: entries.ydoc }).from(entries).where(eq(entries.id, blankId))
    const d = new Y.Doc({ gc: false })
    Y.applyUpdate(d, b?.v ?? new Uint8Array())
    expect(d.getXmlFragment(YDOC_FRAGMENT).length).toBe(1) // 一个空段落 → 首次打开不注入骨架

    const unknown = await req(member.cookie, '/api/v1/entries', {
      method: 'POST',
      body: JSON.stringify({ kind: 'note', title: 'x', templateId: 'builtin:nope' }),
    })
    expect(unknown.status).toBe(422)
  })

  it('REQ-TPL-004 自定义模板：另存为个人模板 → 仅本人可见；工作区模板仅管理员可建、全员可用；内置不可改删', async () => {
    const src = await req(member.cookie, '/api/v1/entries', {
      method: 'POST',
      body: JSON.stringify({ kind: 'plan', title: '源', fields: { status: 'active' } }),
    })
    const srcId = ((await src.json()) as { id: string }).id
    // 模拟已编辑过的记录：直接写 ydoc（正文真源）
    await db()
      .update(entries)
      .set({
        ydoc: ydocFromPm({
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '我的阶段' }] },
          ],
        }),
      })
      .where(eq(entries.id, srcId))
    const saved = await req(member.cookie, '/api/v1/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: '我的学习计划',
        scope: 'personal',
        fromEntryId: srcId,
        spaceKind: 'learning',
      }),
    })
    expect(saved.status).toBe(201)
    const tpl = (await saved.json()) as {
      id: string
      kind: string
      canManage: boolean
      updatedAt: string
    }
    expect(tpl.kind).toBe('plan')
    expect(tpl.canManage).toBe(true)

    // 他人看不到个人模板
    const ownerList = (await (await req(owner, '/api/v1/templates')).json()) as {
      items: { id: string }[]
    }
    expect(ownerList.items.map((t) => t.id)).not.toContain(tpl.id)
    expect((await req(owner, `/api/v1/templates/${tpl.id}`)).status).toBe(404)

    // 用个人模板建记录
    const e = await req(member.cookie, '/api/v1/entries', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'plan',
        title: '按我的模板',
        fields: { status: 'active' },
        templateId: tpl.id,
      }),
    })
    expect(await headingsOf(((await e.json()) as { id: string }).id)).toEqual(['我的阶段'])
    // 别人不能用他的个人模板
    const stolen = await req(owner, '/api/v1/entries', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'plan',
        title: 'x',
        fields: { status: 'active' },
        templateId: tpl.id,
      }),
    })
    expect(stolen.status).toBe(422)

    // 工作区模板（改于 2026-09-28，ADR-0023：member 也可共享，见 REQ-TPL-006）；owner 建 → 全员可见，member 不可管
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '团队' }] }],
    }
    const ws = await req(owner, '/api/v1/templates', {
      method: 'POST',
      body: JSON.stringify({ name: '团队周报', scope: 'workspace', kind: 'journal', body }),
    })
    expect(ws.status).toBe(201)
    const wsTpl = (await ws.json()) as { id: string; updatedAt: string }
    const wsId = wsTpl.id
    const seen = (await (await req(guest.cookie, '/api/v1/templates')).json()) as {
      items: { id: string; canManage: boolean }[]
    }
    expect(seen.items.find((t) => t.id === wsId)?.canManage).toBe(false)
    expect(
      (
        await req(member.cookie, `/api/v1/templates/${wsId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: 'x', ifUpdatedAt: wsTpl.updatedAt }),
        })
      ).status,
    ).toBe(403)
    // 改名 / 删除自己的；内置模板只有所有者能改删（ADR-0038）
    const renamed = await req(member.cookie, `/api/v1/templates/${tpl.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: '学习计划 v2', ifUpdatedAt: tpl.updatedAt }),
    })
    expect(((await renamed.json()) as { name: string }).name).toBe('学习计划 v2')
    expect(
      (await req(member.cookie, '/api/v1/templates/builtin:bug-fix', { method: 'DELETE' })).status,
    ).toBe(403)
    expect(
      (await req(member.cookie, `/api/v1/templates/${tpl.id}`, { method: 'DELETE' })).status,
    ).toBe(204)
    expect((await req(member.cookie, `/api/v1/templates/${tpl.id}`)).status).toBe(404)
    // guest 不能建个人模板
    const g = await req(guest.cookie, '/api/v1/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'g', scope: 'personal', kind: 'note', body }),
    })
    expect(g.status).toBe(403)
  })

  it('REQ-TPL-006 成员可把模板共享到工作区：全员可见可用、只有作者与管理员可管；guest 不能共享；列表带作者名与 canShare', async () => {
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '共享正文' }] }],
    }
    const created = await req(member.cookie, '/api/v1/templates', {
      method: 'POST',
      body: JSON.stringify({ name: '成员共享', scope: 'workspace', kind: 'note', body }),
    })
    expect(created.status).toBe(201)
    const shared = (await created.json()) as { id: string; canManage: boolean; ownerName: string }
    expect(shared.canManage).toBe(true)
    expect(shared.ownerName).toBe('tpl-member')
    const asOwner = (await (await req(owner, '/api/v1/templates')).json()) as {
      items: { id: string; canManage: boolean; ownerName: string; source: string }[]
      canShare: boolean
    }
    const row = asOwner.items.find((t) => t.id === shared.id)
    expect(row).toMatchObject({ source: 'workspace', canManage: true, ownerName: 'tpl-member' })
    expect(asOwner.canShare).toBe(true)
    const asGuest = (await (await req(guest.cookie, '/api/v1/templates')).json()) as {
      items: { id: string; canManage: boolean }[]
      canShare: boolean
    }
    expect(asGuest.canShare).toBe(false)
    expect(asGuest.items.find((t) => t.id === shared.id)?.canManage).toBe(false)
    expect((await req(guest.cookie, `/api/v1/templates/${shared.id}`)).status).toBe(200)
    const g = await req(guest.cookie, '/api/v1/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'g', scope: 'workspace', kind: 'note', body }),
    })
    expect(g.status).toBe(403)
    // 个人 → 共享（改范围）也允许成员
    const mine = (await (
      await req(member.cookie, '/api/v1/templates', {
        method: 'POST',
        body: JSON.stringify({ name: '先个人', scope: 'personal', kind: 'note', body }),
      })
    ).json()) as { id: string; updatedAt: string }
    const up = await req(member.cookie, `/api/v1/templates/${mine.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ scope: 'workspace', ifUpdatedAt: mine.updatedAt }),
    })
    expect(((await up.json()) as { source: string }).source).toBe('workspace')
  })

  it('REQ-TPL-007 改模板正文 / 类型 / fields 带乐观锁：过期 ifUpdatedAt → 409；只改 kind 重置 fields；fields 按 kind 校验', async () => {
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'v1' }] }],
    }
    const t0 = (await (
      await req(member.cookie, '/api/v1/templates', {
        method: 'POST',
        body: JSON.stringify({ name: '可编辑', kind: 'note', body }),
      })
    ).json()) as { id: string; updatedAt: string }
    const v2 = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第二版' }] },
      ],
    }
    const ok = await req(member.cookie, `/api/v1/templates/${t0.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: v2, description: '改过', ifUpdatedAt: t0.updatedAt }),
    })
    expect(ok.status).toBe(200)
    const t1 = (await ok.json()) as { updatedAt: string; description: string }
    expect(t1.description).toBe('改过')
    const detail = (await (await req(member.cookie, `/api/v1/templates/${t0.id}`)).json()) as {
      body: { content: { type: string }[] }
    }
    expect(detail.body.content[0]?.type).toBe('heading')
    // 旧时间戳 → 409 CONFLICT_STALE
    const stale = await req(member.cookie, `/api/v1/templates/${t0.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: '覆盖', ifUpdatedAt: t0.updatedAt }),
    })
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as { code: string }).code).toBe('CONFLICT_STALE')
    // 缺 ifUpdatedAt → 422
    const noLock = await req(member.cookie, `/api/v1/templates/${t0.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: '无锁' }),
    })
    expect(noLock.status).toBe(422)
    // 只改 kind → fields 重置为 bug 默认
    const toBug = await req(member.cookie, `/api/v1/templates/${t0.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'bug', ifUpdatedAt: t1.updatedAt }),
    })
    const t2 = (await toBug.json()) as { kind: string; fields: object; updatedAt: string }
    expect(t2).toMatchObject({ kind: 'bug', fields: { severity: 'medium', status: 'new' } })
    // fields 按当前 kind 校验
    const bad = await req(member.cookie, `/api/v1/templates/${t0.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { severity: 'huge' }, ifUpdatedAt: t2.updatedAt }),
    })
    expect(bad.status).toBe(422)
  })

  it('REQ-TPL-008 复制到我的：内置与共享模板可复制成个人模板；看不到的模板 404；来源多选 422', async () => {
    const copy = await req(member.cookie, '/api/v1/templates', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bug 模板 副本', fromTemplateId: 'builtin:bug-fix' }),
    })
    expect(copy.status).toBe(201)
    const c = (await copy.json()) as { id: string; kind: string; source: string; ownerId: string }
    expect(c).toMatchObject({ kind: 'bug', source: 'personal', ownerId: member.userId })
    const d = (await (await req(member.cookie, `/api/v1/templates/${c.id}`)).json()) as {
      body: { content: unknown[] }
    }
    expect(d.body.content.length).toBeGreaterThan(5)
    const hidden = (await (
      await req(owner, '/api/v1/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: '私有',
          kind: 'note',
          body: { type: 'doc', content: [{ type: 'paragraph' }] },
        }),
      })
    ).json()) as { id: string }
    const denied = await req(member.cookie, '/api/v1/templates', {
      method: 'POST',
      body: JSON.stringify({ name: '偷', fromTemplateId: hidden.id }),
    })
    expect(denied.status).toBe(404)
    const both = await req(member.cookie, '/api/v1/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: 'x',
        kind: 'note',
        fromTemplateId: 'builtin:bug-fix',
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
      }),
    })
    expect(both.status).toBe(422)
  })

  it('REQ-TPL-009 取消共享或删除时清掉引用它的空间默认模板', async () => {
    const body = { type: 'doc', content: [{ type: 'paragraph' }] }
    const mk = async (name: string) =>
      (await (
        await req(owner, '/api/v1/templates', {
          method: 'POST',
          body: JSON.stringify({ name, scope: 'workspace', kind: 'note', body }),
        })
      ).json()) as { id: string; updatedAt: string }
    const a = await mk('默认 A')
    const b = await mk('默认 B')
    const mkSpace = async (slug: string, tplId: string) => {
      const created = await req(owner, '/api/v1/spaces', {
        method: 'POST',
        body: JSON.stringify({ name: slug, slug, kind: 'work' }),
      })
      expect(created.status, await created.clone().text()).toBe(201)
      const sp = (await created.json()) as { id: string; updatedAt: string }
      const r = await req(owner, `/api/v1/spaces/${sp.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ defaultTemplateId: tplId, ifUpdatedAt: sp.updatedAt }),
      })
      expect(r.status, await r.clone().text()).toBe(200)
      return sp
    }
    const sa = await mkSpace('tpl-default-a', a.id)
    const sb = await mkSpace('tpl-default-b', b.id)
    const listed = (await (await req(owner, '/api/v1/templates')).json()) as {
      items: { id: string; spaceDefaults: number }[]
    }
    expect(listed.items.find((t) => t.id === a.id)?.spaceDefaults).toBe(1)
    const unshare = await req(owner, `/api/v1/templates/${a.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ scope: 'personal', ifUpdatedAt: a.updatedAt }),
    })
    expect(unshare.status).toBe(200)
    const spA = (await (await req(owner, `/api/v1/spaces/${sa.id}`)).json()) as {
      defaultTemplateId: string | null
    }
    expect(spA.defaultTemplateId).toBeNull()
    expect((await req(owner, `/api/v1/templates/${b.id}`, { method: 'DELETE' })).status).toBe(204)
    const spB = (await (await req(owner, `/api/v1/spaces/${sb.id}`)).json()) as {
      defaultTemplateId: string | null
    }
    expect(spB.defaultTemplateId).toBeNull()
  })
})
