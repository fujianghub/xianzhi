/** 渲染服务端高亮串（02 §4.1：只含 `<mark>`，其余已转义）：拆成 React 节点，不走 innerHTML。 */
const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

export function Highlight({ html, className }: { html: string; className?: string }) {
  const parts = html.split(/(<mark>[\s\S]*?<\/mark>)/g).filter(Boolean)
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.startsWith('<mark>') ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 片段顺序固定
          <mark key={i} className="rounded-sm bg-primary-soft px-0.5 text-fg">
            {decodeEntities(p.slice(6, -7))}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: 片段顺序固定
          <span key={i}>{decodeEntities(p)}</span>
        ),
      )}
    </span>
  )
}
