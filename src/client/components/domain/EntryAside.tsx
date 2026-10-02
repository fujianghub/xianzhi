/**
 * 记录 Aside（04 §4、08 §2.9、T1-017）：`?aside=outline|backlinks|comments|props|history`。
 * 大纲：实时标题，点击跳转；属性：可见性、所在空间（移动，REQ-ENTRY-011）、标记版本（REQ-COLLAB-007）、作者与时间。
 * 历史：快照列表 → 预览 / 对比 / 恢复（REQ-COLLAB-008）；关联：出链 / 反链 / Bug ↔ 迭代（ADR-0012）；评论随 T1-023 接入。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Tag } from 'lucide-react'
import {
  type CSSProperties,
  type FormEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { versionStamp } from '../../../shared/schemas/versions.ts'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { ApiError, api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { type Entry, type EntryKind, treeQuery } from '../../lib/entry-queries.ts'
import { kindKey, useKindLabel, useKindOptions } from '../../lib/entry-types.ts'
import { useReading } from '../../lib/reading.ts'
import { type Space, spacesQuery } from '../../lib/space-queries.ts'
import { useCommentDraft, useOutline } from '../../lib/stores.ts'
import { templateListQuery } from '../../lib/template-queries.ts'
import { childrenMap, flatten } from '../../lib/tree.ts'
import { newId } from '../../lib/uuid.ts'
import { Button } from '../ui/button.tsx'
import { Checkbox } from '../ui/checkbox.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Input } from '../ui/input.tsx'
import { RelativeTime } from '../ui/relative-time.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { Comments } from './Comments.tsx'
import { EntryRelations } from './EntryRelations.tsx'

type SnapshotMeta = import('../../editor/SnapshotPreview.tsx').SnapshotMeta
const SnapshotPreview = lazy(() => import('../../editor/SnapshotPreview.tsx'))

export const ASIDE_TABS = ['outline', 'props', 'backlinks', 'comments', 'history'] as const
export type AsideTab = (typeof ASIDE_TABS)[number]

interface Snapshot {
  id: string
  label: string | null
  createdAt: string
}

export function EntryAside({
  entry,
  tab,
  onTab,
  canWrite,
  me,
}: {
  entry: Entry
  tab: AsideTab
  onTab: (t: AsideTab) => void
  canWrite: boolean
  me: { id: string; workspaceRole: string }
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4" data-testid="entry-aside">
      <div role="tablist" aria-label={t('ui.nav.views')} className="flex flex-wrap gap-1">
        {ASIDE_TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            data-testid={`aside-tab-${k}`}
            onClick={() => onTab(k)}
            className={cn(
              'h-7 rounded-full px-2.5 text-xs',
              tab === k ? 'bg-selected font-medium' : 'text-fg-muted hover:bg-hover',
            )}
          >
            {t(`entry.aside.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'outline' ? <Outline /> : null}
        {tab === 'props' ? <Props entry={entry} canWrite={canWrite} me={me} /> : null}
        {tab === 'comments' ? <EntryComments entry={entry} me={me} /> : null}
        {tab === 'history' ? <History entry={entry} canWrite={canWrite} /> : null}
        {tab === 'backlinks' ? <EntryRelations entry={entry} canWrite={canWrite} /> : null}
      </div>
    </div>
  )
}

/** 正文里标题的 DOM（与 collectHeadings 同序：h1–h4，含提示块 / 折叠块里的）。 */
const headingEls = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-testid="editor"] :is(h1, h2, h3, h4)'))

