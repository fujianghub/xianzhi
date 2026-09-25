/** REQ-LINK-001 ~ 003（ADR-0012 §4：Bug ↔ 迭代 resolves、反链、mentions 同步）。 */
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { ydocFromPm } from '../../collab/ydoc-json.ts'
import { getDb } from '../db/index.ts'
import { entries, links } from '../db/schema/business.ts'
import { writeEntryDerived } from '../services/derived.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
interface LinkView {
  id: string
  kind: string
  from: { id: string; title: string }
  to: { id: string; title: string }
}

async function join(app: App, ownerCookie: string, email: string) {
  const inv = await app.request('/api/v1/workspace/invitations', {
    method: 'POST',
    headers: jsonHeaders({ cookie: ownerCookie }),
    body: JSON.stringify({ email, role: 'member' }),
  })
  const { id } = (await inv.json()) as { id: string }
  await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, name: 'm', password: 'member-password-123' }),
  })
  return (await signIn(app, email, 'member-password-123')).cookie
}

describe('links', () => {
  let app: App
  let owner = ''
  let member = ''
  let bug = ''
  let iteration = ''
  let secret = ''
  const req = (cookie: string, path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: jsonHeaders({ cookie }) })
  const create = async (cookie: string, body: Record<string, unknown>) => {
    const r = await req(cookie, '/api/v1/entries', { method: 'POST', body: JSON.stringify(body) })
    expect(r.status, await r.clone().text()).toBe(201)
    return ((await r.json()) as { id: string }).id
  }

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    owner = (await signIn(app, OWNER.email, OWNER.password)).cookie
    member = await join(app, owner, 'link-member@xz.local')
    const s = await req(owner, '/api/v1/spaces', {
      method: 'POST',
      body: JSON.stringify({ name: '简斋', slug: 'jianzhai-kb', kind: 'project' }),
    })
    const spaceId = ((await s.json()) as { id: string }).id
    bug = await create(owner, {
      kind: 'bug',
      title: 'PDF 渲染空白',
      spaceId,
      visibility: 'workspace',
      fields: { severity: 'high', status: 'open' },
    })
    iteration = await create(owner, {
      kind: 'iteration',
      title: 'v0.9 迭代',
      spaceId,
      visibility: 'workspace',
      fields: { periodStart: '2026-09-20', periodEnd: '2026-09-26' },
    })
    secret = await create(owner, { kind: 'note', title: '私人随笔' }) // 个人空间 private
  })

  it('REQ-LINK-003 迭代 resolves Bug：出链 / 反链可见；重复 409；mentions 不可手建', async () => {
    const body = {
      fromType: 'entry',
      fromId: iteration,
      toType: 'entry',
      toId: bug,
      kind: 'resolves',
    }
    const r = await req(owner, '/api/v1/links', { method: 'POST', body: JSON.stringify(body) })
    expect(r.status).toBe(201)
    const dup = await req(owner, '/api/v1/links', { method: 'POST', body: JSON.stringify(body) })
    expect(dup.status).toBe(409)
    const out = (await (
      await req(owner, `/api/v1/links?fromType=entry&fromId=${iteration}`)
    ).json()) as { items: LinkView[] }
    expect(out.items.map((l) => [l.kind, l.to.title])).toEqual([['resolves', 'PDF 渲染空白']])
    const back = (await (await req(member, `/api/v1/entries/${bug}/backlinks`)).json()) as {
      items: LinkView[]
    }
    expect(back.items.map((l) => [l.kind, l.from.title])).toEqual([['resolves', 'v0.9 迭代']])
    const m = await req(owner, '/api/v1/links', {
      method: 'POST',
      body: JSON.stringify({ ...body, kind: 'mentions' }),
    })
    expect(m.status).toBe(422)
  })

  it('REQ-LINK-002 反链按 can(read) 过滤：私有随笔链接到 Bug，他人看不到这条反链', async () => {
    await req(owner, '/api/v1/links', {
      method: 'POST',
      body: JSON.stringify({
        fromType: 'entry',
        fromId: secret,
        toType: 'entry',
        toId: bug,
        kind: 'relates',
      }),
    })
    const mine = (await (await req(owner, `/api/v1/entries/${bug}/backlinks`)).json()) as {
      items: LinkView[]
    }
    expect(mine.items.map((l) => l.from.title).sort()).toEqual(['v0.9 迭代', '私人随笔'].sort())
    const theirs = (await (await req(member, `/api/v1/entries/${bug}/backlinks`)).json()) as {
      items: LinkView[]
    }
    expect(theirs.items.map((l) => l.from.title)).toEqual(['v0.9 迭代'])
  })

  it('REQ-LINK-001 正文 entryLink / entryCard 派生为 mentions；移除后行消失；mentions 不可手删', async () => {
    const doc = (targets: { link?: string; card?: string }) => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '见 ' },
            ...(targets.link
              ? [{ type: 'entryLink', attrs: { id: targets.link, title: 'x' } }]
              : []),
          ],
        },
        ...(targets.card ? [{ type: 'entryCard', attrs: { entryId: targets.card } }] : []),
      ],
    })
    const y = ydocFromPm(doc({ link: bug, card: iteration }) as never)
    await getDb().update(entries).set({ ydoc: y }).where(eq(entries.id, secret))
    await writeEntryDerived(getDb(), secret, y)
    const rows = await getDb().select().from(links).where(eq(links.fromId, secret))
    expect(
      rows
        .filter((r) => r.kind === 'mentions')
        .map((r) => r.toId)
        .sort(),
    ).toEqual([bug, iteration].sort())
    const m = rows.find((r) => r.kind === 'mentions')
    expect((await req(owner, `/api/v1/links/${m?.id}`, { method: 'DELETE' })).status).toBe(403)
    const y2 = ydocFromPm(doc({ link: bug }) as never)
    await writeEntryDerived(getDb(), secret, y2)
    const after = await getDb().select().from(links).where(eq(links.fromId, secret))
    expect(after.filter((r) => r.kind === 'mentions').map((r) => r.toId)).toEqual([bug])
    // 手动 relates 仍在
    expect(after.some((r) => r.kind === 'relates')).toBe(true)
  })

  it('REQ-LINK-003 删除手动链接：member 对两端都不可写 → 403；owner 204', async () => {
    const out = (await (
      await req(owner, `/api/v1/links?fromType=entry&fromId=${iteration}`)
    ).json()) as { items: LinkView[] }
    const id = out.items[0]?.id
    expect((await req(member, `/api/v1/links/${id}`, { method: 'DELETE' })).status).toBe(403)
    expect((await req(owner, `/api/v1/links/${id}`, { method: 'DELETE' })).status).toBe(204)
  })
})
