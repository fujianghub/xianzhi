/**
 * Bug 统计视图（ADR-0033、REQ-BUG-008）：记录页 `view=stats`（只选 Bug）与查询块共用。
 * 概要卡 · 分布（状态 / 优先级 / 严重度 / 模块，点击即筛选）· 趋势（新增 / 关闭柱 + 未关闭存量线，悬停看数，可切表格）·
 * 修复时长（按优先级）· 未关闭账龄。数据来自 `/entries/stats` 与 `/entries/bug-stats`，与列表同口径。
 * 图形自绘（不引图表库）：颜色只取 token（新增 = 粉、关闭 = 蓝、存量 = 紫，已过色觉校验；分布单系列用主色）。
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { type EntryStatsParams, entryStatsQuery } from '../../lib/entry-queries.ts'
import { Skeleton } from '../ui/skeleton.tsx'
import { useFieldSpecs } from './FieldValue.tsx'

const RANGES = [
  { key: '4w', bucket: 'week', days: 28 },
  { key: '12w', bucket: 'week', days: 84 },
  { key: '26w', bucket: 'week', days: 182 },
  { key: '12m', bucket: 'month', days: 365 },
] as const
type RangeKey = (typeof RANGES)[number]['key']

export interface BugStatsData {
  from: string
  to: string
  bucket: 'week' | 'month'
  summary: { total: number; open: number; p0Open: number; closedInRange: number; reopened: number }
  trend: { start: string; created: number; resolved: number; open: number }[]
  mttr: { priority: string; n: number; avgDays: number; medianDays: number }[]
  aging: { key: string; n: number }[]
}

/** 筛选参数（列表同口径，kind 固定 bug）。 */
export type BugStatsParams = Omit<EntryStatsParams, 'kind' | 'typeId' | 'groupBy'>

const clean = (p: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== ''))

export const bugStatsQuery = (p: BugStatsParams & { from?: string; bucket?: string }) => ({
  queryKey: ['entries', 'bug-stats', clean(p as Record<string, string | undefined>)] as const,
  queryFn: () =>
    unwrap<BugStatsData>(
      api.entries['bug-stats'].$get({
        query: clean(p as Record<string, string | undefined>) as never,
      }),
    ),
  staleTime: 15_000,
})

