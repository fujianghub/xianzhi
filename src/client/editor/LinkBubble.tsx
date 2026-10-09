/**
 * 链接气泡（ADR-0054 §D、REQ-LINK-008，参考简斋 LinkBubbleMenu）：可编辑时光标落在链接上（无选区）出现。
 * 「显示为」链接（文字 = 网址）· 标题（取网页标题）· 卡片（换成网页卡片块）｜ 打开 · 复制链接 · 编辑 · 移除。
 * 有选区时让给选区工具条（BubbleBar）；非 http(s) 链接（mailto / xz:）只有打开 / 复制 / 编辑 / 移除。
 */
import { getMarkRange } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Copy, ExternalLink, Link2, PanelTop, Pencil, Type, Unlink } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { isAllowedLink } from '../../shared/editor/links.ts'
import { cn } from '../lib/cn.ts'
import { fetchLinkPreview, isWebUrl } from '../lib/link-preview.ts'

interface Active {
  from: number
  to: number
  href: string
  text: string
}

function activeLink(editor: Editor): Active | null {
  const { state } = editor
  const type = state.schema.marks.link
  if (!type || !state.selection.empty) return null
  const $pos = state.selection.$from
  const range = getMarkRange($pos, type)
  if (!range) return null
  const mark = state.doc
    .resolve(range.from + 1)
    .marks()
    .find((m) => m.type === type)
  return {
    ...range,
    href: String(mark?.attrs.href ?? ''),
    text: state.doc.textBetween(range.from, range.to),
  }
}

export function LinkBubble({ editor }: { editor: Editor }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [href, setHref] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const link = useEditorState({ editor, selector: ({ editor: e }) => (e ? activeLink(e) : null) })
  const shouldShow = useCallback(
    ({ editor: e }: { editor: Editor }) =>
      e.isEditable && !e.isActive('codeBlock') && e.state.selection.empty && e.isActive('link'),
    [],
  )
  const options = useMemo(
    () => ({ placement: 'bottom' as const, offset: 6, onHide: () => setEditing(false) }),
    [],
  )
  const web = !!link && isWebUrl(link.href)

  const setText = (text: string) => {
    if (!link || !text || text === link.text) return
    const type = editor.schema.marks.link
    if (!type) return
    const tr = editor.state.tr.insertText(text, link.from, link.to)
    tr.addMark(link.from, link.from + text.length, type.create({ href: link.href }))
    editor.view.dispatch(tr)
  }
  const asTitle = async () => {
    if (!link) return
    setBusy(true)
    try {
      const p = await fetchLinkPreview(link.href)
      setText(p.title)
    } catch {
      toast.error(t('editor.linkCard.failed'))
    } finally {
      setBusy(false)
    }
  }
  const asCard = () => {
    if (!link) return
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: link.from, to: link.to },
        {
          type: 'linkCard',
          attrs: { url: link.href, title: link.text !== link.href ? link.text : '' },
        },
      )
      .run()
  }
  const apply = () => {
    const v = href.trim()
    if (!v) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else if (!isAllowedLink(v)) return void toast.error(t('editor.bubble.linkInvalid'))
    else editor.chain().focus().extendMarkRange('link').setLink({ href: v }).run()
    setEditing(false)
  }

  const btn = (
    key: string,
    Icon: typeof Link2,
    label: string,
    run: () => void,
    opts: { active?: boolean; disabled?: boolean } = {},
  ) => (
    <button
      key={key}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      disabled={opts.disabled}
      aria-pressed={opts.active}
      className={cn('xz-link-bubble-btn', opts.active && 'is-active')}
      data-testid={`link-bubble-${key}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  )

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="linkBubble"
      shouldShow={shouldShow}
      options={options}
      className="glass-thick xz-link-bubble"
      data-testid="link-bubble"
    >
      {editing ? (
        <form
          className="flex items-center gap-1"
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
                e.preventDefault()
                setEditing(false)
                editor.commands.focus()
              }
            }}
            aria-label={t('editor.bubble.linkPrompt')}
            placeholder={t('editor.bubble.linkPrompt')}
            className="h-7 w-64 rounded-md border border-border bg-surface px-2 text-sm outline-none"
            data-testid="link-bubble-input"
          />
          <button type="submit" className="xz-link-bubble-btn">
            {t('ui.action.save')}
          </button>
        </form>
      ) : link ? (
        <div className="flex items-center gap-0.5">
          {web ? (
            <>
              <span className="px-1.5 text-fg-muted text-xs">{t('editor.linkCard.showAs')}</span>
              {btn('as-link', Link2, t('editor.linkCard.asLink'), () => setText(link.href), {
                active: link.text === link.href,
              })}
              {btn(
                'as-title',
                Type,
                busy ? t('editor.linkCard.fetchingTitle') : t('editor.linkCard.asTitle'),
                () => void asTitle(),
                { active: link.text !== link.href, disabled: busy },
              )}
              {btn('as-card', PanelTop, t('editor.linkCard.asCard'), asCard)}
              <span className="mx-1 h-4 w-px bg-divider" aria-hidden />
            </>
          ) : null}
          {btn('open', ExternalLink, t('editor.linkCard.open'), () =>
            window.open(link.href, '_blank', 'noopener,noreferrer'),
          )}
          {btn('copy', Copy, t('editor.linkCard.copy'), () => {
            void navigator.clipboard
              ?.writeText(link.href)
              .then(() => toast.success(t('editor.linkCard.copied')))
              .catch(() => undefined)
          })}
          {btn('edit', Pencil, t('editor.linkCard.edit'), () => {
            setHref(link.href)
            setEditing(true)
            setTimeout(() => inputRef.current?.select(), 0)
          })}
          {btn('unlink', Unlink, t('editor.linkCard.unlink'), () =>
            editor.chain().focus().extendMarkRange('link').unsetLink().run(),
          )}
        </div>
      ) : null}
    </BubbleMenu>
  )
}
