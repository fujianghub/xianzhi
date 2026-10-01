/**
 * 任务快速添加的智能识别（ADR-0043、REQ-TASK-026）：纯函数，不依赖时区库以外的东西，前端输入时实时解析。
 * - 日期：今天 / 明天 / 后天 / 大后天 · 周X / 星期X（本周未过取本周，否则下周）· 下周X · M月D日 / M-D / M/D / YYYY-M-D，
 *   可跟时间 `HH:mm` 或 `(上午|下午|晚上)N点(半)`；只取第一个日期。无时间 = 当天 23:59（与日历 / 今日一致）。
 * - 优先级：`!紧急` 4 · `!高` 3 · `!中` 2 · `!低` 1（全角 ！ 亦可）。与任务 priority 同向：数字越大越急。
 * - 标签：`#名`（多个）；清单 / 空间：`~名`（一个；ADR-0044 起先按本人清单匹配，再按空间）。名字到空白或下一个标记为止。
 * - `ignored`：用户在预览里点 × 取消识别的片段原文，按普通文字留在标题里。
 * 识别出的片段从标题里去掉；去掉后标题为空则全部不识别（整句当标题）。
 */
import { addDays, dayOfWeek, type LocalDate, zonedMidnight } from './tz.ts'

export type QuickTokenKind = 'date' | 'priority' | 'tag' | 'list'
export interface QuickToken {
  kind: QuickTokenKind
  /** 原文片段 */
  text: string
  start: number
  end: number
}
export interface QuickAddResult {
  title: string
  due?: { date: LocalDate; minutes: number | null }
  priority?: 1 | 2 | 3 | 4
  tags: string[]
  /** `~名`：由调用方先匹配本人清单、再匹配空间 */
  list?: string
  tokens: QuickToken[]
}

/** 只有日期的截止 = 当天 23:59（REQ-TASK-005 · 日历 ALL_DAY） */
export const ALL_DAY_MINUTES = 23 * 60 + 59

const WEEKDAY: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
const PRIORITY: Record<string, 1 | 2 | 3 | 4> = { 紧急: 4, 高: 3, 中: 2, 低: 1 }

const TIME = String.raw`(?:\s*(?:(\d{1,2})[:：](\d{2})|(上午|中午|下午|晚上)?(\d{1,2})点(半|(\d{1,2})分)?))?`
const DATE_RE = new RegExp(
  String.raw`(大后天|后天|明天|明日|今天|今日|(下)?(?:周|星期)([一二三四五六日天])|(?:(\d{4})[-/年])?(\d{1,2})(?:[-/](\d{1,2})|月(\d{1,2})[日号]?))${TIME}`,
  'u',
)
const PRIORITY_RE = /[!！](紧急|高|中|低)/u
const NAME = String.raw`[^\s#~!！]+`
const TAG_RE = new RegExp(String.raw`#(${NAME})`, 'gu')
const SPACE_RE = new RegExp(String.raw`~(${NAME})`, 'u')

/** 周一为一周起点：本周 / 下周的某天 */
function weekdayDate(today: LocalDate, target: number, next: boolean): LocalDate {
  const monIdx = (d: number) => (d + 6) % 7 // 周一 0 … 周日 6
  const cur = monIdx(dayOfWeek(today))
  const want = monIdx(target)
  if (next) return addDays(today, 7 - cur + want)
  return addDays(today, want >= cur ? want - cur : 7 - cur + want)
}

function validDate(y: number, m: number, d: number): LocalDate | null {
  const t = addDays({ y, m, d }, 0)
  return t.y === y && t.m === m && t.d === d ? t : null
}

function parseDate(
  m: RegExpExecArray,
  today: LocalDate,
): { date: LocalDate; minutes: number | null } | null {
  const word = m[1] ?? ''
  let date: LocalDate | null = null
  if (word === '今天' || word === '今日') date = today
  else if (word === '明天' || word === '明日') date = addDays(today, 1)
  else if (word === '后天') date = addDays(today, 2)
  else if (word === '大后天') date = addDays(today, 3)
  else if (m[3]) date = weekdayDate(today, WEEKDAY[m[3]] ?? 0, !!m[2])
  else if (m[5]) {
    const month = Number(m[5])
    const day = Number(m[6] ?? m[7])
    if (m[4]) date = validDate(Number(m[4]), month, day)
    else {
      // 不写年：今年这天已过 → 明年
      const thisYear = validDate(today.y, month, day)
      date =
        thisYear && (thisYear.m > today.m || (thisYear.m === today.m && thisYear.d >= today.d))
          ? thisYear
          : validDate(today.y + 1, month, day)
    }
  }
  if (!date) return null
  let minutes: number | null = null
  if (m[8] !== undefined) {
    const h = Number(m[8])
    const min = Number(m[9])
    if (h > 23 || min > 59) return null
    minutes = h * 60 + min
  } else if (m[11] !== undefined) {
    let h = Number(m[11])
    if (h > 23) return null
    if ((m[10] === '下午' || m[10] === '晚上') && h < 12) h += 12
    const min = m[12] === '半' ? 30 : Number(m[13] ?? 0)
    if (min > 59) return null
    minutes = h * 60 + min
  }
  return { date, minutes }
}

export function parseQuickAdd(
  input: string,
  today: LocalDate,
  ignored: readonly string[] = [],
): QuickAddResult {
  const tokens: QuickToken[] = []
  const out: QuickAddResult = { title: input.trim(), tags: [], tokens }
  const skip = (text: string) => ignored.includes(text)

  const d = DATE_RE.exec(input)
  if (d && !skip(d[0].trim())) {
    const due = parseDate(d, today)
    if (due) {
      out.due = due
      tokens.push({ kind: 'date', text: d[0].trim(), start: d.index, end: d.index + d[0].length })
    }
  }
  const p = PRIORITY_RE.exec(input)
  if (p && !skip(p[0])) {
    out.priority = PRIORITY[p[1] as string]
    tokens.push({ kind: 'priority', text: p[0], start: p.index, end: p.index + p[0].length })
  }
  for (const t of input.matchAll(TAG_RE)) {
    if (skip(t[0]) || out.tags.includes(t[1] as string)) continue
    out.tags.push(t[1] as string)
    tokens.push({ kind: 'tag', text: t[0], start: t.index, end: t.index + t[0].length })
  }
  const s = SPACE_RE.exec(input)
  if (s && !skip(s[0])) {
    out.list = s[1]
    tokens.push({ kind: 'list', text: s[0], start: s.index, end: s.index + s[0].length })
  }
  // 去掉识别出的片段（不重叠：日期里不含 # ~ !）
  tokens.sort((a, b) => a.start - b.start)
  let title = ''
  let at = 0
  for (const t of tokens) {
    if (t.start < at) continue
    title += input.slice(at, t.start)
    at = t.end
  }
  title = (title + input.slice(at)).replace(/\s+/g, ' ').trim()
  if (!title) return { title: input.trim(), tags: [], tokens: [] }
  out.title = title
  return out
}

/** 识别出的截止 → ISO（按用户时区；无时间 = 23:59） */
export function quickDueIso(due: NonNullable<QuickAddResult['due']>, tz: string): string {
  const mins = due.minutes ?? ALL_DAY_MINUTES
  return new Date(zonedMidnight(tz, due.date).getTime() + mins * 60_000).toISOString()
}