const isoDaysAgo = (days: number) => {
  const d = new Date(Date.now() - days * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function BugStats({
  params,
  onFilter,
  compact,
}: {
  params: BugStatsParams
  /** 点分布条 = 追加 fields 过滤（记录页）；查询块里不给 */
  onFilter?: (field: string, value: string) => void
  /** 查询块：只显示概要与趋势 */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [range, setRange] = useState<RangeKey>('12w')
  const r = RANGES.find((x) => x.key === range) ?? RANGES[1]
  const report = useQuery(
    bugStatsQuery({ ...params, from: isoDaysAgo(r.days - 1), bucket: r.bucket }),
  )
  // 字段规格已套代码字段覆盖（ADR-0042）：被隐藏的字段不出分布卡，显示名 / 选项名取覆盖
  const specs = useFieldSpecs()('bug')
  const specOf = (name: string) => specs.find((f) => f.name === name)
  const dist = (groupBy: string) => ({
    ...entryStatsQuery({ ...params, kind: 'bug', groupBy }),
    enabled: !compact && !!specOf(groupBy),
  })
  const byStatus = useQuery(dist('status'))
  const byPriority = useQuery(dist('priority'))
  const bySeverity = useQuery(dist('severity'))
  const byModule = useQuery(dist('module'))
  const counts = (d: typeof byStatus.data, key: string) =>
    new Map((d?.groups ?? []).map((g) => [g.values[key] ?? '', g.n]))

  if (report.isPending) return <Skeleton className="h-64 w-full rounded-lg" />
  const data = report.data
  if (!data) return <p className="text-fg-muted text-sm">{t('bug.stats.loadFailed')}</p>
  const s = data.summary
  return (
    <div className="flex flex-col gap-4" data-testid="bug-stats">
      <div className="flex flex-wrap items-center gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-5">
          <Tile label={t('bug.stats.total')} value={s.total} testId="total" />
          <Tile label={t('bug.stats.open')} value={s.open} testId="open" />
          {specOf('priority') ? (
            <Tile label={t('bug.stats.p0Open')} value={s.p0Open} testId="p0Open" />
          ) : null}
          <Tile label={t('bug.stats.closedInRange')} value={s.closedInRange} testId="closed" />
          <Tile label={t('bug.stats.reopened')} value={s.reopened} testId="reopened" />
        </div>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          aria-label={t('bug.stats.range')}
          className="h-8 rounded-full border border-border bg-surface px-3 text-sm"
          data-testid="bug-stats-range"
        >
          {RANGES.map((x) => (
            <option key={x.key} value={x.key}>
              {t(`bug.stats.ranges.${x.key}`)}
            </option>
          ))}
        </select>
      </div>

      <Card title={t('bug.stats.trend')} hint={t('bug.stats.trendHint')}>
        <Trend data={data} />
      </Card>

      {compact ? null : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {(
              [
                ['status', byStatus.data],
                ['priority', byPriority.data],
                ['severity', bySeverity.data],
              ] as const
            ).map(([name, d]) => {
              const spec = specOf(name)
              if (!spec) return null
              const n = counts(d, name)
              // 严重度从高到低（代码定义是低 → 高）
              const opts = name === 'severity' ? [...spec.options].reverse() : spec.options
              return (
                <Card key={name} title={spec.label}>
                  <BarList
                    rows={opts
                      .filter((o) => !o.hidden || (n.get(String(o.value)) ?? 0) > 0)
                      .map((o) => ({
                        key: String(o.value),
                        label: o.label,
                        n: n.get(String(o.value)) ?? 0,
                      }))}
                    onPick={onFilter ? (v) => onFilter(name, v) : undefined}
                    testId={`dist-${name}`}
                  />
                </Card>
              )
            })}
            {specOf('module') ? (
              <Card title={specOf('module')?.label ?? ''}>
                <BarList
                  rows={(byModule.data?.groups ?? []).slice(0, 8).map((g) => ({
                    key: g.values.module ?? '',
                    label: g.values.module ?? t('entry.group.empty'),
                    n: g.n,
                  }))}
                  onPick={onFilter ? (v) => v && onFilter('module', v) : undefined}
                  testId="dist-module"
                />
              </Card>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {specOf('priority') ? (
              <Card title={t('bug.stats.mttr')} hint={t('bug.stats.mttrHint')}>
                <table className="w-full text-sm" data-testid="bug-mttr">
                  <thead className="text-fg-muted text-xs">
                    <tr>
                      <th scope="col" className="py-1 text-left font-medium">
                        {specOf('priority')?.label}
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        {t('bug.stats.fixedCount')}
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        {t('bug.stats.avgDays')}
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        {t('bug.stats.medianDays')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {data.mttr.map((m) => (
                      <tr key={m.priority} className="border-divider border-t">
                        <td className="py-1.5">
                          {specOf('priority')?.options.find((o) => o.value === m.priority)?.label ??
                            m.priority}
                        </td>
                        <td className="py-1.5 text-right">{m.n}</td>
                        <td className="py-1.5 text-right">{m.n ? m.avgDays : '—'}</td>
                        <td className="py-1.5 text-right">{m.n ? m.medianDays : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : null}
            <Card title={t('bug.stats.aging')} hint={t('bug.stats.agingHint')}>
              <BarList
                rows={data.aging.map((a) => ({
                  key: a.key,
                  label: t(`bug.stats.agingBucket.${a.key}`),
                  n: a.n,
                }))}
                testId="bug-aging"
              />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div
      className="rounded-lg border border-divider bg-surface px-3 py-2"
      data-testid={`bug-tile-${testId}`}
    >
      <p className="text-fg-muted text-xs">{label}</p>
      <p className="font-semibold text-xl tabular-nums">{value}</p>
    </div>
  )
}

function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="paper rounded-lg p-3">
      <h3 className="mb-2 font-medium text-sm">{title}</h3>
      {children}
      {hint ? <p className="mt-2 text-fg-faint text-xs">{hint}</p> : null}
    </section>
  )
}

/** 单系列横向条形列表：主色填充、4px 圆角、数值用文字色（不用系列色）。 */
function BarList({
  rows,
  onPick,
  testId,
}: {
  rows: { key: string; label: string; n: number }[]
  onPick?: (key: string) => void
  testId: string
}) {
  const { t } = useTranslation()
  const max = Math.max(1, ...rows.map((r) => r.n))
  if (!rows.length) return <p className="text-fg-faint text-xs">{t('bug.stats.empty')}</p>
  return (
    <ul className="flex flex-col gap-1.5" data-testid={testId}>
      {rows.map((r) => {
        const inner = (
          <>
            <span className="w-16 shrink-0 truncate text-left text-xs">{r.label}</span>
            <span className="relative h-3 flex-1">
              <span
                className="absolute inset-y-0 left-0 rounded-r-sm bg-primary"
                style={{ width: `${(r.n / max) * 100}%`, minWidth: r.n ? 2 : 0 }}
              />
            </span>
            <span className="w-8 shrink-0 text-right text-fg-muted text-xs tabular-nums">
              {r.n}
            </span>
          </>
        )
        return (
          <li key={r.key} data-key={r.key} data-n={r.n}>
            {onPick ? (
              <button
                type="button"
                onClick={() => onPick(r.key)}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 hover:bg-hover"
                title={t('bug.stats.filterBy', { value: r.label })}
              >
                {inner}
              </button>
            ) : (
              <div className="flex items-center gap-2 px-1 py-0.5">{inner}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** 趋势：新增 / 关闭为分组柱，未关闭存量为折线；同一计数轴（单轴）。悬停 / 聚焦某桶看数；可切表格。 */
function Trend({ data }: { data: BugStatsData }) {
  const { t } = useTranslation()
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const rows = data.trend
  const n = rows.length
  const max = Math.max(1, ...rows.flatMap((r) => [r.created, r.resolved, r.open]))
  const step = Math.max(1, Math.ceil(n / 8))
  const label = (s: string) =>
    data.bucket === 'month' ? s.slice(0, 7) : `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`
  const legend = [
    { key: 'created', cls: 'bg-pink-solid', label: t('bug.stats.created') },
    { key: 'resolved', cls: 'bg-blue-solid', label: t('bug.stats.resolved') },
    { key: 'open', cls: 'bg-purple-solid', label: t('bug.stats.backlog') },
  ]
  const cur = hover !== null ? rows[hover] : undefined
  return (
    <div data-testid="bug-trend">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-fg-muted text-xs">
        {legend.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-sm', l.cls)} aria-hidden />
            {l.label}
          </span>
        ))}
        <button
          type="button"
          className="ms-auto rounded px-1.5 py-0.5 hover:bg-hover"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          data-testid="bug-trend-table-toggle"
        >
          {t(asTable ? 'bug.stats.asChart' : 'bug.stats.asTable')}
        </button>
      </div>
      {asTable ? (
        <table className="w-full text-sm tabular-nums" data-testid="bug-trend-table">
          <thead className="text-fg-muted text-xs">
            <tr>
              <th scope="col" className="py-1 text-left font-medium">
                {t('bug.stats.period')}
              </th>
              {legend.map((l) => (
                <th key={l.key} scope="col" className="py-1 text-right font-medium">
                  {l.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.start} className="border-divider border-t">
                <td className="py-1">{r.start}</td>
                <td className="py-1 text-right">{r.created}</td>
                <td className="py-1 text-right">{r.resolved}</td>
                <td className="py-1 text-right">{r.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          {/* 刻度：0 / 一半 / 最大，横线弱化 */}
          <div className="relative ms-7 h-40">
            {[1, 0.5, 0].map((f) => (
              <div
                key={f}
                className="absolute inset-x-0 border-divider border-t"
                style={{ bottom: `${f * 100}%` }}
              >
                <span className="-translate-y-1/2 absolute -left-7 w-6 text-right text-[10px] text-fg-faint tabular-nums">
                  {Math.round(max * f)}
                </span>
              </div>
            ))}
            <div className="absolute inset-0 flex">
              {rows.map((r, i) => (
                <button
                  type="button"
                  key={r.start}
                  className={cn('relative flex-1', hover === i && 'bg-hover')}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={t('bug.stats.bucketAria', {
                    period: r.start,
                    created: r.created,
                    resolved: r.resolved,
                    open: r.open,
                  })}
                  data-testid="bug-trend-bucket"
                >
                  {/* 绝对定位容器给出确定高度，柱高百分比才生效（按钮作为被拉伸的 flex 项不算确定高度） */}
                  <span className="absolute inset-0 flex items-end justify-center gap-0.5 px-[12%]">
                    <span
                      className="w-1/2 max-w-3 rounded-t-sm bg-pink-solid"
                      style={{ height: `${(r.created / max) * 100}%` }}
                    />
                    <span
                      className="w-1/2 max-w-3 rounded-t-sm bg-blue-solid"
                      style={{ height: `${(r.resolved / max) * 100}%` }}
                    />
                  </span>
                </button>
              ))}
            </div>
            {/* 存量折线：非缩放描边，点为 HTML（不随 viewBox 变形） */}
            <svg
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
              viewBox={`0 0 ${n} 100`}
              preserveAspectRatio="none"
              aria-hidden
            >
              <polyline
                points={rows.map((r, i) => `${i + 0.5},${100 - (r.open / max) * 100}`).join(' ')}
                fill="none"
                className="stroke-purple-solid"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {rows.map((r, i) => (
              <span
                key={r.start}
                aria-hidden
                className="-translate-x-1/2 pointer-events-none absolute size-2 translate-y-1/2 rounded-full bg-purple-solid ring-2 ring-surface"
                style={{ left: `${((i + 0.5) / n) * 100}%`, bottom: `${(r.open / max) * 100}%` }}
              />
            ))}
            {cur && hover !== null ? (
              <div
                role="status"
                className="glass-opaque -translate-x-1/2 pointer-events-none absolute top-0 z-10 rounded-md px-2 py-1 text-xs"
                style={{ left: `${Math.min(85, Math.max(15, ((hover + 0.5) / n) * 100))}%` }}
                data-testid="bug-trend-tip"
              >
                <p className="font-medium">{cur.start}</p>
                {legend.map((l) => (
                  <p key={l.key} className="flex items-center gap-1.5 tabular-nums">
                    <span className={cn('size-2 rounded-sm', l.cls)} aria-hidden />
                    {l.label} {cur[l.key as 'created' | 'resolved' | 'open']}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <div className="ms-7 mt-1 flex text-[10px] text-fg-faint">
            {rows.map((r, i) => (
              <span key={r.start} className="flex-1 text-center">
                {i % step === 0 ? label(r.start) : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
