import { describe, expect, it } from 'vitest'
import { PALETTE_COLORS } from '../../shared/schemas/enums.ts'
import {
  dateTone,
  daysBetween,
  isClosedStatus,
  positionTone,
  progressTone,
  valueTone,
} from '../lib/field-tones.ts'

describe('元数据配色', () => {
  it('REQ-UI-044 状态 / 优先级 / 严重度按语义取色，未知值为灰', () => {
    expect(valueTone('status', 'new')).toBe('red')
    expect(valueTone('status', 'fixed')).toBe('green')
    expect(valueTone('priority', 'p0')).toBe('red')
    expect(valueTone('priority', 'p1')).toBe('orange')
    expect(valueTone('priority', 'p2')).toBe('blue')
    expect(valueTone('priority', 'p3')).toBe('gray')
    expect(valueTone('severity', 'critical')).toBe('red')
    expect(valueTone('module', 'auth')).toBe('gray')
    for (const v of ['new', 'pending', 'accepted', 'paused'])
      expect(PALETTE_COLORS).toContain(valueTone('status', v))
  })

  it('REQ-UI-044 自定义选项：设定色优先，否则首项灰、末项绿、中间轮换', () => {
    const options = ['待办', '进行中', '评审', '完成']
    expect(valueTone('status', '进行中', { options, colors: { 进行中: 'pink' } })).toBe('pink')
    expect(valueTone('status', '待办', { options })).toBe('gray')
    expect(valueTone('status', '完成', { options })).toBe('green')
    expect(valueTone('status', '评审', { options })).toBe('orange')
    expect(positionTone(1, 4)).toBe('blue')
  })

  it('REQ-UI-044 截止日：过期红、3 天内橙、更远蓝、已完成绿；起始类青、完成类绿', () => {
    const today = '2026-09-30'
    expect(dateTone('dueDate', '2026-09-29', today)).toBe('red')
    expect(dateTone('dueDate', '2026-09-30', today)).toBe('orange')
    expect(dateTone('endDate', '2026-10-03', today)).toBe('orange')
    expect(dateTone('periodEnd', '2026-10-04', today)).toBe('blue')
    expect(dateTone('dueDate', '2026-09-01', today, true)).toBe('green')
    expect(dateTone('foundAt', '2026-09-01', today)).toBe('cyan')
    expect(dateTone('resolvedAt', '2026-09-01', today)).toBe('green')
    expect(dateTone('xABCDEF', '2026-09-01', today)).toBe('blue')
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })

  it('REQ-UI-044 进度与完成态', () => {
    expect(progressTone(0)).toBe('orange')
    expect(progressTone(30)).toBe('blue')
    expect(progressTone(100)).toBe('green')
    expect(isClosedStatus('fixed')).toBe(true)
    expect(isClosedStatus('pending')).toBe(false)
    expect(isClosedStatus('完成', ['待办', '完成'])).toBe(true)
  })
})
