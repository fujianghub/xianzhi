/**
 * 只读正文的链接悬停预览（ADR-0054 §D、REQ-LINK-008）：鼠标在外链上停 400ms → 链接下方浮出小卡片
 * （图标 · 站点名 · 标题 · 描述 · 网址），移开 150ms 后收起（可移到卡片上点开）。触屏不出。
 * 网页卡片自己已有展示，不重复预览。
 */
import { useQuery } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import { Globe } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { hostOf, isWebUrl, linkPreviewQuery } from '../lib/link-preview.ts'

const SHOW_MS = 400
const HIDE_MS = 150
const W = 320

export function LinkHoverCard({ editor }: { editor: Editor }) {
  const [hit, setHit] = useState<{ url: string; rect: DOMRect } | null>(null)
  const showT = useRef<number | undefined>(undefined)
  const hideT = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (window.matchMedia?.('(hover: none)').matches) return
    let dom: HTMLElement
    try {
      dom = editor.view.dom
    } catch {
      return
    }
    const over = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.closest('.xz-link-card-wrap')) return
      const url = a.getAttribute('href') ?? ''
      if (!isWebUrl(url)) return
      window.clearTimeout(hideT.current)
      window.clearTimeout(showT.current)
      showT.current = window.setTimeout(
        () => setHit({ url, rect: a.getBoundingClientRect() }),
        SHOW_MS,
      )
    }
    const out = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]')
      if (!a) return
      window.clearTimeout(showT.current)
      hideT.current = window.setTimeout(() => setHit(null), HIDE_MS)
    }
    dom.addEventListener('mouseover', over)
    dom.addEventListener('mouseout', out)
    return () => {
      dom.removeEventListener('mouseover', over)
      dom.removeEventListener('mouseout', out)
      window.clearTimeout(showT.current)
      window.clearTimeout(hideT.current)
    }
  }, [editor])
  if (!hit) return null
  const left = Math.max(8, Math.min(hit.rect.left, window.innerWidth - W - 8))
  const below = hit.rect.bottom + 6
  const top = below + 140 > window.innerHeight ? Math.max(8, hit.rect.top - 146) : below
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: 悬停保持（鼠标移入卡片不收起），无键盘交互
    <div
      className="xz-link-hover glass-thick"
      style={{ left, top, width: W }}
      onMouseEnter={() => window.clearTimeout(hideT.current)}
      onMouseLeave={() => {
        hideT.current = window.setTimeout(() => setHit(null), HIDE_MS)
      }}
      data-testid="link-hover"
    >
      <HoverBody url={hit.url} />
    </div>,
    document.body,
  )
}

function HoverBody({ url }: { url: string }) {
  const { t } = useTranslation()
  const q = useQuery(linkPreviewQuery(url))
  const d = q.data
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="block p-3">
      <span className="xz-link-card-site">
        {d?.favicon ? (
          <img src={d.favicon} alt="" className="xz-link-card-icon" />
        ) : (
          <Globe className="xz-link-card-icon text-fg-faint" aria-hidden />
        )}
        <span className="truncate">{d?.siteName ?? hostOf(url)}</span>
      </span>
      <span className="xz-link-card-title">
        {d?.title ??
          (q.isPending
            ? t('editor.linkCard.loading')
            : q.isError
              ? t('editor.linkCard.failed')
              : url)}
      </span>
      {d?.description ? <span className="xz-link-card-desc">{d.description}</span> : null}
      <span className="xz-link-card-url">{url}</span>
    </a>
  )
}
