/** 编辑器节点视图（03 §3.2 · §3.3 · §9）：代码块语言选择、附件卡片、记录卡片、目录、未知块。 */
import { useQuery } from '@tanstack/react-query'
import { NodeViewContent, type NodeViewProps, NodeViewWrapper, useEditorState } from '@tiptap/react'
import { decode as decodeBlurhash } from 'blurhash'
import { Download, FileText, HelpCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { ALL_LANGUAGES, ensureLanguage, lowlight } from './lowlight.ts'

export function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const { t } = useTranslation()
  const lang = String(node.attrs.language ?? '')
  // 远端 / 历史内容里的按需语言：挂载时加载，完成后重设属性触发重新高亮
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只随语言变化
  useEffect(() => {
    if (lang && !lowlight.registered(lang))
      void ensureLanguage(lang).then((ok) => {
        if (ok) updateAttributes({ language: lang })
      })
  }, [lang])
  return (
    <NodeViewWrapper as="div" className="xz-code relative">
      <select
        contentEditable={false}
        disabled={!editor.isEditable}
        value={lang}
        aria-label={t('editor.language')}
        className="absolute top-2 right-2 h-7 rounded-md border border-(--xz-code-border) bg-(--xz-code-bar) px-1 text-(--xz-code-fg) text-xs"
        data-testid="code-language"
        onChange={async (e) => {
          const next = e.target.value
          await ensureLanguage(next) // 按需语言：一次 chunk 请求（REQ-EDITOR-003）
          updateAttributes({ language: next || null })
        }}
      >
        <option value="">{t('editor.plainText')}</option>
        {ALL_LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <pre>
        <NodeViewContent<'code'> as="code" className={lang ? `language-${lang}` : undefined} />
      </pre>
    </NodeViewWrapper>
  )
}

const fmtSize = (n: number) =>
  n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

export function AttachmentView({ node }: NodeViewProps) {
  const { t } = useTranslation()
  const id = String(node.attrs.attachmentId ?? '')
  return (
    <NodeViewWrapper as="div" className="my-2" data-drag-handle>
      <div
        className="paper flex items-center gap-3 rounded-md border border-divider px-3 py-2 text-sm"
        contentEditable={false}
      >
        <FileText className="size-5 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate">
          {String(node.attrs.name || t('editor.attachment'))}
        </span>
        <span className="text-fg-muted text-xs">{fmtSize(Number(node.attrs.size ?? 0))}</span>
        {id ? (
          <a
            href={`/api/v1/attachments/${id}?download=1`}
            className="inline-flex items-center gap-1 text-primary-text text-xs"
            aria-label={t('editor.download')}
          >
            <Download className="size-4" />
          </a>
        ) : null}
      </div>
    </NodeViewWrapper>
  )
}

interface Preview {
  title: string
  kind: string
  excerpt: string
  author: { displayName: string }
}
export function EntryCardView({ node }: NodeViewProps) {
  const { t } = useTranslation()
  const id = String(node.attrs.entryId ?? '')
  const { data, isError } = useQuery({
    queryKey: ['entry', id, 'preview'],
    queryFn: () => unwrap<Preview>(api.entries[':id'].preview.$get({ param: { id } })),
    enabled: !!id,
    staleTime: 60_000,
  })
  return (
    <NodeViewWrapper as="div" className="my-2" data-drag-handle>
      <a
        href={`/entries/${id}`}
        contentEditable={false}
        className="paper block rounded-md border border-divider p-3 text-sm hover:bg-hover"
      >
        {isError ? (
          <span className="text-fg-muted">{t('ui.notFound.title')}</span>
        ) : (
          <>
            <span className="font-medium">{data?.title ?? '…'}</span>
            {data ? (
              <span className="ml-2 text-fg-muted text-xs">
                {t(`entry.kind.${data.kind}`)} · {data.author.displayName}
              </span>
            ) : null}
            {data?.excerpt ? (
              <p className="mt-1 line-clamp-2 text-fg-muted">{data.excerpt}</p>
            ) : null}
          </>
        )}
      </a>
    </NodeViewWrapper>
  )
}

export function TocView({ editor }: NodeViewProps) {
  const { t } = useTranslation()
  const headings = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      const out: { level: number; text: string; pos: number }[] = []
      ed?.state.doc.descendants((n, pos) => {
        if (n.type.name === 'heading')
          out.push({ level: Number(n.attrs.level), text: n.textContent, pos })
      })
      return out
    },
  })
  return (
    <NodeViewWrapper
      as="nav"
      className="paper my-3 rounded-md border border-divider p-3 text-sm"
      contentEditable={false}
      data-testid="toc"
    >
      {headings?.length ? (
        <ol className="flex flex-col gap-1">
          {headings.map((h) => (
            <li key={h.pos} style={{ paddingInlineStart: `${(h.level - 1) * 12}px` }}>
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .setTextSelection(h.pos + 1)
                    .scrollIntoView()
                    .run()
                }
              >
                {h.text || '…'}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-fg-muted">{t('editor.tocEmpty')}</p>
      )}
    </NodeViewWrapper>
  )
}

export function UnknownBlockView({ node }: NodeViewProps) {
  const { t } = useTranslation()
  let type = '?'
  try {
    type = (JSON.parse(String(node.attrs.raw)) as { type?: string }).type ?? '?'
  } catch {
    /* raw 坏了也照样显示占位 */
  }
  return (
    <NodeViewWrapper as="div" className="my-2" contentEditable={false} data-testid="unknown-block">
      <div className="flex items-center gap-2 rounded-md border border-border border-dashed px-3 py-2 text-fg-muted text-sm">
        <HelpCircle className="size-4" />
        {t('editor.unknownBlock')} · <code>{type}</code>
      </div>
    </NodeViewWrapper>
  )
}

/** 图片（REQ-EDITOR-004）：渲染 md 变体；加载前以 blurhash 解码的 32×32 画布作占位，按 width/height 预留比例。 */
export function ImageView({ node, selected }: NodeViewProps) {
  const src = String(node.attrs.src ?? '')
  const id = src.startsWith('xz:attachment/') ? src.slice('xz:attachment/'.length) : ''
  const w = Number(node.attrs.width) || 0
  const h = Number(node.attrs.height) || 0
  const [loaded, setLoaded] = useState(false)
  const placeholder = useMemo(
    () => blurhashUrl(node.attrs.blurhash as string | null),
    [node.attrs.blurhash],
  )
  return (
    <NodeViewWrapper as="figure" className="my-3" data-drag-handle>
      <div
        className={cn(
          'relative overflow-hidden rounded-md bg-surface-2',
          selected && 'ring-2 ring-primary-text',
        )}
        style={{
          aspectRatio: w && h ? `${w} / ${h}` : undefined,
          maxWidth: w ? `${w}px` : undefined,
          backgroundImage: !loaded && placeholder ? `url(${placeholder})` : undefined,
          backgroundSize: 'cover',
        }}
      >
        {id ? (
          <img
            src={`/api/v1/attachments/${id}/md`}
            alt={String(node.attrs.alt ?? '')}
            data-src={src}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            className={cn(
              'block h-full w-full object-contain transition-opacity duration-(--xz-dur-base)',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        ) : null}
      </div>
    </NodeViewWrapper>
  )
}

function blurhashUrl(hash: string | null): string | null {
  if (!hash || typeof document === 'undefined') return null
  try {
    const px = decodeBlurhash(hash, 32, 32)
    const c = document.createElement('canvas')
    c.width = 32
    c.height = 32
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px), 32, 32), 0, 0)
    return c.toDataURL()
  } catch {
    return null
  }
}
