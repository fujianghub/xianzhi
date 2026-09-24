/**
 * 命令注册表（04 §6、T1-029、REQ-UI-005 · 006）：⌘K、快捷键帮助面板与全局热键共用。
 * 第一组由 CommandContext 决定（任务 / 记录 / 空间），第二组为全局（跳转、创建、偏好）。
 * 带 `page` 的命令在面板内进入二级列表（改状态 / 指派 / 设截止 / 移动空间）。
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { entryQuery } from '../lib/entry-queries.ts'
import {
  useCommandContext,
  useLayout,
  useNewEntry,
  useNewTask,
  usePalette,
  usePeek,
} from '../lib/stores.ts'
import { taskQuery } from '../lib/task-queries.ts'
import { currentTheme, setTheme } from '../lib/theme.ts'
import { useEntryActions } from './useEntries.ts'
import { useSpaces } from './useSpaces.ts'

export type PalettePage = 'status' | 'assignee' | 'due' | 'space'
export type CmdGroup = 'context' | 'navigate' | 'create' | 'prefs'

export interface Cmd {
  id: string
  group: CmdGroup
  label: string
  /** 全局热键（`g t`、`c`、`mod+k`）；显示为 KeyHint */
  hotkey?: string
  keywords?: string[]
  disabled?: boolean
  page?: PalettePage
  run?: () => void
}

/** 热键 → KeyHint 显示（mod → ⌘ / Ctrl）。 */
export function hotkeyParts(hotkey: string): string[] {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return hotkey
    .split(' ')
    .flatMap((k) => k.split('+'))
    .map((k) => (k === 'mod' ? (mac ? '⌘' : 'Ctrl') : k.length === 1 ? k.toUpperCase() : k))
}

