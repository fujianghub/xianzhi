/**
 * ⌘K 命令面板（04 §6、T1-029 · T1-026；REQ-UI-005 · REQ-SEARCH-006）：
 * - 空输入：第一组为上下文命令（焦点对象），其后为跳转 / 创建 / 偏好；候选带 KeyHint。
 * - 有输入：先「搜索结果」（任务 + 记录，`<mark>` 高亮），再匹配的命令；Enter 打开首项。
 * - 带 page 的命令进入二级列表；空输入时 Backspace 返回。按需懒加载。
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CheckSquare, CornerDownLeft, FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Cmd, hotkeyParts, type PalettePage, useCommands } from '../../hooks/useCommands.ts'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { memberName, useSpaceCandidates } from '../../hooks/useMembers.ts'
import { useSpaces } from '../../hooks/useSpaces.ts'
import { useTaskActions } from '../../hooks/useTasks.ts'
import { hitLink, searchQuery } from '../../lib/search-queries.ts'
import { usePalette } from '../../lib/stores.ts'
import { TASK_STATUSES } from '../../lib/task-queries.ts'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command.tsx'
import { Highlight } from '../ui/highlight.tsx'
import { KeyHint } from '../ui/key-hint.tsx'

const GROUP_ORDER: Cmd['group'][] = ['context', 'navigate', 'create', 'prefs']

/** 本地时区某天 18:00 的 ISO（截止默认下班时间）。 */
const dayAt = (addDays: number) => {
  const d = new Date()
  d.setDate(d.getDate() + addDays)
  d.setHours(18, 0, 0, 0)
  return d.toISOString()
}
const nextMonday = () => {
  const d = new Date()
  return ((8 - d.getDay()) % 7 || 7) as number
}

