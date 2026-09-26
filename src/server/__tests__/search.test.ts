/** T1-025 搜索（REQ-SEARCH-001 ~ 005，api 层）。 */
import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { searchQuery } from '../../shared/schemas/search.ts'
import type { Actor } from '../authz.ts'
import { getDb } from '../db/index.ts'
import { entries, tasks } from '../db/schema/business.ts'
import { weightedTsv } from '../services/derived.ts'
import { highlight, search } from '../services/search.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

const db = () => getDb()
type App = ReturnType<typeof buildApp>['app']
interface U {
  id: string
  cookie: string
}
interface Hit {
  id: string
  title: string
  highlight: string
}
interface Res {
  groups: {
    tasks?: { items: Hit[]; nextCursor: string | null }
    entries?: { items: Hit[]; nextCursor: string | null }
  }
}

describe('T1-025 search', () => {
  let app: App
  let workspaceId = ''
  const u: Record<'owner' | 'member' | 'other', U> = {} as never
  let spaceId = ''
  const req = (who: U, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who.cookie }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const find = async (who: U, qs: string) => {
    const r = await req(who, 'GET', `/search?${qs}`)
    expect(r.status, await r.clone().text()).toBe(200)
    return (await r.json()) as Res
  }
  /** 建记录并写正文派生列（与 collab 落库同一个 weightedTsv）。 */
  const entry = async (
    who: U,
    title: string,
    body: string,
    extra: Record<string, unknown> = {},
  ) => {
    const r = await req(who, 'POST', '/entries', {
      kind: 'note',
      title,
      spaceId,
      visibility: 'space',
      ...extra,
    })
    const { id } = (await r.json()) as { id: string }
    await db()
      .update(entries)
      .set({ plain: body, tsv: weightedTsv(title, body) as unknown as string })
      .where(eq(entries.id, id))
    return id
  }
  async function invite(email: string): Promise<U> {
    const inv = await req(u.owner, 'POST', '/workspace/invitations', { email, role: 'member' })
    const { id } = (await inv.json()) as { id: string }
    const acc = await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email, name: email.split('@')[0], password: 'search-pass-1' }),
    })
    const userId = ((await acc.json()) as { userId: string }).userId
    return { id: userId, cookie: (await signIn(app, email, 'search-pass-1')).cookie }
  }

  beforeAll(async () => {
    await truncateAll()
    const r = await seedOwner()
    workspaceId = r.workspaceId
    app = buildApp().app
    u.owner = { id: r.userId, cookie: (await signIn(app, OWNER.email, OWNER.password)).cookie }
    u.member = await invite('sm@xz.local')
    u.other = await invite('so@xz.local')
    const s = await req(u.owner, 'POST', '/spaces', { name: 'S', slug: 'search-s', kind: 'work' })
    spaceId = ((await s.json()) as { id: string }).id
  })

  it('highlight：只含 <mark>，其余转义；最多 2 段', () => {
    expect(highlight('关于缓存策略的决定 <b>', ['缓存'])).toBe(
      '关于<mark>缓存</mark>策略的决定 &lt;b&gt;',
    )
    const long = `${'前'.repeat(100)}缓存${'中'.repeat(100)}决定${'后'.repeat(100)}缓存${'尾'.repeat(100)}`
    expect(highlight(long, ['缓存', '决定']).match(/<mark>/g)?.length).toBeLessThanOrEqual(3)
    expect(highlight(long, ['缓存']).split(' ').length).toBeLessThanOrEqual(2)
  })

  it('REQ-SEARCH-001 · 002 分组结果带 <mark> 高亮；中文词级命中「缓存 决定」', async () => {
    const id = await entry(u.member, '架构备忘', '关于缓存策略的决定：采用写穿透。')
    await entry(u.member, '无关', '今天天气不错')
    const r = await find(u.member, `q=${encodeURIComponent('缓存')}`)
    expect(r.groups.entries?.items[0]?.id).toBe(id)
    expect(r.groups.entries?.items[0]?.highlight).toContain('<mark>缓存</mark>')
    expect(r.groups.tasks).toBeDefined()
    const both = await find(u.member, `q=${encodeURIComponent('缓存 决定')}`)
    expect(both.groups.entries?.items.map((x) => x.id)).toEqual([id])
    const miss = await find(u.member, `q=${encodeURIComponent('缓存 天气')}`)
    expect(miss.groups.entries?.items).toEqual([]) // AND 语义
  })

  it('REQ-SEARCH-003 REQ-TAG-007 标题 / 本人标签子串兜底：「存策」命中标题含「缓存策略」的记录与任务', async () => {
    const e = await entry(u.member, '缓存策略复盘', '正文无关')
    const t = await req(u.member, 'POST', '/tasks', { title: '调研缓存策略', spaceId })
    const tid = ((await t.json()) as { id: string }).id
    const r = await find(u.member, `q=${encodeURIComponent('存策')}`)
    expect(r.groups.entries?.items.map((x) => x.id)).toContain(e)
    expect(r.groups.tasks?.items.map((x) => x.id)).toContain(tid)
    // 标签名子串（标签是个人的，ADR-0017：成员打自己的标签）
    const tag = await req(u.member, 'POST', '/tags', { name: '性能优化', color: 'green' })
    const tagId = ((await tag.json()) as { id: string }).id
    const tt = await req(u.member, 'POST', '/tasks', {
      title: '无关标题',
      spaceId,
      tagIds: [tagId],
    })
    const ttId = ((await tt.json()) as { id: string }).id
    expect(
      (await find(u.member, `q=${encodeURIComponent('能优')}`)).groups.tasks?.items.map(
        (x) => x.id,
      ),
    ).toContain(ttId)
    // 别人的私有标签名不参与匹配：所有者看得到这个任务，但按「能优」搜不到
    expect(
      (await find(u.owner, `q=${encodeURIComponent('能优')}`)).groups.tasks?.items.map(
        (x) => x.id,
      ) ?? [],
    ).not.toContain(ttId)
    // types 限定
    const only = await find(u.member, `q=${encodeURIComponent('存策')}&types=task`)
    expect(only.groups.entries).toBeUndefined()
  })

  it('REQ-SEARCH-004 他人 private 不出现；软删与归档不入结果', async () => {
    const priv = await entry(u.other, '机密缓存方案', '私下的缓存想法', { visibility: 'private' })
    const r = await find(u.member, `q=${encodeURIComponent('缓存')}`)
    expect(r.groups.entries?.items.map((x) => x.id)).not.toContain(priv)
    expect(
      (await find(u.other, `q=${encodeURIComponent('缓存')}`)).groups.entries?.items.map(
        (x) => x.id,
      ),
    ).toContain(priv)
    const del = await entry(u.member, '要删的缓存', '缓存')
    await req(u.member, 'DELETE', `/entries/${del}`)
    const arc = await entry(u.member, '归档的缓存', '缓存')
    await req(u.member, 'POST', `/entries/${arc}/archive`)
    const ids =
      (await find(u.member, `q=${encodeURIComponent('缓存')}&limit=50`)).groups.entries?.items.map(
        (x) => x.id,
      ) ?? []
    expect(ids).not.toContain(del)
    expect(ids).not.toContain(arc)
  })

  it('REQ-SEARCH-005 分组游标翻页无重复；空 q 回传最近访问；第 61 次 429；1 万条 P95 ≤ 150ms', async () => {
    for (let i = 0; i < 5; i++) await entry(u.member, `分页 ${i}`, `翻页关键词 第${i}篇`)
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const r: Res = await find(
        u.member,
        `q=${encodeURIComponent('翻页关键词')}&types=entry&limit=2${cursor ? `&cursorEntries=${cursor}` : ''}`,
      )
      for (const it of r.groups.entries?.items ?? []) seen.push(it.id)
      cursor = r.groups.entries?.nextCursor ?? null
    } while (cursor)
    expect(seen.length).toBe(5)
    expect(new Set(seen).size).toBe(5)
    const recent = await find(u.member, `recent=${seen.slice(0, 2).reverse().join(',')}`)
    expect(recent.groups.entries?.items.map((x) => x.id)).toEqual(seen.slice(0, 2).reverse())
    // 性能：1 万任务 + 批量记录，服务直调采样
    const now = Date.now()
    for (let b = 0; b < 5; b++)
      await db()
        .insert(tasks)
        .values(
          Array.from({ length: 2000 }, (_, k) => {
            const i = b * 2000 + k
            return {
              workspaceId,
              spaceId,
              title: `批量任务 ${i} ${i % 7 === 0 ? '缓存' : '队列'}`,
              creatorId: u.owner.id,
              sortKey: `z${String(i).padStart(5, '0')}`,
              status: 'todo',
              updatedAt: new Date(now - i * 60_000),
            }
          }),
        )
    await db().execute(
      sql`update tasks set tsv = setweight(to_tsvector('simple', title), 'A') where tsv is null`,
    )
    await db().execute(sql`analyze tasks`)
    const actor: Actor = { id: u.owner.id, workspaceRole: 'owner' }
    const samples: number[] = []
    for (let i = 0; i < 40; i++) {
      const q = searchQuery.parse({ q: i % 2 ? '缓存' : '存策', limit: '10' })
      const t = performance.now()
      await search(db(), { actor, workspaceId }, q)
      samples.push(performance.now() - t)
    }
    samples.sort((a, b) => a - b)
    const p95 = samples[Math.floor(samples.length * 0.95) - 1] ?? 0
    expect(p95).toBeLessThanOrEqual(150)
    // 限流：换一个新用户打满 60 次
    const fresh = await invite('srate@xz.local')
    let last = 0
    for (let i = 0; i < 61; i++) last = (await req(fresh, 'GET', '/search?q=x')).status
    expect(last).toBe(429)
  }, 120_000)
})
