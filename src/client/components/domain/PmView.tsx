/** 只读渲染 liteKit 子集的 PM JSON（评论正文等）：直接生成 React 节点，不经 innerHTML；链接走白名单。 */
import type { ReactNode } from 'react'
import { isAllowedLink } from '../../../shared/editor/links.ts'
import type { PmNode } from '../../../shared/schemas/pm.ts'

function marks(text: ReactNode, ms: PmNode['marks'], key: string): ReactNode {
  let out = text
  for (const m of ms ?? []) {
    if (m.type === 'bold') out = <strong key={key}>{out}</strong>
    else if (m.type === 'italic') out = <em key={key}>{out}</em>
    else if (m.type === 'strike') out = <s key={key}>{out}</s>
    else if (m.type === 'underline') out = <u key={key}>{out}</u>
    else if (m.type === 'code') out = <code key={key}>{out}</code>
    else if (m.type === 'link') {
      const href = String(m.attrs?.href ?? '')
      if (isAllowedLink(href))
        out = (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-text underline"
          >
            {out}
          </a>
        )
    }
  }
  return out
}

function node(n: PmNode, key: string): ReactNode {
  const kids = (n.content ?? []).map((c, i) => node(c, `${key}.${i}`))
  switch (n.type) {
    case 'doc':
      return <>{kids}</>
    case 'paragraph':
      return <p key={key}>{kids}</p>
    case 'text':
      return marks(n.text ?? '', n.marks, key)
    case 'hardBreak':
      return <br key={key} />
    case 'bulletList':
      return <ul key={key}>{kids}</ul>
    case 'orderedList':
      return <ol key={key}>{kids}</ol>
    case 'listItem':
    case 'taskItem':
      return <li key={key}>{kids}</li>
    case 'taskList':
      return (
        <ul key={key} data-type="taskList">
          {kids}
        </ul>
      )
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{(n.content ?? []).map((c) => c.text ?? '').join('')}</code>
        </pre>
      )
    case 'mention':
      return (
        <span key={key} className="xz-mention">
          @{String(n.attrs?.label ?? n.attrs?.id ?? '')}
        </span>
      )
    case 'entryLink':
      return (
        <a key={key} href={`/entries/${String(n.attrs?.id ?? '')}`} className="xz-entry-link">
          [[{String(n.attrs?.title ?? '')}]]
        </a>
      )
    default:
      return <span key={key}>{kids}</span>
  }
}

export function PmView({ doc, className }: { doc: unknown; className?: string }) {
  if (!doc || typeof doc !== 'object') return null
  return <div className={className}>{node(doc as PmNode, 'r')}</div>
}
