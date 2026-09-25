/**
 * 附件预览（REQ-ATTACH-013）：文本 / 代码 / JSON 等宽显示，csv 表格（前 200 行），Markdown 经 markdown-it（html:false）渲染，
 * docx 经 mammoth 转 HTML 后按白名单净化（不透传 style / 事件 / 脚本 / 非 http(s) 链接）。PDF 由调用方交给浏览器新标签页。
 * 只读取前 1MB 文本；mammoth 与本组件一起懒加载。
 */
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { type FileKind, parseCsv } from '../../shared/editor/file-kind.ts'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { markdownToHtml } from './paste.ts'

const TEXT_LIMIT = 1024 * 1024

const ALLOWED_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'S',
  'SUB',
  'SUP',
  'A',
  'BR',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
  'BLOCKQUOTE',
  'PRE',
  'CODE',
  'HR',
  'IMG',
])

/** 白名单净化：未知标签拆包保留文字；属性只留 a[href=http(s)/mailto]、img[src=data:image]、td/th 跨行列。 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild as HTMLElement
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      walk(child)
      if (!ALLOWED_TAGS.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED'].includes(child.tagName)) child.remove()
        else child.replaceWith(...child.childNodes)
        continue
      }
      for (const a of [...child.attributes]) {
        const keep =
          (child.tagName === 'A' && a.name === 'href' && /^(https?:|mailto:)/i.test(a.value)) ||
          (child.tagName === 'IMG' && a.name === 'src' && /^data:image\//i.test(a.value)) ||
          (['TD', 'TH'].includes(child.tagName) && ['colspan', 'rowspan'].includes(a.name))
        if (!keep) child.removeAttribute(a.name)
      }
      if (child.tagName === 'A') {
        child.setAttribute('target', '_blank')
        child.setAttribute('rel', 'noopener noreferrer')
      }
    }
  }
  walk(root)
  return root.innerHTML
}

type Loaded = { type: 'text'; text: string; truncated: boolean } | { type: 'html'; html: string }

async function load(id: string, kind: FileKind): Promise<Loaded> {
  const res = await fetch(`/api/v1/attachments/${id}`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(String(res.status))
  if (kind === 'word') {
    const mammoth = (await import('mammoth')).default
    const r = await mammoth.convertToHtml({ arrayBuffer: await res.arrayBuffer() })
    return { type: 'html', html: sanitizeHtml(r.value) }
  }
  const buf = await res.arrayBuffer()
  const text = new TextDecoder().decode(buf.slice(0, TEXT_LIMIT))
  const truncated = buf.byteLength > TEXT_LIMIT
  if (kind === 'markdown') return { type: 'html', html: sanitizeHtml(markdownToHtml(text)) }
  if (kind === 'json') {
    try {
      return { type: 'text', text: JSON.stringify(JSON.parse(text), null, 2), truncated }
    } catch {
      /* 截断或非法 JSON：原样显示 */
    }
  }
  return { type: 'text', text, truncated }
}

export default function AttachmentPreview({
  id,
  name,
  kind,
  onClose,
}: {
  id: string
  name: string
  kind: FileKind
  onClose: () => void
}) {
  const { t } = useTranslation()
  const q = useQuery({
    queryKey: ['attachment-preview', id],
    queryFn: () => load(id, kind),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const data = q.data
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] w-[min(96vw,60rem)] flex-col"
        data-testid="attachment-preview"
      >
        <DialogTitle className="truncate pe-8">{name}</DialogTitle>
        <DialogDescription className="sr-only">{t('editor.attachmentPreview')}</DialogDescription>
        <div className="mt-3 min-h-40 flex-1 overflow-auto rounded-md border border-border">
          {q.isError ? (
            <p className="p-4 text-danger text-sm">{t('editor.previewFailed')}</p>
          ) : !data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.type === 'html' ? (
            <div
              className="xz-prose p-4"
              data-testid="attachment-preview-html"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitizeHtml 白名单净化后的 mammoth / markdown-it 输出
              dangerouslySetInnerHTML={{ __html: data.html }}
            />
          ) : kind === 'csv' ? (
            <CsvTable text={data.text} />
          ) : (
            <pre
              className="whitespace-pre-wrap break-words p-4 font-mono text-xs"
              data-testid="attachment-preview-text"
            >
              {data.text}
            </pre>
          )}
        </div>
        {data?.type === 'text' && data.truncated ? (
          <p className="mt-2 text-fg-muted text-xs">{t('editor.previewTruncated')}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function CsvTable({ text }: { text: string }) {
  const rows = parseCsv(text)
  const [head, ...body] = rows
  return (
    <table className="w-full border-collapse text-xs" data-testid="attachment-preview-csv">
      <thead className="sticky top-0 bg-surface">
        <tr>
          {(head ?? []).map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 表头列无稳定 id
            <th key={i} className="border-border border-b px-2 py-1 text-left font-medium">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 预览行无稳定 id
          <tr key={i} className="odd:bg-surface-2">
            {r.map((c, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 单元格无稳定 id
              <td key={j} className="px-2 py-1 align-top">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
