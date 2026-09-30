/**
 * 元数据配色（ADR-0035 §C）：状态 / 优先级 / 严重度 / 心情 / 日期 / 进度 → 04 §2.1 色板色名。
 * 纯函数：记录页属性面板、表格、看板、卡片、空间首页统一取色；颜色旁总有文字，不单靠颜色传达含义。
 */
import type { PaletteColor } from '../../shared/schemas/enums.ts'

/** 内置状态的语义色：未开始 / 提议 = 蓝，进行中 = 橙，完成 = 绿，搁置 / 作废 = 灰，新 Bug = 红 */
export const STATUS_TONE: Record<string, PaletteColor> = {
  new: 'red',
  pending: 'orange',
  fixed: 'green',
  wontfix: 'gray',
  proposed: 'blue',
  accepted: 'green',
  superseded: 'gray',
  rejected: 'gray',
  planned: 'cyan',
  doing: 'orange',
  shipped: 'green',
  dropped: 'gray',
  planning: 'blue',
  active: 'orange',
  paused: 'yellow',
  done: 'green',
}

/** 其它内置枚举值的语义色（优先级 P0 最红、严重度 critical 最红） */
export const VALUE_TONE: Record<string, Record<string, PaletteColor>> = {
  priority: { p0: 'red', p1: 'orange', p2: 'blue', p3: 'gray' },
  severity: { critical: 'red', high: 'orange', medium: 'yellow', low: 'gray' },
  mood: { '1': 'purple', '2': 'blue', '3': 'gray', '4': 'cyan', '5': 'green' },
}

/** 自定义选项没设颜色时按位置轮换：首项灰、末项绿、其余依次蓝 / 橙 / 紫…（与 ADR-0016 状态色一致） */
const POSITION_TONES: PaletteColor[] = ['blue', 'orange', 'purple', 'cyan', 'pink', 'yellow']
export function positionTone(index: number, count: number): PaletteColor {
  if (index <= 0) return 'gray'
  if (index === count - 1) return 'green'
  return POSITION_TONES[(index - 1) % POSITION_TONES.length] ?? 'blue'
}

/**
 * 某字段取值的色：
 * - `colors` = 类型里为选项设定的颜色（自定义状态 / 自定义单选，ADR-0036）优先；
 * - `options` = 自定义选项列表（未设色时按位置轮换）；
 * - 否则按内置语义表；都没有 → 灰。
 */
export function valueTone(
  field: string,
  value: unknown,
  custom?: { options: readonly string[]; colors?: Record<string, string> | null },
): PaletteColor {
  const v = String(value)
  if (custom) {
    const c = custom.colors?.[v]
    if (c) return c as PaletteColor
    const i = custom.options.indexOf(v)
    if (i >= 0) return positionTone(i, custom.options.length)
  }
  if (field === 'status') return STATUS_TONE[v] ?? 'gray'
  return VALUE_TONE[field]?.[v] ?? 'gray'
}

/** 日期的角色：截止类随临近程度变色；起始 / 发现类青；完成类绿；其余蓝 */
export type DateRole = 'due' | 'start' | 'done' | 'plain'
const DATE_ROLE: Record<string, DateRole> = {
  dueDate: 'due',
  endDate: 'due',
  periodEnd: 'due',
  startDate: 'start',
  periodStart: 'start',
  foundAt: 'start',
  resolvedAt: 'done',
  releasedAt: 'done',
  decidedAt: 'done',
}
export const dateRole = (field: string): DateRole => DATE_ROLE[field] ?? 'plain'

/** 两个 YYYY-MM-DD 相差天数（b − a），按日历日计，不受时区影响 */
export function daysBetween(a: string, b: string): number {
  const ms =
    Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) -
    Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  return Math.round(ms / 86_400_000)
}

/**
 * 日期色：截止类——已完成 = 绿，过期 = 红，3 天内（含今天）= 橙，更远 = 蓝；
 * 起始类 = 青；完成类 = 绿；其余 = 蓝。`today` 为操作者时区的 YYYY-MM-DD。
 */
export function dateTone(field: string, date: string, today: string, closed = false): PaletteColor {
  const role = dateRole(field)
  if (role === 'start') return 'cyan'
  if (role === 'done') return 'green'
  if (role === 'plain') return 'blue'
  if (closed) return 'green'
  const d = daysBetween(today, date)
  if (d < 0) return 'red'
  if (d <= 3) return 'orange'
  return 'blue'
}

/** 进度色：0–29 橙、30–99 蓝、100 绿 */
export function progressTone(v: number): PaletteColor {
  if (v >= 100) return 'green'
  if (v >= 30) return 'blue'
  return 'orange'
}

/** 记录是否已「完成」（截止日不再告警）：各类型的终态 */
const CLOSED_STATUSES = new Set([
  'fixed',
  'wontfix',
  'accepted',
  'superseded',
  'rejected',
  'shipped',
  'dropped',
  'done',
])
export function isClosedStatus(status: unknown, custom?: readonly string[] | null): boolean {
  if (typeof status !== 'string') return false
  // 自定义状态：末项视为完成（与位置配色「末项绿」一致）
  if (custom?.length) return custom[custom.length - 1] === status
  return CLOSED_STATUSES.has(status)
}
