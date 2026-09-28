/**
 * 块手柄（ADR-0025 §3、REQ-EDITOR-027，参考简斋 BlockHoverMenu）：拖动把手移动块；单击打开菜单——
 * 转换为（正文 / 标题 1–4 / 三种列表 / 引用 / 代码块，仅文本块可用）、包裹为（四种提示块 / 折叠块 / 引用）、
 * 操作（复制此块：去掉评论锚点再插到下方；删除此块）。菜单打开期间锁住把手，避免跟随鼠标跳走。
 * 当前悬停块由 DragHandle 的 onNodeChange 写入 `onBlockNodeChange`（EntryEditor 接线）。
 */
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { GripVertical } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.tsx'
import { cn } from '../lib/cn.ts'
import { CALLOUT_KINDS } from './nodes.ts'

interface BlockTarget {
  node: PmNode | null
  pos: number
}
const useBlockTarget = create<BlockTarget & { set: (t: BlockTarget) => void }>((set) => ({
  node: null,
  pos: -1,
  set: (t) => set(t),
}))

/** 交给 `<DragHandle onNodeChange>`：记下把手当前对应的顶层块。 */
export function onBlockNodeChange({ node, pos }: { node: PmNode | null; pos: number }) {
  useBlockTarget.getState().set({ node, pos })
}

/** JSON 里去掉评论锚点标记（复制出的块不应与原块共用评论线程）。 */
function stripComments(json: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...json }
  if (Array.isArray(out.marks)) {
    const marks = (out.marks as { type: string }[]).filter((m) => m.type !== 'comment')
    if (marks.length) out.marks = marks
    else delete out.marks
  }
  if (Array.isArray(out.content))
    out.content = (out.content as Record<string, unknown>[]).map(stripComments)
  return out
}

type Item = { key: string; label: string; run: () => void; danger?: boolean; disabled?: boolean }

export function BlockHandle({ editor }: { editor: Editor }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const live = useBlockTarget()
  // 打开菜单时对目标块拍快照：鼠标移进（portal 的）菜单会离开编辑器，DragHandle 随即把目标清成 null
  const snap = useRef<BlockTarget>({ node: null, pos: -1 })
  const { node } = open ? snap.current : live

  const setOpenLocked = (v: boolean) => {
    if (v) snap.current = { node: live.node, pos: live.pos }
    setOpen(v)
    // DragHandle 插件读事务元数据 lockDragHandle（React 版不注册 lock 命令，直接 setMeta）
    editor.commands.setMeta('lockDragHandle', v)
  }
  const valid = () => {
    const t = snap.current
    const n = t.node && t.pos >= 0 ? editor.state.doc.nodeAt(t.pos) : null
    return n ? { n, pos: t.pos } : null
  }
  /** 选中整块文本后执行（转换 / 包裹都作用在这一块上）。 */
  const onBlock = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => {
    const b = valid()
    setOpenLocked(false)
    if (!b) return
    const chain = editor.chain().focus()
    const sel = b.n.isTextblock
      ? chain.setTextSelection({ from: b.pos + 1, to: b.pos + b.n.nodeSize - 1 })
      : chain.setNodeSelection(b.pos)
    fn(sel).run()
  }
  const textblock = !!node?.isTextblock

  const convert: Item[] = [
    { key: 'paragraph', label: t('editor.block.paragraph'), run: onBlock((c) => c.setParagraph()) },
    ...([1, 2, 3, 4] as const).map((level) => ({
      key: `h${level}`,
      label: t('editor.block.heading', { level }),
      run: onBlock((c) => c.setHeading({ level })),
    })),
    { key: 'bullet', label: t('editor.block.bullet'), run: onBlock((c) => c.toggleBulletList()) },
    {
      key: 'ordered',
      label: t('editor.block.ordered'),
      run: onBlock((c) => c.toggleOrderedList()),
    },
    { key: 'todo', label: t('editor.block.todo'), run: onBlock((c) => c.toggleTaskList()) },
    { key: 'quote', label: t('editor.block.quote'), run: onBlock((c) => c.toggleBlockquote()) },
    { key: 'code', label: t('editor.block.code'), run: onBlock((c) => c.setCodeBlock()) },
  ].map((i) => ({ ...i, disabled: !textblock }))

  const wrap: Item[] = [
    ...CALLOUT_KINDS.map((kind) => ({
      key: `callout-${kind}`,
      label: t(`editor.callout.kind.${kind}`),
      run: onBlock((c) => c.wrapIn('callout', { kind })),
    })),
    { key: 'details', label: t('editor.block.details'), run: onBlock((c) => c.setDetails()) },
    {
      key: 'wrapQuote',
      label: t('editor.block.quote'),
      run: onBlock((c) => c.wrapIn('blockquote')),
    },
  ]

  const actions: Item[] = [
    {
      key: 'duplicate',
      label: t('editor.block.duplicate'),
      run: () => {
        const b = valid()
        setOpenLocked(false)
        if (!b) return
        editor
          .chain()
          .focus()
          .insertContentAt(b.pos + b.n.nodeSize, stripComments(b.n.toJSON()))
          .run()
      },
    },
    {
      key: 'delete',
      label: t('editor.block.delete'),
      danger: true,
      run: () => {
        const b = valid()
        setOpenLocked(false)
        if (!b) return
        editor
          .chain()
          .focus()
          .deleteRange({ from: b.pos, to: b.pos + b.n.nodeSize })
          .run()
      },
    },
  ]

  const section = (title: string, items: Item[], cols: string) => (
    <div className="flex flex-col gap-1">
      <div className="px-1 text-fg-muted text-xs">{title}</div>
      <div className={cn('grid gap-1', cols)}>
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            disabled={i.disabled}
            onClick={i.run}
            data-testid={`block-${i.key}`}
            className={cn(
              'h-8 truncate rounded-md px-2 text-left text-sm hover:bg-hover disabled:pointer-events-none disabled:opacity-40',
              i.danger && 'text-danger',
            )}
          >
            {i.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <Popover open={open} onOpenChange={setOpenLocked}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="grid size-6 cursor-grab place-items-center rounded text-fg-faint hover:bg-hover"
          aria-label={t('editor.dragHandle')}
          title={t('editor.block.handleHint')}
          data-testid="block-handle"
        >
          <GripVertical className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="flex w-80 flex-col gap-3 p-3"
        data-testid="block-menu"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {section(t('editor.block.convert'), convert, 'grid-cols-3')}
        {section(t('editor.block.wrap'), wrap, 'grid-cols-3')}
        {section(t('editor.block.actions'), actions, 'grid-cols-2')}
      </PopoverContent>
    </Popover>
  )
}
