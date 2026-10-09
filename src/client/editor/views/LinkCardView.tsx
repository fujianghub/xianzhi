/**
 * 网页卡片节点视图（ADR-0054 §D、REQ-LINK-008，参考简斋 LinkCardEmbed）：
 * 站点行（图标 + 站点名）· 标题（两行截断）· 描述（两行截断）· 网址（单行）。
 * - attrs 存标题 / 描述 / 站点名（插入后首次抓到即写回，只读与导出不再依赖抓取）；图标按网址实时取（data URI）。
 * - 可编辑：点击选中节点不跳转；悬停出模式菜单「链接 · 标题 · 刷新 · 打开」（前两项把卡片换回一行链接）；
 *   url 为空（斜杠命令刚插入）时显示网址输入框，回车确定、Esc / 取消删除节点。
 * - 只读：点击在新标签打开。抓取失败显示网址与「无法获取网页信息」，仍可点开。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { ExternalLink, Globe, Link2, Pencil, RefreshCw, Type } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '../../lib/cn.ts'
import { hostOf, isWebUrl, linkPreviewQuery } from '../../lib/link-preview.ts'

export function LinkCardView({
  node,
  editor,
  getPos,
  updateAttributes,
  deleteNode,
  selected,
}: NodeViewProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const url = String(node.attrs.url ?? '')
  const editable = editor.isEditable
  const q = useQuery(linkPreviewQuery(url))
  const data = q.data
  // 抓到即写回 attrs（只在可编辑、标题为空时；不覆盖用户写的标题）。换了网址或清空标题后会再次写回
  useEffect(() => {
    if (!editable || !data || node.attrs.title) return
    updateAttributes({
      title: data.title,
      description: data.description ?? '',
      siteName: data.siteName,
    })
  }, [editable, data, node.attrs.title, updateAttributes])
  const [editing, setEditing] = useState(false)

  const title = String(node.attrs.title || data?.title || '')
  const desc = String(node.attrs.description || data?.description || '')
  const site = String(node.attrs.siteName || data?.siteName || hostOf(url))

  /** 换回一行链接（文字 = 网址或标题） */
  const toLink = (text: string) => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (pos === undefined) return
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: pos, to: pos + node.nodeSize },
        {
          type: 'paragraph',
          content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] }],
        },
      )
      .run()
  }
  const refresh = async () => {
    try {
      await qc.invalidateQueries({ queryKey: ['link-preview', url] })
      const d = await qc.fetchQuery(linkPreviewQuery(url))
      updateAttributes({ title: d.title, description: d.description ?? '', siteName: d.siteName })
    } catch {
      toast.error(t('editor.linkCard.failed'))
    }
  }

  if (!url) return <UrlInput onDone={(v) => updateAttributes({ url: v })} onCancel={deleteNode} />
  if (editing)
    return (
      <CardEditor
        title={String(node.attrs.title ?? '')}
        url={url}
        onCancel={() => {
          setEditing(false)
          editor.commands.focus()
        }}
        onSave={(next) => {
          setEditing(false)
          // 换网址：描述 / 站点名作废、重新抓；标题按用户填写（留空 = 用抓到的）
          updateAttributes(
            next.url === url
              ? { title: next.title }
              : { url: next.url, title: next.title, description: '', siteName: '' },
          )
        }}
      />
    )

  const btn = (key: string, Icon: typeof Link2, label: string, run: () => void) => (
    <button
      key={key}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        run()
      }}
      className="xz-link-card-mode"
      data-testid={`link-card-${key}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  )

  return (
    <NodeViewWrapper
      as="div"
      className={cn('xz-link-card-wrap', selected && 'is-selected')}
      data-drag-handle
      data-testid="link-card"
    >
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        contentEditable={false}
        className="xz-link-card"
        onClick={(e) => {
          if (editable) e.preventDefault()
        }}
      >
        <span className="xz-link-card-text">
          <span className="xz-link-card-site">
            {data?.favicon ? (
              <img src={data.favicon} alt="" className="xz-link-card-icon" />
            ) : (
              <Globe className="xz-link-card-icon text-fg-faint" aria-hidden />
            )}
            <span className="truncate">{site}</span>
          </span>
          <span className="xz-link-card-title">
            {title || (q.isPending ? t('editor.linkCard.loading') : url)}
          </span>
          {desc ? (
            <span className="xz-link-card-desc">{desc}</span>
          ) : q.isError && !title ? (
            <span className="xz-link-card-desc">{t('editor.linkCard.failed')}</span>
          ) : null}
          <span className="xz-link-card-url">{url}</span>
        </span>
      </a>
      {editable ? (
        <span className="xz-link-card-menu" contentEditable={false}>
          {btn('as-link', Link2, t('editor.linkCard.asLink'), () => toLink(url))}
          {btn('as-title', Type, t('editor.linkCard.asTitle'), () => toLink(title || url))}
          {btn('edit', Pencil, t('editor.linkCard.edit'), () => setEditing(true))}
          {btn('refresh', RefreshCw, t('editor.linkCard.refresh'), () => void refresh())}
          {btn('open', ExternalLink, t('editor.linkCard.open'), () =>
            window.open(url, '_blank', 'noopener,noreferrer'),
          )}
        </span>
      ) : null}
    </NodeViewWrapper>
  )
}

function UrlInput({ onDone, onCancel }: { onDone: (url: string) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [v, setV] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const submit = () => {
    const s = v.trim()
    const url = /^https?:\/\//i.test(s) ? s : s ? `https://${s}` : ''
    if (!isWebUrl(url)) {
      toast.error(t('editor.linkCard.invalid'))
      return
    }
    onDone(url)
  }
  return (
    <NodeViewWrapper as="div" className="xz-link-card-input" data-stop-pm contentEditable={false}>
      <Globe className="size-4 shrink-0 text-fg-muted" aria-hidden />
      <input
        ref={ref}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        placeholder={t('editor.linkCard.placeholder')}
        aria-label={t('editor.linkCard.placeholder')}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        data-testid="link-card-input"
      />
      <button type="button" className="xz-link-card-mode" onClick={submit}>
        {t('ui.action.confirm')}
      </button>
      <button type="button" className="xz-link-card-mode" onClick={onCancel}>
        {t('ui.action.cancel')}
      </button>
    </NodeViewWrapper>
  )
}

