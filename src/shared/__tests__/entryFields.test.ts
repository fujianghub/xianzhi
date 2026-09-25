/** REQ-ENTRY-001 fields 按 kind 严格校验：每 kind 正反用例（01 §3.5）。 */
import { describe, expect, it } from 'vitest'
import { entryFieldsByKind, kindWithFieldsSchema } from '../schemas/entryFields.ts'
import { ENTRY_KINDS } from '../schemas/enums.ts'

const UUID = '01920000-0000-7000-8000-000000000001'

const cases: Record<
  (typeof ENTRY_KINDS)[number],
  { ok: unknown[]; bad: { v: unknown; path: string }[] }
> = {
  decision: {
    ok: [
      { status: 'proposed' },
      { status: 'accepted', supersedesId: UUID, decidedAt: '2026-09-23' },
    ],
    bad: [
      { v: { status: 'maybe' }, path: 'status' },
      { v: { status: 'accepted', decidedAt: '2026/09/23' }, path: 'decidedAt' },
      { v: { status: 'accepted', extra: 1 }, path: 'extra' },
      { v: {}, path: 'status' },
    ],
  },
  bug: {
    ok: [
      { severity: 'high', status: 'open' },
      { severity: 'low', status: 'fixed', commit: 'abc123', debugDir: 'debug/2026-09-23-x' },
    ],
    bad: [
      { v: { severity: 'x', status: 'open' }, path: 'severity' },
      { v: { severity: 'low', status: 'done' }, path: 'status' },
      { v: { severity: 'low', status: 'open', commit: '' }, path: 'commit' },
    ],
  },
  iteration: {
    ok: [
      { periodStart: '2026-09-01', periodEnd: '2026-09-07' },
      { periodStart: '2026-09-01', periodEnd: '2026-09-07', version: 'v0.3' },
    ],
    bad: [
      { v: { periodStart: '2026-09-08', periodEnd: '2026-09-07' }, path: 'periodEnd' },
      { v: { periodStart: '2026-09-01' }, path: 'periodEnd' },
      { v: { periodStart: 'today', periodEnd: '2026-09-07' }, path: 'periodStart' },
    ],
  },
  changelog: {
    ok: [{ version: '1.2.0', releasedAt: '2026-09-23' }],
    bad: [
      { v: { version: '', releasedAt: '2026-09-23' }, path: 'version' },
      { v: { version: '1.0' }, path: 'releasedAt' },
      { v: { version: '1.0', releasedAt: '2026-09-23T00:00:00Z' }, path: 'releasedAt' },
    ],
  },
  review: {
    ok: [{ cycleId: UUID }],
    bad: [
      { v: {}, path: 'cycleId' },
      { v: { cycleId: 'not-uuid' }, path: 'cycleId' },
    ],
  },
  journal: {
    ok: [{}, { mood: 3 }],
    bad: [
      { v: { mood: 0 }, path: 'mood' },
      { v: { mood: 6 }, path: 'mood' },
      { v: { mood: '3' }, path: 'mood' },
    ],
  },
  note: {
    ok: [{}],
    bad: [{ v: { anything: true }, path: 'anything' }],
  },
  optimize: {
    ok: [{ status: 'proposed' }, { status: 'doing', metric: '首屏 LCP', target: '≤ 1.5s' }],
    bad: [
      { v: {}, path: 'status' },
      { v: { status: 'maybe' }, path: 'status' },
      { v: { status: 'doing', metric: '' }, path: 'metric' },
    ],
  },
  plan: {
    ok: [
      { status: 'active' },
      { status: 'planning', startDate: '2026-10-01', endDate: '2026-12-31', progress: 40 },
    ],
    bad: [
      { v: { status: 'active', progress: 120 }, path: 'progress' },
      { v: { status: 'active', startDate: '2026-12-01', endDate: '2026-10-01' }, path: 'endDate' },
      { v: { status: 'active', extra: 1 }, path: 'extra' },
    ],
  },
}

describe('entry fields by kind', () => {
  for (const kind of ENTRY_KINDS) {
    const c = cases[kind]
    it(`REQ-ENTRY-001 ${kind}：${c.ok.length} 正例通过`, () => {
      for (const v of c.ok)
        expect(entryFieldsByKind[kind].safeParse(v).success, JSON.stringify(v)).toBe(true)
    })
    it(`REQ-ENTRY-001 ${kind}：${c.bad.length} 反例失败且 path 指向出错字段`, () => {
      for (const { v, path } of c.bad) {
        const r = kindWithFieldsSchema.safeParse({ kind, fields: v })
        expect(r.success, JSON.stringify(v)).toBe(false)
        if (!r.success)
          expect(r.error.issues.map((i) => i.path.join('.'))).toContain(`fields.${path}`)
      }
    })
  }
  it('REQ-ENTRY-001 kind 只能是 7 种', () => {
    expect(kindWithFieldsSchema.safeParse({ kind: 'todo', fields: {} }).success).toBe(false)
    expect(Object.keys(entryFieldsByKind).sort()).toEqual([...ENTRY_KINDS].sort())
  })
})
