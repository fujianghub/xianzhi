/** ADR-0043 任务页按截止日分组（REQ-TASK-027）。 */
import { describe, expect, it } from 'vitest'
import { groupTasks } from '../lib/task-groups.ts'

const tz = 'Asia/Shanghai'
// 本地 2026-10-01 10:00（周四）
const now = new Date('2026-10-01T02:00:00.000Z')
const t = (id: string, dueAt: string | null, priority = 0) => ({
  id,
  dueAt,
  priority,
  sortKey: id,
})

describe('task groups', () => {
  it('REQ-TASK-027 逾期 = 早于今天 00:00；今天 / 明天 / 未来 7 天 / 以后 / 无日期按用户时区切分，组内截止早的与优先级高的在前', () => {
    const g = groupTasks(
      [
        t('late', '2026-09-30T15:00:00.000Z'), // 本地 9/30 23:00 → 逾期
        t('todayEarly', '2026-09-30T16:30:00.000Z'), // 本地 10/1 00:30 → 今天（已过点仍算今天）
        t('todayB', '2026-10-01T15:59:00.000Z', 1),
        t('todayA', '2026-10-01T15:59:00.000Z', 3),
        t('tomorrow', '2026-10-02T15:59:00.000Z'),
        t('week', '2026-10-08T15:59:00.000Z'), // 本地 10/8 → 未来 7 天（含第 7 天）
        t('later', '2026-10-09T00:00:00.000Z'), // 本地 10/9 08:00 → 以后
        t('none', null),
      ],
      tz,
      now,
    )
    const ids = (k: string) => (g.get(k as never) ?? []).map((x) => x.id)
    expect(ids('overdue')).toEqual(['late'])
    expect(ids('today')).toEqual(['todayEarly', 'todayA', 'todayB'])
    expect(ids('tomorrow')).toEqual(['tomorrow'])
    expect(ids('week')).toEqual(['week'])
    expect(ids('later')).toEqual(['later'])
    expect(ids('noDate')).toEqual(['none'])
  })
})
