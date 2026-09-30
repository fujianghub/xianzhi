/** ADR-0038 内置模板由所有者维护：改 / 恢复默认（REQ-TPL-013）· 删 / 恢复（REQ-TPL-014）· 新增内置（REQ-TPL-015）。 */
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { YDOC_FRAGMENT } from '../../collab/derive.ts'
import { yElementToPm } from '../../shared/editor/unknown.ts'
import { getDb } from '../db/index.ts'
import { entries } from '../db/schema/business.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface Tpl {
  id: string
  source: string
  name: string
  kind: string
  canManage: boolean
  customized?: boolean
  deleted?: boolean
  updatedAt: string
  body?: { content?: { type: string; content?: { text?: string }[] }[] }
}

const doc = (title: string) => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] },
    { type: 'paragraph' },
  ],
})

async function headingsOf(id: string): Promise<string[]> {
  const [row] = await getDb().select({ ydoc: entries.ydoc }).from(entries).where(eq(entries.id, id))
  const d = new Y.Doc({ gc: false })
  Y.applyUpdate(d, row?.ydoc ?? new Uint8Array())
  const out = d
    .getXmlFragment(YDOC_FRAGMENT)
    .toArray()
    .map((n) => yElementToPm(n as never))
    .filter((n) => n.type === 'heading')
    .map((n) => (n.content ?? []).map((t) => t.text ?? '').join(''))
  d.destroy()
  return out
}