/** 编辑网页卡片（ADR-0055）：显示的标题与真实网址都可改；回车保存、Esc 取消 */
function CardEditor({
  title,
  url,
  onSave,
  onCancel,
}: {
  title: string
  url: string
  onSave: (v: { title: string; url: string }) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [tv, setTv] = useState(title)
  const [uv, setUv] = useState(url)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.select()
  }, [])
  const save = () => {
    const s = uv.trim()
    const next = /^https?:\/\//i.test(s) ? s : s ? `https://${s}` : ''
    if (!isWebUrl(next)) return void toast.error(t('editor.linkCard.invalid'))
    onSave({ title: tv.trim(), url: next })
  }
  const field =
    'h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-selected-border'
  return (
    <NodeViewWrapper
      as="div"
      className="xz-link-card-edit"
      data-stop-pm
      contentEditable={false}
      data-testid="link-card-form"
    >
      <span className="font-medium text-xs">{t('editor.linkCard.editTitle')}</span>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      >
        <label className="flex items-center gap-2 text-xs">
          <span className="w-14 shrink-0 text-fg-muted">{t('editor.linkCard.text')}</span>
          <input
            ref={ref}
            value={tv}
            onChange={(e) => setTv(e.target.value)}
            maxLength={200}
            placeholder={t('editor.linkCard.textAuto')}
            className={field}
            data-testid="link-card-title-input"
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-14 shrink-0 text-fg-muted">{t('editor.linkCard.href')}</span>
          <input
            value={uv}
            onChange={(e) => setUv(e.target.value)}
            className={field}
            data-testid="link-card-url-input"
          />
        </label>
        <div className="flex justify-end gap-1">
          <button type="button" className="xz-link-card-mode" onClick={onCancel}>
            {t('ui.action.cancel')}
          </button>
          <button type="submit" className="xz-link-card-mode" data-testid="link-card-save">
            {t('ui.action.save')}
          </button>
        </div>
      </form>
    </NodeViewWrapper>
  )
}
