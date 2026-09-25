/** 本地 UI 状态（Zustand，ADR §3：仅主题、布局）：侧栏 / Aside 折叠、密度、动效档位、StatusPill 状态。 */
import { create } from 'zustand'
import type { EntryKind } from '../../shared/schemas/enums.ts'
import { type MotionLevel, setMotion as persistMotion, storedMotion } from './motion.ts'

export type PillStatus = 'idle' | 'synced' | 'connecting' | 'offline' | 'readOnly'

export type Density = 'comfortable' | 'compact'

interface LayoutState {
  density: Density
  setDensity: (d: Density) => void
  motion: MotionLevel
  setMotion: (m: MotionLevel) => void
  sidebarOpen: boolean
  asideOpen: boolean
  drawerOpen: boolean
  toggleSidebar: () => void
  toggleAside: () => void
  setDrawer: (v: boolean) => void
  setAside: (v: boolean) => void
}

const read = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k)
    return v === null ? d : v === '1'
  } catch {
    return d
  }
}
const write = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const readDensity = (): Density => {
  try {
    return localStorage.getItem('xz:density') === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}
/** 写 html[data-density]，tokens.css 据此切换 --xz-row-h。 */
export function applyDensity(d: Density): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.density = d
}

export const useLayout = create<LayoutState>((set, get) => ({
  density: typeof window === 'undefined' ? 'comfortable' : readDensity(),
  setDensity: (density) => {
    try {
      localStorage.setItem('xz:density', density)
    } catch {
      /* ignore */
    }
    applyDensity(density)
    set({ density })
  },
  motion: typeof window === 'undefined' ? 'standard' : storedMotion(),
  setMotion: (motion) => {
    persistMotion(motion)
    set({ motion })
  },
  sidebarOpen: typeof window === 'undefined' ? true : read('xz:sidebar', true),
  asideOpen: typeof window === 'undefined' ? true : read('xz:aside', true),
  drawerOpen: false,
  toggleSidebar: () => {
    const v = !get().sidebarOpen
    write('xz:sidebar', v)
    set({ sidebarOpen: v })
  },
  toggleAside: () => {
    const v = !get().asideOpen
    write('xz:aside', v)
    set({ asideOpen: v })
  },
  setAside: (v) => set({ asideOpen: v }),
  setDrawer: (v) => set({ drawerOpen: v }),
}))

export const useStatus = create<{ status: PillStatus; set: (s: PillStatus) => void }>((set) => ({
  status: 'idle',
  set: (status) => set({ status }),
}))

/** Aside 内容由页面注入（04 §4：大纲 / 反链 / 评论 / 属性）；离开页面清空。 */
export const useAsideSlot = create<{
  node: import('react').ReactNode | null
  set: (n: import('react').ReactNode | null) => void
}>((set) => ({ node: null, set: (node) => set({ node }) }))

/** 新建空间 Dialog（侧栏 + 空间列表页两个入口共用，08 §2.5）。 */
/** 新建分类；`groupId` = 预选大类（列表页「在此新建」，ADR-0012）。 */
export const useCreateSpaceDialog = create<{
  open: boolean
  groupId: string | null
  setOpen: (v: boolean, groupId?: string | null) => void
}>((set) => ({
  open: false,
  groupId: null,
  setOpen: (open, groupId) => set(groupId !== undefined ? { open, groupId } : { open }),
}))

/** 全局「新任务」（`c`，04 §6）：页面登记当前上下文的默认值（空间 / 状态 / 截止）。 */
export interface NewTaskDefaults {
  spaceId?: string
  status?: 'inbox' | 'todo' | 'doing' | 'blocked' | 'done' | 'cancelled'
  dueAt?: string | null
  parentId?: string
}
export const useNewTask = create<{
  open: boolean
  defaults: NewTaskDefaults
  setOpen: (v: boolean) => void
  setDefaults: (d: NewTaskDefaults) => void
}>((set) => ({
  open: false,
  defaults: {},
  setOpen: (open) => set({ open }),
  setDefaults: (defaults) => set({ defaults }),
}))

/** 全局新记录（08 §2.8：`e`）：页面登记默认空间 / kind（空间记录页 → 该空间）。 */
export interface NewEntryDefaults {
  spaceId?: string
  kind?: EntryKind
  /** 预选模板（ADR-0011 §2）：内置 `builtin:<key>` 或用户模板 uuid */
  templateId?: string
  /** 目录（ADR-0012）：null = 放进目录根级；uuid = 作为其子页；undefined = 不进目录 */
  parentId?: string | null
}
export const useNewEntry = create<{
  open: boolean
  defaults: NewEntryDefaults
  setOpen: (v: boolean, defaults?: NewEntryDefaults) => void
  setDefaults: (d: NewEntryDefaults) => void
}>((set) => ({
  open: false,
  defaults: {},
  setOpen: (open, defaults) => set(defaults ? { open, defaults } : { open }),
  setDefaults: (defaults) => set({ defaults }),
}))

/** 当前编辑器的大纲（Aside 大纲页读取；EntryEditor 在每次更新后写入，REQ-EDITOR-012）。 */
export interface OutlineItem {
  level: number
  text: string
  pos: number
}
export const useOutline = create<{
  items: OutlineItem[]
  jump: ((pos: number) => void) | null
  set: (items: OutlineItem[], jump?: ((pos: number) => void) | null) => void
}>((set) => ({
  items: [],
  jump: null,
  set: (items, jump) => set(jump === undefined ? { items } : { items, jump }),
}))

/**
 * ⌘K 上下文（04 §6 CommandContext）：页面登记底层（空间 / 记录），列表焦点 / 详情覆盖在上层（任务）。
 * 生效上下文 = focus ?? base。
 */
export type CommandTarget =
  | { kind: 'task'; id: string }
  | { kind: 'entry'; id: string }
  | { kind: 'space'; id: string; slug: string }
export const useCommandContext = create<{
  base: CommandTarget | null
  focus: CommandTarget | null
  setBase: (t: CommandTarget | null) => void
  setFocus: (t: CommandTarget | null) => void
}>((set) => ({
  base: null,
  focus: null,
  setBase: (base) => set({ base }),
  setFocus: (focus) => set({ focus }),
}))

/** ⌘K 面板与快捷键帮助的开关。 */
export const usePalette = create<{
  open: boolean
  help: boolean
  setOpen: (v: boolean) => void
  setHelp: (v: boolean) => void
}>((set) => ({
  open: false,
  help: false,
  setOpen: (open) => set({ open }),
  setHelp: (help) => set({ help }),
}))

/** Peek 预览（04 §6、REQ-UI-007）：不改 URL；Enter 升级为详情由面板处理。 */
export type PeekTarget =
  | { kind: 'task'; id: string; spaceSlug: string }
  | { kind: 'entry'; id: string }
export const usePeek = create<{
  target: PeekTarget | null
  open: (t: PeekTarget) => void
  close: () => void
}>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))

/** 记录内锚定评论草稿（T1-023）：浮动工具条创建（已套 comment 标记）→ Aside 评论页写首条；取消时编辑器移除标记。 */
export const useCommentDraft = create<{
  pending: { threadId: string; quote: string } | null
  removeMark: ((threadId: string) => void) | null
  setPending: (p: { threadId: string; quote: string } | null) => void
  setRemover: (fn: ((threadId: string) => void) | null) => void
}>((set) => ({
  pending: null,
  removeMark: null,
  setPending: (pending) => set({ pending }),
  setRemover: (removeMark) => set({ removeMark }),
}))
