/**
 * 链接气泡（ADR-0054 §D、REQ-LINK-008，参考简斋 LinkBubbleMenu）：可编辑时光标落在链接上（无选区）出现。
 * 「显示为」链接（文字 = 网址）· 标题（取网页标题）· 卡片（换成网页卡片块）｜ 打开 · 复制链接 · 编辑 · 移除。
 * 有选区时让给选区工具条（BubbleBar）；非 http(s) 链接（mailto / xz:）只有打开 / 复制 / 编辑 / 移除。
 * 「编辑」（ADR-0055）同时改显示文字与链接地址；没有网页卡片节点的编辑器（任务描述 / 评论）不给「卡片」。
 * 布局（ADR-0056，debug/2026-10-09-link-bubble-clipped-in-dock）：
 * - fixed 定位、挂载 / 边界 / 滚动跟随见 floating.ts——不再被详情坞 / 纸面裁剪，也不撑出坞的横向滚动；
 *   z = dropdown，压过侧栏与吸顶格式栏；
 * - 切到编辑表单、紧凑模式切换（内容尺寸变）时主动重新定位；
 * - 所在区域窄于 560px 时按钮只留图标（文字进 title 与读屏）。
 */
import { getMarkRange } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Copy, ExternalLink, Link2, PanelTop, Pencil, Type, Unlink } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { isAllowedLink } from '../../shared/editor/links.ts'
import { cn } from '../lib/cn.ts'
import { fetchLinkPreview, isWebUrl } from '../lib/link-preview.ts'
import { menuBoundary, menuBounds, useFixedMenu } from './floating.ts'

interface Active {
  from: number
  to: number
  href: string
  text: string
}

const PLUGIN_KEY = 'linkBubble'
/** 区域窄于此宽度时按钮只留图标（完整一行约 513px） */
const COMPACT_BELOW = 560

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
  // 编辑（ADR-0055）：显示文字与链接地址都可改；开始编辑时记下链接范围，输入期间选区变化不影响
  const [editing, setEditing] = useState<Active | null>(null)
  const [href, setHref] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [compact, setCompact] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // 挂载、滚动跟随与重新定位（floating.ts，ADR-0056 §B）
  const { appendTo, visible, reposition } = useFixedMenu(editor, PLUGIN_KEY)
  // 有网页卡片节点的编辑器（记录正文）才给「卡片」；任务描述 / 评论（liteKit）没有
  const cards = !!editor.schema.nodes.linkCard
  const link = useEditorState({ editor, selector: ({ editor: e }) => (e ? activeLink(e) : null) })
  const shouldShow = useCallback(
    ({ editor: e }: { editor: Editor }) =>
      e.isEditable && !e.isActive('codeBlock') && e.state.selection.empty && e.isActive('link'),
    [],
  )
  // BubbleMenu 在 options 引用变化时会派发 updateOptions：保持稳定引用，边界在每次定位时现取
  const options = useMemo(
    () => ({
      strategy: 'fixed' as const,
      placement: 'bottom' as const,
      offset: 6,
      flip: () => ({ ...menuBounds(editor), fallbackPlacements: ['top' as const] }),
      shift: () => menuBounds(editor),
      hide: () => ({ boundary: menuBounds(editor).boundary }),
      onShow: () => {
        visible.current = true
        const w = menuBoundary(editor)?.clientWidth ?? window.innerWidth
        setCompact(w < COMPACT_BELOW)
      },
      onHide: () => {
        visible.current = false
        setEditing(null)
      },
    }),
    [editor, visible],
  )
  // 内容尺寸变了（工具条 ⇄ 编辑表单、紧凑切换）：按新尺寸重新翻转 / 推回
  // biome-ignore lint/correctness/useExhaustiveDependencies: editing / compact 是触发条件
  useEffect(() => {
    reposition()
  }, [editing, compact, reposition])
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
  const startEdit = () => {
    if (!link) return
    setHref(link.href)
    setLabel(link.text)
    setEditing(link)
    setTimeout(() => inputRef.current?.select(), 0)
  }
  /** 保存：地址清空 = 移除链接；显示文字清空 = 用地址作文字 */
  const apply = () => {
    const at = editing
    if (!at) return
    const v = href.trim()
    const type = editor.schema.marks.link
    if (!type) return
    if (!v) {
      editor.chain().focus().setTextSelection(at).unsetLink().run()
      setEditing(null)
      return
    }
    if (!isAllowedLink(v)) return void toast.error(t('editor.bubble.linkInvalid'))
    const text = label.trim() || v
    const tr = editor.state.tr
    if (text !== at.text) tr.insertText(text, at.from, at.to)
    const to = at.from + text.length
    tr.removeMark(at.from, to, type).addMark(at.from, to, type.create({ href: v }))
    editor.view.dispatch(tr)
    editor.commands.focus(to)
    setEditing(null)
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
      title={compact ? label : undefined}
      className={cn('xz-link-bubble-btn', opts.active && 'is-active')}
      data-testid={`link-bubble-${key}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {compact ? <span className="sr-only">{label}</span> : label}
    </button>
  )

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={PLUGIN_KEY}
      shouldShow={shouldShow}
      options={options}
      appendTo={appendTo}
      className="glass-thick xz-link-bubble"
      data-compact={compact || undefined}
      data-testid="link-bubble"
    >
      {editing ? (
        <form
          className="flex flex-col gap-1.5 p-1"
          onSubmit={(e) => {
            e.preventDefault()
            apply()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(null)
              editor.commands.focus()
            }
          }}
          data-testid="link-bubble-form"
        >
          <label className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 text-fg-muted">{t('editor.linkCard.text')}</span>
            <input
              ref={inputRef}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={500}
              className="h-7 w-[min(16rem,calc(100vw-7rem))] rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-selected-border"
              data-testid="link-bubble-text"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 text-fg-muted">{t('editor.linkCard.href')}</span>
            <input
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder={t('editor.bubble.linkPrompt')}
              className="h-7 w-[min(16rem,calc(100vw-7rem))] rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-selected-border"
              data-testid="link-bubble-input"
            />
          </label>
          <div className="flex justify-end gap-1">
            <button
              type="button"
              className="xz-link-bubble-btn"
              onClick={() => {
                setEditing(null)
                editor.commands.focus()
              }}
            >
              {t('ui.action.cancel')}
            </button>
            <button
              type="submit"
              className="xz-link-bubble-btn is-active"
              data-testid="link-bubble-save"
            >
              {t('ui.action.save')}
            </button>
          </div>
        </form>
      ) : link ? (
        <div className="flex items-center gap-0.5">
          {web ? (
            <>
              {compact ? null : (
                <span className="px-1.5 text-fg-muted text-xs">{t('editor.linkCard.showAs')}</span>
              )}
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
              {cards ? btn('as-card', PanelTop, t('editor.linkCard.asCard'), asCard) : null}
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
          {btn('edit', Pencil, t('editor.linkCard.edit'), startEdit)}
          {btn('unlink', Unlink, t('editor.linkCard.unlink'), () =>
            editor.chain().focus().extendMarkRange('link').unsetLink().run(),
          )}
        </div>
      ) : null}
    </BubbleMenu>
  )
}
