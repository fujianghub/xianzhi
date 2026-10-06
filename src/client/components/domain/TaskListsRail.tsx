/**
 * 任务页清单栏（ADR-0044、REQ-TASK-034）：智能清单（全部 · 今天 · 明天 · 最近 7 天 · 未归类 · 已完成）+ 我的清单（文件夹可折叠）+ 标签。
 * 右侧计数来自 `GET /tasks/counts`；选中项 = selected 底 + 左侧主色条。清单 ⋯：改名 · 改色 · 移到文件夹 · 删除。
 * 点文件夹 = 聚合查看其下全部清单（按清单分组，ADR-0050）；文件夹前的箭头单独负责折叠。
 * 窄屏（< lg）由页面改用横向胶囊条（`TaskViewChips`）。
 */
import { useQuery } from '@tanstack/react-query'
import {
  Infinity as AllIcon,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Folder,
  FolderPlus,
  Inbox,
  type LucideIcon,
  MoreHorizontal,
  Plus,
  Sun,
  Tag as TagIcon,
} from 'lucide-react'
import { type CSSProperties, type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaletteColor } from '../../../shared/schemas/enums.ts'
import { useTaskListActions } from '../../hooks/useTaskLists.ts'
import { cn } from '../../lib/cn.ts'
import {
  listTree,
  SMART_VIEWS,
  type SmartView,
  type TaskCounts,
  type TaskList,
  taskListsQuery,
} from '../../lib/task-list-queries.ts'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { PALETTE, type PaletteName } from './SpaceIcon.tsx'
import { tagsQuery } from './TagPicker.tsx'
import { DropZone, type TaskDropTarget } from './TaskDnd.tsx'
import { ListDot } from './TaskListDot.tsx'

/** 标签区默认只显示前几个，其余「全部」展开 */
const TAGS_SHOWN = 12

/** 当前选中：智能清单 / 某清单 / 某文件夹（聚合其下清单，ADR-0050）/ 某标签 */
export type TaskScope =
  | { kind: 'smart'; view: SmartView }
  | { kind: 'list'; id: string }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; name: string }

const SMART: Record<SmartView, { icon: LucideIcon; hue: string }> = {
  all: { icon: AllIcon, hue: 'sky' },
  today: { icon: Sun, hue: 'amber' },
  tomorrow: { icon: CalendarDays, hue: 'cyan' },
  next7: { icon: CalendarClock, hue: 'violet' },
  unlisted: { icon: Inbox, hue: 'emerald' },
  done: { icon: CheckCircle2, hue: 'lime' },
}
const hue = (h: string) => ({ '--xz-ico': `var(--xz-icon-${h})` }) as CSSProperties

export const smartCount = (c: TaskCounts | undefined, v: SmartView): number | undefined =>
  !c || v === 'done' ? undefined : v === 'all' ? c.all : c[v]

