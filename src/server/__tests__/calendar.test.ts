/** ADR-0009 日历与日程（REQ-CAL-001 ~ 008，api / unit 层）。 */
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CalendarOccurrence, CalendarView } from '../../shared/schemas/calendar.ts'
import { events } from '../db/schema/business.ts'
import { runCalendarReminders } from '../jobs/calendarReminders.ts'
import { fromFloating, occurrencesBetween, toFloating } from '../services/calendar-recur.ts'
import { db, truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

type App = ReturnType<typeof buildApp>['app']
const TZ = 'Asia/Shanghai'

describe('calendar-recur（unit）', () => {
  it('REQ-CAL-004 浮动时间往返：跨 DST 仍是本地 09:00', () => {
    const ny = 'America/New_York'
    const start = new Date('2026-03-06T14:00:00Z') // 纽约 09:00 EST
    const occ = occurrencesBetween(
      {
        startAt: start,
        endAt: new Date(start.getTime() + 3_600_000),
        timezone: ny,
        rrule: 'FREQ=DAILY;COUNT=5',
      },
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-20T00:00:00Z'),
    )
    expect(occ).toHaveLength(5)
    // 3/8 起 EDT：UTC 13:00 = 本地 09:00
    expect(occ.map((d) => d.toISOString())).toEqual([
      '2026-03-06T14:00:00.000Z',
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
      '2026-03-10T13:00:00.000Z',
    ])
    const t = new Date('2026-09-25T01:30:00Z')
    expect(fromFloating(TZ, toFloating(TZ, t)).toISOString()).toBe(t.toISOString())
  })
})

describe('ADR-0009 日历 API', () => {
  let app: App
  let cookie = ''
  let other = ''
  let cals: CalendarView[] = []
  const req = (method: string, path: string, body?: unknown, who = cookie) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders({ cookie: who }),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const list = async (from: string, to: string, who = cookie) => {
    const r = await req(
      'GET',
      `/calendar-events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      undefined,
      who,
    )
    expect(r.status).toBe(200)
    return ((await r.json()) as { items: CalendarOccurrence[] }).items
  }

  beforeAll(async () => {
    await truncateAll()
    await seedOwner()
    app = buildApp().app
    cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    // 第二个成员：验证隐私
    const inv = await req('POST', '/workspace/invitations', { email: 'm@xz.local', role: 'member' })
    const { id } = (await inv.json()) as { id: string }
    await app.request(`/api/v1/workspace/invitations/${id}/accept`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: 'm@xz.local', name: 'M', password: 'member-pw1' }),
    })
    other = (await signIn(app, 'm@xz.local', 'member-pw1')).cookie
  })

  it('REQ-CAL-001 首次读取自动建 4 个默认日历，且幂等', async () => {
    const r = await req('GET', '/calendars')
    cals = ((await r.json()) as { items: CalendarView[] }).items
    expect(cals.map((c) => c.name)).toEqual(['个人', '工作', '学习', '生活'])
    expect(cals.filter((c) => c.isDefault)).toHaveLength(1)
    const again = ((await (await req('GET', '/calendars')).json()) as { items: unknown[] }).items
    expect(again).toHaveLength(4)
  })

  it('REQ-CAL-001 新建 / 改名改色 / 隐藏 / 删除（至少留一个）', async () => {
    const c = await req('POST', '/calendars', { name: '健身', color: 'cyan' })
    expect(c.status).toBe(201)
    const cal = (await c.json()) as CalendarView
    const p = await req('PATCH', `/calendars/${cal.id}`, { name: '运动', hidden: true })
    expect(((await p.json()) as CalendarView).hidden).toBe(true)
    expect((await req('POST', '/calendars', { name: 'x', color: 'teal' })).status).toBe(422)
    expect((await req('DELETE', `/calendars/${cal.id}`)).status).toBe(204)
  })

  let evId = ''
  let updatedAt = ''
  it('REQ-CAL-002 新建定时日程并按区间读取', async () => {
    const r = await req('POST', '/calendar-events', {
      calendarId: cals[1]?.id,
      title: '周会',
      location: '3 号会议室',
      startAt: '2026-09-28T02:00:00.000Z',
      endAt: '2026-09-28T03:00:00.000Z',
      timezone: TZ,
      alarms: [10],
    })
    expect(r.status).toBe(201)
    const ev = (await r.json()) as CalendarOccurrence
    evId = ev.id
    updatedAt = ev.updatedAt
    expect(ev.recurring).toBe(false)
    const items = await list('2026-09-27T16:00:00Z', '2026-09-28T16:00:00Z')
    expect(items.map((i) => i.title)).toEqual(['周会'])
    expect(await list('2026-09-29T00:00:00Z', '2026-09-30T00:00:00Z')).toHaveLength(0)
  })

  it('REQ-CAL-002 结束早于开始 422；区间 > 400 天 422', async () => {
    const bad = await req('POST', '/calendar-events', {
      calendarId: cals[0]?.id,
      title: 'x',
      startAt: '2026-09-28T03:00:00Z',
      endAt: '2026-09-28T02:00:00Z',
      timezone: TZ,
    })
    expect(bad.status).toBe(422)
    const r = await req('GET', '/calendar-events?from=2026-01-01T00:00:00Z&to=2027-03-01T00:00:00Z')
    expect(r.status).toBe(422)
  })

  it('REQ-CAL-003 拖动改期（PATCH startAt/endAt，ifUpdatedAt 乐观锁）', async () => {
    const r = await req('PATCH', `/calendar-events/${evId}`, {
      startAt: '2026-09-28T06:00:00.000Z',
      endAt: '2026-09-28T07:30:00.000Z',
      ifUpdatedAt: updatedAt,
    })
    expect(r.status).toBe(200)
    const ev = (await r.json()) as CalendarOccurrence
    expect(ev.endAt).toBe('2026-09-28T07:30:00.000Z')
    const stale = await req('PATCH', `/calendar-events/${evId}`, {
      title: 'x',
      ifUpdatedAt: updatedAt,
    })
    expect(stale.status).toBe(409)
    updatedAt = ev.updatedAt
  })

  it('REQ-CAL-006 他人不可见 / 不可改（404）', async () => {
    expect(await list('2026-09-27T00:00:00Z', '2026-09-30T00:00:00Z', other)).toHaveLength(0)
    const r = await req(
      'PATCH',
      `/calendar-events/${evId}`,
      { title: 'x', ifUpdatedAt: updatedAt },
      other,
    )
    expect(r.status).toBe(404)
    const cr = await req(
      'POST',
      '/calendar-events',
      {
        calendarId: cals[0]?.id,
        title: 'x',
        startAt: '2026-09-28T02:00:00Z',
        endAt: '2026-09-28T03:00:00Z',
        timezone: TZ,
      },
      other,
    )
    expect(cr.status).toBe(404)
  })

  let seriesId = ''
  it('REQ-CAL-004 每周一三重复：展开 + 全天事件', async () => {
    const r = await req('POST', '/calendar-events', {
      calendarId: cals[2]?.id,
      title: '英语',
      startAt: '2026-09-28T12:00:00.000Z', // 周一 20:00
      endAt: '2026-09-28T13:00:00.000Z',
      timezone: TZ,
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
    })
    expect(r.status).toBe(201)
    seriesId = ((await r.json()) as CalendarOccurrence).id
    const items = (await list('2026-09-27T16:00:00Z', '2026-10-11T16:00:00Z')).filter(
      (i) => i.id === seriesId,
    )
    expect(items.map((i) => i.startAt.slice(0, 10))).toEqual([
      '2026-09-28',
      '2026-09-30',
      '2026-10-05',
      '2026-10-07',
    ])
    expect(items.every((i) => i.recurring && i.occurrenceStart === i.startAt)).toBe(true)
    const bad = await req('POST', '/calendar-events', {
      calendarId: cals[2]?.id,
      title: 'x',
      startAt: '2026-09-28T12:00:00Z',
      endAt: '2026-09-28T13:00:00Z',
      timezone: TZ,
      rrule: 'FREQ=HOURLY',
    })
    expect(bad.status).toBe(422)
    const allDay = await req('POST', '/calendar-events', {
      calendarId: cals[3]?.id,
      title: '旅行',
      allDay: true,
      startAt: '2026-10-01T00:00:00+08:00',
      endAt: '2026-10-04T00:00:00+08:00',
      timezone: TZ,
    })
    expect(((await allDay.json()) as CalendarOccurrence).allDay).toBe(true)
  })

  it('REQ-CAL-005 仅此次：改写一次，其余不变', async () => {
    const items = (await list('2026-09-27T16:00:00Z', '2026-10-11T16:00:00Z')).filter(
      (i) => i.id === seriesId,
    )
    const second = items[1] as CalendarOccurrence
    const r = await req('PATCH', `/calendar-events/${seriesId}`, {
      title: '英语（改到 21 点）',
      startAt: '2026-09-30T13:00:00.000Z',
      endAt: '2026-09-30T14:00:00.000Z',
      scope: 'this',
      occurrenceStart: second.occurrenceStart,
      ifUpdatedAt: second.updatedAt,
    })
    expect(r.status).toBe(200)
    const ex = (await r.json()) as CalendarOccurrence
    expect(ex.isException).toBe(true)
    const after = await list('2026-09-27T16:00:00Z', '2026-10-11T16:00:00Z')
    const titles = after.filter((i) => i.title.startsWith('英语')).map((i) => i.title)
    expect(titles).toEqual(['英语', '英语（改到 21 点）', '英语', '英语'])
  })

  it('REQ-CAL-005 删除此次及将来：系列截断', async () => {
    const items = (await list('2026-09-27T16:00:00Z', '2026-10-11T16:00:00Z')).filter(
      (i) => i.id === seriesId,
    )
    const third = items.find((i) => i.startAt.startsWith('2026-10-05')) as CalendarOccurrence
    const r = await req(
      'DELETE',
      `/calendar-events/${seriesId}?scope=future&occurrenceStart=${encodeURIComponent(third.occurrenceStart ?? '')}`,
    )
    expect(r.status).toBe(204)
    const left = (await list('2026-09-27T16:00:00Z', '2026-12-31T16:00:00Z')).filter((i) =>
      i.title.startsWith('英语'),
    )
    expect(left.map((i) => i.startAt.slice(0, 10))).toEqual(['2026-09-28', '2026-09-30'])
  })

  it('REQ-CAL-005 删除整个系列（含改写行）', async () => {
    const r = await req('DELETE', `/calendar-events/${seriesId}?scope=all`)
    expect(r.status).toBe(204)
    const left = (await list('2026-09-27T16:00:00Z', '2026-12-31T16:00:00Z')).filter((i) =>
      i.title.startsWith('英语'),
    )
    expect(left).toHaveLength(0)
  })

  it('REQ-CAL-008 提醒：到点 emit 一次，连跑不重复', async () => {
    // 周会 06:00Z 开始、提前 10 分钟 → 05:50Z 触发
    const now = new Date('2026-09-28T05:51:00Z')
    expect((await runCalendarReminders(db(), now)).emitted).toBe(1)
    expect((await runCalendarReminders(db(), now)).emitted).toBe(0)
    expect((await runCalendarReminders(db(), new Date('2026-09-28T05:40:00Z'))).emitted).toBe(0)
    const ev = await db().select().from(events).where(eq(events.kind, 'calendar.reminder'))
    expect(ev).toHaveLength(1)
    expect((ev[0]?.payload as { date: string } | undefined)?.date).toBe('2026-09-28')
  })
})
