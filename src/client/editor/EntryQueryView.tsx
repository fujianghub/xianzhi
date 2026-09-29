/**
 * 查询块节点视图（ADR-0033、REQ-BUG-011 · 012）：按 attrs.query（记录页 search 白名单）以读者自己的权限实时查询，
 * 展示为 表格 / 统计（仅 Bug）/ 计数；标题栏可切视图、打开记录页、设置（可编辑时）。
 * 静态文档（历史版本 / 模板预览，StaticDoc 标记）只显示标题与链接，不请求数据。
 * 设置对话框保存时一次 updateAttributes（不逐键写，不变量 7）。
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { ArrowUpRight, Settings2, TableProperties } from 'lucide-react'
import { cloneElement, type FormEvent, type ReactElement, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ENTRY_KIND_VALUES,
  type EntryFilterSearch,
  parseEntryFilter,
  stringifyEntryFilter,
} from '../../shared/entry-search.ts'
import { BugStats } from '../components/domain/BugStats.tsx'
import { fieldSpecs } from '../components/domain/EntryFieldsForm.tsx'
import { EntryTable } from '../components/domain/EntryTable.tsx'
import { Button } from '../components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { Input } from '../components/ui/input.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import {
  BUG_SORTS,
  ENTRY_SORTS,
  type EntryKind,
  type EntryPage,
  entryStatsQuery,
} from '../lib/entry-queries.ts'
import { spacesQuery } from '../lib/space-queries.ts'
import { ENTRY_QUERY_VIEWS, type EntryQueryView as QueryView } from './nodes.ts'

/** 列表参数（去掉只属页面展示的 view / group）。 */
const listParams = (f: EntryFilterSearch) => {
  const { view: _v, group: _g, ...rest } = f
  return rest as Record<string, string>
}

export function EntryQueryView({ node, editor, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const filter = parseEntryFilter(String(node.attrs.query ?? ''))
  const view = (ENTRY_QUERY_VIEWS as readonly string[]).includes(node.attrs.view)
    ? (node.attrs.view as QueryView)
    : 'table'
  const limit = Math.min(50, Math.max(1, Number(node.attrs.limit) || 20))
  const title = String(node.attrs.title || '') || t('editor.query.untitled')
  const isStatic = !!(editor.storage as unknown as Record<string, unknown>).xzStaticDoc
  const writable = editor.isEditable && !isStatic
  const href = `/entries?${stringifyEntryFilter(filter)}`
  const isBug = filter.kind === 'bug'

  if (isStatic)
    return (
      <NodeViewWrapper as="div" className="my-3" data-testid="entry-query" data-static="">
        <a
          href={href}
          contentEditable={false}
          className="paper flex items-center gap-2 rounded-md border border-divider p-3 text-sm hover:bg-hover"
        >
          <TableProperties className="size-4 text-fg-muted" aria-hidden />
          <span className="font-medium">{title}</span>
          <span className="text-fg-muted text-xs">{t('editor.query.staticHint')}</span>
        </a>
      </NodeViewWrapper>
    )

  return (
    <NodeViewWrapper
      as="div"
      className="xz-entry-query paper my-3 rounded-lg border border-divider p-3"
      contentEditable={false}
      data-testid="entry-query"
      data-view={view}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2" data-drag-handle>
        <TableProperties className="size-4 text-fg-muted" aria-hidden />
        <span className="font-medium text-sm" data-testid="entry-query-title">
          {title}
        </span>
        <div className="ms-auto flex items-center gap-1">
          <fieldset className="flex rounded-full border border-border p-0.5 text-xs">
            <legend className="sr-only">{t('editor.query.view')}</legend>
            {ENTRY_QUERY_VIEWS.filter((v) => v !== 'stats' || isBug).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                disabled={!writable}
                onClick={() => updateAttributes({ view: v })}
                className={cn(
                  'h-6 rounded-full px-2',
                  view === v ? 'bg-selected' : 'text-fg-muted enabled:hover:bg-hover',
                )}
                data-testid={`entry-query-view-${v}`}
              >
                {t(`editor.query.views.${v}`)}
              </button>
            ))}
          </fieldset>
          <Link
            to="/entries"
            search={filter}
            className="inline-grid size-7 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            title={t('editor.query.open')}
            aria-label={t('editor.query.open')}
            data-testid="entry-query-open"
          >
            <ArrowUpRight className="size-4" />
          </Link>
          {writable ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-grid size-7 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
              title={t('editor.query.settings')}
              aria-label={t('editor.query.settings')}
              data-testid="entry-query-settings"
            >
              <Settings2 className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      {view === 'stats' && isBug ? (
        <BugStats params={listParams(filter)} compact />
      ) : (
        <QueryResult filter={filter} limit={limit} count={view === 'count'} />
      )}
      {writable ? (
        <QuerySettings
          open={editing}
          onClose={() => setEditing(false)}
          initial={{ title: String(node.attrs.title || ''), filter, view, limit }}
          onSave={(v) => {
            updateAttributes({
              title: v.title,
              query: stringifyEntryFilter(v.filter),
              view: v.view,
              limit: v.limit,
            })
            setEditing(false)
          }}
        />
      ) : null}
    </NodeViewWrapper>
  )
}

