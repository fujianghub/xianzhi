/** T0-014 协同集成：Hocuspocus 真实监听 + HocuspocusProvider（Node ws）+ xz_test。 */
import { createServer } from 'node:net'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { and, eq, sql } from 'drizzle-orm'
import pino from 'pino'
import { v7 } from 'uuid'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { truncateAll } from '../../server/__tests__/db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from '../../server/__tests__/helpers.ts'
import { getDb } from '../../server/db/index.ts'
import { entries, events, spaceMembers, spaces } from '../../server/db/schema/business.ts'
import { signCollabToken } from '../../server/lib/collab-token.ts'
import { getEventBus } from '../../server/lib/event-bus.ts'
import { deriveFromYdoc, YDOC_FRAGMENT } from '../derive.ts'
import { createCollabServer, docNameOf, LIMITS } from '../server.ts'

const SECRET = process.env.COLLAB_TOKEN_SECRET as string
const ORIGIN = 'http://localhost:3010'
const db = () => getDb()
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean | Promise<boolean>, ms = 3000, label = ''): Promise<void> {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (await fn()) return
    await sleep(25)
  }
  throw new Error(`until: timeout ${label}`)
}

const originWs = (origin: string | null) =>
  class extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, origin ? { origin } : {})
    }
  }

interface Client {
  provider: HocuspocusProvider
  doc: Y.Doc
  state: {
    authenticated: boolean
    readOnly: boolean | null
    failed: string | null
    synced: boolean
    closedReason: string | null
  }
  destroy: () => void
}

let url = ''
function connect(
  entryId: string,
  token: string | null,
  origin: string | null = ORIGIN,
  docName = docNameOf(entryId),
): Client {
  const doc = new Y.Doc({ gc: false })
  const state: Client['state'] = {
    authenticated: false,
    readOnly: null,
    failed: null,
    synced: false,
    closedReason: null,
  }
  const ws = new HocuspocusProviderWebsocket({
    url,
    WebSocketPolyfill: originWs(origin),
    maxAttempts: 1,
  })
  const provider = new HocuspocusProvider({
    websocketProvider: ws,
    name: docName,
    token: token ?? '',
    document: doc,
    onAuthenticated: ({ scope }) => {
      state.authenticated = true
      state.readOnly = scope === 'readonly'
    },
    onAuthenticationFailed: ({ reason }) => {
      state.failed = reason
    },
    onSynced: () => {
      state.synced = true
    },
    onClose: ({ event }) => {
      if (event.reason) state.closedReason = event.reason
    },
  })
  provider.attach()
  return {
    provider,
    doc,
    state,
    destroy: () => {
      provider.destroy()
      ws.destroy()
    },
  }
}

const typeText = (doc: Y.Doc, text: string) => {
  const frag = doc.getXmlFragment(YDOC_FRAGMENT)
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText(text)])
  frag.insert(frag.length, [p])
}

