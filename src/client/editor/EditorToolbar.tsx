/**
 * 文档上方工具栏（ADR-0025 §1、REQ-EDITOR-024 · REQ-READ-007，参考简斋 RichTextEditor 工具栏 + 阅读胶囊）：
 * 吸顶在顶栏下（专注时贴顶），纸面实底不 blur（06）。
 * ADR-0028：格式始终一行，放不下从右往左收进「…」。ADR-0029：阅读 / 保存 / 字数移到标题下的文档栏（DocBar），吸顶的只剩格式。
 * 编辑组：+ 插入 | 撤销 重做 清除格式 | 标题▾ | B I U S 更多▾ | 文字色▾ 背景色▾ | 列表 ×3 引用 | 对齐▾ | 链接；
 * 文档栏（DocBar，ADR-0029 · 0037）：「N 字 · 上次保存」| 阅读▾（字体 / 纸张 / 排版 / 目录分页）· 专注 · 保存 · Markdown。
 * < lg 编辑组隐藏（MobileToolbar 负责）。下拉关闭时焦点回编辑器。
 */
import { useQuery } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  BookOpen,
  ChevronDown,
  Code,
  FileCode,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  ListTree,
  type LucideIcon,
  Maximize2,
  MoreHorizontal,
  Plus,
  Quote,
  Redo2,
  RemoveFormatting,
  Save,
  Scroll,
  SlidersHorizontal,
  Strikethrough,
  Subscript,
  Superscript,
  Type,
  Underline,
  Undo2,
} from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isAllowedLink } from '../../shared/editor/links.ts'
import { wordCount } from '../../shared/editor/word-count.ts'
import { PALETTE_COLORS, type PaletteColor } from '../../shared/schemas/enums.ts'
import { FontPanel, LayoutPanel, PaperPanel, TocPanel } from '../components/domain/ReadingPanel.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.tsx'
import { RelativeTime } from '../components/ui/relative-time.tsx'
import { hotkeyParts } from '../hooks/useCommands.ts'
import { api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { useFocusMode } from '../lib/reading.ts'
import { INSERT_SECTIONS, InsertIcon, LINK_INSERT_EVENT } from './insert-meta.tsx'
import { paletteKey } from './marks.ts'
import { SLASH_ITEMS, type SlashCtx, slashLabel } from './slash.tsx'

type Chain = ReturnType<Editor['chain']>

/** 清除格式：去掉全部行内标记，但保留评论锚点（comment），否则评论线程会失去定位。 */
function clearMarks(editor: Editor) {
  let c: Chain = editor.chain().focus()
  for (const name of Object.keys(editor.schema.marks))
    if (name !== 'comment') c = c.unsetMark(name, { extendEmptyMarkRange: true })
  c.run()
}

function Btn({
  label,
  icon: Icon,
  onClick,
  active,
  disabled,
  testId,
  shortcut,
  children,
}: {
  label: string
  icon?: LucideIcon
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  testId?: string
  shortcut?: string
  children?: ReactNode
}) {
  const title = shortcut ? `${label} (${hotkeyParts(shortcut).join('+')})` : label
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      aria-pressed={active}
      disabled={disabled}
      data-testid={testId}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn('xz-tb-btn', active && 'is-active', children ? 'gap-1 px-2' : 'w-8')}
    >
      {Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  )
}

const Sep = () => <span className="xz-tb-sep" aria-hidden />

/** 工具栏下拉：Popover；关闭后焦点回编辑器，不跳到触发按钮。 */
function Menu({
  editor,
  label,
  icon,
  text,
  testId,
  active,
  children,
  width = 'w-56',
  open,
  onOpenChange,
}: {
  editor: Editor | null
  label: string
  icon?: LucideIcon
  text?: string
  testId: string
  active?: boolean
  children: (close: () => void) => ReactNode
  width?: string
  open?: boolean
  onOpenChange?: (v: boolean) => void
}) {
  const [inner, setInner] = useState(false)
  const isOpen = open ?? inner
  const set = onOpenChange ?? setInner
  const Icon = icon
  return (
    <Popover open={isOpen} onOpenChange={set}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={active}
          aria-expanded={isOpen}
          data-testid={testId}
          onMouseDown={(e) => e.preventDefault()}
          className={cn('xz-tb-btn gap-0.5 px-1.5', active && 'is-active')}
        >
          {Icon ? <Icon className="size-4" /> : null}
          {text ? <span className="min-w-8 text-xs">{text}</span> : null}
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('p-1.5', width)}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          if (editor && !editor.isDestroyed && editor.isEditable) editor.commands.focus()
        }}
      >
        {children(() => set(false))}
      </PopoverContent>
    </Popover>
  )
}

