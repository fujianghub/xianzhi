/** ADR-0054 §C：复制记录（REQ-ENTRY-038）。 */
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { deriveFromYdoc } from '../../collab/derive.ts'
import { ydocFromPm } from '../../collab/ydoc-json.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { entries } from '../db/schema/business.ts'
import { attachmentIdsOf, rewriteForCopy } from '../services/entry-duplicate.ts'
import { db, truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface EntryV {
  id: string
  title: string
  kind: string
  typeId: string | null
  spaceId: string
  visibility: string
  fields: Record<string, unknown>
  tagIds?: string[]
  parentId: string | null
  treeOrder: string | null
  excerpt?: string
}

const png = (color: string) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
    .png()
    .toBuffer()

describe('REQ-ENTRY-038 duplicate entry', () => {
  let app: App
  let owner = ''
  let member = ''
  let spaceId = ''
  let otherSpaceId = ''
  let personalId = ''
  const req = (cookie: string, method: string, path: string, body?: unknown, extra = {}) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie, ...extra }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const dup = (cookie: string, id: string, body: Record<string, unknown> = {}) =>
    req(cookie, 'POST', `/entries/${id}/duplicate`, body, {
      'idempotency-key': crypto.randomUUID(),
    })
  const json = async <T>(r: Response) => (await r.json()) as T
  const get = async (id: string) => json<EntryV>(await req(owner, 'GET', `/entries/${id}`))
  const upload = async (cookie: string, bytes: Buffer, entryId: string) => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(bytes)], 'p.png'))
    fd.append('targetType', 'entry')
    fd.append('targetId', entryId)
    const { 'content-type': _ct, ...h } = jsonHeaders({ cookie })
    const r = await app.request('/api/v1/attachments', { method: 'POST', headers: h, body: fd })
    expect(r.status).toBeLessThan(300)
    return ((await r.json()) as { id: string }).id
  }
  const setBody = (id: string, doc: PmNode) =>
    db()
      .update(entries)
      .set({ ydoc: ydocFromPm(doc), ydocVersion: 3 })
      .where(eq(entries.id, id))
  const bodyOf = async (id: string) => {
    const [r] = await db().select({ ydoc: entries.ydoc }).from(entries).where(eq(entries.id, id))
    return r ? deriveFromYdoc(r.ydoc).pmJson : null
  }

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    owner = (await signIn(app, OWNER.email, OWNER.password)).cookie
    const inv = await req(owner, 'POST', '/workspace/invitations', {
      email: 'dup-m@xz.local',
      role: 'member',
    })
    const { id } = await json<{ id: string }>(inv)
    await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'dup-m@xz.local', name: 'm', password: 'dup-password-1' }),
    })
    member = (await signIn(app, 'dup-m@xz.local', 'dup-password-1')).cookie
    const mk = async (slug: string, visibility: string) =>
      (
        await json<{ id: string }>(
          await req(owner, 'POST', '/spaces', { name: slug, slug, kind: 'project', visibility }),
        )
      ).id
    spaceId = await mk('dup-a', 'workspace')
    otherSpaceId = await mk('dup-b', 'members')
    const spaces = await json<{ items: { id: string; isPersonal: boolean }[] }>(
      await req(owner, 'GET', '/spaces'),
    )
    personalId = spaces.items.find((s) => s.isPersonal)?.id ?? ''
  })

  it('REQ-ENTRY-038 原地复制：紧跟在源之后、带属性 / 自己的标签 / 正文（去评论标记）、派生列已写、源不变', async () => {
    const tag = await json<{ id: string }>(
      await req(
        owner,
        'POST',
        '/tags',
        { name: 'dup-tag', color: 'blue' },
        { 'idempotency-key': crypto.randomUUID() },
      ),
    )
    const mk = async (title: string, extra: Record<string, unknown> = {}) => {
      const r = await req(
        owner,
        'POST',
        '/entries',
        { kind: 'bug', spaceId, title, parentId: null, ...extra },
        { 'idempotency-key': crypto.randomUUID() },
      )
      return (await json<{ id: string }>(r)).id
    }
    const a = await mk('源 Bug', { fields: { status: 'new', severity: 'high' }, tagIds: [tag.id] })
    const next = await mk('下一个', { kind: 'note' })
    await setBody(a, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '复现步骤 ' },
            {
              type: 'text',
              text: '带评论',
              marks: [{ type: 'comment', attrs: { threadId: 't1' } }],
            },
          ],
        },
      ],
    })
    const r = await dup(owner, a)
    expect(r.status).toBe(201)
    const copy = await get((await json<{ id: string }>(r)).id)
    const src = await get(a)
    expect(copy.title).toBe('源 Bug 副本')
    expect(copy.kind).toBe('bug')
    expect(copy.fields.severity).toBe('high')
    expect(copy.tagIds).toEqual([tag.id])
    expect(copy.parentId).toBeNull()
    const nextRow = await get(next)
    expect(copy.treeOrder && src.treeOrder && nextRow.treeOrder).toBeTruthy()
    expect((copy.treeOrder ?? '') > (src.treeOrder ?? '')).toBe(true)
    expect((copy.treeOrder ?? '') < (nextRow.treeOrder ?? '')).toBe(true)
    const body = JSON.stringify(await bodyOf(copy.id))
    expect(body).toContain('复现步骤')
    expect(body).toContain('带评论')
    expect(body).not.toContain('"comment"')
    // 派生列同事务写：列表摘要立即有正文
    const list = await json<{ items: EntryV[] }>(
      await req(owner, 'GET', `/entries?spaceId=${spaceId}&q=${encodeURIComponent('复现步骤')}`),
    )
    expect(list.items.some((e) => e.id === copy.id)).toBe(true)
    // 源正文不受影响（仍带评论标记）
    expect(JSON.stringify(await bodyOf(a))).toContain('"comment"')
  })

  it('REQ-ENTRY-038 附件另存一份：副本引用新附件；源被彻底删除后副本图片仍可读', async () => {
    const a = (
      await json<{ id: string }>(
        await req(
          owner,
          'POST',
          '/entries',
          { kind: 'note', spaceId, title: '带图' },
          { 'idempotency-key': crypto.randomUUID() },
        ),
      )
    ).id
    const att = await upload(owner, await png('#a35'), a)
    await setBody(a, {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: `xz:attachment/${att}`, alt: 'x' } }],
    })
    const copyId = (await json<{ id: string }>(await dup(owner, a, { title: '带图 2' }))).id
    const ids = attachmentIdsOf(await bodyOf(copyId))
    expect(ids).toHaveLength(1)
    expect(ids[0]).not.toBe(att)
    // 彻底删除源（软删 → 永久删）
    expect((await req(owner, 'DELETE', `/entries/${a}`)).status).toBe(204)
    expect((await req(owner, 'DELETE', `/entries/${a}?permanent=1`)).status).toBe(204)
    const img = await app.request(`/api/v1/attachments/${ids[0]}`, {
      headers: { cookie: owner },
    })
    expect(img.status).toBe(200)
    expect((await get(copyId)).title).toBe('带图 2')
  })

  it('REQ-ENTRY-038 复制到个人空间 = 仅自己、不进目录；到别的空间放到所给父页下', async () => {
    const a = (
      await json<{ id: string }>(
        await req(
          owner,
          'POST',
          '/entries',
          { kind: 'note', spaceId, title: '要搬的', parentId: null },
          { 'idempotency-key': crypto.randomUUID() },
        ),
      )
    ).id
    const p = await json<EntryV>(
      await req(
        owner,
        'GET',
        `/entries/${(await json<{ id: string }>(await dup(owner, a, { spaceId: personalId }))).id}`,
      ),
    )
    expect(p.spaceId).toBe(personalId)
    expect(p.visibility).toBe('private')
    expect(p.treeOrder).toBeNull()

    const parent = (
      await json<{ id: string }>(
        await req(
          owner,
          'POST',
          '/entries',
          { kind: 'note', spaceId: otherSpaceId, title: '父页', parentId: null },
          { 'idempotency-key': crypto.randomUUID() },
        ),
      )
    ).id
    const c = await get(
      (await json<{ id: string }>(await dup(owner, a, { spaceId: otherSpaceId, parentId: parent })))
        .id,
    )
    expect(c.spaceId).toBe(otherSpaceId)
    expect(c.parentId).toBe(parent)
    // detach 与 parentId 同给 → 422
    expect((await dup(owner, a, { detach: true, parentId: null })).status).toBe(422)
  })

  it('REQ-ENTRY-038 权限：源不可读 404；目标空间不可建 403 且不落库', async () => {
    const secret = (
      await json<{ id: string }>(
        await req(
          owner,
          'POST',
          '/entries',
          { kind: 'note', spaceId: otherSpaceId, title: '秘密' },
          { 'idempotency-key': crypto.randomUUID() },
        ),
      )
    ).id
    expect((await dup(member, secret)).status).toBe(404)
    const open = (
      await json<{ id: string }>(
        await req(
          owner,
          'POST',
          '/entries',
          { kind: 'note', spaceId, title: '公开' },
          { 'idempotency-key': crypto.randomUUID() },
        ),
      )
    ).id
    // 成员不是 dup-b 的成员：到那里建 → 404（空间不可见）
    expect((await dup(member, open, { spaceId: otherSpaceId })).status).toBe(404)
    // 只读成员：能读、不能在该空间建 → 403 且不落库
    const ro = (
      await json<{ id: string }>(
        await req(owner, 'POST', '/spaces', {
          name: 'ro',
          slug: 'dup-ro',
          kind: 'project',
          visibility: 'members',
        }),
      )
    ).id
    const me = await json<{ id: string }>(await req(member, 'GET', '/me'))
    expect(
      (await req(owner, 'POST', `/spaces/${ro}/members`, { userId: me.id, role: 'viewer' })).status,
    ).toBeLessThan(300)
    const roEntry = (
      await json<{ id: string }>(
        await req(
          owner,
          'POST',
          '/entries',
          { kind: 'note', spaceId: ro, title: '只读处' },
          { 'idempotency-key': crypto.randomUUID() },
        ),
      )
    ).id
    const count = async () =>
      (await json<{ items: unknown[] }>(await req(owner, 'GET', `/entries?spaceId=${ro}`))).items
        .length
    const before = await count()
    expect((await dup(member, roEntry)).status).toBe(403)
    expect(await count()).toBe(before)
    // 复制到自己的个人空间可以（能读即可复制）
    const mine = await json<{ items: { id: string; isPersonal: boolean }[] }>(
      await req(member, 'GET', '/spaces'),
    )
    const mp = mine.items.find((s) => s.isPersonal)?.id
    const ok = await dup(member, roEntry, { spaceId: mp })
    expect(ok.status).toBe(201)
    const mineCopy = await json<EntryV>(
      await req(member, 'GET', `/entries/${(await json<{ id: string }>(ok)).id}`),
    )
    expect(mineCopy.visibility).toBe('private')
  })

  it('REQ-ENTRY-038 rewriteForCopy：改写图片 src 与文件 attachmentId、去掉评论标记', () => {
    const old = '11111111-1111-4111-8111-111111111111'
    const nu = '22222222-2222-4222-8222-222222222222'
    const doc: PmNode = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: `xz:attachment/${old}` } },
        { type: 'fileAttachment', attrs: { attachmentId: old, name: 'a.pdf' } },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'comment' }, { type: 'bold' }] }],
        },
      ],
    }
    expect(attachmentIdsOf(doc)).toEqual([old])
    const out = rewriteForCopy(doc, new Map([[old, nu]]))
    expect(JSON.stringify(out)).not.toContain(old)
    expect(attachmentIdsOf(out)).toEqual([nu])
    expect(out.content?.[2]?.content?.[0]?.marks).toEqual([{ type: 'bold' }])
  })
})