function QueryResult({
  filter,
  limit,
  count,
}: {
  filter: EntryFilterSearch
  limit: number
  count: boolean
}) {
  const { t } = useTranslation()
  const params = listParams(filter)
  const { sort: _s, pinned: _p, ...statsParams } = params
  const total = useQuery(entryStatsQuery(statsParams))
  const list = useQuery({
    queryKey: ['entries', 'query-block', params, limit],
    queryFn: () =>
      unwrap<EntryPage>(api.entries.$get({ query: { ...params, limit: String(limit) } as never })),
    enabled: !count,
    staleTime: 15_000,
  })
  if (count)
    return (
      <p className="flex items-baseline gap-2" data-testid="entry-query-count">
        <span className="font-semibold text-3xl tabular-nums">{total.data?.total ?? '…'}</span>
        <span className="text-fg-muted text-sm">{t('editor.query.countUnit')}</span>
      </p>
    )
  if (list.isPending) return <Skeleton className="h-24 w-full" />
  const items = list.data?.items ?? []
  if (!items.length)
    return <p className="py-3 text-center text-fg-muted text-sm">{t('editor.query.empty')}</p>
  const kinds = (filter.kind?.split(',') ?? []) as EntryKind[]
  return (
    <>
      <EntryTable items={items} kinds={kinds} showSpace={!filter.spaceId} />
      {total.data && total.data.total > items.length ? (
        <p className="mt-2 text-fg-muted text-xs" data-testid="entry-query-more">
          {t('editor.query.more', { shown: items.length, total: total.data.total })}
        </p>
      ) : null}
    </>
  )
}

interface Settings {
  title: string
  filter: EntryFilterSearch
  view: QueryView
  limit: number
}