function MenuItem({
  label,
  hint,
  active,
  onClick,
  testId,
  className,
  icon,
}: {
  label: ReactNode
  hint?: string
  active?: boolean
  onClick: () => void
  testId?: string
  className?: string
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover',
        active && 'bg-selected text-primary-text',
        className,
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {hint ? <span className="text-fg-muted text-xs">{hint}</span> : null}
    </button>
  )
}

/** 颜色网格：默认 + 9 色板（文字色取 -fg，背景色取 -bg，夜场自动）。 */
export function ColorGrid({
  kind,
  current,
  onPick,
}: {
  kind: 'text' | 'bg'
  current: PaletteColor | null
  onPick: (c: PaletteColor | null) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5 p-1" data-testid={`color-grid-${kind}`}>
      <div className="grid grid-cols-5 gap-1.5">
        {PALETTE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={t(`palette.${c}`)}
            aria-label={t(`palette.${c}`)}
            aria-pressed={current === c}
            data-testid={`color-${kind}-${c}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
            className={cn(
              'xz-color-swatch grid size-7 place-items-center rounded-md border border-border text-xs font-semibold',
              current === c && 'ring-2 ring-(--xz-focus-color)',
            )}
            data-kind={kind}
            data-color={c}
          >
            A
          </button>
        ))}
      </div>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(null)}
        data-testid={`color-${kind}-none`}
        className="h-7 rounded-md text-fg-muted text-xs hover:bg-hover"
      >
        {kind === 'text' ? t('editor.toolbar.colorDefault') : t('editor.toolbar.bgNone')}
      </button>
    </div>
  )
}

/** 8×8 表格尺寸选择（简斋没有，衔枝补上；斜杠 /表格 仍 3×3）。 */
function TableGrid({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const { t } = useTranslation()
  const [hover, setHover] = useState<[number, number]>([0, 0])
  return (
    <div className="flex flex-col gap-1.5 p-1" data-testid="table-grid">
      <div className="grid grid-cols-8 gap-0.5">
        {Array.from({ length: 64 }, (_, i) => {
          const r = Math.floor(i / 8) + 1
          const c = (i % 8) + 1
          const on = r <= hover[0] && c <= hover[1]
          return (
            <button
              key={`${r}-${c}`}
              type="button"
              aria-label={`${r} × ${c}`}
              data-testid={`table-grid-${r}-${c}`}
              onMouseEnter={() => setHover([r, c])}
              onFocus={() => setHover([r, c])}
              onClick={() => onPick(r, c)}
              className={cn(
                'size-4 rounded-[3px] border',
                on ? 'border-selected-border bg-selected' : 'border-border bg-surface',
              )}
            />
          )
        })}
      </div>
      <div className="text-center text-fg-muted text-xs">
        {hover[0] ? `${hover[0]} × ${hover[1]}` : t('editor.toolbar.tableSize')}
      </div>
    </div>
  )
}

/** 「+」插入面板（简斋 QuickInsertMenu）：搜索 + 分区；表格走尺寸网格。 */
function InsertPanel({
  editor,
  getCtx,
  exclude,
  close,
}: {
  editor: Editor
  getCtx: () => SlashCtx
  exclude: readonly string[]
  close: () => void
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [tableOpen, setTableOpen] = useState(false)
  const byId = useMemo(
    () => new Map(SLASH_ITEMS.filter((i) => !exclude.includes(i.id)).map((i) => [i.id, i])),
    [exclude],
  )
  const run = (id: string) => {
    if (id === 'table') {
      setTableOpen(true)
      return
    }
    const it = byId.get(id)
    if (!it) return
    close()
    const at = editor.state.selection.from
    it.run(editor, { from: at, to: at }, getCtx())
  }
  const needle = q.trim().toLowerCase()
  const match = (id: string) => {
    if (!needle) return true
    const it = byId.get(id)
    const terms = [
      ...(it?.terms ?? []),
      slashLabel(id),
      t(`editor.slash.terms.${id}`, { defaultValue: '' }),
    ]
    return terms.some((s) => s.toLowerCase().includes(needle))
  }
  const sections = INSERT_SECTIONS.map((s) => ({
    ...s,
    ids: s.ids.filter((id) => byId.has(id) && match(id)),
  })).filter((s) => s.ids.length)

  if (tableOpen)
    return (
      <TableGrid
        onPick={(rows, cols) => {
          close()
          editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
        }}
      />
    )
  return (
    <div className="flex max-h-[min(70vh,32rem)] flex-col" data-testid="insert-panel">
      <input
        // biome-ignore lint/a11y/noAutofocus: 打开面板即可输入搜索
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && sections[0]?.ids[0]) run(sections[0].ids[0])
        }}
        placeholder={t('editor.toolbar.insertSearch')}
        aria-label={t('editor.toolbar.insertSearch')}
        data-testid="insert-search"
        className="mb-1.5 h-8 rounded-md border border-border bg-surface px-2.5 text-sm outline-none focus:border-selected-border"
      />
      <div className="-mx-1.5 overflow-y-auto px-1.5">
        {sections.length ? (
          sections.map((s) => (
            <section key={s.key} className="mb-2">
              <h3 className="px-1 pt-1 pb-1 font-medium text-[11px] text-fg-muted tracking-wider">
                {t(`editor.toolbar.sections.${s.key}`)}
              </h3>
              <div className={cn('grid gap-1', s.grid && !needle ? 'grid-cols-3' : 'grid-cols-2')}>
                {s.ids.map((id) => (
                  <button
                    key={id}
                    type="button"
                    data-insert={id}
                    onClick={() => run(id)}
                    className={cn(
                      'flex items-center gap-2 rounded-md text-left text-sm hover:bg-hover',
                      s.grid && !needle
                        ? 'flex-col justify-center border border-border px-1 py-2 text-xs'
                        : 'h-9 px-1.5',
                    )}
                  >
                    <InsertIcon id={id} size={s.grid && !needle ? 'md' : 'sm'} />
                    <span className="truncate">{slashLabel(id)}</span>
                  </button>
                ))}
              </div>
            </section>
          ))
        ) : (
          <p className="px-2 py-6 text-center text-fg-muted text-sm">{t('editor.slash.empty')}</p>
        )}
      </div>
    </div>
  )
}

/** 链接弹层：有选区 → 给选区加链接；无选区 → 插入「文字」并带链接。 */
function LinkForm({ editor, close }: { editor: Editor; close: () => void }) {
  const { t } = useTranslation()
  const sel = editor.state.selection
  const [href, setHref] = useState(String(editor.getAttributes('link').href ?? ''))
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const submit = () => {
    const url = href.trim()
    if (!url || !isAllowedLink(url)) {
      setBad(true)
      return
    }
    close()
    const c = editor.chain().focus()
    if (sel.empty && !editor.isActive('link'))
      c.insertContent({
        type: 'text',
        text: text.trim() || url,
        marks: [{ type: 'link', attrs: { href: url } }],
      }).run()
    else c.extendMarkRange('link').setLink({ href: url }).run()
  }
  return (
    <form
      className="flex flex-col gap-2 p-1.5"
      data-testid="toolbar-link-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: 打开即填写
        autoFocus
        value={href}
        onChange={(e) => {
          setHref(e.target.value)
          setBad(false)
        }}
        placeholder="https://"
        aria-label={t('editor.toolbar.linkUrl')}
        aria-invalid={bad}
        className="h-8 rounded-md border border-border bg-surface px-2.5 text-sm outline-none aria-invalid:border-danger"
      />
      {sel.empty && !editor.isActive('link') ? (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('editor.toolbar.linkText')}
          aria-label={t('editor.toolbar.linkText')}
          className="h-8 rounded-md border border-border bg-surface px-2.5 text-sm outline-none"
        />
      ) : null}
      {bad ? <p className="text-danger text-xs">{t('editor.bubble.linkInvalid')}</p> : null}
      <div className="flex justify-end gap-1.5">
        {editor.isActive('link') ? (
          <button
            type="button"
            className="h-7 rounded-md px-2 text-danger text-xs hover:bg-hover"
            onClick={() => {
              close()
              editor.chain().focus().extendMarkRange('link').unsetLink().run()
            }}
          >
            {t('editor.toolbar.unlink')}
          </button>
        ) : null}
        <button
          type="submit"
          className="h-7 rounded-md bg-(image:--xz-primary-gradient) px-3 text-primary-fg text-xs"
        >
          {t('editor.toolbar.linkApply')}
        </button>
      </div>
    </form>
  )
}

type ReadingTab = 'font' | 'paper' | 'layout' | 'toc'

/**
 * 「阅读」（ADR-0037、REQ-READ-010；取代 ADR-0029 的四图标阅读胶囊）：一个带文字的按钮，
 * 弹层里 字体 / 纸张 / 排版 / 目录 四个分页（分页按钮沿用 reading-open-* testid），默认停在上次看的分页。
 */
function ReadingMenu() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ReadingTab>('font')
  const items: { key: ReadingTab; icon: LucideIcon; panel: ReactNode }[] = [
    { key: 'font', icon: Type, panel: <FontPanel /> },
    { key: 'paper', icon: Scroll, panel: <PaperPanel /> },
    { key: 'layout', icon: SlidersHorizontal, panel: <LayoutPanel /> },
    { key: 'toc', icon: ListTree, panel: <TocPanel /> },
  ]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="xz-tb-btn gap-1 px-2 text-xs"
          aria-label={t('reading.title')}
          data-testid="reading-open"
        >
          <BookOpen className="size-4" />
          <span>{t('editor.docbar.readingShort')}</span>
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="xz-reading-tabs" role="tablist" aria-label={t('reading.title')}>
          {items.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className="xz-reading-tab"
              data-testid={`reading-open-${key}`}
            >
              <Icon aria-hidden />
              {t(`reading.capsule.${key}`)}
            </button>
          ))}
        </div>
        <div className="p-4" role="tabpanel">
          {items.find((x) => x.key === tab)?.panel}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const NO_EXCLUDE: readonly string[] = []

export function EditorToolbar({
  editor,
  readOnly,
  getCtx,
  exclude = NO_EXCLUDE,
}: {
  editor: Editor | null
  readOnly: boolean
  getCtx: () => SlashCtx
  /** 「+」插入面板要排除的项（模板编辑器：图片 / 附件 / 记录卡片 / 记录链接等依赖记录的项，ADR-0037） */
  exclude?: readonly string[]
}) {
  const { t } = useTranslation()
  const [insertOpen, setInsertOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null
      const level = [1, 2, 3, 4].find((l) => e.isActive('heading', { level: l })) ?? 0
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        sub: e.isActive('subscript'),
        sup: e.isActive('superscript'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        todo: e.isActive('taskList'),
        quote: e.isActive('blockquote'),
        link: e.isActive('link'),
        level,
        align: (['center', 'right'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
        textColor: paletteKey(e.getAttributes('textColor').color),
        bg: e.isActive('highlight')
          ? (paletteKey(e.getAttributes('highlight').color) ?? 'yellow')
          : null,
        canUndo: e.can().undo?.() ?? false,
        canRedo: e.can().redo?.() ?? false,
      }
    },
  })

  const c = () => (editor as Editor).chain().focus()
  const editable = !!editor && !readOnly && !!s

  // ---- 第一行：格式组（ADR-0028 两行固定分工）；放不下时从右往左收进「…」 ----
  const [moreOpen, setMoreOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const groupRefs = useRef<(HTMLDivElement | null)[]>([])
  const widths = useRef<number[]>([])
  const [shown, setShown] = useState(Number.POSITIVE_INFINITY)

  const groups: { key: string; bar: ReactNode; menu: (close: () => void) => ReactNode }[] =
    editable && editor && s
      ? [
          {
            key: 'history',
            bar: (
              <>
                <Btn
                  label={t('editor.toolbar.undo')}
                  icon={Undo2}
                  shortcut="mod+z"
                  disabled={!s.canUndo}
                  onClick={() => c().undo().run()}
                  testId="tb-undo"
                />
                <Btn
                  label={t('editor.toolbar.redo')}
                  icon={Redo2}
                  shortcut="mod+shift+z"
                  disabled={!s.canRedo}
                  onClick={() => c().redo().run()}
                  testId="tb-redo"
                />
                <Btn
                  label={t('editor.toolbar.clear')}
                  icon={RemoveFormatting}
                  onClick={() => clearMarks(editor)}
                  testId="tb-clear"
                />
              </>
            ),
            menu: (close) => (
              <>
                <MenuItem
                  icon={<Undo2 className="size-4" />}
                  label={t('editor.toolbar.undo')}
                  onClick={() => {
                    close()
                    c().undo().run()
                  }}
                />
                <MenuItem
                  icon={<Redo2 className="size-4" />}
                  label={t('editor.toolbar.redo')}
                  onClick={() => {
                    close()
                    c().redo().run()
                  }}
                />
                <MenuItem
                  icon={<RemoveFormatting className="size-4" />}
                  label={t('editor.toolbar.clear')}
                  onClick={() => {
                    close()
                    clearMarks(editor)
                  }}
                />
              </>
            ),
          },
          {
            key: 'heading',
            bar: (
              <Menu
                editor={editor}
                label={t('editor.toolbar.block')}
                text={
                  s.level
                    ? t('editor.toolbar.headingN', { level: s.level })
                    : t('editor.slash.paragraph')
                }
                testId="tb-heading"
                width="w-52"
              >
                {(close) => headingItems(close)}
              </Menu>
            ),
            menu: (close) => headingItems(close),
          },
          {
            key: 'marks',
            bar: (
              <>
                <Btn
                  label={t('editor.toolbar.bold')}
                  icon={Bold}
                  shortcut="mod+b"
                  active={s.bold}
                  onClick={() => c().toggleBold().run()}
                  testId="tb-bold"
                />
                <Btn
                  label={t('editor.toolbar.italic')}
                  icon={Italic}
                  shortcut="mod+i"
                  active={s.italic}
                  onClick={() => c().toggleItalic().run()}
                  testId="tb-italic"
                />
                <Btn
                  label={t('editor.toolbar.underline')}
                  icon={Underline}
                  shortcut="mod+u"
                  active={s.underline}
                  onClick={() => c().toggleUnderline().run()}
                  testId="tb-underline"
                />
                <Btn
                  label={t('editor.toolbar.strike')}
                  icon={Strikethrough}
                  shortcut="mod+shift+s"
                  active={s.strike}
                  onClick={() => c().toggleStrike().run()}
                  testId="tb-strike"
                />
                <Menu
                  editor={editor}
                  label={t('editor.toolbar.moreMarks')}
                  icon={Code}
                  testId="tb-more"
                  active={s.code || s.sub || s.sup}
                  width="w-44"
                >
                  {(close) => moreMarkItems(close)}
                </Menu>
              </>
            ),
            menu: (close) => (
              <>
                <MenuItem
                  icon={<Bold className="size-4" />}
                  label={t('editor.toolbar.bold')}
                  active={s.bold}
                  onClick={() => {
                    close()
                    c().toggleBold().run()
                  }}
                />
                <MenuItem
                  icon={<Italic className="size-4" />}
                  label={t('editor.toolbar.italic')}
                  active={s.italic}
                  onClick={() => {
                    close()
                    c().toggleItalic().run()
                  }}
                />
                <MenuItem
                  icon={<Underline className="size-4" />}
                  label={t('editor.toolbar.underline')}
                  active={s.underline}
                  onClick={() => {
                    close()
                    c().toggleUnderline().run()
                  }}
                />
                <MenuItem
                  icon={<Strikethrough className="size-4" />}
                  label={t('editor.toolbar.strike')}
                  active={s.strike}
                  onClick={() => {
                    close()
                    c().toggleStrike().run()
                  }}
                />
                {moreMarkItems(close)}
              </>
            ),
          },
          {
            key: 'colors',
            bar: (
              <>
                <Menu
                  editor={editor}
                  label={t('editor.toolbar.textColor')}
                  icon={Baseline}
                  testId="tb-text-color"
                  active={!!s.textColor}
                  width="w-52"
                >
                  {(close) => (
                    <ColorGrid
                      kind="text"
                      current={s.textColor}
                      onPick={(col) => {
                        close()
                        pickText(col)
                      }}
                    />
                  )}
                </Menu>
                <Menu
                  editor={editor}
                  label={t('editor.toolbar.bgColor')}
                  icon={Highlighter}
                  testId="tb-bg-color"
                  active={!!s.bg}
                  width="w-52"
                >
                  {(close) => (
                    <ColorGrid
                      kind="bg"
                      current={s.bg}
                      onPick={(col) => {
                        close()
                        pickBg(col)
                      }}
                    />
                  )}
                </Menu>
              </>
            ),
            menu: (close) => (
              <>
                <div className="px-2 pt-1 text-fg-muted text-xs">
                  {t('editor.toolbar.textColor')}
                </div>
                <ColorGrid
                  kind="text"
                  current={s.textColor}
                  onPick={(col) => {
                    close()
                    pickText(col)
                  }}
                />
                <div className="px-2 pt-1 text-fg-muted text-xs">{t('editor.toolbar.bgColor')}</div>
                <ColorGrid
                  kind="bg"
                  current={s.bg}
                  onPick={(col) => {
                    close()
                    pickBg(col)
                  }}
                />
              </>
            ),
          },
          {
            key: 'lists',
            bar: (
              <>
                <Btn
                  label={t('editor.slash.bullet')}
                  icon={List}
                  active={s.bullet}
                  onClick={() => c().toggleBulletList().run()}
                  testId="tb-bullet"
                />
                <Btn
                  label={t('editor.slash.ordered')}
                  icon={ListOrdered}
                  active={s.ordered}
                  onClick={() => c().toggleOrderedList().run()}
                  testId="tb-ordered"
                />
                <Btn
                  label={t('editor.slash.todo')}
                  icon={ListTodo}
                  active={s.todo}
                  onClick={() => c().toggleTaskList().run()}
                  testId="tb-todo"
                />
                <Btn
                  label={t('editor.slash.quote')}
                  icon={Quote}
                  active={s.quote}
                  onClick={() => c().toggleBlockquote().run()}
                  testId="tb-quote"
                />
              </>
            ),
            menu: (close) => (
              <>
                <MenuItem
                  icon={<List className="size-4" />}
                  label={t('editor.slash.bullet')}
                  active={s.bullet}
                  onClick={() => {
                    close()
                    c().toggleBulletList().run()
                  }}
                />
                <MenuItem
                  icon={<ListOrdered className="size-4" />}
                  label={t('editor.slash.ordered')}
                  active={s.ordered}
                  onClick={() => {
                    close()
                    c().toggleOrderedList().run()
                  }}
                />
                <MenuItem
                  icon={<ListTodo className="size-4" />}
                  label={t('editor.slash.todo')}
                  active={s.todo}
                  onClick={() => {
                    close()
                    c().toggleTaskList().run()
                  }}
                />
                <MenuItem
                  icon={<Quote className="size-4" />}
                  label={t('editor.slash.quote')}
                  active={s.quote}
                  onClick={() => {
                    close()
                    c().toggleBlockquote().run()
                  }}
                />
              </>
            ),
          },
          {
            key: 'align',
            bar: (
              <Menu
                editor={editor}
                label={t('editor.toolbar.align')}
                icon={
                  s.align === 'center' ? AlignCenter : s.align === 'right' ? AlignRight : AlignLeft
                }
                testId="tb-align"
                width="w-44"
              >
                {(close) => alignItems(close)}
              </Menu>
            ),
            menu: (close) => alignItems(close),
          },
          {
            key: 'link',
            bar: (
              <Popover open={linkOpen} onOpenChange={setLinkOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('editor.toolbar.link')}
                    title={t('editor.toolbar.link')}
                    aria-pressed={s.link}
                    data-testid="tb-link"
                    onMouseDown={(e) => e.preventDefault()}
                    className={cn('xz-tb-btn w-8', s.link && 'is-active')}
                  >
                    <Link2 className="size-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-72 p-1.5"
                  onCloseAutoFocus={(e) => {
                    e.preventDefault()
                    if (!editor.isDestroyed) editor.commands.focus()
                  }}
                >
                  <LinkForm editor={editor} close={() => setLinkOpen(false)} />
                </PopoverContent>
              </Popover>
            ),
            menu: (close) => (
              <>
                <div className="px-2 pt-1 text-fg-muted text-xs">{t('editor.toolbar.link')}</div>
                <LinkForm editor={editor} close={close} />
              </>
            ),
          },
        ]
      : []

  function headingItems(close: () => void) {
    return (
      <>
        <MenuItem
          label={t('editor.slash.paragraph')}
          hint={hotkeyParts('mod+shift+0').join('+')}
          active={!s?.level}
          testId="tb-heading-0"
          onClick={() => {
            close()
            c().setParagraph().run()
          }}
        />
        {([1, 2, 3, 4] as const).map((level) => (
          <MenuItem
            key={level}
            label={
              <span className={`xz-tb-h${level}`}>{t('editor.toolbar.headingN', { level })}</span>
            }
            hint={hotkeyParts(`mod+shift+${level}`).join('+')}
            active={s?.level === level}
            testId={`tb-heading-${level}`}
            onClick={() => {
              close()
              c().setHeading({ level }).run()
            }}
          />
        ))}
      </>
    )
  }
  function moreMarkItems(close: () => void) {
    return (
      <>
        <MenuItem
          icon={<Code className="size-4" />}
          label={t('editor.toolbar.code')}
          hint={hotkeyParts('mod+e').join('+')}
          active={s?.code}
          onClick={() => {
            close()
            c().toggleCode().run()
          }}
          testId="tb-code"
        />
        <MenuItem
          icon={<Superscript className="size-4" />}
          label={t('editor.toolbar.sup')}
          hint={hotkeyParts('mod+.').join('+')}
          active={s?.sup}
          onClick={() => {
            close()
            c().toggleSuperscript().run()
          }}
          testId="tb-sup"
        />
        <MenuItem
          icon={<Subscript className="size-4" />}
          label={t('editor.toolbar.sub')}
          hint={hotkeyParts('mod+,').join('+')}
          active={s?.sub}
          onClick={() => {
            close()
            c().toggleSubscript().run()
          }}
          testId="tb-sub"
        />
      </>
    )
  }
  function alignItems(close: () => void) {
    return (
      [
        ['left', AlignLeft, 'mod+shift+l'],
        ['center', AlignCenter, 'mod+shift+e'],
        ['right', AlignRight, 'mod+shift+r'],
      ] as const
    ).map(([a, Icon, key]) => (
      <MenuItem
        key={a}
        icon={<Icon className="size-4" />}
        label={t(`editor.toolbar.align_${a}`)}
        hint={hotkeyParts(key).join('+')}
        active={s?.align === a}
        testId={`tb-align-${a}`}
        onClick={() => {
          close()
          c().setTextAlign(a).run()
        }}
      />
    ))
  }
  function pickText(col: PaletteColor | null) {
    if (col) c().setTextColor(col).run()
    else c().unsetTextColor().run()
  }
  function pickBg(col: PaletteColor | null) {
    if (col) c().setHighlight({ color: col }).run()
    else c().unsetHighlight().run()
  }

  // 量宽度：可见的组记下宽度（含前置分隔线与间距）；容器宽度变化时算出能放下前几组，其余收进「…」
  const count = groups.length
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row || !count) return
    const MORE = 40
    const measure = () => {
      groupRefs.current.forEach((el, i) => {
        if (el && !el.hidden) widths.current[i] = el.offsetWidth
      })
      const plus = (row.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0
      const avail = row.clientWidth - plus
      const total = widths.current.slice(0, count).reduce((a, b) => a + (b ?? 0), 0)
      if (total <= avail) {
        setShown(count)
        return
      }
      let used = 0
      let n = 0
      while (n < count && used + (widths.current[n] ?? 0) <= avail - MORE) {
        used += widths.current[n] ?? 0
        n++
      }
      setShown(n)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    return () => ro.disconnect()
  }, [count])
  const hidden = groups.slice(Math.min(shown, count))

  // 斜杠「链接」：链接组在行内 → 打开其弹层；已收进「…」→ 打开「…」
  const linkHidden = hidden.some((g) => g.key === 'link')
  const linkHiddenRef = useRef(linkHidden)
  linkHiddenRef.current = linkHidden
  useEffect(() => {
    const open = () => (linkHiddenRef.current ? setMoreOpen(true) : setLinkOpen(true))
    window.addEventListener(LINK_INSERT_EVENT, open)
    return () => window.removeEventListener(LINK_INSERT_EVENT, open)
  }, [])

  // 吸顶检测（IntersectionObserver，rootMargin 扣掉顶栏高度）
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = sentinel
    if (!el) return
    const top = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--xz-topbar-h') || '56',
    )
    const io = new IntersectionObserver(([e]) => setStuck(!!e && !e.isIntersecting), {
      rootMargin: `-${top + 1}px 0px 0px 0px`,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [sentinel])
  if (!editable || !editor || !s) return null
  return (
    <>
      {/* 吸顶检测：哨兵滚出顶栏下沿 → 工具栏标 data-stuck（加极淡阴影） */}
      <div ref={setSentinel} className="xz-tb-sentinel" aria-hidden />
      <div
        className="xz-editor-toolbar"
        role="toolbar"
        aria-label={t('editor.toolbar.label')}
        data-testid="editor-toolbar"
        data-stuck={stuck || undefined}
      >
        {editable && editor && s ? (
          <div className="xz-tb-row1 flex" ref={rowRef} data-testid="editor-toolbar-edit">
            <div className="xz-tb-group">
              <Popover open={insertOpen} onOpenChange={setInsertOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('editor.toolbar.insert')}
                    title={t('editor.toolbar.insert')}
                    data-testid="insert-open"
                    onMouseDown={(e) => e.preventDefault()}
                    className="xz-tb-plus"
                  >
                    <Plus className="size-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[23rem] p-2"
                  onCloseAutoFocus={(e) => {
                    e.preventDefault()
                    if (!editor.isDestroyed) editor.commands.focus()
                  }}
                >
                  <InsertPanel
                    editor={editor}
                    getCtx={getCtx}
                    exclude={exclude as string[]}
                    close={() => setInsertOpen(false)}
                  />
                </PopoverContent>
              </Popover>
            </div>
            {groups.map((g, i) => (
              <div
                key={g.key}
                className="xz-tb-group"
                data-group={g.key}
                hidden={i >= shown}
                ref={(el) => {
                  groupRefs.current[i] = el
                }}
              >
                <Sep />
                {g.bar}
              </div>
            ))}
            {hidden.length ? (
              <div className="xz-tb-group">
                <Sep />
                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={t('editor.toolbar.overflow')}
                      title={t('editor.toolbar.overflow')}
                      data-testid="tb-overflow"
                      onMouseDown={(e) => e.preventDefault()}
                      className="xz-tb-btn w-8"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="flex w-60 flex-col gap-1 p-1.5"
                    data-testid="tb-overflow-menu"
                    onCloseAutoFocus={(e) => {
                      e.preventDefault()
                      if (!editor.isDestroyed) editor.commands.focus()
                    }}
                  >
                    {hidden.map((g, i) => (
                      <div
                        key={g.key}
                        className={cn('flex flex-col', i > 0 && 'border-divider border-t pt-1')}
                        data-overflow-group={g.key}
                      >
                        {g.menu(() => setMoreOpen(false))}
                      </div>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  )
}

/**
 * 文档栏（ADR-0029）：在标题下方、不吸顶。左：字数 · 上次保存版本；右：阅读（胶囊 + 专注）| 文档（保存版本 + Markdown）。
 * 这组不属于编辑格式：阅读设置只读者也用；保存 / 源码是文档级操作。由 EntryEditor 经 portal 挂到标题下的插槽。
 */
export function DocBar({
  editor,
  entryId,
  readOnly,
  others,
  onSource,
  onSaveVersion,
}: {
  editor: Editor | null
  entryId: string
  readOnly: boolean
  others: number
  onSource: () => void
  onSaveVersion: () => void
}) {
  const { t } = useTranslation()
  const setFocus = useFocusMode((st) => st.set)
  const editable = !!editor && !readOnly

  // 字数：文档变化后空闲时重算（与服务端 word_count 同一算法）
  const [words, setWords] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!editor) return
    const compute = () => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        if (editor.isDestroyed) return
        const d = editor.state.doc
        setWords(wordCount(d.textBetween(0, d.content.size, '\n', ' ')))
      }, 400)
    }
    compute()
    editor.on('update', compute)
    return () => {
      editor.off('update', compute)
      clearTimeout(timer.current)
    }
  }, [editor])

  // 上次保存版本：与历史面板同一查询（同 key），取最近一个手动保存 / 带标记的版本
  const snaps = useQuery({
    queryKey: ['entry', entryId, 'snapshots'],
    queryFn: () =>
      unwrap<{ items: { createdAt: string; createdBy?: string | null; label: string | null }[] }>(
        api.entries[':id'].snapshots.$get({ param: { id: entryId } }),
      ),
    staleTime: 30_000,
  })
  const last = snaps.data?.items.find((x) => x.createdBy || x.label)

  return (
    <div className="xz-doc-bar" data-testid="doc-bar">
      <div className="xz-doc-meta">
        <span data-testid="word-count">{t('editor.toolbar.words', { n: words })}</span>
        {last ? (
          <span data-testid="doc-last-saved">
            {t('editor.docbar.lastSaved')}
            <RelativeTime date={last.createdAt} />
          </span>
        ) : null}
      </div>
      <div className="xz-doc-actions">
        <fieldset className="xz-doc-group" aria-label={t('editor.docbar.reading')}>
          <ReadingMenu />
          <Btn
            label={t('reading.focus')}
            icon={Maximize2}
            shortcut="mod+shift+enter"
            onClick={() => setFocus(!useFocusMode.getState().on)}
            testId="focus-enter"
          >
            <span className="hidden text-xs sm:inline">{t('editor.docbar.focus')}</span>
          </Btn>
        </fieldset>
        {editable ? (
          <fieldset className="xz-doc-group" aria-label={t('editor.docbar.document')}>
            <Btn
              label={t('editor.version.save')}
              icon={Save}
              shortcut="mod+s"
              onClick={onSaveVersion}
              testId="save-version"
            >
              <span className="hidden text-xs sm:inline">{t('editor.version.saveShort')}</span>
            </Btn>
            <button
              type="button"
              data-testid="source-open"
              disabled={others > 0}
              title={others > 0 ? t('editor.source.busy') : t('editor.source.title')}
              aria-label={t('editor.source.title')}
              onClick={onSource}
              className="xz-tb-btn gap-1 px-2 text-xs"
            >
              <FileCode className="size-4" />
              <span className="hidden sm:inline">{t('editor.docbar.markdown')}</span>
            </button>
          </fieldset>
        ) : null}
      </div>
    </div>
  )
}
