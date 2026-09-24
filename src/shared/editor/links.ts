/** 链接协议白名单（03 §3.1 · §12、REQ-EDITOR-018）：http / https / mailto / xz，以及站内相对地址；其他（javascript: data: …）剥离。 */
export const LINK_PROTOCOLS = ['http', 'https', 'mailto', 'xz'] as const

export function isAllowedLink(href: string): boolean {
  const v = href.trim()
  if (!v) return false
  if (v.startsWith('/') && !v.startsWith('//')) return true
  if (v.startsWith('#')) return true
  const m = /^([a-z][a-z0-9+.-]*):/i.exec([...v].filter((ch) => ch.charCodeAt(0) > 32).join(''))
  return !!m && (LINK_PROTOCOLS as readonly string[]).includes((m[1] as string).toLowerCase())
}