/** 当前阅读位置对应的标题下标（顶栏 + 吸顶工具栏之下第一屏；rAF 节流）。 */
function useActiveHeading(count: number): number {
  const [active, setActive] = useState(-1)
  useEffect(() => {
    if (!count) return
    let raf = 0
    const compute = () => {
      raf = 0
      const bar = document.querySelector('[data-testid="editor-toolbar"]')
      const line = (bar?.getBoundingClientRect().bottom ?? 120) + 16
      const els = headingEls()
      let idx = els.length ? 0 : -1
      for (let i = 0; i < els.length; i++) {
        const el = els[i] as HTMLElement
        if (el.offsetParent === null) continue // 折叠块里隐藏的标题不参与
        if (el.getBoundingClientRect().top <= line) idx = i
        else break
      }
      // 已滚到页底：末尾几个标题永远到不了顶部，直接算最后一个可见标题
      const doc = document.documentElement
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
        for (let i = els.length - 1; i >= 0; i--)
          if ((els[i] as HTMLElement).offsetParent !== null) {
            idx = i
            break
          }
      }
      setActive(idx)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute)
    }
    compute()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [count])
  return active
}

/**
 * 右侧目录（ADR-0026，参考简斋 TocPanel）：自动编号（tocNumbers，默认开；与正文编号分开）、
 * 按编号层级缩进并画层级引导线、当前标题高亮（随滚动）、目录深度过滤。
 */