describe('collab', () => {
  // 与服务层同一条总线：spaces / entries service 的 entry.access_changed 直达 collab（REQ-COLLAB-016）
  const bus = getEventBus()
  let collab: ReturnType<typeof createCollabServer>
  let failDerive = false
  const retries: string[] = []
  let app: ReturnType<typeof buildApp>['app']
  let ownerId = ''
  let ownerCookie = ''
  let workspaceId = ''
  let spaceId = ''
  let guestId = ''
  let noteId = ''
  let port = 0
  const clients: Client[] = []
  const open = (...a: Parameters<typeof connect>) => {
    const c = connect(...a)
    clients.push(c)
    return c
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    ownerId = r.userId
    workspaceId = r.workspaceId
    app = buildApp().app
    ownerCookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    spaceId = v7()
    await db().insert(spaces).values({
      id: spaceId,
      workspaceId,
      name: '协同',
      slug: 'collab',
      kind: 'project',
      visibility: 'workspace',
      sortKey: 'a1',
      createdBy: ownerId,
    })
    // guest，显式加入空间为 viewer
    const inv = await app.request('/api/v1/workspace/invitations', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ email: 'viewer@xz.local', role: 'guest' }),
    })
    const { id: invId } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${invId}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        email: 'viewer@xz.local',
        name: 'viewer',
        password: 'viewer-password-1',
      }),
    })
    guestId = ((await acc.json()) as { userId: string }).userId
    await db().insert(spaceMembers).values({ spaceId, userId: guestId, role: 'viewer' })
    const created = await app.request('/api/v1/entries', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ kind: 'note', title: '协同随笔', spaceId, visibility: 'workspace' }),
    })
    noteId = ((await created.json()) as { id: string }).id

    collab = createCollabServer({
      db: db(),
      bus,
      secret: SECRET,
      appUrl: ORIGIN,
      logger: pino({ level: process.env.XZ_COLLAB_LOG ?? 'silent' }),
      debounce: 50,
      maxDebounce: 200,
      enqueueRetry: async (id) => {
        retries.push(id)
      },
      derive: async (tx, id, ydoc) => {
        if (failDerive) throw new Error('boom: derive failed')
        const { writeEntryDerived } = await import('../../server/services/derived.ts')
        await writeEntryDerived(tx, id, ydoc)
      },
    })
    port = await freePort()
    await collab.server.listen(port)
    url = `ws://127.0.0.1:${port}/collab`
  })

  afterAll(async () => {
    for (const c of clients) c.destroy()
    await collab?.destroy()
  })

  it('REQ-COLLAB-002 POST /collab/token：可读 → 200 票据；不可见 → 404；未登录 401', async () => {
    const ok = await app.request('/api/v1/collab/token', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ entryId: noteId }),
    })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { token: string; expiresAt: string }
    expect(body.token.split('.')).toHaveLength(2)
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000)
    expect(
      (
        await app.request('/api/v1/collab/token', {
          method: 'POST',
          headers: jsonHeaders({ cookie: ownerCookie }),
          body: JSON.stringify({ entryId: v7() }),
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await app.request('/api/v1/collab/token', {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({ entryId: noteId }),
        })
      ).status,
    ).toBe(401)
  })

  it('REQ-COLLAB-002 无票据 / 错签名 / 过期 → 4401；错文档 / jti 重放 → 4409；错 Origin → 4403', async () => {
    const good = signCollabToken(SECRET, ownerId, noteId)
    const cases: [Client, string][] = [
      [open(noteId, null), '4401:no-token'],
      [
        open(
          noteId,
          signCollabToken('wrong-secret-wrong-secret-wrong-secret', ownerId, noteId).token,
        ),
        '4401:signature',
      ],
      [
        open(noteId, signCollabToken(SECRET, ownerId, noteId, Date.now() - 6 * 60 * 1000).token),
        '4401:expired',
      ],
      [open(noteId, signCollabToken(SECRET, ownerId, v7()).token), '4409:entry-mismatch'],
      [open(noteId, good.token, 'https://evil.example'), '4403:origin'],
    ]
    for (const [c, expected] of cases) {
      await until(() => c.state.failed !== null)
      expect(c.state.failed).toBe(expected)
      expect(c.state.authenticated).toBe(false)
    }
    const first = open(noteId, good.token)
    await until(() => first.state.synced)
    const replay = open(noteId, good.token)
    await until(() => replay.state.failed !== null)
    expect(replay.state.failed).toBe('4409:replay')
  })

  it('REQ-COLLAB-002 viewer 只读：scope=readonly，本地编辑不落库', async () => {
    const viewer = open(noteId, signCollabToken(SECRET, guestId, noteId).token)
    await until(() => viewer.state.synced)
    expect(viewer.state.readOnly).toBe(true)
    typeText(viewer.doc, 'viewer 写不进去')
    await sleep(400)
    const [row] = await db()
      .select({ ydoc: entries.ydoc })
      .from(entries)
      .where(eq(entries.id, noteId))
    expect(deriveFromYdoc(row?.ydoc ?? new Uint8Array()).plain).not.toContain('viewer 写不进去')
  })

  it('REQ-COLLAB-003 · 015 落库后 ydoc_version 递增、派生列与 ydoc 一致；entry.updated 5 分钟内合并为一行且不产生通知', async () => {
    const [before] = await db()
      .select({ v: entries.ydocVersion })
      .from(entries)
      .where(eq(entries.id, noteId))
    const c = open(noteId, signCollabToken(SECRET, ownerId, noteId).token)
    await until(() => c.state.synced)
    typeText(c.doc, '第一次编辑 衔枝')
    await until(async () =>
      (
        (await db().select({ p: entries.plain }).from(entries).where(eq(entries.id, noteId)))[0]
          ?.p ?? ''
      ).includes('第一次编辑'),
    )
    const [row] = await db().select().from(entries).where(eq(entries.id, noteId))
    if (!row) throw new Error('entry missing')
    expect(row.ydocVersion).toBeGreaterThan(before?.v ?? 0)
    const d = deriveFromYdoc(row.ydoc)
    expect(row.plain).toBe(d.plain)
    expect(row.pmJson).toEqual(d.pmJson)
    expect(row.wordCount).toBe(d.wordCount)
    expect(row.derivedError).toBeNull()
    const [tsv] = await db()
      .select({ t: sql<string>`${entries.tsv}::text` })
      .from(entries)
      .where(eq(entries.id, noteId))
    expect(tsv?.t).toContain("'枝'")
    typeText(c.doc, '第二次编辑')
    await until(async () =>
      (
        (await db().select({ p: entries.plain }).from(entries).where(eq(entries.id, noteId)))[0]
          ?.p ?? ''
      ).includes('第二次编辑'),
    )
    const ev = await db()
      .select()
      .from(events)
      .where(and(eq(events.kind, 'entry.updated'), eq(events.targetId, noteId)))
    expect(ev).toHaveLength(1)
    expect((ev[0]?.payload as { summary?: string } | undefined)?.summary).toContain('第二次编辑')
    expect(ev[0]?.actorId).toBe(ownerId)
    const { notifications } = await import('../../server/db/schema/business.ts')
    expect(await db().select().from(notifications)).toHaveLength(0)
  })

  it('REQ-COLLAB-009 派生抛错不阻塞：ydoc 照常落库、derived_error 写入；恢复后清空', async () => {
    const c = open(noteId, signCollabToken(SECRET, ownerId, noteId).token)
    await until(() => c.state.synced)
    failDerive = true
    const [before] = await db()
      .select({ v: entries.ydocVersion, at: entries.derivedAt })
      .from(entries)
      .where(eq(entries.id, noteId))
    typeText(c.doc, '派生会失败的这次')
    await until(
      async () =>
        ((
          await db().select({ v: entries.ydocVersion }).from(entries).where(eq(entries.id, noteId))
        )[0]?.v ?? 0) > (before?.v ?? 0),
      3000,
      'version',
    )
    const [row] = await db().select().from(entries).where(eq(entries.id, noteId))
    expect(row?.derivedError).toContain('boom')
    expect(row?.derivedAt?.toISOString()).toBe(before?.at?.toISOString()) // 失败不改 derived_at（01 §3.4：只记最后一次成功）
    expect(retries).toContain(noteId) // 入队 derive.retry
    expect(deriveFromYdoc(row?.ydoc ?? new Uint8Array()).plain).toContain('派生会失败的这次') // ydoc 已落库
    expect(row?.plain ?? '').not.toContain('派生会失败的这次') // 派生列未更新
    failDerive = false
    typeText(c.doc, '恢复')
    await until(
      async () => {
        const [r] = await db()
          .select({ e: entries.derivedError, p: entries.plain })
          .from(entries)
          .where(eq(entries.id, noteId))
        return r?.e === null && (r?.p ?? '').includes('恢复')
      },
      3000,
      'cleared',
    )
  })

  it('03 §6 模板：新建 decision 首次打开注入模板骨架（背景 / 候选方案表格 / 决定…）', async () => {
    const created = await app.request('/api/v1/entries', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({
        kind: 'decision',
        title: '选型',
        spaceId,
        fields: { status: 'proposed' },
      }),
    })
    const id = ((await created.json()) as { id: string }).id
    const c = open(id, signCollabToken(SECRET, ownerId, id).token)
    await until(() => c.state.synced)
    const frag = c.doc.getXmlFragment(YDOC_FRAGMENT)
    expect(frag.length).toBeGreaterThan(5)
    expect(frag.toString()).toContain('背景')
    expect(frag.toString()).toContain('<table>')
  })

  it('REQ-WS-004 user.revoked：该用户连接 1s 内以 4403 断开，其他人不受影响', async () => {
    const mine = open(noteId, signCollabToken(SECRET, guestId, noteId).token)
    const other = open(noteId, signCollabToken(SECRET, ownerId, noteId).token)
    await until(() => mine.state.synced && other.state.synced)
    const t = Date.now()
    bus.publish('user.revoked', { userId: guestId })
    await until(() => mine.state.closedReason !== null, 1000)
    expect(Date.now() - t).toBeLessThan(1000)
    expect(mine.state.closedReason).toBe('4403:revoked')
    expect(other.state.closedReason).toBeNull()
    expect(collab.connectionsOf(guestId)).toBe(0)
  })

  it('REQ-COLLAB-016 作者把记录改为 private：他人连接 1s 内 4403 断开，重取票据 404', async () => {
    const created = await app.request('/api/v1/entries', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ kind: 'note', title: '要收回的', spaceId, visibility: 'workspace' }),
    })
    const { id } = (await created.json()) as { id: string }
    const detail = (await (
      await app.request(`/api/v1/entries/${id}`, { headers: { cookie: ownerCookie } })
    ).json()) as { updatedAt: string }
    const viewer = open(id, signCollabToken(SECRET, guestId, id).token)
    const owner = open(id, signCollabToken(SECRET, ownerId, id).token)
    await until(() => viewer.state.synced && owner.state.synced)
    const t = Date.now()
    const r = await app.request(`/api/v1/entries/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ visibility: 'private', ifUpdatedAt: detail.updatedAt }),
    })
    expect(r.status).toBe(200)
    await until(() => viewer.state.closedReason !== null, 1000, 'viewer 4403')
    expect(Date.now() - t).toBeLessThan(1000)
    expect(viewer.state.closedReason).toBe('4403:access-revoked')
    expect(owner.state.closedReason).toBeNull()
    const guestCookie = (await signIn(app, 'viewer@xz.local', 'viewer-password-1')).cookie
    const tok = await app.request('/api/v1/collab/token', {
      method: 'POST',
      headers: jsonHeaders({ cookie: guestCookie }),
      body: JSON.stringify({ entryId: id }),
    })
    expect(tok.status).toBe(404)
  })

  it('REQ-COLLAB-016 移出空间：该成员的连接 1s 内 4403 断开', async () => {
    // members 可见空间 + 显式成员 member → 移出后失去读权限
    const sid = v7()
    await db().insert(spaces).values({
      id: sid,
      workspaceId,
      name: '临时',
      slug: 'tmp-collab',
      kind: 'work',
      visibility: 'members',
      sortKey: 'b1',
      createdBy: ownerId,
    })
    await db().insert(spaceMembers).values({ spaceId: sid, userId: ownerId, role: 'admin' })
    await app.request(`/api/v1/spaces/${sid}/members`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ userId: guestId, role: 'viewer' }),
    })
    const created = await app.request('/api/v1/entries', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ kind: 'note', title: '空间里的', spaceId: sid, visibility: 'space' }),
    })
    const { id } = (await created.json()) as { id: string }
    const viewer = open(id, signCollabToken(SECRET, guestId, id).token)
    await until(() => viewer.state.synced, 3000, 'synced')
    const t = Date.now()
    const r = await app.request(`/api/v1/spaces/${sid}/members/${guestId}`, {
      method: 'DELETE',
      headers: jsonHeaders({ cookie: ownerCookie }),
    })
    expect(r.status).toBe(204)
    await until(() => viewer.state.closedReason !== null, 1000, 'removed 4403')
    expect(Date.now() - t).toBeLessThan(1000)
    expect(viewer.state.closedReason).toBe('4403:access-revoked')
  })

  it('REQ-WS-014 admin 停用成员：该成员的协同连接 1s 内以 4403 断开；恢复后可重新取票', async () => {
    const id = noteId
    const viewer = open(id, signCollabToken(SECRET, guestId, id).token)
    await until(() => viewer.state.synced, 3000, 'synced')
    const t = Date.now()
    const r = await app.request(`/api/v1/workspace/members/${guestId}/suspend`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({}),
    })
    expect(r.status).toBe(204)
    await until(() => viewer.state.closedReason !== null, 1000, 'suspended 4403')
    expect(Date.now() - t).toBeLessThan(1000)
    expect(viewer.state.closedReason).toBe('4403:revoked')
    expect(
      (
        await app.request(`/api/v1/workspace/members/${guestId}/unsuspend`, {
          method: 'POST',
          headers: jsonHeaders({ cookie: ownerCookie }),
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(204)
    const guestCookie = (await signIn(app, 'viewer@xz.local', 'viewer-password-1')).cookie
    const tok = await app.request('/api/v1/collab/token', {
      method: 'POST',
      headers: jsonHeaders({ cookie: guestCookie }),
      body: JSON.stringify({ entryId: id }),
    })
    expect(tok.status).toBe(200)
  })

  it('07 §5 每用户并发连接 ≤ 10：第 11 条 → 4429', async () => {
    for (const c of clients.splice(0)) c.destroy()
    await until(() => collab.connectionsOf(ownerId) === 0)
    const ten = Array.from({ length: LIMITS.maxConnectionsPerUser }, () =>
      open(noteId, signCollabToken(SECRET, ownerId, noteId).token),
    )
    await until(() => ten.every((c) => c.state.authenticated), 5000)
    const eleventh = open(noteId, signCollabToken(SECRET, ownerId, noteId).token)
    await until(() => eleventh.state.failed !== null)
    expect(eleventh.state.failed).toBe('4429:too-many-connections')
    for (const c of clients.splice(0)) c.destroy()
  })

  it('07 §5 单条 update > 2 MB → 4413 断开', async () => {
    const c = open(noteId, signCollabToken(SECRET, ownerId, noteId).token)
    await until(() => c.state.synced)
    typeText(c.doc, 'x'.repeat(LIMITS.maxUpdateBytes + 1024))
    await until(() => c.state.closedReason !== null)
    expect(c.state.closedReason).toBe('4413:update-too-large')
  })

  it('REQ-EDITOR-017 硬限：文档已接近上限时再写入 → 4413 document-too-large 断开（客户端转只读）', async () => {
    // 阈值是配置项（20MB）；测试把它临时调到 64KB，避免在测试里同步 20MB 文档
    const limits = LIMITS as { maxDocBytes: number }
    const orig = limits.maxDocBytes
    limits.maxDocBytes = 64 * 1024
    try {
      const big = new Y.Doc({ gc: false })
      const frag = big.getXmlFragment(YDOC_FRAGMENT)
      const p = new Y.XmlElement('paragraph')
      p.insert(0, [new Y.XmlText('y'.repeat(50 * 1024))])
      frag.insert(0, [p])
      const [row] = await db()
        .insert(entries)
        .values({
          workspaceId,
          spaceId,
          kind: 'note',
          title: '接近上限',
          authorId: ownerId,
          visibility: 'workspace',
          ydoc: Buffer.from(Y.encodeStateAsUpdate(big)),
        })
        .returning({ id: entries.id })
      const id = row?.id as string
      const c = open(id, signCollabToken(SECRET, ownerId, id).token)
      await until(() => c.state.synced)
      typeText(c.doc, 'z'.repeat(20 * 1024)) // 单条远小于 2MB，但累计超过上限
      await until(() => c.state.closedReason !== null)
      expect(c.state.closedReason).toBe('4413:document-too-large')
    } finally {
      limits.maxDocBytes = orig
    }
  })

  it('REQ-COLLAB-007 真实 onStoreDocument 路径：跨过第 50 次落库自动生成快照', async () => {
    const { entrySnapshots } = await import('../../server/db/schema/business.ts')
    await db().update(entries).set({ ydocVersion: 48 }).where(eq(entries.id, noteId))
    await db().delete(entrySnapshots).where(eq(entrySnapshots.entryId, noteId))
    const c = open(noteId, signCollabToken(SECRET, ownerId, noteId).token)
    await until(() => c.state.synced)
    for (const t of ['a', 'b', 'c']) {
      typeText(c.doc, `快照触发 ${t}`)
      await sleep(350)
    }
    await until(
      async () =>
        (await db().select().from(entrySnapshots).where(eq(entrySnapshots.entryId, noteId)))
          .length === 1,
      3000,
      'snapshot',
    )
    const [s] = await db().select().from(entrySnapshots).where(eq(entrySnapshots.entryId, noteId))
    expect(s?.ydocVersion).toBe(50)
  })

  it('REQ-COLLAB-014 加载旧 schema 版本文档时 bump editor_schema_version', async () => {
    const { EDITOR_SCHEMA_VERSION } = await import('../derive.ts')
    const created = await app.request('/api/v1/entries', {
      method: 'POST',
      headers: jsonHeaders({ cookie: ownerCookie }),
      body: JSON.stringify({ kind: 'note', title: '旧版本', spaceId }),
    })
    const id = ((await created.json()) as { id: string }).id
    await db().update(entries).set({ editorSchemaVersion: 0 }).where(eq(entries.id, id))
    const c = open(id, signCollabToken(SECRET, ownerId, id).token)
    await until(() => c.state.synced)
    const [row] = await db()
      .select({ v: entries.editorSchemaVersion })
      .from(entries)
      .where(eq(entries.id, id))
    expect(row?.v).toBe(EDITOR_SCHEMA_VERSION)
  })

  it('/collab/health 公开只回 ok', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/collab/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
