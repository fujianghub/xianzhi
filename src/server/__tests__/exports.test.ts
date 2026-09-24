/** T1-028 / T1-041 导出（REQ-EXPORT-001 · 002 · 003 · 006 · 007 · 008）。 */
import { and, eq } from 'drizzle-orm'
import { strFromU8, unzipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { pmToHtmlDocument } from '../../shared/editor/serializers/html.ts'
import { pmToMarkdown } from '../../shared/editor/serializers/markdown.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { getDb } from '../db/index.ts'
import { auditLog, entries, events } from '../db/schema/business.ts'
import { getEnv } from '../env.ts'
import { runExport } from '../jobs/export.ts'
import { inlineQueue } from '../lib/job-queue.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, problemOf, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
const DATA = getEnv().DATA_DIR
type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
const P = (...content: PmNode[]): PmNode => ({ type: 'paragraph', content })
const T = (text: string, marks?: PmNode['marks']): PmNode => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
})
const ATT = '01920000-0000-7000-8000-00000000aaaa'
const RICH: PmNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [T('背景')] },
    P(
      T('有'),
      T('粗体', [{ type: 'bold' }]),
      T('、'),
      T('被评论的字', [{ type: 'comment', attrs: { threadId: 'x' } }]),
      T('与'),
      T('链接', [{ type: 'link', attrs: { href: 'https://a.example' } }]),
    ),
    { type: 'callout', attrs: { kind: 'warning' }, content: [P(T('注意'))] },
    { type: 'mermaid', attrs: { code: 'graph LR; A-->B' } },
    { type: 'mathBlock', attrs: { latex: 'E = mc^2' } },
    P(
      { type: 'entryLink', attrs: { id: '01920000-0000-7000-8000-000000000001', title: '另一篇' } },
      T(' '),
      { type: 'mention', attrs: { id: 'u1', label: '小明' } },
    ),
    { type: 'image', attrs: { src: `xz:attachment/${ATT}`, alt: '图' } },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [P(T('完成项'))] },
        { type: 'taskItem', attrs: { checked: false }, content: [P(T('待办'))] },
      ],
    },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [T('const a = 1')] },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [P(T('列'))] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [P(T('值'))] }] },
      ],
    },
  ],
}

describe('serializers', () => {
  it('REQ-EXPORT-002 每个自定义节点的 Markdown 形态（callout / mermaid / 公式 / entryLink / mention / 图片 / 任务列表 / 代码 / 表格）', () => {
    const md = pmToMarkdown(RICH, { resolveImage: (id) => `../../assets/${id}.png` })
    expect(md).toContain('## 背景')
    expect(md).toContain('**粗体**')
    expect(md).toContain('[链接](https://a.example)')
    expect(md).toContain(':::warning\n注意\n:::')
    expect(md).toContain('```mermaid\ngraph LR; A-->B\n```')
    expect(md).toContain('$$\nE = mc^2\n$$')
    expect(md).toContain('[另一篇](xz://entry/01920000-0000-7000-8000-000000000001)')
    expect(md).toContain('@小明')
    expect(md).toContain(`![图](../../assets/${ATT}.png)`)
    expect(md).toContain('- [x] 完成项\n- [ ] 待办')
    expect(md).toContain('```ts\nconst a = 1\n```')
    expect(md).toContain('| 列 |\n| --- |\n| 值 |')
  })
  it('REQ-EXPORT-003 有损：评论标记丢弃、文字保留', () => {
    const md = pmToMarkdown(RICH)
    expect(md).toContain('被评论的字')
    expect(md).not.toMatch(/comment|threadId/)
  })
  it('REQ-EXPORT-006 HTML：单文件、内联 CSS、无外链样式与脚本、文本转义', () => {
    const html = pmToHtmlDocument('<标题>', {
      type: 'doc',
      content: [P(T('<script>alert(1)</script>'))],
    })
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<style>')
    expect(html).not.toMatch(/<link\b|<script\b/)
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<title>&lt;标题&gt;</title>')
  })
})