function Outline() {
  const { t } = useTranslation()
  const all = useOutline((s) => s.items)
  const jump = useOutline((s) => s.jump)
  const depth = useReading((s) => s.prefs.tocDepth)
  const numbered = useReading((s) => s.prefs.tocNumbers)
  const active = useActiveHeading(all.length)
  const activePos = all[active]?.pos
  // 当前项滚进 Aside 可视区（长目录）
  useEffect(() => {
    if (activePos === undefined) return
    document
      .querySelector('[data-testid="outline"] [data-active]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activePos])
  if (!all.some((h) => h.depth <= depth))
    return <p className="text-fg-muted text-sm">{t('entry.aside.outlineEmpty')}</p>
  return (
    <ol className="xz-outline flex flex-col gap-0.5 text-sm" data-testid="outline">
      {all.map((h) =>
        h.depth > depth ? null : (
          <li
            key={h.pos}
            className="xz-outline-item"
            style={{ '--xz-outline-depth': h.depth - 1 } as CSSProperties}
            data-depth={h.depth}
            data-active={h.pos === activePos || undefined}
          >
            <button
              type="button"
              className="w-full truncate rounded px-1.5 py-1 text-left hover:bg-hover"
              onClick={() => jump?.(h.pos)}
              aria-current={h.pos === activePos ? 'location' : undefined}
            >
              {numbered ? (
                <span className="me-1.5 text-fg-muted tabular-nums" data-testid="outline-num">
                  {h.num}
                </span>
              ) : null}
              {h.text || '…'}
            </button>
          </li>
        ),
      )}
    </ol>
  )
}

function Props({
  entry,
  canWrite,
  me,
}: {
  entry: Entry
  canWrite: boolean
  me: { id: string; workspaceRole: string }
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const actions = useEntryActions()
  const spaces = useQuery(spacesQuery())
  const snaps = useQuery({
    queryKey: ['entry', entry.id, 'snapshots'],
    queryFn: () =>
      unwrap<{ items: Snapshot[] }>(api.entries[':id'].snapshots.$get({ param: { id: entry.id } })),
  })
  const [label, setLabel] = useState('')
  const mark = useMutation({
    mutationFn: (l: string) =>
      unwrap<Snapshot>(
        api.entries[':id'].snapshots.$post({ param: { id: entry.id }, json: { label: l } }),
      ),
    onSuccess: () => {
      toast.success(t('entry.aside.marked'))
      setLabel('')
      void qc.invalidateQueries({ queryKey: ['entry', entry.id, 'snapshots'] })
    },
    onError: () => toast.error(t('task.saveFailed')),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (label.trim()) mark.mutate(label.trim())
  }
  const current = spaces.data?.find((s) => s.id === entry.spaceId)
  const personal = !!current?.isPersonal
  const [leaveTree, setLeaveTree] = useState<Space | null>(null)
  const moveSpace = (target: Space) =>
    void actions
      .patch(entry, {
        spaceId: target.id,
        // 个人空间只能 private；离开个人空间默认 space（REQ-ENTRY-003）
        ...(target.isPersonal
          ? { visibility: 'private' as const }
          : personal
            ? { visibility: 'space' as const }
            : {}),
      })
      .then(() =>
        toast.success(
          t('entry.aside.moved', {
            space: target.isPersonal ? t('space.personal') : target.name,
          }),
        ),
      )
  const row = 'flex flex-col gap-1 text-sm'
  const labelCls = 'text-fg-muted text-xs'
  // 改类型（ADR-0016）：fields 按目标类型重建，保留仍合法的状态 / 进度；有必填属性的类型 422 → 提示原因
  const kindOf = useKindLabel()
  const cur = kindOf(entry.kind, entry.typeId)
  // 可改成：所在空间启用且本人可用的类型（ADR-0036）；当前类型即使未启用也保留
  const kindOptions = useKindOptions(current ?? null, { keep: cur })
  const retype = async (key: string) => {
    const m = kindOptions.find((o) => kindKey(o) === key)
    if (!m || key === kindKey(cur)) return
    try {
      const r = await unwrap<Entry>(
        api.entries[':id'].$patch({
          param: { id: entry.id },
          json: {
            kind: m.kind as EntryKind,
            ...(m.typeId ? { typeId: m.typeId } : {}),
            ifUpdatedAt: entry.updatedAt,
          } as never,
        }),
      )
      qc.setQueryData(['entry', entry.id], r)
      void qc.invalidateQueries({ queryKey: ['entries'] })
      void qc.invalidateQueries({ queryKey: ['entry-types'] })
      toast.success(t('entry.aside.retyped', { kind: m.label }))
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? (err.problem.errors?.[0]?.message ?? err.message)
          : t('task.saveFailed'),
      )
    }
  }
  return (
    <div className="flex flex-col gap-4" data-testid="entry-props">
      <label className={row}>
        <span className={labelCls}>{t('entry.props.kind')}</span>
        <select
          value={kindKey(cur)}
          disabled={!canWrite}
          data-testid="entry-kind"
          onChange={(e) => void retype(e.target.value)}
          className="h-8 rounded-md border border-border bg-surface px-2"
        >
          {kindOptions.map((o) => (
            <option key={kindKey(o)} value={kindKey(o)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className={row}>
        <span className={labelCls}>{t('entry.props.visibility')}</span>
        <select
          value={entry.visibility}
          disabled={!canWrite || personal}
          data-testid="entry-visibility"
          onChange={(e) =>
            void actions.patch(entry, { visibility: e.target.value as Entry['visibility'] })
          }
          className="h-8 rounded-md border border-border bg-surface px-2"
        >
          {(['private', 'space', 'workspace'] as const).map((v) => (
            <option key={v} value={v}>
              {t(`entry.visibility.${v}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={row}>
        <span className={labelCls}>{t('entry.aside.moveSpace')}</span>
        <select
          value={entry.spaceId}
          disabled={!canWrite}
          data-testid="entry-space"
          onChange={(e) => {
            const target = spaces.data?.find((s) => s.id === e.target.value)
            if (!target) return
            // 在目录里的记录换空间会移出目录（ADR-0014）：先确认
            if (entry.treeOrder !== null) setLeaveTree(target)
            else moveSpace(target)
          }}
          className="h-8 rounded-md border border-border bg-surface px-2"
        >
          {(spaces.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.isPersonal ? t('space.personal') : s.name}
            </option>
          ))}
        </select>
      </label>
      <ConfirmDialog
        open={!!leaveTree}
        onOpenChange={(v) => !v && setLeaveTree(null)}
        title={t('entry.aside.leaveTreeTitle')}
        description={t('entry.aside.leaveTreeBody')}
        confirmLabel={t('entry.aside.leaveTreeOk')}
        onConfirm={() => {
          if (leaveTree) moveSpace(leaveTree)
          setLeaveTree(null)
        }}
      />
      {current && !personal ? <TreePosition entry={entry} disabled={!canWrite} /> : null}
      <div className={row}>
        <span className={labelCls}>{t('entry.aside.author')}</span>
        <span>{entry.author.displayName}</span>
      </div>
      <div className={row}>
        <span className={labelCls}>{t('entry.aside.updatedAt')}</span>
        <RelativeTime date={entry.updatedAt} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className={row}>
          <span className={labelCls}>{t('entry.props.words')}</span>
          <span>{entry.wordCount ?? 0}</span>
        </div>
        <div className={row}>
          <span className={labelCls}>{t('entry.props.version')}</span>
          <span>{entry.ydocVersion}</span>
        </div>
      </div>
      {canWrite ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <span className={labelCls}>{t('entry.aside.markVersion')}</span>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('entry.aside.markVersionPlaceholder')}
            aria-label={t('entry.aside.markVersion')}
            maxLength={80}
            data-testid="snapshot-label"
          />
          <Button type="submit" size="sm" loading={mark.isPending} disabled={!label.trim()}>
            {t('entry.aside.markVersion')}
          </Button>
        </form>
      ) : null}
      {snaps.data?.items.some((s) => s.label) ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid="snapshot-list">
          {snaps.data.items
            .filter((s) => s.label)
            .map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{s.label}</span>
                <RelativeTime date={s.createdAt} className="shrink-0 text-fg-muted text-xs" />
              </li>
            ))}
        </ul>
      ) : null}
      {me.workspaceRole !== 'guest' ? <SaveAsTemplate entry={entry} /> : null}
    </div>
  )
}

/**
 * 目录位置（ADR-0014、REQ-KB-005）：不在目录 / 目录顶层 / 某页之下（排除自身与子孙）；放到目标父级的最后。
 */
function TreePosition({ entry, disabled }: { entry: Entry; disabled: boolean }) {
  const { t } = useTranslation()
  const actions = useEntryActions()
  const tree = useQuery(treeQuery(entry.spaceId))
  const nodes = tree.data ?? []
  // 自身及子孙不能作为父级
  const banned = useMemo(() => {
    const kids = childrenMap(nodes)
    const out = new Set<string>([entry.id])
    const walk = (id: string) => {
      for (const c of kids.get(id) ?? []) {
        out.add(c.id)
        walk(c.id)
      }
    }
    walk(entry.id)
    return out
  }, [nodes, entry.id])
  const options = flatten(nodes).filter((n) => !banned.has(n.id))
  const value = entry.treeOrder === null ? '' : (entry.parentId ?? ROOT)
  const onChange = (v: string) => {
    const to =
      v === ''
        ? ({ detach: true } as const)
        : (() => {
            const parentId = v === ROOT ? null : v
            const siblings = (childrenMap(nodes).get(parentId) ?? []).filter(
              (n) => n.id !== entry.id,
            )
            return { parentId, after: siblings.at(-1)?.id ?? null }
          })()
    void actions
      .move(entry, to)
      .then(() => toast.success(t('entry.aside.treeMoved')))
      .catch((err) => toast.error(err instanceof ApiError ? err.message : t('task.saveFailed')))
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-fg-muted text-xs">{t('entry.aside.treePos')}</span>
      <select
        value={value}
        disabled={disabled || tree.isPending}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-border bg-surface px-2"
        data-testid="entry-tree-position"
      >
        <option value="">{t('entry.aside.treeNone')}</option>
        <option value={ROOT}>{t('entry.aside.treeRoot')}</option>
        {options.map((n) => (
          <option key={n.id} value={n.id}>
            {`${'\u00a0\u00a0'.repeat(n.depth + 1)}${n.title || t('entry.untitled')}`}
          </option>
        ))}
      </select>
    </label>
  )
}
const ROOT = '__root'

/**
 * 另存为模板（ADR-0011 §2 · ADR-0023、REQ-TPL-004）：取本篇当前正文 + kind / fields；可写描述；
 * 「共享给工作区成员」按服务端 canShare 显示（前端不比较角色）。
 */
function SaveAsTemplate({ entry }: { entry: Entry }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(entry.title)
  const [description, setDescription] = useState('')
  const [shared, setShared] = useState(false)
  const list = useQuery({ ...templateListQuery, enabled: open })
  const save = useMutation({
    mutationFn: () =>
      unwrap<{ id: string; name: string }>(
        api.templates.$post(
          {
            json: {
              name: name.trim(),
              scope: shared ? 'workspace' : 'personal',
              fromEntryId: entry.id,
              description: description.trim(),
            },
          },
          { headers: { 'idempotency-key': newId() } },
        ),
      ),
    onSuccess: (r) => {
      toast.success(t('template.saved', { name: r.name }))
      setOpen(false)
      void qc.invalidateQueries({ queryKey: ['templates'] })
    },
    onError: () => toast.error(t('task.saveFailed')),
  })
  if (!open)
    return (
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => setOpen(true)}
        data-testid="save-as-template"
      >
        {t('template.saveAs')}
      </Button>
    )
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      data-testid="save-as-template-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) save.mutate()
      }}
    >
      <span className="text-fg-muted text-xs">{t('template.saveAs')}</span>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={t('template.saveAsName')}
        maxLength={60}
        autoFocus
        data-testid="save-as-template-name"
      />
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        aria-label={t('template.description')}
        placeholder={t('template.descriptionPlaceholder')}
        maxLength={200}
        data-testid="save-as-template-description"
      />
      {list.data?.canShare ? (
        <label className="flex cursor-pointer items-center gap-2 text-fg-muted text-xs">
          <Checkbox
            checked={shared}
            onCheckedChange={(v) => setShared(v === true)}
            data-testid="save-as-template-share"
          />
          {t('template.share')}
        </label>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('ui.action.cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          loading={save.isPending}
          disabled={!name.trim()}
          data-testid="save-as-template-submit"
        >
          {t('template.saveAs')}
        </Button>
      </div>
    </form>
  )
}

/**
 * 历史（REQ-COLLAB-008）：全部快照按天分组（新 → 旧）；标记版本显示 label，自动快照显示「自动保存 · v…」。
 * 点开 → 只读预览 / 对比当前 / 恢复（SnapshotPreview，随编辑器 chunk 懒加载）。
 */
function History({ entry, canWrite }: { entry: Entry; canWrite: boolean }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [open, setOpen] = useState<SnapshotMeta | null>(null)
  const snaps = useQuery({
    queryKey: ['entry', entry.id, 'snapshots'],
    queryFn: () =>
      unwrap<{ items: SnapshotMeta[] }>(
        api.entries[':id'].snapshots.$get({ param: { id: entry.id } }),
      ),
    // 文档栏「上次保存」与此同 key、在进入记录页时已取过；打开历史必须拿最新（他处 / 协作者 / 自动留版）
    refetchOnMount: 'always',
  })
  const groups = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, {
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    })
    const out: { day: string; items: SnapshotMeta[] }[] = []
    for (const s of snaps.data?.items ?? []) {
      const day = fmt.format(new Date(s.createdAt))
      const last = out[out.length - 1]
      if (last?.day === day) last.items.push(s)
      else out.push({ day, items: [s] })
    }
    return out
  }, [snaps.data, i18n.language])
  if (snaps.isPending) return <Skeleton className="h-24 w-full" />
  if (!groups.length)
    return (
      <p className="text-fg-muted text-sm" data-testid="history-empty">
        {t('entry.history.empty')}
      </p>
    )
  return (
    <div className="flex flex-col gap-3" data-testid="history">
      <p className="text-fg-muted text-xs">{t('entry.history.hint')}</p>
      {groups.map((g) => (
        <section key={g.day} className="flex flex-col gap-1">
          <h3 className="text-fg-muted text-xs">{g.day}</h3>
          <ul className="flex flex-col">
            {g.items.map((s) => (
              <HistoryItem
                key={s.id}
                entryId={entry.id}
                snap={s}
                canWrite={canWrite}
                onOpen={() => setOpen(s)}
              />
            ))}
          </ul>
        </section>
      ))}
      {open ? (
        <Suspense fallback={null}>
          <SnapshotPreview
            entryId={entry.id}
            snap={open}
            canWrite={canWrite}
            onOpenChange={(v) => {
              if (!v) setOpen(null)
            }}
            onRestored={() => {
              // 恢复在 collab 异步完成：稍后刷新列表（多出「恢复前自动保存」）与记录元信息
              setTimeout(() => {
                void qc.invalidateQueries({ queryKey: ['entry', entry.id] })
              }, 1500)
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

/**
 * 历史一项（ADR-0026、REQ-COLLAB-017 · 018）：手动保存的版本以本地时间 `YYYYMMDD-HHmmss` 命名，自动快照显示「自动保存」；
 * 带标记的显示标记名（时间戳作副标题）。可写者可打标记 / 改标记 / 清除（PATCH label；带标记永久保留）。
 */
function HistoryItem({
  entryId,
  snap: s,
  canWrite,
  onOpen,
}: {
  entryId: string
  snap: SnapshotMeta
  canWrite: boolean
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(s.label ?? '')
  const stamp = versionStamp(new Date(s.createdAt))
  const name =
    s.label ?? (s.createdBy ? stamp : t('entry.history.auto', { version: s.ydocVersion }))
  const save = useMutation({
    mutationFn: (label: string | null) =>
      unwrap<SnapshotMeta>(
        api.entries[':id'].snapshots[':sid'].$patch({
          param: { id: entryId, sid: s.id },
          json: { label },
        }),
      ),
    onSuccess: () => {
      setEditing(false)
      void qc.invalidateQueries({ queryKey: ['entry', entryId, 'snapshots'] })
    },
    onError: () => toast.error(t('task.saveFailed')),
  })
  if (editing)
    return (
      <li>
        <form
          className="flex items-center gap-1 px-1 py-1"
          onSubmit={(e) => {
            e.preventDefault()
            const v = value.trim()
            save.mutate(v ? v : null)
          }}
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={80}
            placeholder={t('entry.history.tagPlaceholder')}
            aria-label={t('entry.history.tag')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
            }}
            autoFocus
            className="h-8 text-sm"
            data-testid="history-tag-input"
          />
          <Button size="sm" type="submit" loading={save.isPending} data-testid="history-tag-save">
            {t('entry.history.tagSave')}
          </Button>
          {s.label ? (
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => save.mutate(null)}
              data-testid="history-tag-clear"
            >
              {t('entry.history.tagClear')}
            </Button>
          ) : null}
        </form>
      </li>
    )
  return (
    <li className="group flex items-center gap-1">
      <button
        type="button"
        data-testid="history-item"
        data-snapshot-id={s.id}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover"
      >
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              'truncate',
              s.label || s.createdBy ? 'font-medium' : 'text-fg-muted',
              !s.label && s.createdBy && 'font-mono tabular-nums',
            )}
          >
            {s.label ? (
              <Tag className="me-1 inline size-3 align-[-0.125em] text-primary-text" aria-hidden />
            ) : null}
            {name}
          </span>
          {s.label ? (
            <span className="font-mono text-fg-muted text-xs tabular-nums">{stamp}</span>
          ) : null}
        </span>
        <RelativeTime date={s.createdAt} className="shrink-0 text-fg-muted text-xs" />
      </button>
      {canWrite ? (
        <button
          type="button"
          aria-label={t('entry.history.tag')}
          title={t('entry.history.tag')}
          data-testid="history-tag"
          onClick={() => {
            setValue(s.label ?? '')
            setEditing(true)
          }}
          className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted opacity-60 hover:bg-hover hover:opacity-100 group-hover:opacity-100"
        >
          <Tag className="size-3.5" />
        </button>
      ) : null}
    </li>
  )
}

function EntryComments({ entry, me }: { entry: Entry; me: { id: string; workspaceRole: string } }) {
  const pending = useCommentDraft((s) => s.pending)
  const setPending = useCommentDraft((s) => s.setPending)
  const removeMark = useCommentDraft((s) => s.removeMark)
  return (
    <Comments
      targetType="entry"
      targetId={entry.id}
      spaceId={entry.spaceId}
      me={me}
      pending={pending}
      onPendingDone={() => setPending(null)}
      onPendingCancel={(threadId) => {
        removeMark?.(threadId)
        setPending(null)
      }}
      canResolveAll={
        entry.authorId === me.id || me.workspaceRole === 'owner' || me.workspaceRole === 'admin'
      }
    />
  )
}