export function useCommands(): { commands: Cmd[]; target: ReturnType<typeof useTarget> } {
  const { t } = useTranslation()
  const nav = useNavigate()
  const target = useTarget()
  const { data: spaces = [] } = useSpaces()
  const openTask = useNewTask((s) => s.setOpen)
  const setTaskDefaults = useNewTask((s) => s.setDefaults)
  const openEntry = useNewEntry((s) => s.setOpen)
  const { toggleSidebar, toggleAside, density, setDensity } = useLayout()
  const setHelp = usePalette((s) => s.setHelp)
  const setPalette = usePalette((s) => s.setOpen)
  const peek = usePeek((s) => s.open)
  const entryActions = useEntryActions()

  const commands = useMemo<Cmd[]>(() => {
    const go = (to: string) => () => void nav({ to })
    const out: Cmd[] = []
    // ---- 第一组：上下文 ----
    if (target.kind === 'task' && target.task) {
      const task = target.task
      out.push(
        { id: 'task.status', group: 'context', label: t('cmd.task.status'), page: 'status' },
        { id: 'task.assign', group: 'context', label: t('cmd.task.assign'), page: 'assignee' },
        { id: 'task.due', group: 'context', label: t('cmd.task.due'), page: 'due' },
        { id: 'task.cycle', group: 'context', label: t('cmd.task.cycle'), disabled: true },
        {
          id: 'task.open',
          group: 'context',
          label: t('cmd.task.open'),
          run: () =>
            void nav({
              to: '/spaces/$spaceSlug/tasks/$taskId',
              params: { spaceSlug: task.spaceSlug, taskId: task.id },
            }),
        },
        {
          id: 'task.peek',
          group: 'context',
          label: t('cmd.task.peek'),
          hotkey: 'p',
          run: () => peek({ kind: 'task', id: task.id, spaceSlug: task.spaceSlug }),
        },
      )
    } else if (target.kind === 'entry' && target.entry) {
      const entry = target.entry
      out.push(
        {
          id: 'entry.mark',
          group: 'context',
          label: t('cmd.entry.mark'),
          run: () =>
            void nav({
              to: '/entries/$entryId',
              params: { entryId: entry.id },
              search: { aside: 'props' },
            }),
        },
        {
          id: 'entry.export',
          group: 'context',
          label: t('cmd.entry.export'),
          run: () => {
            window.location.href = `/api/v1/entries/${entry.id}/export?format=md`
          },
        },
        { id: 'entry.move', group: 'context', label: t('cmd.entry.move'), page: 'space' },
        {
          id: 'entry.pin',
          group: 'context',
          label: t(entry.pinned ? 'entry.unpin' : 'entry.pin'),
          run: () => void entryActions.patch(entry, { pinned: !entry.pinned }),
        },
      )
    } else if (target.kind === 'space') {
      const sp = spaces.find((s) => s.id === target.id)
      out.push(
        {
          id: 'space.newTask',
          group: 'context',
          label: t('cmd.space.newTask'),
          run: () => {
            setTaskDefaults({ spaceId: target.id, status: 'todo' })
            openTask(true)
          },
        },
        {
          id: 'space.entries',
          group: 'context',
          label: t('cmd.space.entries'),
          run: () =>
            void nav({
              to: '/spaces/$spaceSlug/entries',
              params: { spaceSlug: sp?.slug ?? target.slug },
              search: {},
            }),
        },
        {
          id: 'space.invite',
          group: 'context',
          label: t('cmd.space.invite'),
          run: go('/settings/workspace/members'),
        },
      )
    }
    // ---- 第二组：全局 ----
    out.push(
      {
        id: 'go.today',
        group: 'navigate',
        label: t('cmd.go', { page: t('ui.page.today') }),
        hotkey: 'g t',
        run: go('/today'),
      },
      {
        id: 'go.inbox',
        group: 'navigate',
        label: t('cmd.go', { page: t('ui.page.inbox') }),
        hotkey: 'g i',
        run: go('/inbox'),
      },
      {
        id: 'go.calendar',
        group: 'navigate',
        label: t('cmd.go', { page: t('ui.page.calendar') }),
        hotkey: 'g c',
        run: go('/calendar'),
      },
      {
        id: 'go.search',
        group: 'navigate',
        label: t('cmd.go', { page: t('ui.page.search') }),
        hotkey: 'g s',
        run: go('/search'),
      },
      {
        id: 'go.entries',
        group: 'navigate',
        label: t('cmd.go', { page: t('ui.page.entries') }),
        run: go('/entries'),
      },
      {
        id: 'go.notifications',
        group: 'navigate',
        label: t('cmd.go', { page: t('ui.page.notifications') }),
        hotkey: 'n',
        run: go('/notifications'),
      },
      {
        id: 'go.trash',
        group: 'navigate',
        label: t('cmd.go', { page: t('ui.page.trash') }),
        run: go('/trash'),
      },
      {
        id: 'go.settings',
        group: 'navigate',
        label: t('cmd.go', { page: t('ui.page.settings') }),
        run: go('/settings'),
      },
      ...spaces.map(
        (s): Cmd => ({
          id: `go.space.${s.id}`,
          group: 'navigate',
          label: t('cmd.goSpace', { name: s.isPersonal ? t('space.personal') : s.name }),
          keywords: [s.slug],
          run: () => void nav({ to: '/spaces/$spaceSlug', params: { spaceSlug: s.slug } }),
        }),
      ),
      {
        id: 'new.task',
        group: 'create',
        label: t('task.newTask'),
        hotkey: 'c',
        run: () => openTask(true),
      },
      {
        id: 'new.entry',
        group: 'create',
        label: t('entry.new'),
        hotkey: 'e',
        run: () => openEntry(true),
      },
      {
        id: 'prefs.theme',
        group: 'prefs',
        label: t('ui.theme.toggle'),
        run: () => void setTheme(currentTheme() === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'prefs.density',
        group: 'prefs',
        label: t(density === 'compact' ? 'cmd.densityComfortable' : 'cmd.densityCompact'),
        run: () => setDensity(density === 'compact' ? 'comfortable' : 'compact'),
      },
      {
        id: 'ui.sidebar',
        group: 'prefs',
        label: t('ui.nav.collapseSidebar'),
        hotkey: '[',
        run: toggleSidebar,
      },
      {
        id: 'ui.aside',
        group: 'prefs',
        label: t('ui.nav.collapseAside'),
        hotkey: ']',
        run: toggleAside,
      },
      {
        id: 'ui.palette',
        group: 'prefs',
        label: t('cmd.palette'),
        hotkey: 'mod+k',
        run: () => setPalette(true),
      },
      {
        id: 'ui.help',
        group: 'prefs',
        label: t('cmd.help'),
        hotkey: '?',
        run: () => setHelp(true),
      },
    )
    return out
  }, [
    t,
    nav,
    target,
    spaces,
    openTask,
    setTaskDefaults,
    openEntry,
    toggleSidebar,
    toggleAside,
    density,
    setDensity,
    setHelp,
    setPalette,
    peek,
    entryActions,
  ])
  return { commands, target }
}

/** 生效上下文 + 对象数据（任务 / 记录走 Query 缓存）。 */
function useTarget() {
  const base = useCommandContext((s) => s.base)
  const focus = useCommandContext((s) => s.focus)
  const cur = focus ?? base
  const task = useQuery({
    ...taskQuery(cur?.kind === 'task' ? cur.id : ''),
    enabled: cur?.kind === 'task',
  })
  const entry = useQuery({
    ...entryQuery(cur?.kind === 'entry' ? cur.id : ''),
    enabled: cur?.kind === 'entry',
  })
  return useMemo(
    () =>
      cur?.kind === 'task'
        ? { kind: 'task' as const, id: cur.id, task: task.data }
        : cur?.kind === 'entry'
          ? { kind: 'entry' as const, id: cur.id, entry: entry.data }
          : cur?.kind === 'space'
            ? { kind: 'space' as const, id: cur.id, slug: cur.slug }
            : { kind: 'none' as const },
    [cur, task.data, entry.data],
  )
}