describe('T1-028 exports', () => {
  let app: App
  let workspaceId = ''
  const u: Record<'owner' | 'member' | 'other', U> = {} as never
  let spaceId = ''
  const queue = inlineQueue({
    'export.run': (data, jobId) =>
      runExport({ db: db(), dataDir: DATA, backoffMs: 0 }, data as never, jobId),
  })
  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const entry = async (who: U, title: string, doc: PmNode, extra: Record<string, unknown> = {}) => {
    const r = await req(who, 'POST', '/entries', {
      kind: 'decision',
      title,
      spaceId,
      visibility: 'space',
      fields: { status: 'accepted' },
      ...extra,
    })
    const { id } = (await r.json()) as { id: string }
    await db().update(entries).set({ pmJson: doc }).where(eq(entries.id, id))
    return id
  }
  async function invite(email: string): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role: 'member' })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'export-pass-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'export-pass-1')).cookie }
  }
  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    workspaceId = r.workspaceId
    app = buildApp({ jobQueue: queue }).app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('em@xz.local')
    u.other = await invite('eo@xz.local')
    const s = await req(u.owner, 'POST', '/spaces', {
      name: '产品 开发',
      slug: 'product',
      kind: 'project',
    })
    spaceId = ((await s.json()) as { id: string }).id
  })

  it('REQ-EXPORT-001 POST /exports 202 {jobId} → GET /jobs/:id completed 带 resultUrl；仅发起人可下载；发 system.export_done', async () => {
    await entry(u.member, '缓存方案', RICH)
    await req(u.member, 'POST', '/tasks', { title: '导出里的任务', spaceId })
    const r = await req(u.member, 'POST', '/exports', { scope: 'space', id: spaceId })
    expect(r.status).toBe(202)
    const { jobId } = (await r.json()) as { jobId: string }
    const job = (await (await req(u.member, 'GET', `/jobs/${jobId}`)).json()) as {
      status: string
      resultUrl: string
      fileName: string
    }
    expect(job).toMatchObject({ status: 'completed', resultUrl: `/api/v1/jobs/${jobId}/download` })
    expect((await req(u.other, 'GET', `/jobs/${jobId}`)).status).toBe(404)
    const dl = await app.request(job.resultUrl, { headers: { cookie: u.member.cookie } })
    expect(dl.status).toBe(200)
    expect(dl.headers.get('content-disposition')).toContain('attachment;')
    expect((await app.request(job.resultUrl, { headers: { cookie: u.other.cookie } })).status).toBe(
      404,
    )
    const [ev] = await db().select().from(events).where(eq(events.kind, 'system.export_done'))
    expect(ev?.visibilityScope).toMatchObject({ userIds: [u.member.id] })
    // 结构：<space>/<kind>/<date>-<slug>.md + frontmatter；README 说明有损
    const files = unzipSync(new Uint8Array(await dl.arrayBuffer()))
    const mdPath = Object.keys(files).find((p) => p.endsWith('.md') && p.includes('/decision/'))
    expect(mdPath).toMatch(/^product\/decision\/\d{4}-\d{2}-\d{2}-缓存方案\.md$/)
    const md = strFromU8(files[mdPath as string] as Uint8Array)
    expect(md).toMatch(/^---\nid: "[0-9a-f-]{36}"\ntitle: "缓存方案"\nkind: "decision"\n/)
    for (const k of ['fields:', 'tags:', 'links:', 'createdAt:']) expect(md).toContain(k)
    expect(md).toContain(`../../assets/${ATT}`)
    expect(Object.keys(files)).toContain('README.md')
    expect(Object.keys(files)).toContain('product/tasks.json')
  })

  it('REQ-EXPORT-008 member 请求 scope=workspace 403；导出 zip 不含他人 private 记录；admin 身份也不放宽', async () => {
    const r = await req(u.member, 'POST', '/exports', { scope: 'workspace' })
    expect(r.status).toBe(403)
    const priv = await entry(u.other, '他人私密', RICH, { visibility: 'private' })
    const mine = await entry(u.member, '我的公开', RICH)
    const job = (await (
      await req(u.member, 'POST', '/exports', { scope: 'space', id: spaceId })
    ).json()) as { jobId: string }
    const dl = await app.request(`/api/v1/jobs/${job.jobId}/download`, {
      headers: { cookie: u.member.cookie },
    })
    const text = Object.values(unzipSync(new Uint8Array(await dl.arrayBuffer())))
      .map((b) => strFromU8(b))
      .join('\n')
    expect(text).toContain(mine)
    expect(text).not.toContain(priv)
    expect(text).not.toContain('他人私密')
    // owner 的全量导出同样看不到 other 的 private（private 仅作者，01 §5）
    const w = (await (await req(u.owner, 'POST', '/exports', { scope: 'workspace' })).json()) as {
      jobId: string
    }
    const wdl = await app.request(`/api/v1/jobs/${w.jobId}/download`, {
      headers: { cookie: u.owner.cookie },
    })
    const wtext = Object.values(unzipSync(new Uint8Array(await wdl.arrayBuffer())))
      .map((b) => strFromU8(b))
      .join('\n')
    expect(wtext).not.toContain(priv)
    expect(
      Object.keys(
        unzipSync(
          new Uint8Array(
            await (
              await app.request(`/api/v1/jobs/${w.jobId}/download`, {
                headers: { cookie: u.owner.cookie },
              })
            ).arrayBuffer(),
          ),
        ),
      ),
    ).toContain('cycles.json')
    // 不可见的 space / entry → 404
    expect((await req(u.member, 'POST', '/exports', { scope: 'entry', id: priv })).status).toBe(404)
  })

  it('REQ-EXPORT-003 单篇同步导出 md / html；评论标记不出现', async () => {
    const id = await entry(u.member, '单篇', RICH)
    const md = await req(u.member, 'POST', `/entries/${id}/export?format=md`)
    expect(md.status).toBe(200)
    expect(md.headers.get('content-type')).toContain('text/markdown')
    const text = await md.text()
    expect(text).toContain(':::warning')
    expect(text).not.toContain('threadId')
    const html = await req(u.member, 'POST', `/entries/${id}/export?format=html`)
    expect((await html.text()).startsWith('<!doctype html>')).toBe(true)
    expect(
      (
        await req(
          u.other,
          'POST',
          `/entries/${await entry(u.member, '私', RICH, { visibility: 'private' })}/export`,
        )
      ).status,
    ).toBe(404)
  })

  it('REQ-EXPORT-007 处理函数持续抛错：4 次尝试后失败，audit export.failed 有行', async () => {
    let calls = 0
    await expect(
      runExport(
        {
          db: db(),
          dataDir: DATA,
          backoffMs: 0,
          build: async () => {
            calls++
            throw new Error('磁盘满')
          },
        },
        { userId: u.owner.id, workspaceId, scope: 'workspace', format: 'zip' },
        'job-fail-1',
      ),
    ).rejects.toThrow('磁盘满')
    expect(calls).toBe(4)
    const rows = await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'export.failed'), eq(auditLog.targetId, 'job-fail-1')))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.meta).toMatchObject({ error: '磁盘满' })
    // 作业层面：failed 状态经队列反映
    const failingQueue = inlineQueue({
      'export.run': async () => {
        throw new Error('x')
      },
    })
    const fapp = buildApp({ jobQueue: failingQueue }).app
    const cookie = (await signIn(fapp, OWNER.email, OWNER.password)).cookie
    const jr = await fapp.request('/api/v1/exports', {
      method: 'POST',
      headers: jsonHeaders({ cookie }),
      body: JSON.stringify({ scope: 'workspace' }),
    })
    const { jobId } = (await jr.json()) as { jobId: string }
    const st = (await (
      await fapp.request(`/api/v1/jobs/${jobId}`, { headers: { cookie } })
    ).json()) as { status: string; error: string }
    expect(st).toMatchObject({ status: 'failed', error: '导出失败，请稍后重试' })
    expect(
      (
        await problemOf(
          await fapp.request(`/api/v1/jobs/${jobId}/download`, { headers: { cookie } }),
        )
      ).code,
    ).toBe('NOT_FOUND')
  })
})
