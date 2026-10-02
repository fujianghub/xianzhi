/** 编辑器节点视图（03 §3.2 · §3.3 · §9）：代码块头部条（语言 / 行数 / 复制，ADR-0025 §5）、附件卡片、记录卡片、目录、未知块。 */
import { useQuery } from '@tanstack/react-query'
import { NodeViewContent, type NodeViewProps, NodeViewWrapper, useEditorState } from '@tiptap/react'
import { decode as decodeBlurhash } from 'blurhash'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  HelpCircle,
  ListTree,
  Presentation,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type FileKind, fileKind, PREVIEWABLE } from '../../shared/editor/file-kind.ts'
import { collectHeadings } from '../../shared/editor/headings.ts'
import { CODE_FOLD_AUTO_LINES } from '../../shared/schemas/preferences.ts'
import { api, unwrap } from '../lib/api.ts'
import { copyText } from '../lib/clipboard.ts'
import { cn } from '../lib/cn.ts'
import { useKindLabel } from '../lib/entry-types.ts'
import { useReading } from '../lib/reading.ts'
import { ALL_LANGUAGES, ensureLanguage, lowlight } from './lowlight.ts'

const AttachmentPreview = lazy(() => import('./AttachmentPreview.tsx'))

export function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const { t } = useTranslation()
  const lang = String(node.attrs.language ?? '')
  const [copied, setCopied] = useState(false)
  const lines = node.textContent ? node.textContent.split('\n').length : 1
  // 折叠（ADR-0032）：只影响本人视图、不写正文；初值按阅读偏好（展开 / 折叠 / 超过阈值自动折叠），偏好改变时重置
  const fold = useReading((st) => st.prefs.codeFold)
  const initial = () => fold === 'collapsed' || (fold === 'auto' && lines > CODE_FOLD_AUTO_LINES)
  const [collapsed, setCollapsed] = useState(initial)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只随偏好变化重置，不随行数变化
  useEffect(() => setCollapsed(initial()), [fold])
  const canFold = lines > 3
  // 远端 / 历史内容里的按需语言：挂载时加载，完成后重设属性触发重新高亮
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只随语言变化
  useEffect(() => {
    if (lang && !lowlight.registered(lang))
      void ensureLanguage(lang).then((ok) => {
        if (ok) updateAttributes({ language: lang })
      })
  }, [lang])
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])
  const copy = async () => {
    // copyText 在局域网 HTTP（无 navigator.clipboard）下退回 execCommand（ADR-0025 §5）
    if (await copyText(node.textContent)) setCopied(true)
    else toast.error(t('editor.code.copyFailed'))
  }
  return (
    <NodeViewWrapper
      as="div"
      className="xz-code"
      data-testid="code-block"
      data-collapsed={(collapsed && canFold) || undefined}
    >
      {/* 头部条（ADR-0025 §5）：折叠 · 语言 · 行数 · 复制；不覆盖代码区 */}
      <div className="xz-code-head" contentEditable={false}>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          disabled={!canFold}
          aria-expanded={!collapsed || !canFold}
          aria-label={collapsed ? t('editor.code.expand') : t('editor.code.collapse')}
          title={collapsed ? t('editor.code.expand') : t('editor.code.collapse')}
          data-testid="code-fold"
          className="xz-code-fold"
        >
          <ChevronRight className="size-3.5" />
        </button>
        <select
          disabled={!editor.isEditable}
          value={lang}
          aria-label={t('editor.language')}
          className="h-7 rounded-md border border-(--xz-code-border) bg-(--xz-code-bar) px-1 text-(--xz-code-fg) text-xs"
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
        <span className="text-(--xz-code-comment) text-xs" data-testid="code-lines">
          {t('editor.code.lines', { n: lines })}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? t('editor.code.copied') : t('editor.code.copy')}
          title={copied ? t('editor.code.copied') : t('editor.code.copy')}
          data-testid="code-copy"
          data-copied={copied || undefined}
          className="ms-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-(--xz-code-fg) text-xs hover:bg-(--xz-code-border)"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t('editor.code.copied') : t('editor.code.copy')}
        </button>
      </div>
      <pre>
        <NodeViewContent<'code'> as="code" className={lang ? `language-${lang}` : undefined} />
      </pre>
      {collapsed && canFold ? (
        <button
          type="button"
          contentEditable={false}
          className="xz-code-more"
          onClick={() => setCollapsed(false)}
          data-testid="code-expand"
        >
          {t('editor.code.expandN', { n: lines })}
        </button>
      ) : null}
    </NodeViewWrapper>
  )
}

