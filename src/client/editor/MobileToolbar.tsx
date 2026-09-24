/**
 * 移动端编辑器工具条（03 §11.6、04 §6、REQ-MOBILE-003）：< lg 且编辑器聚焦时固定在底部，随软键盘上移
 * （visualViewport：bottom = innerHeight − (vv.height + vv.offsetTop)）。glass 材质，横向可滚动，当前块类型高亮。
 */
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import {
  Bold,
  CheckSquare,
  ChevronDown,
  Code,
  Heading2,
  Image,
  Italic,
  Link2,
  List,
  Quote,
  Redo2,
  Slash,
  Undo2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn.ts'
import { LINK_EVENT } from './extensions.ts'

/** 键盘占用的底部高度（无 visualViewport 时为 0）。 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const v = window.visualViewport
      if (v) setInset(Math.max(0, window.innerHeight - (v.height + v.offsetTop)))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}

export function MobileToolbar({ editor, onImage }: { editor: Editor; onImage: () => void }) {
  const { t } = useTranslation()
  const inset = useKeyboardInset()
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      focused: e?.isFocused ?? false,
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      h2: e?.isActive('heading', { level: 2 }) ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      todo: e?.isActive('taskList') ?? false,
      quote: e?.isActive('blockquote') ?? false,
      code: e?.isActive('codeBlock') ?? false,
    }),
  })
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(width < 64rem)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(width < 64rem)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  if (!narrow || !s?.focused) return null
  const chain = () => editor.chain().focus()
  const btn = (key: string, active: boolean, Icon: typeof Bold, run: () => void) => (
    <button
      key={key}
      type="button"
      aria-label={t(`editor.mobile.${key}`)}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-md',
        active ? 'bg-selected text-primary-text' : 'text-fg',
      )}
    >
      <Icon className="size-5" strokeWidth={1.75} />
    </button>
  )
  return (
    <div
      data-testid="mobile-toolbar"
      role="toolbar"
      aria-label={t('editor.mobile.toolbar')}
      style={{ bottom: `${inset}px` }}
      className="glass fixed inset-x-0 z-(--xz-z-sticky) flex h-12 items-center gap-0.5 overflow-x-auto border-x-0 border-b-0 px-1 pb-[env(safe-area-inset-bottom)]"
    >
      {btn('undo', false, Undo2, () => chain().undo().run())}
      {btn('redo', false, Redo2, () => chain().redo().run())}
      {btn('bold', !!s?.bold, Bold, () => chain().toggleBold().run())}
      {btn('italic', !!s?.italic, Italic, () => chain().toggleItalic().run())}
      {btn('heading', !!s?.h2, Heading2, () => chain().toggleHeading({ level: 2 }).run())}
      {btn('bullet', !!s?.bullet, List, () => chain().toggleBulletList().run())}
      {btn('todo', !!s?.todo, CheckSquare, () => chain().toggleTaskList().run())}
      {btn('quote', !!s?.quote, Quote, () => chain().toggleBlockquote().run())}
      {btn('code', !!s?.code, Code, () => chain().toggleCodeBlock().run())}
      {btn('link', false, Link2, () => window.dispatchEvent(new CustomEvent(LINK_EVENT)))}
      {btn('image', false, Image, onImage)}
      {btn('slash', false, Slash, () => chain().insertContent('/').run())}
      {btn('hide', false, ChevronDown, () => editor.commands.blur())}
    </div>
  )
}