export default function CommandPalette() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { open, setOpen } = usePalette()
  const { commands, target } = useCommands()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState<PalettePage | null>(null)
  const [value, setValue] = useState('')
  const taskActions = useTaskActions()
  const entryActions = useEntryActions()
  const { data: spaces = [] } = useSpaces()
  const task = target.kind === 'task' ? target.task : undefined
  const entry = target.kind === 'entry' ? target.entry : undefined
  const candidates = useSpaceCandidates(page === 'assignee' ? task?.spaceId : undefined)

  useEffect(() => {
    if (!open) {
      setQ('')
      setPage(null)
    }
  }, [open])
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 150)
    return () => clearTimeout(h)
  }, [q])

  const searching = !page && debounced.length > 0
  const search = useQuery({
    ...searchQuery({ q: debounced, limit: 5 }),
    enabled: open && searching,
  })
  const hits = searching
    ? [...(search.data?.groups.tasks?.items ?? []), ...(search.data?.groups.entries?.items ?? [])]
    : []
  const needle = q.trim().toLowerCase()
  const cmds = useMemo(
    () =>
      commands.filter(
        (c) =>
          !needle ||
          c.label.toLowerCase().includes(needle) ||
          c.keywords?.some((k) => k.toLowerCase().includes(needle)),
      ),
    [commands, needle],
  )

  const close = () => setOpen(false)
  const run = (c: Cmd) => {
    if (c.disabled) return
    if (c.page) {
      setPage(c.page)
      setQ('')
      return
    }
    close()
    c.run?.()
  }

  // 二级页条目
  const pageItems: { key: string; label: string; run: () => void }[] =
    page === 'status' && task
      ? TASK_STATUSES.map((s) => ({
          key: `status:${s}`,
          label: t(`task.status.${s}`),
          run: () => void taskActions.patch(task, { status: s }),
        }))
      : page === 'assignee' && task
        ? [
            {
              key: 'assign:none',
              label: t('task.unassigned'),
              run: () => void taskActions.patch(task, { assigneeId: null }),
            },
            ...candidates.map((m) => ({
              key: `assign:${m.userId}`,
              label: memberName(m),
              run: () => void taskActions.patch(task, { assigneeId: m.userId }),
            })),
          ]
        : page === 'due' && task
          ? [
              {
                key: 'due:today',
                label: t('cmd.dueToday'),
                run: () => void taskActions.patch(task, { dueAt: dayAt(0) }),
              },
              {
                key: 'due:tomorrow',
                label: t('cmd.dueTomorrow'),
                run: () => void taskActions.patch(task, { dueAt: dayAt(1) }),
              },
              {
                key: 'due:monday',
                label: t('cmd.dueNextWeek'),
                run: () => void taskActions.patch(task, { dueAt: dayAt(nextMonday()) }),
              },
              {
                key: 'due:clear',
                label: t('cmd.dueClear'),
                run: () => void taskActions.patch(task, { dueAt: null }),
              },
            ]
          : page === 'space' && entry
            ? spaces
                .filter((s) => s.id !== entry.spaceId)
                .map((s) => ({
                  key: `space:${s.id}`,
                  label: s.isPersonal ? t('space.personal') : s.name,
                  run: () =>
                    void entryActions.patch(entry, {
                      spaceId: s.id,
                      ...(s.isPersonal
                        ? { visibility: 'private' as const }
                        : spaces.find((x) => x.id === entry.spaceId)?.isPersonal
                          ? { visibility: 'space' as const }
                          : {}),
                    }),
                }))
            : []
  const filteredPage = pageItems.filter((i) => !needle || i.label.toLowerCase().includes(needle))

  // 受控高亮：候选变化时回到第一项（Enter 打开首项，REQ-SEARCH-006）
  const firstKey = page
    ? filteredPage[0]?.key
    : hits[0]
      ? `hit:${hits[0].type}:${hits[0].id}`
      : cmds[0]?.id
  // 只在首项变化时重置高亮
  useEffect(() => {
    if (firstKey) setValue(firstKey)
  }, [firstKey])

  const grouped = GROUP_ORDER.map((g) => [g, cmds.filter((c) => c.group === g)] as const).filter(
    ([, list]) => list.length,
  )

  const item = (
    key: string,
    onSelect: () => void,
    body: React.ReactNode,
    extra?: { disabled?: boolean; testId?: string },
  ) => (
    <CommandItem
      key={key}
      value={key}
      disabled={extra?.disabled}
      onSelect={onSelect}
      data-testid={extra?.testId}
      className="data-[disabled=true]:opacity-50"
    >
      {body}
    </CommandItem>
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t('cmd.palette')}
      value={value}
      onValueChange={setValue}
      shouldFilter={false}
    >
      <CommandInput
        value={q}
        onValueChange={setQ}
        placeholder={page ? t(`cmd.page.${page}`) : t('cmd.placeholder')}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' && !q && page) {
            e.preventDefault()
            setPage(null)
          }
        }}
        data-testid="command-input"
      />
      <CommandList data-testid="command-palette" data-context={target.kind}>
        <CommandEmpty>
          {searching && search.isFetching ? t('cmd.searching') : t('cmd.empty')}
        </CommandEmpty>
        {page ? (
          <CommandGroup heading={t(`cmd.page.${page}`)}>
            {filteredPage.map((i) =>
              item(
                i.key,
                () => {
                  close()
                  i.run()
                },
                <span className="flex-1 truncate">{i.label}</span>,
              ),
            )}
          </CommandGroup>
        ) : (
          <>
            {hits.length ? (
              <CommandGroup heading={t('cmd.results')} data-testid="command-results">
                {hits.map((h) =>
                  item(
                    `hit:${h.type}:${h.id}`,
                    () => {
                      close()
                      void nav(hitLink(h))
                    },
                    <>
                      {h.type === 'task' ? (
                        <CheckSquare className="size-4 shrink-0 text-fg-muted" />
                      ) : (
                        <FileText className="size-4 shrink-0 text-fg-muted" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{h.title}</span>
                        {h.highlight && h.highlight !== h.title ? (
                          <Highlight html={h.highlight} className="ml-2 text-fg-muted text-xs" />
                        ) : null}
                      </span>
                      <CornerDownLeft className="size-3.5 text-fg-faint" />
                    </>,
                    { testId: 'command-hit' },
                  ),
                )}
              </CommandGroup>
            ) : null}
            {grouped.map(([g, list]) => (
              <CommandGroup
                key={g}
                heading={t(`cmd.group.${g}`)}
                data-testid={`command-group-${g}`}
              >
                {list.map((c) =>
                  item(
                    c.id,
                    () => run(c),
                    <>
                      <span className="flex-1 truncate">
                        {c.label}
                        {c.disabled ? (
                          <span className="ml-2 text-fg-muted text-xs">{t('cmd.later')}</span>
                        ) : null}
                      </span>
                      {c.hotkey ? <KeyHint keys={hotkeyParts(c.hotkey)} /> : null}
                    </>,
                    { disabled: c.disabled, testId: `cmd-${c.id}` },
                  ),
                )}
              </CommandGroup>
            ))}
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