describe('builtin templates (owner-managed)', () => {
  let app: App
  let owner = ''
  let member = ''
  let spaceId = ''
  const req = (cookie: string, path: string, init: RequestInit = {}) =>
    app.request(`/api/v1${path}`, { ...init, headers: jsonHeaders({ cookie }) })
  const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T
  const get = (id: string, cookie = owner) => json<Tpl>(req(cookie, `/templates/${id}`))
  const list = async (cookie = owner, qs = '') =>
    (await json<{ items: Tpl[] }>(req(cookie, `/templates${qs}`))).items

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    owner = (await signIn(app, OWNER.email, OWNER.password)).cookie
    const inv = await req(owner, '/workspace/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'btm@xz.local', role: 'member' }),
    })
    const { id } = (await inv.json()) as { id: string }
    await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'btm@xz.local', name: 'btm', password: 'member-password-123' }),
    })
    member = (await signIn(app, 'btm@xz.local', 'member-password-123')).cookie
    const sp = await json<{ id: string }>(
      req(owner, '/spaces', {
        method: 'POST',
        body: JSON.stringify({ name: 'B', slug: 'bt-s', kind: 'project', visibility: 'workspace' }),
      }),
    )
    spaceId = sp.id
  })

  it('REQ-TPL-013 所有者改内置模板（名 / 正文）→ 列表 / 详情 / 新建记录都用改后的；成员 403；恢复默认回到代码版本', async () => {
    const before = await get('builtin:bug-fix')
    expect(before).toMatchObject({ canManage: true, customized: false })
    expect((await get('builtin:bug-fix', member)).canManage).toBe(false)
    const denied = await req(member, '/templates/builtin:bug-fix', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'x', ifUpdatedAt: before.updatedAt }),
    })
    expect(denied.status).toBe(403)
    const p = await req(owner, '/templates/builtin:bug-fix', {
      method: 'PATCH',
      body: JSON.stringify({
        name: '团队 Bug 模板',
        body: doc('现象'),
        ifUpdatedAt: before.updatedAt,
      }),
    })
    expect(p.status).toBe(200)
    const after = (await p.json()) as Tpl
    expect(after).toMatchObject({ name: '团队 Bug 模板', customized: true })
    // 乐观锁：旧 updatedAt → 409
    expect(
      (
        await req(owner, '/templates/builtin:bug-fix', {
          method: 'PATCH',
          body: JSON.stringify({ name: 'y', ifUpdatedAt: before.updatedAt }),
        })
      ).status,
    ).toBe(409)
    // 内置模板不能改成自定义类型 / 改共享范围
    expect(
      (
        await req(owner, '/templates/builtin:bug-fix', {
          method: 'PATCH',
          body: JSON.stringify({ scope: 'personal', ifUpdatedAt: after.updatedAt }),
        })
      ).status,
    ).toBe(422)
    expect((await list(member)).find((t) => t.id === 'builtin:bug-fix')?.name).toBe('团队 Bug 模板')
    const e = await json<{ id: string }>(
      req(member, '/entries', {
        method: 'POST',
        body: JSON.stringify({
          spaceId,
          kind: 'bug',
          title: 'b',
          fields: { status: 'new', severity: 'low' },
          templateId: 'builtin:bug-fix',
        }),
      }),
    )
    expect(await headingsOf(e.id)).toEqual(['现象'])
    // 恢复默认
    const reset = await json<Tpl>(
      req(owner, '/templates/builtin:bug-fix/reset', { method: 'POST' }),
    )
    expect(reset).toMatchObject({ customized: false })
    expect(reset.name).toBe(before.name)
    expect((await req(member, '/templates/builtin:bug-fix/reset', { method: 'POST' })).status).toBe(
      403,
    )
  })

  it('REQ-TPL-014 所有者删内置模板：列表隐藏、用它新建 422、清空空间默认；「已删除」可恢复（保留修改）', async () => {
    const t = await get('builtin:reading-note')
    await req(owner, '/templates/builtin:reading-note', {
      method: 'PATCH',
      body: JSON.stringify({ name: '读书卡', ifUpdatedAt: t.updatedAt }),
    })
    const sp = await json<{ updatedAt: string }>(req(owner, `/spaces/${spaceId}`))
    const setDefault = await req(owner, `/spaces/${spaceId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        defaultTemplateId: 'builtin:reading-note',
        ifUpdatedAt: sp.updatedAt,
      }),
    })
    expect(setDefault.status).toBe(200)
    expect(
      (await req(member, '/templates/builtin:reading-note', { method: 'DELETE' })).status,
    ).toBe(403)
    expect((await req(owner, '/templates/builtin:reading-note', { method: 'DELETE' })).status).toBe(
      204,
    )
    expect((await list(member)).some((t) => t.id === 'builtin:reading-note')).toBe(false)
    expect((await req(member, '/templates/builtin:reading-note')).status).toBe(404)
    const use = await req(member, '/entries', {
      method: 'POST',
      body: JSON.stringify({
        spaceId,
        kind: 'note',
        title: 'n',
        templateId: 'builtin:reading-note',
      }),
    })
    expect(use.status).toBe(422)
    const space = await json<{ defaultTemplateId: string | null }>(req(owner, `/spaces/${spaceId}`))
    expect(space.defaultTemplateId).toBeNull()
    // 已删除列表：仅所有者
    expect((await list(owner, '?deleted=1')).map((x) => x.id)).toEqual(['builtin:reading-note'])
    expect((await req(member, '/templates?deleted=1')).status).toBe(403)
    const restored = await json<Tpl>(
      req(owner, '/templates/builtin:reading-note/restore', { method: 'POST' }),
    )
    expect(restored).toMatchObject({ name: '读书卡', deleted: false, customized: true })
    expect((await list(member)).some((x) => x.id === 'builtin:reading-note')).toBe(true)
    await req(owner, '/templates/builtin:reading-note/reset', { method: 'POST' })
  })

  it('REQ-TPL-015 所有者可新增内置模板（全员可见、成员不能改删、可作空间默认）；成员不能新增', async () => {
    expect(
      (
        await req(member, '/templates', {
          method: 'POST',
          body: JSON.stringify({ name: 'x', scope: 'builtin', kind: 'note', body: doc('x') }),
        })
      ).status,
    ).toBe(403)
    const r = await req(owner, '/templates', {
      method: 'POST',
      body: JSON.stringify({ name: '周会纪要', scope: 'builtin', kind: 'note', body: doc('议题') }),
    })
    expect(r.status).toBe(201)
    const t = (await r.json()) as Tpl
    expect(t.source).toBe('builtin')
    const seen = (await list(member)).find((x) => x.id === t.id)
    expect(seen).toMatchObject({ source: 'builtin', canManage: false })
    expect(
      (
        await req(member, `/templates/${t.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: 'y', ifUpdatedAt: t.updatedAt }),
        })
      ).status,
    ).toBe(403)
    const sp = await json<{ updatedAt: string }>(req(owner, `/spaces/${spaceId}`))
    expect(
      (
        await req(owner, `/spaces/${spaceId}`, {
          method: 'PATCH',
          body: JSON.stringify({ defaultTemplateId: t.id, ifUpdatedAt: sp.updatedAt }),
        })
      ).status,
    ).toBe(200)
  })
})
