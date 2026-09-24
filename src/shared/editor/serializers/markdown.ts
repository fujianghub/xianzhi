/**
 * ProseMirror JSON → Markdown（03 §8，**有损**，导出对话框需明示）：直接遍历 JSON，不依赖编辑器 schema，前后端共用。
 * 规则：callout → `:::kind`；mermaid → ```mermaid；mathBlock → `$$`；entryLink → `[title](xz://entry/<id>)`；
 * mention → `@label`；image(xz:attachment/<id>) → 由 resolveImage 给出链接（全量导出指向 assets/）；
 * comment 标记丢弃；underline 无 Markdown 语法，保留文字；表格 → GFM 表格。
 */
import type { PmNode } from '../../schemas/pm.ts'

export interface MarkdownOptions {
  /** xz:attachment/<id> → 导出里的相对路径或 URL；缺省为 `/api/v1/attachments/<id>` */
  resolveImage?: (attachmentId: string) => string
}

const ATTACH = /^xz:attachment\/([0-9a-f-]{36})$/i

/** 行内 Markdown 转义（只转会被误解析的字符）。 */
const escInline = (s: string) => s.replace(/([\\`*_[\]<>#|])/g, '\\$1')

function marks(text: string, node: PmNode): string {
  let out = escInline(text)
  const ms = node.marks ?? []
  const has = (t: string) => ms.find((m) => m.type === t)
  if (has('code')) return `\`${text.replace(/`/g, '\\`')}\``
  if (has('bold')) out = `**${out}**`
  if (has('italic')) out = `*${out}*`
  if (has('strike')) out = `~~${out}~~`
  const link = has('link')
  if (link) out = `[${out}](${String(link.attrs?.href ?? '')})`
  return out // comment / underline：丢弃标记，保留文字
}

function inline(nodes: PmNode[] | undefined, o: MarkdownOptions): string {
  return (nodes ?? [])
    .map((n) => {
      switch (n.type) {
        case 'text':
          return marks(n.text ?? '', n)
        case 'hardBreak':
          return '  \n'
        case 'mention':
          return `@${String(n.attrs?.label ?? n.attrs?.id ?? '')}`
        case 'entryLink':
          return `[${escInline(String(n.attrs?.title || n.attrs?.id || ''))}](xz://entry/${String(n.attrs?.id ?? '')})`
        case 'image':
          return image(n, o)
        default:
          return inline(n.content, o)
      }
    })
    .join('')
}

function image(n: PmNode, o: MarkdownOptions): string {
  const src = String(n.attrs?.src ?? '')
  const m = ATTACH.exec(src)
  const url = m ? (o.resolveImage?.(m[1] as string) ?? `/api/v1/attachments/${m[1]}`) : src
  return `![${escInline(String(n.attrs?.alt ?? ''))}](${url})`
}

const indent = (s: string, pad: string) =>
  s
    .split('\n')
    .map((l, i) => (i === 0 || !l ? l : pad + l))
    .join('\n')

function block(n: PmNode, o: MarkdownOptions): string {
  const c = n.content ?? []
  switch (n.type) {
    case 'doc':
      return blocks(c, o)
    case 'paragraph':
      return inline(c, o)
    case 'heading':
      return `${'#'.repeat(Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1))))} ${inline(c, o)}`
    case 'blockquote':
      return blocks(c, o)
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n')
    case 'horizontalRule':
      return '---'
    case 'codeBlock': {
      const text = c.map((t) => t.text ?? '').join('')
      const fence = text.includes('```') ? '~~~~' : '```'
      return `${fence}${String(n.attrs?.language ?? '')}\n${text}\n${fence}`
    }
    case 'mermaid':
      return `\`\`\`mermaid\n${String(n.attrs?.code ?? '')}\n\`\`\``
    case 'mathBlock':
      return `$$\n${String(n.attrs?.latex ?? '')}\n$$`
    case 'callout':
      return `:::${String(n.attrs?.kind ?? 'info')}\n${blocks(c, o)}\n:::`
    case 'image':
      return image(n, o)
    case 'bulletList':
      return c.map((li) => `- ${indent(blocks(li.content ?? [], o), '  ')}`).join('\n')
    case 'orderedList': {
      const start = Number(n.attrs?.start ?? 1)
      return c
        .map((li, i) => `${start + i}. ${indent(blocks(li.content ?? [], o), '   ')}`)
        .join('\n')
    }
    case 'taskList':
      return c
        .map(
          (li) =>
            `- [${li.attrs?.checked ? 'x' : ' '}] ${indent(blocks(li.content ?? [], o), '  ')}`,
        )
        .join('\n')
    case 'table': {
      const rows = c.map((r) =>
        (r.content ?? []).map(
          (cell) =>
            inline(
              (cell.content ?? []).flatMap((p) => p.content ?? []),
              o,
            ).replace(/\n/g, ' ') || ' ',
        ),
      )
      if (!rows.length) return ''
      const width = Math.max(...rows.map((r) => r.length))
      const pad = (r: string[]) => [...r, ...Array(width - r.length).fill(' ')]
      const [head, ...body] = rows
      return [
        `| ${pad(head as string[]).join(' | ')} |`,
        `|${' --- |'.repeat(width)}`,
        ...body.map((r) => `| ${pad(r).join(' | ')} |`),
      ].join('\n')
    }
    default:
      return c.length ? blocks(c, o) : inline([n], o)
  }
}

function blocks(nodes: PmNode[], o: MarkdownOptions): string {
  return nodes
    .map((n) => block(n, o))
    .filter((s) => s !== '')
    .join('\n\n')
}

export function pmToMarkdown(doc: PmNode | null | undefined, o: MarkdownOptions = {}): string {
  if (!doc) return ''
  return `${block(doc, o).trim()}\n`
}

/** 最小 YAML：字符串一律双引号转义，数组 / 对象用 flow 风格（Obsidian 可读）。 */
export function yamlValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(yamlValue).join(', ')}]`
  return `{${Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${JSON.stringify(k)}: ${yamlValue(x)}`)
    .join(', ')}}`
}

export function frontmatter(fields: Record<string, unknown>): string {
  return `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${yamlValue(v)}`)
    .join('\n')}\n---\n\n`
}
