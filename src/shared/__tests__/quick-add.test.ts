/** ADR-0043：任务快速添加智能识别（REQ-TASK-026）。 */
import { describe, expect, it } from 'vitest'
import { parseQuickAdd, quickDueIso } from '../quick-add.ts'

// 2026-10-01 是周四
const today = { y: 2026, m: 10, d: 1 }
const p = (s: string, ignored: string[] = []) => parseQuickAdd(s, today, ignored)

describe('quick add', () => {
  it('REQ-TASK-026 相对日期：今天 / 明天 / 后天 / 大后天，识别后从标题去掉', () => {
    expect(p('明天 买牛奶')).toMatchObject({
      title: '买牛奶',
      due: { date: { y: 2026, m: 10, d: 2 }, minutes: null },
    })
    expect(p('买牛奶今天').due?.date).toEqual(today)
    expect(p('后天交作业').due?.date).toEqual({ y: 2026, m: 10, d: 3 })
    expect(p('大后天交作业').due?.date).toEqual({ y: 2026, m: 10, d: 4 })
  })

  it('REQ-TASK-026 周X：本周未过取本周（含今天），已过取下周；下周X 取下周', () => {
    expect(p('周五 复盘').due?.date).toEqual({ y: 2026, m: 10, d: 2 })
    expect(p('周四 复盘').due?.date).toEqual({ y: 2026, m: 10, d: 1 })
    expect(p('周一 复盘').due?.date).toEqual({ y: 2026, m: 10, d: 5 })
    expect(p('下周一 复盘').due?.date).toEqual({ y: 2026, m: 10, d: 5 })
    expect(p('下周五 复盘').due?.date).toEqual({ y: 2026, m: 10, d: 9 })
    expect(p('星期日 休息').due?.date).toEqual({ y: 2026, m: 10, d: 4 })
  })

  it('REQ-TASK-026 绝对日期：M月D日 / M-D / YYYY-M-D；今年已过 → 明年；非法日期不识别', () => {
    expect(p('10月8日 体检').due?.date).toEqual({ y: 2026, m: 10, d: 8 })
    expect(p('体检 12-25').due?.date).toEqual({ y: 2026, m: 12, d: 25 })
    expect(p('续费 3/1').due?.date).toEqual({ y: 2027, m: 3, d: 1 })
    expect(p('2027-1-2 续费').due?.date).toEqual({ y: 2027, m: 1, d: 2 })
    expect(p('2月30日 x').due).toBeUndefined()
  })

  it('REQ-TASK-026 时间：HH:mm、下午3点、晚上8点半；无时间按 23:59 转 ISO（用户时区）', () => {
    expect(p('明天 15:30 开会').due?.minutes).toBe(15 * 60 + 30)
    expect(p('明天下午3点 开会')).toMatchObject({ title: '开会', due: { minutes: 15 * 60 } })
    expect(p('今天晚上8点半 跑步').due?.minutes).toBe(20 * 60 + 30)
    expect(quickDueIso({ date: today, minutes: null }, 'Asia/Shanghai')).toBe(
      '2026-10-01T15:59:00.000Z',
    )
    expect(quickDueIso({ date: today, minutes: 9 * 60 }, 'Asia/Shanghai')).toBe(
      '2026-10-01T01:00:00.000Z',
    )
  })

  it('REQ-TASK-026 优先级 / 标签 / 清单（~）；取消识别的片段留在标题；识别后标题为空则整句当标题', () => {
    const r = p('明天 买牛奶 !高 #生活 #购物 ~家务')
    expect(r).toMatchObject({
      title: '买牛奶',
      priority: 3,
      tags: ['生活', '购物'],
      list: '家务',
    })
    expect(r.tokens.map((t) => t.kind)).toEqual(['date', 'priority', 'tag', 'tag', 'list'])
    expect(p('读书 ！紧急').priority).toBe(4)
    const kept = p('明天 买牛奶', ['明天'])
    expect(kept.title).toBe('明天 买牛奶')
    expect(kept.due).toBeUndefined()
    expect(p('明天')).toMatchObject({ title: '明天', tokens: [] })
    expect(p('就一句话')).toMatchObject({ title: '就一句话', tags: [], tokens: [] })
  })
})
