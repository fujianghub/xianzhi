/**
 * 网页链接预览（ADR-0054 §D、REQ-LINK-007）：`GET /link-preview?url=`；卡片 / 粘贴取标题 / 悬停预览共用。
 * React Query 缓存 1 小时；失败不重试（服务端已缓存失败 10 分钟）。
 */
import { api, unwrap } from './api.ts'

export interface LinkPreview {
  url: string
  title: string
  description: string | null
  siteName: string
  favicon: string | null
}

export const isWebUrl = (s: string) => /^https?:\/\/[^\s<>"]+$/i.test(s.trim())

export const fetchLinkPreview = (url: string) =>
  unwrap<LinkPreview>(api['link-preview'].$get({ query: { url } }))

export const linkPreviewQuery = (url: string) => ({
  queryKey: ['link-preview', url] as const,
  queryFn: () => fetchLinkPreview(url),
  staleTime: 3600_000,
  gcTime: 3600_000,
  retry: false,
  enabled: isWebUrl(url),
})

/** 显示用主机名（去 www.） */
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 本站记录链接（/entries/<uuid>，同源或相对）→ 记录 id；粘贴时转成记录引用 */
export function entryIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url, window.location.origin)
    if (u.origin !== window.location.origin) return null
    const m = /^\/entries\/([0-9a-f-]{36})\/?$/i.exec(u.pathname)
    return m?.[1] ?? null
  } catch {
    return null
  }
}