const fmtSize = (n: number) =>
  n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

const KIND_ICON: Record<FileKind, typeof FileText> = {
  pdf: FileType,
  word: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  csv: FileSpreadsheet,
  markdown: FileText,
  code: FileCode,
  json: FileJson,
  text: FileText,
  zip: FileArchive,
  image: FileImage,
  other: File,
}

/** 附件卡片（03 §3.2、REQ-ATTACH-013）：按类别给图标；可预览的给「预览」（PDF 开新标签页），始终可下载。 */
export function AttachmentView({ node }: NodeViewProps) {
  const { t } = useTranslation()
  const id = String(node.attrs.attachmentId ?? '')
  const name = String(node.attrs.name || t('editor.attachment'))
  const kind = fileKind(String(node.attrs.mime ?? ''), name)
  const Icon = KIND_ICON[kind]
  const [preview, setPreview] = useState(false)
  const openPreview = () => {
    if (kind === 'pdf') window.open(`/api/v1/attachments/${id}`, '_blank', 'noopener')
    else setPreview(true)
  }
  return (
    <NodeViewWrapper as="div" className="my-2" data-drag-handle>
      <div
        className="paper flex items-center gap-3 rounded-md px-3 py-2 text-sm"
        contentEditable={false}
        data-testid="attachment-card"
        data-kind={kind}
      >
        <Icon className="size-5 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="text-fg-muted text-xs">{fmtSize(Number(node.attrs.size ?? 0))}</span>
        {id && PREVIEWABLE.has(kind) ? (
          <button
            type="button"
            onClick={openPreview}
            className="inline-flex items-center gap-1 text-primary-text text-xs"
            aria-label={t('editor.preview')}
            title={t('editor.preview')}
            data-testid="attachment-preview-open"
          >
            <Eye className="size-4" />
          </button>
        ) : null}
        {id ? (
          <a
            href={`/api/v1/attachments/${id}?download=1`}
            className="inline-flex items-center gap-1 text-primary-text text-xs"
            aria-label={t('editor.download')}
            title={t('editor.download')}
          >
            <Download className="size-4" />
          </a>
        ) : null}
      </div>
      {preview ? (
        <Suspense fallback={null}>
          <AttachmentPreview id={id} name={name} kind={kind} onClose={() => setPreview(false)} />
        </Suspense>
      ) : null}
    </NodeViewWrapper>
  )
}

