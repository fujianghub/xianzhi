/**
 * 表格工具条（ADR-0025 §4、REQ-EDITOR-028）：光标在表格内时浮在表格上方（第二个 BubbleMenu，独立 pluginKey）。
 * 行 / 列增删、合并 / 拆分（不可用时禁用）、表头行开关、删除表格。glass-thick（06 L2）。
 * 定位（ADR-0056 §E）：fixed、挂载 / 边界 / 滚动跟随见 floating.ts（不被详情坞裁剪、不撑横向滚动、压过侧栏）；
 * 表格顶部滚出可视区时参照改为表格在可视区内的部分，工具条停在可视区顶部，不翻到屏幕外；
 * 所在区域比工具条窄（最窄的详情坞 320px）时换行。
 */
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  type LucideIcon,
  PanelLeft,
  PanelTop,
  Rows3,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn.ts'
import { menuBoundary, menuBounds, topInset, useFixedMenu } from './floating.ts'

const PLUGIN_KEY = 'xzTableMenu'
const GAP = 8

/** 取光标所在表格的 DOM，作为浮层参照（而不是选区矩形）。 */
/** 当前表格的表头状态（ADR-0032）：首行全是 th = 表头行；各行首格都是 th = 表头列。 */
function tableHeaders(editor: Editor): { row: boolean; col: boolean } {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const table = $from.node(d)
    if (table.type.name !== 'table') continue
    const rows: import('@tiptap/pm/model').Node[] = []
    table.forEach((r) => {
      rows.push(r)
    })
    const first = rows[0]
    let row = !!first && first.childCount > 0
    first?.forEach((c) => {
      if (c.type.name !== 'tableHeader') row = false
    })
    // 表头列看除首行外的各行首格（首行在开表头行时本就是 th）
    const body = rows.length > 1 ? rows.slice(1) : rows
    const col = body.length > 0 && body.every((r) => r.firstChild?.type.name === 'tableHeader')
    return { row, col }
  }
  return { row: false, col: false }
}

function tableElement(editor: Editor): HTMLElement | null {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') {
      const dom = editor.view.nodeDOM($from.before(d))
      const el = dom instanceof HTMLElement ? dom : null
      return (el?.querySelector('table') as HTMLElement | null) ?? el
    }
  }
  return null
}

export function TableMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation()
  const shouldShow = useCallback(
    ({ editor: e }: { editor: Editor }) => e.isEditable && e.isActive('table'),
    [],
  )
  const { appendTo, visible, reposition } = useFixedMenu(editor, PLUGIN_KEY)
  const bar = useRef<HTMLDivElement>(null)
  // 工具条最宽 = 所在区域宽 − 两侧边距，超出换行；宽度变了（换行 → 变高）按新尺寸重新定位
  const [maxW, setMaxW] = useState<number | undefined>(undefined)
  // biome-ignore lint/correctness/useExhaustiveDependencies: maxW 是触发条件
  useEffect(() => {
    reposition()
  }, [maxW, reposition])
  const options = useMemo(
    () => ({
      strategy: 'fixed' as const,
      placement: 'top-start' as const,
      offset: 8,
      flip: () => menuBounds(editor),
      shift: () => menuBounds(editor),
      hide: () => ({ boundary: menuBounds(editor).boundary }),
      onShow: () => {
        visible.current = true
        const w = menuBoundary(editor)?.clientWidth
        setMaxW(w ? w - 2 * GAP : undefined)
      },
      onHide: () => {
        visible.current = false
      },
    }),
    [editor, visible],
  )
  const getReferencedVirtualElement = useCallback(() => {
    const el = tableElement(editor)
    if (!el) return null
    return {
      contextElement: el,
      getBoundingClientRect: () => {
        const r = el.getBoundingClientRect()
        // 参照顶边至少在可视区顶部以下「工具条高 + 间距」，工具条才放得进可视区
        const top = topInset(editor) + (bar.current?.offsetHeight ?? 40) + GAP
        // 整张表已滚出可视区：保持原矩形，交给 hide 隐藏
        if (r.top >= top || r.bottom <= top) return r
        return new DOMRect(r.left, top, r.width, r.bottom - top)
      },
    }
  }, [editor])
  const can = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      merge: e?.can().mergeCells() ?? false,
      split: e?.can().splitCell() ?? false,
      ...(e ? tableHeaders(e) : { row: false, col: false }),
    }),
  })

  const btn = (
    key: string,
    Icon: LucideIcon,
    run: () => boolean,
    opts: { disabled?: boolean; danger?: boolean; pressed?: boolean } = {},
  ) => (
    <button
      key={key}
      type="button"
      aria-label={t(`editor.table.${key}`)}
      title={t(`editor.table.${key}`)}
      aria-pressed={opts.pressed}
      disabled={opts.disabled}
      data-testid={`table-${key}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn(
        'grid size-8 place-items-center rounded-md transition-colors duration-(--xz-dur-fast) hover:bg-hover disabled:pointer-events-none disabled:opacity-40',
        opts.danger && 'text-danger',
        opts.pressed && 'bg-selected text-primary-text',
      )}
    >
      <Icon className="size-4" />
    </button>
  )
  const sep = (k: string) => <span key={k} className="mx-0.5 h-5 w-px bg-border" aria-hidden />
  const chain = () => editor.chain().focus()

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={PLUGIN_KEY}
      shouldShow={shouldShow}
      options={options}
      appendTo={appendTo}
      getReferencedVirtualElement={getReferencedVirtualElement}
      className="xz-float-menu"
    >
      <div
        ref={bar}
        role="toolbar"
        aria-label={t('editor.table.toolbar')}
        data-testid="table-menu"
        className="glass-thick relative z-(--xz-z-dropdown) flex flex-wrap items-center gap-0.5 rounded-lg px-1 py-1 text-fg"
        style={{ maxWidth: maxW }}
      >
        {btn('rowBefore', ArrowUpToLine, () => chain().addRowBefore().run())}
        {btn('rowAfter', ArrowDownToLine, () => chain().addRowAfter().run())}
        {btn('colBefore', ArrowLeftToLine, () => chain().addColumnBefore().run())}
        {btn('colAfter', ArrowRightToLine, () => chain().addColumnAfter().run())}
        {sep('s1')}
        {btn('deleteRow', Rows3, () => chain().deleteRow().run())}
        {btn('deleteCol', Columns3, () => chain().deleteColumn().run())}
        {sep('s2')}
        {btn('merge', TableCellsMerge, () => chain().mergeCells().run(), { disabled: !can?.merge })}
        {btn('split', TableCellsSplit, () => chain().splitCell().run(), { disabled: !can?.split })}
        {btn('headerRow', PanelTop, () => chain().toggleHeaderRow().run(), {
          pressed: can?.row,
        })}
        {btn('headerCol', PanelLeft, () => chain().toggleHeaderColumn().run(), {
          pressed: can?.col,
        })}
        {sep('s3')}
        {btn('deleteTable', Trash2, () => chain().deleteTable().run(), { danger: true })}
      </div>
    </BubbleMenu>
  )
}
