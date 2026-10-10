/**
 * 日期属性的选择器（ADR-0056、REQ-ENTRY-042）：FieldEditor 的日期分支，属性面板 / 表格 / 模板元数据共用。
 * - 快选（昨天 · 今天 · 明天）+ 月历：点一下即提交；越界日期（`min` / `max`，如 Bug 发现日期不晚于今天）置灰。
 * - 文本框只在回车时按完整日期提交（YYYY-MM-DD，也认 / 和 .）——不用原生日期框：它逐段改值即触发 change，
 *   「选中即提交」会把半截日期（0005-02-02）存进去并立刻关掉弹层（debug/2026-10-09-date-field-commit-per-keystroke）。
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addDays,
  addMonths,
  formatLocalDate,
  type LocalDate,
  localDateOf,
  parseLocalDate,
} from '../../../shared/tz.ts'
import { useMe } from '../../hooks/useMe.ts'
import { MiniMonth } from '../calendar/MiniMonth.tsx'
import { Input } from '../ui/input.tsx'
import { useUserTimeZone } from '../ui/relative-time.tsx'

/** 「2026-10-1」「2026/10/01」「2026.10.1」→ 2026-10-01；不合法返回 null */
export function parseDateText(s: string): string | null {
  const m = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*$/.exec(s)
  if (!m) return null
  const d = parseLocalDate(`${m[1]}-${m[2]?.padStart(2, '0')}-${m[3]?.padStart(2, '0')}`)
  return d ? formatLocalDate(d) : null
}

export function DateFieldPicker({
  name,
  label,
  value,
  required,
  min,
  max,
  onCommit,
}: {
  name: string
  label: string
  value: unknown
  required?: boolean
  /** 可选范围（含端点，YYYY-MM-DD） */
  min?: string
  max?: string
  /** `undefined` = 清空 */
  onCommit: (v: string | undefined) => void
}) {
  const { t } = useTranslation()
  const { tz } = useUserTimeZone()
  const { data: me } = useMe()
  const today = localDateOf(tz, new Date())
  const cur = typeof value === 'string' ? parseLocalDate(value) : null
  const [month, setMonth] = useState<LocalDate>(cur ?? today)
  const [draft, setDraft] = useState(cur ? formatLocalDate(cur) : '')
  const [bad, setBad] = useState<'format' | 'range' | null>(null)
  // 与服务端 isoDate 同口径（1900 ~ 2999 年）
  const outOf = (k: string) =>
    k < '1900-01-01' || k > '2999-12-31' || (!!min && k < min) || (!!max && k > max)
  const pick = (d: LocalDate) => {
    const k = formatLocalDate(d)
    if (!outOf(k)) onCommit(k)
  }
  const quick = [
    { key: 'yesterday', d: addDays(today, -1) },
    { key: 'today', d: today },
    { key: 'tomorrow', d: addDays(today, 1) },
  ]
  const navBtn = 'grid size-7 place-items-center rounded-md hover:bg-hover'
  return (
    <div className="flex flex-col gap-2 p-1" data-testid={`date-picker-${name}`}>
      <div className="grid grid-cols-3 gap-1">
        {quick.map((q) => {
          const k = formatLocalDate(q.d)
          return (
            <button
              key={q.key}
              type="button"
              onClick={() => pick(q.d)}
              disabled={outOf(k)}
              aria-pressed={!!cur && formatLocalDate(cur) === k}
              title={k}
              className="xz-picker-quick disabled:cursor-not-allowed disabled:opacity-40"
              data-testid={`date-quick-${q.key}`}
            >
              <span className="font-semibold text-sm tabular-nums">{q.d.d}</span>
              <span className="text-[11px]">{t(`field.dateQuick.${q.key}`)}</span>
            </button>
          )
        })}
      </div>
      <div className="border-divider border-t pt-2">
        <MiniMonth
          month={month}
          weekStartsOn={me?.weekStartsOn ?? 1}
          today={today}
          selected={cur}
          onPick={pick}
          isDisabled={(d) => outOf(formatLocalDate(d))}
          compact
          header={
            <div className="flex items-center justify-between px-1 text-sm">
              <span className="font-medium tabular-nums" data-testid="date-picker-month">
                {month.y} / {month.m}
              </span>
              <span className="flex">
                <button
                  type="button"
                  aria-label={t('calendar.prevMonth')}
                  onClick={() => setMonth((m) => addMonths(m, -1))}
                  className={navBtn}
                  data-testid="date-picker-prev"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={t('calendar.nextMonth')}
                  onClick={() => setMonth((m) => addMonths(m, 1))}
                  className={navBtn}
                  data-testid="date-picker-next"
                >
                  <ChevronRight className="size-4" />
                </button>
              </span>
            </div>
          }
        />
      </div>
      <form
        className="flex items-center gap-1 border-divider border-t pt-2"
        onSubmit={(e) => {
          e.preventDefault()
          const k = parseDateText(draft)
          if (!k) return setBad('format')
          if (outOf(k)) return setBad('range')
          onCommit(k)
        }}
      >
        <Input
          aria-label={label}
          value={draft}
          placeholder="YYYY-MM-DD"
          inputMode="numeric"
          invalid={!!bad}
          onChange={(e) => {
            setDraft(e.target.value)
            setBad(null)
            // 键入完整日期时月历跟过去（不提交）
            const k = parseDateText(e.target.value)
            const d = k ? parseLocalDate(k) : null
            if (d) setMonth(d)
          }}
          className="h-8 flex-1 tabular-nums"
          data-testid={`field-input-${name}`}
        />
        {required ? null : (
          <button
            type="button"
            onClick={() => onCommit(undefined)}
            disabled={!cur}
            className="h-8 shrink-0 rounded-md px-2 text-fg-muted text-xs hover:bg-hover disabled:opacity-50"
            data-testid="field-clear"
          >
            {t('field.clear')}
          </button>
        )}
      </form>
      {bad ? (
        <p className="px-1 text-danger text-xs" role="alert" data-testid="date-picker-error">
          {bad === 'format'
            ? t('field.dateInvalid')
            : t('field.dateRange', { min: min ?? '1900-01-01', max: max ?? '2999-12-31' })}
        </p>
      ) : null}
    </div>
  )
}
