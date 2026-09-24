/**
 * 选区浮动工具条（REQ-EDITOR-015、06 §4）：glass-thick + rounded-full；加粗 / 斜体 / 下划线 / 删除线 / 行内代码 / 高亮 / 链接。
 * 链接输入走协议白名单（REQ-EDITOR-018）；Mod+K 通过 LINK_EVENT 打开同一输入框。
 */
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link2,
  MessageSquarePlus,
  Strikethrough,
  Underline,
  Unlink,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { isAllowedLink } from '../../shared/editor/links.ts'
import { cn } from '../lib/cn.ts'
import { LINK_EVENT } from './extensions.ts'

export function BubbleBar({ editor, onComment }: { editor: Editor; onComment?: () => void }) {
  const { t } = useTranslation()
  const [linking, setLinking] = useState(false)
  const [href, setHref] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // BubbleMenu 在 shouldShow / options 引用变化时会派发 updateOptions 事务并重新定位：一律保持稳定引用
  const commentRef = useRef(onComment)
  commentRef.current = onComment
  const options = useMemo(
    () => ({ placement: 'top' as const, offset: 8, onHide: () => setLinking(false) }),
    [],
  )
  const shouldShow = useCallback(
    ({ editor: e, state }: { editor: Editor; state: Editor['state'] }) =>
      e.isEditable && !state.selection.empty && !state.selection.$from.parent.type.spec.code,
    [],
  )
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      underline: e?.isActive('underline') ?? false,
      strike: e?.isActive('strike') ?? false,
      code: e?.isActive('code') ?? false,
      highlight: e?.isActive('highlight') ?? false,
      link: e?.isActive('link') ?? false,
      href: String(e?.getAttributes('link').href ?? ''),
    }),
  })

  useEffect(() => {
    const open = () => {
      setHref(s?.href ?? '')
      setLinking(true)
    }
    window.addEventListener(LINK_EVENT, open)
    return () => window.removeEventListener(LINK_EVENT, open)
  }, [s?.href])
  useEffect(() => {
    if (linking) inputRef.current?.focus()
  }, [linking])

  const apply = () => {
    const v = href.trim()
    if (!v) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else if (!isAllowedLink(v)) {
      toast.error(t('editor.bubble.linkInvalid'))
      return
    } else editor.chain().focus().extendMarkRange('link').setLink({ href: v }).run()
    setLinking(false)
  }

  const btn = (key: string, active: boolean | undefined, Icon: typeof Bold, run: () => void) => (
    <button
      key={key}
      type="button"
      aria-label={t(`editor.bubble.${key}`)}
      aria-pressed={!!active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn(
        'grid size-8 place-items-center rounded-full transition-colors duration-(--xz-dur-fast) hover:bg-hover',
        active && 'bg-selected text-primary-text',
      )}
    >
      <Icon className="size-4" />
    </button>
  )

  return (
    <BubbleMenu editor={editor} options={options} shouldShow={shouldShow}>
      <div
        data-testid="bubble-menu"
        // relative + 下拉层级：选区靠左时工具条会越过纸面，需盖在固定侧栏（sticky 层）之上
        className="glass-thick relative z-(--xz-z-dropdown) flex items-center gap-0.5 rounded-full px-1.5 py-1 text-fg"
      >
        {linking ? (
          <form
            className="flex items-center gap-1 px-1"
            onSubmit={(e) => {
              e.preventDefault()
              apply()
            }}
          >
            <input
              ref={inputRef}
              value={href}
              onChange={(e) => setHref(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setLinking(false)
                  editor.commands.focus()
                }
              }}
              placeholder={t('editor.bubble.linkPrompt')}
              aria-label={t('editor.bubble.link')}
              className="h-8 w-64 bg-transparent px-2 text-sm outline-none placeholder:text-fg-faint"
            />
            {s?.link
              ? btn('unlink', false, Unlink, () => {
                  editor.chain().focus().extendMarkRange('link').unsetLink().run()
                  setLinking(false)
                })
              : null}
          </form>
        ) : (
          <>
            {btn('bold', s?.bold, Bold, () => editor.chain().focus().toggleBold().run())}
            {btn('italic', s?.italic, Italic, () => editor.chain().focus().toggleItalic().run())}
            {btn('underline', s?.underline, Underline, () =>
              editor.chain().focus().toggleUnderline().run(),
            )}
            {btn('strike', s?.strike, Strikethrough, () =>
              editor.chain().focus().toggleStrike().run(),
            )}
            {btn('code', s?.code, Code, () => editor.chain().focus().toggleCode().run())}
            {btn('highlight', s?.highlight, Highlighter, () =>
              editor.chain().focus().toggleHighlight().run(),
            )}
            {btn('link', s?.link, Link2, () => {
              setHref(s?.href ?? '')
              setLinking(true)
            })}
            {onComment
              ? btn('comment', false, MessageSquarePlus, () => commentRef.current?.())
              : null}
          </>
        )}
      </div>
    </BubbleMenu>
  )
}