export function TaskListsRail({
  scope,
  counts,
  onPick,
  droppable = false,
}: {
  scope: TaskScope
  counts: TaskCounts | undefined
  onPick: (s: TaskScope) => void
  /** 在 TaskDndProvider 里：清单 / 今天 / 明天 / 未归类 可作拖放落点 */
  droppable?: boolean
}) {
  const { t } = useTranslation()
  const { data } = useQuery(taskListsQuery)
  const tags = useQuery(tagsQuery)
  const actions = useTaskListActions()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<null | 'list' | 'folder'>(null)
  const [allTags, setAllTags] = useState(false)
  const [name, setName] = useState('')
  const tree = listTree(data?.items ?? [])
  const on = (s: TaskScope) =>
    s.kind === scope.kind &&
    (s.kind === 'smart'
      ? s.view === (scope as { view: SmartView }).view
      : s.kind === 'list' || s.kind === 'folder'
        ? s.id === (scope as { id: string }).id
        : s.name === (scope as { name: string }).name)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n || !adding) return
    const color = PALETTE[((data?.items.length ?? 0) * 3) % PALETTE.length] as PaletteColor
    actions.create.mutate(adding === 'list' ? { name: n, color } : { kind: 'folder', name: n }, {
      onSuccess: (l) => {
        setName('')
        setAdding(null)
        if (l.kind === 'list') onPick({ kind: 'list', id: l.id })
      },
    })
  }
  const listRow = (l: TaskList, depth = 0) => (
    <li key={l.id} className="group/list relative">
      <DropZone
        target={droppable ? { kind: 'list', id: l.id, name: l.name } : null}
        scope=":rail"
        className="rounded-md"
      >
        <button
          type="button"
          className="xz-rail-item"
          style={{ paddingInlineStart: `${0.625 + depth * 1}rem` }}
          aria-current={on({ kind: 'list', id: l.id }) ? 'page' : undefined}
          onClick={() => onPick({ kind: 'list', id: l.id })}
          data-testid="rail-list"
          data-list-id={l.id}
        >
          <ListDot list={l} />
          <span className="min-w-0 truncate">{l.name}</span>
          <span className="xz-rail-count group-hover/list:opacity-0">
            {counts?.lists[l.id] || ''}
          </span>
        </button>
      </DropZone>
      <ListMenu
        list={l}
        folders={tree.filter((n) => n.item.kind === 'folder').map((n) => n.item)}
      />
    </li>
  )

  return (
    <nav
      aria-label={t('taskLists.nav')}
      className="flex flex-col gap-0.5 text-sm"
      data-testid="tasks-rail"
    >
      {SMART_VIEWS.map((v) => {
        const Icon = SMART[v].icon
        const n = smartCount(counts, v)
        // 拖到「今天 / 明天」改截止，拖到「未归类」移出清单（ADR-0044）
        const target: TaskDropTarget | null = !droppable
          ? null
          : v === 'today'
            ? { kind: 'day', offset: 0 }
            : v === 'tomorrow'
              ? { kind: 'day', offset: 1 }
              : v === 'unlisted'
                ? { kind: 'unlisted' }
                : null
        return (
          <DropZone key={v} target={target} scope=":rail" className="rounded-md">
            <button
              type="button"
              className="xz-rail-item"
              aria-current={on({ kind: 'smart', view: v }) ? 'page' : undefined}
              onClick={() => onPick({ kind: 'smart', view: v })}
              data-testid={`rail-${v}`}
            >
              <span className="xz-nav-icon" style={hue(SMART[v].hue)} aria-hidden>
                <Icon />
              </span>
              {t(`taskLists.smart.${v}`)}
              <span
                className="xz-rail-count"
                data-alert={v === 'today' && counts?.overdue ? '' : undefined}
                title={
                  v === 'today' && counts?.overdue
                    ? t('taskLists.overdueHint', { n: counts.overdue })
                    : undefined
                }
              >
                {n || ''}
              </span>
            </button>
          </DropZone>
        )
      })}

      <div className="xz-rail-head">
        <span className="flex-1">{t('taskLists.lists')}</span>
        {data?.canCreate ? (
          <>
            <IconBtn
              label={t('taskLists.newFolder')}
              onClick={() => setAdding('folder')}
              testId="rail-new-folder"
            >
              <FolderPlus className="size-3.5" />
            </IconBtn>
            <IconBtn
              label={t('taskLists.new')}
              onClick={() => setAdding('list')}
              testId="rail-new-list"
            >
              <Plus className="size-3.5" />
            </IconBtn>
          </>
        ) : null}
      </div>
      {adding ? (
        <form onSubmit={submit} className="px-1 pb-1">
          <input
            // biome-ignore lint/a11y/noAutofocus: 点「新建」后直接输入
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => !name.trim() && setAdding(null)}
            onKeyDown={(e) => e.key === 'Escape' && setAdding(null)}
            placeholder={t(
              adding === 'list' ? 'taskLists.newPlaceholder' : 'taskLists.newFolderPlaceholder',
            )}
            aria-label={t(adding === 'list' ? 'taskLists.new' : 'taskLists.newFolder')}
            maxLength={40}
            className="h-8 w-full rounded-md border border-selected-border bg-surface px-2 text-sm outline-none"
            data-testid="rail-new-input"
          />
        </form>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {tree.map(({ item, children }) =>
          item.kind === 'list' ? (
            listRow(item)
          ) : (
            <li key={item.id} className="group/list relative">
              <button
                type="button"
                className="xz-rail-item xz-rail-folder"
                aria-current={on({ kind: 'folder', id: item.id }) ? 'page' : undefined}
                onClick={() => onPick({ kind: 'folder', id: item.id })}
                data-testid="rail-folder"
                data-folder-id={item.id}
              >
                <Folder className="size-4 text-fg-muted" aria-hidden />
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="xz-rail-count group-hover/list:opacity-0">
                  {children.reduce((a, c) => a + (counts?.lists[c.id] ?? 0), 0) || ''}
                </span>
              </button>
              <button
                type="button"
                className="xz-rail-fold"
                aria-expanded={!collapsed.has(item.id)}
                aria-label={t('taskLists.toggleFolder', { name: item.name })}
                onClick={() =>
                  setCollapsed((s) => {
                    const next = new Set(s)
                    if (next.has(item.id)) next.delete(item.id)
                    else next.add(item.id)
                    return next
                  })
                }
                data-testid="rail-folder-toggle"
              >
                <ChevronRight className="size-3.5" aria-hidden />
              </button>
              <ListMenu list={item} folders={[]} />
              {collapsed.has(item.id) ? null : (
                <ul className="flex flex-col gap-0.5">{children.map((c) => listRow(c, 1))}</ul>
              )}
            </li>
          ),
        )}
        {!tree.length && !adding ? (
          <li className="px-2.5 py-1 text-fg-faint text-xs">{t('taskLists.empty')}</li>
        ) : null}
      </ul>

      {tags.data?.length ? (
        <>
          <div className="xz-rail-head">
            <span className="flex-1">{t('task.tags')}</span>
            {tags.data.length > TAGS_SHOWN ? (
              <button
                type="button"
                onClick={() => setAllTags((x) => !x)}
                className="font-normal text-fg-muted hover:text-fg"
                data-testid="rail-tags-more"
              >
                {allTags
                  ? t('taskLists.tagsLess')
                  : t('taskLists.tagsMore', { n: tags.data.length })}
              </button>
            ) : null}
          </div>
          <ul className="flex flex-wrap gap-1 px-1.5">
            {(allTags ? tags.data : tags.data.slice(0, TAGS_SHOWN)).map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  aria-current={on({ kind: 'tag', name: tag.name }) ? 'page' : undefined}
                  onClick={() => onPick({ kind: 'tag', name: tag.name })}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs hover:bg-hover',
                    on({ kind: 'tag', name: tag.name })
                      ? 'bg-selected font-medium'
                      : 'text-fg-muted',
                  )}
                  data-testid="rail-tag"
                >
                  <TagIcon className="size-3" aria-hidden />
                  {tag.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </nav>
  )
}

function IconBtn({
  label,
  onClick,
  children,
  testId,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  testId?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
      data-testid={testId}
    >
      {children}
    </button>
  )
}

/** 清单 / 文件夹的 ⋯ 菜单：改名 · 改色（清单）· 移到文件夹（清单）· 删除 */
function ListMenu({ list, folders }: { list: TaskList; folders: TaskList[] }) {
  const { t } = useTranslation()
  const actions = useTaskListActions()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(list.name)
  const [confirm, setConfirm] = useState(false)
  const rename = () => {
    const n = name.trim()
    if (n && n !== list.name) actions.patch.mutate({ id: list.id, name: n })
  }
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (o) setName(list.name)
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('taskLists.menu', { name: list.name })}
            className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md text-fg-muted opacity-0 hover:bg-active focus-visible:opacity-100 group-hover/list:opacity-100 data-[state=open]:opacity-100"
            data-testid="rail-list-menu"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2" data-testid="rail-list-menu-content">
          <div className="flex items-center gap-1">
            {list.kind === 'list' ? (
              <ColorPicker
                value={(list.color ?? 'gray') as PaletteName}
                onChange={(c) => actions.patch.mutate({ id: list.id, color: c })}
                label={t('taskLists.color')}
                testId="rail-list-color"
              />
            ) : null}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  rename()
                  setOpen(false)
                }
              }}
              aria-label={t('taskLists.rename')}
              maxLength={40}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-selected-border"
              data-testid="rail-list-rename"
            />
          </div>
          {list.kind === 'list' && folders.length ? (
            <div className="mt-2 border-divider border-t pt-1">
              <p className="px-2 py-1 text-fg-muted text-xs">{t('taskLists.moveTo')}</p>
              {list.parentId ? (
                <button
                  type="button"
                  className="xz-picker-item"
                  onClick={() => actions.patch.mutate({ id: list.id, parentId: null })}
                >
                  {t('taskLists.moveToRoot')}
                </button>
              ) : null}
              {folders
                .filter((f) => f.id !== list.parentId)
                .map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="xz-picker-item"
                    onClick={() => actions.patch.mutate({ id: list.id, parentId: f.id })}
                  >
                    <Folder className="size-4 text-fg-muted" aria-hidden />
                    {f.name}
                  </button>
                ))}
            </div>
          ) : null}
          <div className="mt-2 border-divider border-t pt-1">
            <button
              type="button"
              className="xz-picker-item text-danger"
              onClick={() => {
                setOpen(false)
                setConfirm(true)
              }}
              data-testid="rail-list-delete"
            >
              {t(list.kind === 'list' ? 'taskLists.delete' : 'taskLists.deleteFolder')}
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t(list.kind === 'list' ? 'taskLists.deleteTitle' : 'taskLists.deleteFolderTitle', {
          name: list.name,
        })}
        description={t(
          list.kind === 'list' ? 'taskLists.deleteBody' : 'taskLists.deleteFolderBody',
        )}
        confirmLabel={t('taskLists.deleteConfirm')}
        onConfirm={() => {
          setConfirm(false)
          actions.remove.mutate(list.id)
        }}
      />
    </>
  )
}
