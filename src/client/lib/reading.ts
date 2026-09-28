/**
 * 阅读与写作偏好（ADR-0024、REQ-READ-001 · 002）：服务端按人存（`/me/preferences`），本机按用户缓存首屏值避免闪烁。
 * - 缓存 `xz:reading:<userId>` 只在「服务端返回」或「用户修改」后写，挂载时不写默认值（简斋 frozen-default 教训）。
 * - 修改乐观生效，合并待发补丁、防抖 PATCH（服务端按键合并，不带 ifUpdatedAt）；页面隐藏时 keepalive 冲刷。
 * 专注模式是会话态（不持久），离开记录页即退出。
 */
import { useQuery } from '@tanstack/react-query'
import i18n from 'i18next'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import {
  DEFAULT_READING,
  normalizeReading,
  type ReadingPrefs,
} from '../../shared/schemas/preferences.ts'
import { api, unwrap } from './api.ts'

const cacheKey = (userId: string) => `xz:reading:${userId}`
const DEBOUNCE_MS = 600
const ENDPOINT = '/api/v1/me/preferences'

function readCache(userId: string): ReadingPrefs {
  try {
    const raw = localStorage.getItem(cacheKey(userId))
    return raw ? normalizeReading(JSON.parse(raw)) : DEFAULT_READING
  } catch {
    return DEFAULT_READING
  }
}
function writeCache(userId: string | null, prefs: ReadingPrefs) {
  if (!userId) return
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(prefs))
  } catch {
    /* 隐私模式 */
  }
}

let pending: Partial<ReadingPrefs> = {}
let timer: ReturnType<typeof setTimeout> | undefined

async function flush(keepalive = false) {
  clearTimeout(timer)
  timer = undefined
  if (!Object.keys(pending).length) return
  const reading = pending
  pending = {}
  try {
    const res = await fetch(ENDPOINT, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reading }),
      keepalive,
    })
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    if (!keepalive) toast.error(i18n.t('reading.saveFailed'))
  }
}

interface ReadingState {
  userId: string | null
  prefs: ReadingPrefs
  init: (userId: string) => void
  hydrate: (server: ReadingPrefs) => void
  update: (patch: Partial<ReadingPrefs>) => void
  reset: () => void
}

export const useReading = create<ReadingState>((set, get) => ({
  userId: null,
  prefs: DEFAULT_READING,
  init: (userId) => {
    if (get().userId === userId) return
    pending = {}
    set({ userId, prefs: readCache(userId) })
  },
  hydrate: (server) => {
    // 本机还有未发出的修改时以本机为准（服务端值马上会被补丁覆盖）
    const prefs = { ...server, ...pending }
    writeCache(get().userId, prefs)
    set({ prefs })
  },
  update: (patch) => {
    const prefs = { ...get().prefs, ...patch }
    pending = { ...pending, ...patch }
    writeCache(get().userId, prefs)
    set({ prefs })
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), DEBOUNCE_MS)
  },
  reset: () => get().update({ ...DEFAULT_READING }),
}))

export const preferencesQuery = {
  queryKey: ['me', 'preferences'] as const,
  queryFn: () =>
    unwrap<{ reading: ReadingPrefs }>(api.me.preferences.$get()).then((r) =>
      normalizeReading(r.reading),
    ),
  staleTime: 5 * 60_000,
}

/** 已登录布局调用：同步取本机缓存 → 拉服务端 → 页面隐藏时冲刷未发补丁。 */
export function useReadingSync(userId: string) {
  const inited = useRef<string | null>(null)
  if (inited.current !== userId) {
    inited.current = userId
    useReading.getState().init(userId)
  }
  const q = useQuery(preferencesQuery)
  useEffect(() => {
    if (q.data) useReading.getState().hydrate(q.data)
  }, [q.data])
  useEffect(() => {
    const onHide = () => void flush(true)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      void flush()
    }
  }, [])
}

/** 偏好 → 记录页 `<article class="xz-reading">` 的 data 属性（CSS 映射在 app.css「阅读偏好」段）。 */
export function readingAttrs(p: ReadingPrefs, width: ReadingPrefs['width'] = p.width) {
  return {
    'data-font': p.font,
    'data-size': p.size,
    'data-line-height': p.lineHeight,
    'data-width': width,
    'data-paragraph': p.paragraph,
    'data-paper': p.paper,
    'data-indent': p.indent || undefined,
    'data-justify': p.justify || undefined,
    'data-numbered': p.headingNumbers || undefined,
  }
}

/** 专注写作（ADR-0024 §5）：隐藏侧栏 / 顶栏 / Aside / 底部导航与记录页元信息，只留正文。 */
export const useFocusMode = create<{ on: boolean; set: (v: boolean) => void }>((set) => ({
  on: false,
  set: (on) => set({ on }),
}))
