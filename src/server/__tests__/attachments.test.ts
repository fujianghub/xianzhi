/** T1-020 附件（REQ-ATTACH-001 ~ 011 · REQ-OPS-008，api / unit）。 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { getAuth } from '../auth.ts'
import { getDb } from '../db/index.ts'
import { user as userTable } from '../db/schema/auth.ts'
import { attachments } from '../db/schema/business.ts'
import { getEnv } from '../env.ts'
import { gcAttachments } from '../jobs/gc.ts'
import { dataPath } from '../lib/files.ts'
import { sniffMime } from '../lib/sniff.ts'
import { truncateAll } from './db.ts'
import {
  buildApp,
  captureLogger,
  jsonHeaders,
  ORIGIN,
  OWNER,
  problemOf,
  seedOwner,
  signIn,
} from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface A {
  id: string
  url: string
  mime: string
  size: number
  width: number | null
  height: number | null
  blurhash: string | null
  variants: { thumb?: string; md?: string }
  image?: string
}
const DATA = getEnv().DATA_DIR
const png = (w: number, h: number, color = '#3a7') =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .png()
    .toBuffer()
const countUploads = () => {
  const root = dataPath(DATA, 'uploads')
  if (!existsSync(root)) return 0
  let n = 0
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }))
      e.isDirectory() ? walk(join(d, e.name)) : n++
  }
  walk(root)
  return n
}

describe('T1-020 attachments', () => {
  let app: App
  const u: Record<'owner' | 'member' | 'member2', U> = {} as never
  let workspaceId = ''
  let spaceId = ''
  let secretId = ''

  const up = (
    who: U,
    bytes: Uint8Array | Buffer,
    name: string,
    fields: Record<string, string> = {},
    path = '/attachments',
  ) => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(bytes)], name))
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    const { 'content-type': _ct, ...h } = jsonHeaders({ cookie: who.cookie })
    return app.request(`/api/v1${path}`, { method: 'POST', headers: h, body: fd })
  }
  const get = (who: U, path: string, headers: Record<string, string> = {}) =>
    app.request(path, { headers: { cookie: who.cookie, ...headers } })
  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  async function invite(email: string): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role: 'member' })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'att-password-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'att-password-1')).cookie }
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    workspaceId = r.workspaceId
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('am@xz.local')
    u.member2 = await invite('am2@xz.local')
    const s = await req(u.owner, 'POST', '/spaces', { name: 'A', slug: 'att', kind: 'work' })
    spaceId = ((await s.json()) as { id: string }).id
    const s2 = await req(u.owner, 'POST', '/spaces', {
      name: 'S',
      slug: 'att-secret',
      kind: 'work',
      visibility: 'members',
    })
    secretId = ((await s2.json()) as { id: string }).id
  })

  it('sniffMime：按魔数识别，不信扩展名；HTML 伪装 / 可执行文件 → null', () => {
    const b = (s: string) => new TextEncoder().encode(s)
    expect(sniffMime(b('%PDF-1.7\n...'))).toBe('application/pdf')
    expect(sniffMime(b('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(
      'image/svg+xml',
    )
    expect(sniffMime(b('<!doctype html><script>alert(1)</script>'), 'x.png')).toBeNull()
    expect(sniffMime(new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0]), 'a.exe')).toBeNull()
    expect(sniffMime(b('# 标题\n正文'), 'readme.md')).toBe('text/markdown')
    expect(sniffMime(b('{"a":1}'))).toBe('application/json')
  })

  it('REQ-ATTACH-012 Office 按 zip 内部件识别（不信扩展名）；csv 按扩展名细分文本；代码文件为 text/plain', () => {
    const zip = (...names: string[]) =>
      new Uint8Array(
        Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(names.join('\0'))]),
      )
    expect(sniffMime(zip('[Content_Types].xml', 'word/document.xml'), 'a.zip')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(sniffMime(zip('[Content_Types].xml', 'xl/workbook.xml'))).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(sniffMime(zip('[Content_Types].xml', 'ppt/presentation.xml'))).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
    // 改名成 .docx 的普通 zip 仍是 zip
    expect(sniffMime(zip('a.txt'), 'fake.docx')).toBe('application/zip')
    const b = (s: string) => new TextEncoder().encode(s)
    expect(sniffMime(b('a,b\n1,2\n'), 'data.csv')).toBe('text/csv')
    expect(sniffMime(b('fn main() {}\n'), 'main.rs')).toBe('text/plain')
  })

  it('REQ-ATTACH-001 21MB PNG → 413；.exe 或伪装成 .png 的 HTML → 415 且磁盘无残留', async () => {
    const head = await png(4, 4)
    const big = Buffer.concat([head, Buffer.alloc(21 * 1024 * 1024)])
    const before = countUploads()
    const r = await up(u.owner, big, 'big.png')
    expect(r.status).toBe(413)
    expect((await problemOf(r)).code).toBe('PAYLOAD_TOO_LARGE')
    const exe = await up(u.owner, new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), 'setup.exe')
    expect(exe.status).toBe(415)
    expect((await problemOf(exe)).code).toBe('UNSUPPORTED_MEDIA')
    const html = await up(
      u.owner,
      new TextEncoder().encode('<html><body><script>x()</script></body></html>'),
      'cat.png',
    )
    expect(html.status).toBe(415)
    expect(countUploads()).toBe(before)
  })

  it('REQ-ATTACH-002 同人同文件两次 → 201 同 id、磁盘 1 份；两个用户上传同文件 → 两条行', async () => {
    const bytes = await png(20, 20, '#123456')
    const before = countUploads()
    const a = (await (await up(u.member, bytes, 'a.png')).json()) as A
    const b = await up(u.member, bytes, 'again.png')
    expect(b.status).toBe(201)
    expect(((await b.json()) as A).id).toBe(a.id)
    expect(countUploads()).toBe(before + 3) // 原件 + thumb + md
    const c = (await (await up(u.member2, bytes, 'b.png')).json()) as A
    expect(c.id).not.toBe(a.id)
    const rows = await db()
      .select()
      .from(attachments)
      .where(
        eq(
          attachments.sha256,
          (await db().select().from(attachments).where(eq(attachments.id, a.id)))[0]?.sha256 ?? '',
        ),
      )
    expect(rows).toHaveLength(2)
  })

  it('REQ-ATTACH-003 下载跟随 target 鉴权：无权 404；Range 206 长度 100；ETag → 304；Cache-Control private', async () => {
    const t = await req(u.owner, 'POST', '/tasks', { title: '带图', spaceId: secretId })
    const taskId = ((await t.json()) as { id: string }).id
    const bytes = new TextEncoder().encode('x'.repeat(1000))
    const r = await up(u.owner, bytes, 'notes.txt', { targetType: 'task', targetId: taskId })
    expect(r.status).toBe(201)
    const a = (await r.json()) as A
    expect((await get(u.member, a.url)).status).toBe(404)
    const full = await get(u.owner, a.url)
    expect(full.status).toBe(200)
    expect(full.headers.get('cache-control')).toBe('private, max-age=86400')
    const etag = full.headers.get('etag') ?? ''
    expect(etag).toMatch(/^".+"$/)
    const part = await get(u.owner, a.url, { range: 'bytes=0-99' })
    expect(part.status).toBe(206)
    expect((await part.arrayBuffer()).byteLength).toBe(100)
    expect(part.headers.get('content-range')).toBe('bytes 0-99/1000')
    expect((await get(u.owner, a.url, { 'if-none-match': etag })).status).toBe(304)
    const dl = await get(u.owner, `${a.url}?download=1`)
    expect(dl.headers.get('content-disposition')).toContain("filename*=UTF-8''notes.txt")
    // 给别人的任务挂附件：无写权限 → 404 / 403
    expect(
      (await up(u.member, bytes, 'x.txt', { targetType: 'task', targetId: taskId })).status,
    ).toBe(404)
  })

  it('REQ-ATTACH-004 4000px 图 → variants.md，/md 宽 1280、/thumb 宽 320，带 blurhash 与宽高', async () => {
    const bytes = await sharp({
      create: { width: 4000, height: 2000, channels: 3, background: '#ab4' },
    })
      .jpeg()
      .toBuffer()
    const r = await up(u.owner, bytes, 'wide.jpg')
    expect(r.status).toBe(201)
    const a = (await r.json()) as A
    expect(a).toMatchObject({ mime: 'image/jpeg', width: 4000, height: 2000 })
    expect(a.blurhash).toMatch(/^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,}$/)
    const md = await get(u.owner, a.variants.md ?? '')
    expect(md.status).toBe(200)
    expect((await sharp(Buffer.from(await md.arrayBuffer())).metadata()).width).toBe(1280)
    const th = await get(u.owner, a.variants.thumb ?? '')
    expect((await sharp(Buffer.from(await th.arrayBuffer())).metadata()).width).toBe(320)
  })

  it('REQ-ATTACH-005 含 <script> 的 SVG → 201，mime=image/png，存储文件无脚本', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><script>alert(1)</script><rect width="40" height="40" fill="red"/></svg>'
    const r = await up(u.owner, new TextEncoder().encode(svg), 'evil.svg')
    expect(r.status).toBe(201)
    const a = (await r.json()) as A
    expect(a.mime).toBe('image/png')
    const [row] = await db().select().from(attachments).where(eq(attachments.id, a.id))
    const stored = readFileSync(dataPath(DATA, row?.storageKey ?? ''))
    expect(stored.subarray(0, 4).toString('latin1')).toBe('\x89PNG')
    expect(stored.toString('latin1')).not.toContain('script')
  })

  it('REQ-ATTACH-006 无归属附件 7 天后清理（行与文件）；任务永久删时其附件文件一并删除', async () => {
    const r = (await (await up(u.owner, new TextEncoder().encode('orphan'), 'o.txt')).json()) as A
    const [row] = await db().select().from(attachments).where(eq(attachments.id, r.id))
    const file = dataPath(DATA, row?.storageKey ?? '')
    expect(existsSync(file)).toBe(true)
    await db()
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 8 * 86_400_000) })
      .where(eq(attachments.id, r.id))
    expect(await gcAttachments({ db: db(), dataDir: DATA })).toBeGreaterThanOrEqual(1)
    expect(existsSync(file)).toBe(false)
    expect(await db().select().from(attachments).where(eq(attachments.id, r.id))).toHaveLength(0)
    const t = await req(u.owner, 'POST', '/tasks', { title: '要永久删', spaceId })
    const taskId = ((await t.json()) as { id: string }).id
    const a = (await (
      await up(u.owner, new TextEncoder().encode('task file'), 't.txt', {
        targetType: 'task',
        targetId: taskId,
      })
    ).json()) as A
    const [ar] = await db().select().from(attachments).where(eq(attachments.id, a.id))
    expect((await req(u.owner, 'DELETE', `/tasks/${taskId}?permanent=1`)).status).toBe(204)
    expect(existsSync(dataPath(DATA, ar?.storageKey ?? ''))).toBe(false)
  })

  it('REQ-ATTACH-007 REQ-WS-023 头像：3:2 图 → 1:1，user.image 指向 md 变体、avatarAttachmentId 回写', async () => {
    const r = await up(u.member, await png(600, 400), 'me.png', {}, '/me/avatar')
    expect(r.status, await r.clone().text()).toBe(201)
    const a = (await r.json()) as A
    expect(a.width).toBe(a.height)
    const [usr] = await db()
      .select({ image: userTable.image, att: userTable.avatarAttachmentId })
      .from(userTable)
      .where(eq(userTable.id, u.member.id))
    expect(usr?.image).toBe(a.variants.md)
    expect(usr?.att).toBe(a.id) // REQ-WS-023 头像附件 id 回写
    expect((await get(u.member2, a.variants.md ?? '')).status).toBe(200) // 头像工作区内可见
    expect(
      (await up(u.member, new TextEncoder().encode('%PDF-1.4'), 'x.pdf', {}, '/me/avatar')).status,
    ).toBe(415)
  })

  it('REQ-ATTACH-011 无 target 的附件仅 owner 可读', async () => {
    const a = (await (
      await up(u.member, new TextEncoder().encode('only me'), 'me.txt')
    ).json()) as A
    expect((await get(u.member, a.url)).status).toBe(200)
    expect((await get(u.member2, a.url)).status).toBe(404)
    expect((await get(u.owner, a.url)).status).toBe(404) // 连 owner 也不行
  })

  it('REQ-OPS-008 用量达 5GB 上传 → 413 QUOTA_EXCEEDED', async () => {
    const base = {
      workspaceId,
      ownerId: u.member2.id,
      filename: 'fake',
      mime: 'application/zip',
      storageKey: 'uploads/fake',
    }
    await db()
      .insert(attachments)
      .values([
        { ...base, size: 2_000_000_000, sha256: 'q1' },
        { ...base, size: 2_000_000_000, sha256: 'q2' },
        { ...base, size: 1_368_709_000, sha256: 'q3' },
      ])
    const r = await up(u.member2, new TextEncoder().encode('one more '.repeat(200)), 'x.txt')
    expect(r.status).toBe(413)
    expect((await problemOf(r)).code).toBe('QUOTA_EXCEEDED')
  })

  it('REQ-ATTACH-009 上传限流 30 次 / 分钟：第 31 次 429', async () => {
    const fresh = await invite('rate@xz.local')
    let last = 0
    for (let i = 0; i < 31; i++)
      last = (await up(fresh, new TextEncoder().encode(`n${i}`), `${i}.txt`)).status
    expect(last).toBe(429)
  })

  it('REQ-ATTACH-010 生产静态托管下 /data/... 与 /uploads/... 404，SPA 路由仍回 index.html', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xz-static-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>xz</title>')
    const env = getEnv()
    const prod = createApp({
      auth: getAuth(),
      db: db(),
      logger: captureLogger().logger,
      appUrl: ORIGIN,
      collabSecret: env.COLLAB_TOKEN_SECRET,
      dataDir: env.DATA_DIR,
      nodeEnv: 'test',
      staticDir: dir,
    })
    for (const p of ['/data/uploads/2026/09/x.png', '/uploads/2026/09/x.png', '/data'])
      expect((await prod.request(p)).status, p).toBe(404)
    expect((await prod.request('/spaces/product')).status).toBe(200)
  })
})