/** 设置：标题 · 空间 · 类型 · 该类型的枚举属性 · 排序 · 视图 · 条数。 */
function QuerySettings({
  open,
  onClose,
  initial,
  onSave,
}: {
  open: boolean
  onClose: () => void
  initial: Settings
  onSave: (v: Settings) => void
}) {
  const { t } = useTranslation()
  const spaces = useQuery({ ...spacesQuery(), enabled: open })
  const [v, setV] = useState(initial)
  const baseId = useId()
  // biome-ignore lint/correctness/useExhaustiveDependencies: 每次打开从当前 attrs 重置
  useEffect(() => {
    if (open) setV(initial)
  }, [open])
  const kind =
    v.filter.kind && !v.filter.kind.includes(',') ? (v.filter.kind as EntryKind) : undefined
  const fieldMap = Object.fromEntries(
    (v.filter.fields ?? '')
      .split(',')
      .map((p) => p.split('='))
      .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]),
  )
  const specs = kind ? fieldSpecs(kind).filter((f) => f.kind === 'select') : []
  const setFilter = (patch: Partial<EntryFilterSearch>) =>
    setV((s) => ({ ...s, filter: { ...s.filter, ...patch } }))
  const setField = (name: string, value: string) => {
    const next = { ...fieldMap, [name]: value }
    const parts = Object.entries(next)
      .filter(([, x]) => x)
      .map(([k, x]) => `${k}=${x}`)
    setFilter({ fields: parts.length ? parts.join(',') : undefined })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      ...v,
      title: v.title.trim(),
      view: v.view === 'stats' && kind !== 'bug' ? 'table' : v.view,
    })
  }
  const sel = 'h-9 w-full rounded-md border border-border bg-surface px-2 text-sm'
  // 每行 label 以 htmlFor 关联控件（控件 id = 前缀 + 标签序号）
  let seq = 0
  const row = (label: string, control: ReactElement<{ id?: string }>) => {
    const id = `${baseId}-${seq++}`
    return (
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={id} className="text-fg-muted text-xs">
          {label}
        </label>
        {cloneElement(control, { id })}
      </div>
    )
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(92vw,32rem)]" data-testid="entry-query-dialog">
        <DialogTitle>{t('editor.query.settings')}</DialogTitle>
        <DialogDescription className="text-fg-muted text-sm">
          {t('editor.query.settingsHint')}
        </DialogDescription>
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {row(
              t('editor.query.titleLabel'),
              <Input
                value={v.title}
                onChange={(e) => setV((s) => ({ ...s, title: e.target.value }))}
                placeholder={t('editor.query.untitled')}
                maxLength={60}
                data-testid="entry-query-title-input"
              />,
            )}
          </div>
          {row(
            t('space.space'),
            <select
              className={sel}
              value={v.filter.spaceId ?? ''}
              onChange={(e) =>
                setFilter({ spaceId: e.target.value || undefined, under: undefined })
              }
              data-testid="entry-query-space"
            >
              <option value="">{t('editor.query.allSpaces')}</option>
              {(spaces.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.isPersonal ? t('space.personal') : s.name}
                </option>
              ))}
            </select>,
          )}
          {row(
            t('entry.props.kind'),
            <select
              className={sel}
              value={kind ?? ''}
              onChange={(e) =>
                setFilter({
                  kind: e.target.value || undefined,
                  fields: undefined,
                  typeId: undefined,
                })
              }
              data-testid="entry-query-kind"
            >
              <option value="">{t('entry.allKinds')}</option>
              {ENTRY_KIND_VALUES.map((k) => (
                <option key={k} value={k}>
                  {t(`entry.kind.${k}`)}
                </option>
              ))}
            </select>,
          )}
          {specs.map((f) =>
            f.kind === 'select' ? (
              <div key={f.name}>
                {row(
                  t(`entry.field.${f.name}`),
                  <select
                    className={sel}
                    value={fieldMap[f.name] ?? ''}
                    onChange={(e) => setField(f.name, e.target.value)}
                    data-testid={`entry-query-field-${f.name}`}
                  >
                    <option value="">{t('entry.allKinds')}</option>
                    {kind === 'bug' && f.name === 'status' ? (
                      <option value="new|pending">{t('bug.stats.open')}</option>
                    ) : null}
                    {f.options.map((o) => (
                      <option key={String(o)} value={String(o)}>
                        {t(`entry.fieldValue.${o}`, { defaultValue: String(o) })}
                      </option>
                    ))}
                  </select>,
                )}
              </div>
            ) : null,
          )}
          {row(
            t('entry.sortLabel'),
            <select
              className={sel}
              value={v.filter.sort ?? '-updatedAt'}
              onChange={(e) =>
                setFilter({
                  sort:
                    e.target.value === '-updatedAt'
                      ? undefined
                      : (e.target.value as EntryFilterSearch['sort']),
                })
              }
            >
              {[...ENTRY_SORTS, ...(kind === 'bug' ? BUG_SORTS : [])].map((s) => (
                <option key={s} value={s}>
                  {t(`entry.sort.${s}`)}
                </option>
              ))}
            </select>,
          )}
          {row(
            t('editor.query.view'),
            <select
              className={sel}
              value={v.view}
              onChange={(e) => setV((s) => ({ ...s, view: e.target.value as QueryView }))}
              data-testid="entry-query-view-select"
            >
              {ENTRY_QUERY_VIEWS.filter((x) => x !== 'stats' || kind === 'bug').map((x) => (
                <option key={x} value={x}>
                  {t(`editor.query.views.${x}`)}
                </option>
              ))}
            </select>,
          )}
          {row(
            t('editor.query.limit'),
            <Input
              type="number"
              min={1}
              max={50}
              value={v.limit}
              onChange={(e) =>
                setV((s) => ({
                  ...s,
                  limit: Math.min(50, Math.max(1, Number(e.target.value) || 1)),
                }))
              }
            />,
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('ui.action.cancel')}
            </Button>
            <Button type="submit" variant="primary" data-testid="entry-query-save">
              {t('ui.action.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