interface Preview {
  title: string
  kind: string
  typeId?: string | null
  excerpt: string
  author: { displayName: string }
}
export function EntryCardView({ node }: NodeViewProps) {
  const { t } = useTranslation()
  const kindLabel = useKindLabel()
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
        className="paper block rounded-md p-3 text-sm hover-veil"
      >
        {isError ? (
          <span className="text-fg-muted">{t('ui.notFound.title')}</span>
        ) : (
          <>
            <span className="font-medium">{data?.title ?? '…'}</span>
            {data ? (
              <span className="ml-2 text-fg-muted text-xs">
                {kindLabel(data.kind, data.typeId).label} · {data.author.displayName}
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
  const depth = useReading((s) => s.prefs.tocDepth)
  const numbered = useReading((s) => s.prefs.tocNumbers)
  const all = useEditorState({
    editor,
    selector: ({ editor: ed }) => (ed ? collectHeadings(ed.state.doc) : []),
  })
  const headings = all?.filter((h) => h.depth <= depth)
  // 目录块（ADR-0027，参考简斋 [TOC] 卡片）：主色浅底细边卡片 + 标题行 + 主色编号；
  // 列表不用浏览器序号（.xz-prose ol 的 decimal 会和章节编号叠成两遍）
  return (
    <NodeViewWrapper
      as="nav"
      className="xz-toc-card"
      contentEditable={false}
      data-testid="toc"
      aria-label={t('editor.toc.title')}
    >
      <div className="xz-toc-card-head">
        <ListTree className="size-4" aria-hidden />
        <span>{t('editor.toc.title')}</span>
        {headings?.length ? (
          <span className="xz-toc-card-count">{t('editor.toc.count', { n: headings.length })}</span>
        ) : null}
      </div>
      {headings?.length ? (
        <ol className="xz-toc-card-list">
          {headings.map((h) => (
            <li key={h.pos} data-depth={h.depth} data-testid="toc-item">
              <button
                type="button"
                className="xz-toc-card-link"
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .setTextSelection(h.pos + 1)
                    .scrollIntoView()
                    .run()
                }
              >
                {numbered ? (
                  <span className="xz-toc-num" data-testid="toc-num">
                    {h.num}
                  </span>
                ) : null}
                {h.text || '…'}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="xz-toc-card-empty">{t('editor.tocEmpty')}</p>
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
export const IMAGE_WIDTHS = [25, 50, 75, 100] as const
export const IMAGE_ALIGNS = ['left', 'center', 'right'] as const
const ALIGN_ICON = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const

/**
 * 图片（03 §3.2、REQ-EDITOR-021）：blurhash 占位；选中时浮出「宽度 25 / 50 / 75 / 100% · 左 / 中 / 右」工具条；
 * 图注在图下就地编辑（只读时显示文本）。宽度 null = 原始尺寸（不超过正文宽）。
 */
export function ImageView({ node, selected, editor, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation()
  const src = String(node.attrs.src ?? '')
  const id = src.startsWith('xz:attachment/') ? src.slice('xz:attachment/'.length) : ''
  const w = Number(node.attrs.width) || 0
  const h = Number(node.attrs.height) || 0
  const pct = Number(node.attrs.displayWidth) || 0
  const align = (node.attrs.align as (typeof IMAGE_ALIGNS)[number] | null) ?? 'center'
  const caption = String(node.attrs.caption ?? '')
  const editable = editor.isEditable
  const [loaded, setLoaded] = useState(false)
  const placeholder = useMemo(
    () => blurhashUrl(node.attrs.blurhash as string | null),
    [node.attrs.blurhash],
  )
  return (
    <NodeViewWrapper
      as="figure"
      className="relative my-3"
      data-drag-handle
      data-align={align}
      data-width={pct || undefined}
    >
      {selected && editable ? (
        <div
          className="glass-thick-flat -top-10 absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg p-1"
          contentEditable={false}
          data-testid="image-toolbar"
        >
          {IMAGE_WIDTHS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={pct === v}
              data-testid={`image-width-${v}`}
              onClick={() => updateAttributes({ displayWidth: pct === v ? null : v })}
              className={cn(
                'h-7 rounded-md px-2 text-xs hover:bg-hover',
                pct === v && 'bg-selected font-medium',
              )}
            >
              {v}%
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          {IMAGE_ALIGNS.map((a) => {
            const Icon = ALIGN_ICON[a]
            return (
              <button
                key={a}
                type="button"
                aria-pressed={align === a}
                aria-label={t(`editor.image.align.${a}`)}
                title={t(`editor.image.align.${a}`)}
                data-testid={`image-align-${a}`}
                onClick={() => updateAttributes({ align: a === 'center' ? null : a })}
                className={cn(
                  'grid size-7 place-items-center rounded hover:bg-hover',
                  align === a && 'bg-selected',
                )}
              >
                <Icon className="size-4" />
              </button>
            )
          })}
        </div>
      ) : null}
      <div
        className={cn(
          'relative overflow-hidden rounded-md bg-surface-2',
          align === 'center' && 'mx-auto',
          align === 'right' && 'ms-auto',
          selected && 'ring-2 ring-primary-text',
        )}
        style={{
          aspectRatio: w && h ? `${w} / ${h}` : undefined,
          width: pct ? `${pct}%` : undefined,
          maxWidth: !pct && w ? `${w}px` : undefined,
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
      {editable ? (
        <input
          value={caption}
          onChange={(e) => updateAttributes({ caption: e.target.value })}
          placeholder={t('editor.image.captionPlaceholder')}
          aria-label={t('editor.image.caption')}
          maxLength={200}
          data-testid="image-caption"
          className={cn(
            'mt-1.5 block w-full bg-transparent text-center text-fg-muted text-sm outline-none placeholder:text-fg-faint',
            !caption && !selected && 'opacity-0 focus:opacity-100 hover:opacity-100',
          )}
          // 图注输入时不让 ProseMirror 接管键盘（Enter / Backspace 删节点等）
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : caption ? (
        <figcaption className="mt-1.5 text-center text-fg-muted text-sm">{caption}</figcaption>
      ) : null}
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
