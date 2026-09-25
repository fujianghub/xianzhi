/**
 * ProseMirror JSON → 单文件 HTML（03 §8、REQ-EXPORT-006）：内联 04 排版 CSS，无外链样式，用于邮件摘要与打印。
 * 所有文本转义；链接只保留 http(s) / mailto / 站内相对地址。
 */
import type { PmNode } from '../../schemas/pm.ts'

export interface HtmlOptions {
  resolveImage?: (attachmentId: string) => string
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const safeHref = (h: string) => (/^(https?:|mailto:|\/(?!\/))/i.test(h) ? h : '#')
const ATTACH = /^xz:attachment\/([0-9a-f-]{36})$/i

/** 04 §2 排版（纸面、字号 16 / 行高 1.75、正文宽 760）；色值来自 tokens 的日场取值，导出文件离线可读。 */
export const EXPORT_CSS = `body{margin:0;background:#faf8f4;color:#1f2328;font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif}
main{max-width:760px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.35;margin:1.6em 0 .6em}h1{font-size:1.75em}h2{font-size:1.4em}h3{font-size:1.2em}
p{margin:.8em 0}blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid #d5cfc4;color:#57606a}code{font:.9em ui-monospace,SFMono-Regular,Menlo,monospace;background:#f0ece4;padding:.1em .3em;border-radius:4px}
pre{background:#f0ece4;padding:12px 16px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #d5cfc4;padding:6px 10px}th{background:#f0ece4}
img{max-width:100%;border-radius:6px}.callout{border-radius:8px;padding:10px 14px;background:#eef3f8;margin:1em 0}.task{list-style:none;margin-left:-1.2em}hr{border:0;border-top:1px solid #d5cfc4;margin:2em 0}
.mention{color:#3b6fb0}`

function text(n: PmNode): string {
  let out = esc(n.text ?? '')
  for (const m of n.marks ?? []) {
    if (m.type === 'bold') out = `<strong>${out}</strong>`
    else if (m.type === 'italic') out = `<em>${out}</em>`
    else if (m.type === 'strike') out = `<s>${out}</s>`
    else if (m.type === 'underline') out = `<u>${out}</u>`
    else if (m.type === 'code') out = `<code>${out}</code>`
    else if (m.type === 'link')
      out = `<a href="${esc(safeHref(String(m.attrs?.href ?? '')))}">${out}</a>`
  }
  return out
}

function node(n: PmNode, o: HtmlOptions): string {
  const inner = () => (n.content ?? []).map((c) => node(c, o)).join('')
  switch (n.type) {
    case 'doc':
      return inner()
    case 'text':
      return text(n)
    case 'paragraph':
      return `<p>${inner()}</p>`
    case 'heading': {
      const l = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1)))
      return `<h${l}>${inner()}</h${l}>`
    }
    case 'blockquote':
      return `<blockquote>${inner()}</blockquote>`
    case 'horizontalRule':
      return '<hr>'
    case 'hardBreak':
      return '<br>'
    case 'bulletList':
      return `<ul>${inner()}</ul>`
    case 'orderedList':
      return `<ol>${inner()}</ol>`
    case 'listItem':
      return `<li>${inner()}</li>`
    case 'taskList':
      return `<ul>${inner()}</ul>`
    case 'taskItem':
      return `<li class="task">${n.attrs?.checked ? '☑' : '☐'} ${inner()}</li>`
    case 'codeBlock':
      return `<pre><code>${esc((n.content ?? []).map((t) => t.text ?? '').join(''))}</code></pre>`
    case 'mermaid':
      return `<pre><code>${esc(String(n.attrs?.code ?? ''))}</code></pre>`
    case 'mathBlock':
      return `<pre><code>${esc(String(n.attrs?.latex ?? ''))}</code></pre>`
    case 'callout':
      return `<div class="callout" data-kind="${esc(String(n.attrs?.kind ?? 'info'))}">${inner()}</div>`
    case 'mention':
      return `<span class="mention">@${esc(String(n.attrs?.label ?? n.attrs?.id ?? ''))}</span>`
    case 'entryLink':
      return `<a href="/entries/${esc(String(n.attrs?.id ?? ''))}">${esc(String(n.attrs?.title || n.attrs?.id || ''))}</a>`
    case 'image': {
      const src = String(n.attrs?.src ?? '')
      const m = ATTACH.exec(src)
      const url = m
        ? (o.resolveImage?.(m[1] as string) ?? `/api/v1/attachments/${m[1]}/md`)
        : safeHref(src)
      const img = `<img src="${esc(url)}" alt="${esc(String(n.attrs?.alt ?? ''))}">`
      const caption = String(n.attrs?.caption ?? '')
      // 图注 / 宽度 / 对齐（REQ-EDITOR-021）：有任一项才包 figure
      if (!caption && !n.attrs?.displayWidth && !n.attrs?.align) return img
      const pct = Number(n.attrs?.displayWidth) || 0
      const style = [
        pct ? `width:${Math.min(100, Math.max(10, pct))}%` : '',
        n.attrs?.align === 'left' ? 'margin-right:auto' : '',
        n.attrs?.align === 'right' ? 'margin-left:auto' : '',
        n.attrs?.align === 'center' ? 'margin-inline:auto' : '',
      ]
        .filter(Boolean)
        .join(';')
      return `<figure${style ? ` style="${style}"` : ''}>${img}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`
    }
    case 'table':
      return `<table>${inner()}</table>`
    case 'tableRow':
      return `<tr>${inner()}</tr>`
    case 'tableHeader':
      return `<th>${inner()}</th>`
    case 'tableCell':
      return `<td>${inner()}</td>`
    default:
      return inner()
  }
}

export function pmToHtmlDocument(
  title: string,
  doc: PmNode | null | undefined,
  o: HtmlOptions = {},
): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${EXPORT_CSS}</style></head><body><main><h1>${esc(title)}</h1>${doc ? node(doc, o) : ''}</main></body></html>`
}
