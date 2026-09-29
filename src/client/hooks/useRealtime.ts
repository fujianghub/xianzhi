/**
 * SSE（02 §6、REQ-NOTIF-002 · 003）：EventSource 封装；notification / invalidate → 失效对应 Query；reset（超出补发缓冲）→ 全部重取。
 * 断线指数退避（1s → 30s），重连带 lastEventId 查询参数（EventSource 手动重建时无法设头）。
 * 被服务端挤掉（evicted：同一用户第 4 条连接）→ 停止重连，页面回到前台时再连，避免多标签页互相挤掉。
 * window.__gi.realtime 暴露状态与 close / reconnect，供 e2e 观察。
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

/** 收到即弹 Toast 的通知种类（其余只进铃铛）。 */
const TOAST_KINDS = new Set(['system.export_done'])
/** 失效帧合并：安静 300ms 后失效；连续推送时最多每 2s 失效一次 */
const INVALIDATE_QUIET_MS = 300
const INVALIDATE_MAX_WAIT_MS = 2000

export type RealtimeStatus = 'connecting' | 'open' | 'closed' | 'evicted'

interface RealtimeDebug {
  status: RealtimeStatus
  lastEventId: string | null
  frames: number
  close: () => void
  reconnect: () => void
}
declare global {
  interface Window {
    __gi?: { realtime?: RealtimeDebug }
  }
}

export function useRealtime(enabled: boolean, onStatus?: (s: RealtimeStatus) => void): void {
  const qc = useQueryClient()
  const lastId = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    let es: EventSource | null = null
    let delay = 1000
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let evicted = false
    // 失效合并（ADR-0033 跟进）：invalidate 帧按 key 去重，防抖后一次失效（带最长等待）。
    // 批量改 / 连续新建会逐条推送变更，逐帧失效会让开着统计 / 查询块的页面每帧重取一整组查询，放大成限流 429
    const pending = new Map<string, unknown[]>()
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    let batchStart = 0
    const flush = () => {
      flushTimer = undefined
      batchStart = 0
      const keys = [...pending.values()]
      pending.clear()
      for (const key of keys) void qc.invalidateQueries({ queryKey: key })
    }
    const schedule = () => {
      const now = Date.now()
      batchStart ||= now
      clearTimeout(flushTimer)
      const wait = Math.min(INVALIDATE_QUIET_MS, batchStart + INVALIDATE_MAX_WAIT_MS - now)
      flushTimer = setTimeout(flush, Math.max(0, wait))
    }
    const dbg: RealtimeDebug = {
      status: 'connecting',
      lastEventId: null,
      frames: 0,
      close: () => undefined,
      reconnect: () => undefined,
    }
    window.__gi = { ...(window.__gi ?? {}), realtime: dbg }
    const setStatus = (s: RealtimeStatus) => {
      dbg.status = s
      onStatus?.(s)
    }
    const track = (e: Event) => {
      const id = (e as MessageEvent).lastEventId
      if (id) {
        lastId.current = id
        dbg.lastEventId = id
      }
      dbg.frames++
    }
    const connect = () => {
      clearTimeout(timer)
      es?.close()
      evicted = false
      setStatus('connecting')
      const url = lastId.current
        ? `/api/v1/stream?lastEventId=${encodeURIComponent(lastId.current)}`
        : '/api/v1/stream'
      es = new EventSource(url, { withCredentials: true })
      es.onopen = () => {
        delay = 1000
        setStatus('open')
      }
      es.addEventListener('notification', (e) => {
        track(e)
        void qc.invalidateQueries({ queryKey: ['notifications'] })
        // 需要即时反馈的系统事件：状态胶囊形变为 Toast，4s 后缩回（REQ-UI-008）
        try {
          const n = JSON.parse((e as MessageEvent).data) as { kind?: string; title?: string }
          if (n.kind && TOAST_KINDS.has(n.kind) && n.title)
            toast.success(n.title, { duration: 4000 })
        } catch {
          /* 忽略坏帧 */
        }
      })
      es.addEventListener('invalidate', (e) => {
        track(e)
        try {
          const { keys } = JSON.parse((e as MessageEvent).data) as { keys: unknown[][] }
          for (const key of keys) pending.set(JSON.stringify(key), key)
          schedule()
        } catch {
          /* 忽略坏帧 */
        }
      })
      es.addEventListener('hello', track)
      es.addEventListener('reset', (e) => {
        track(e)
        void qc.invalidateQueries()
      })
      es.addEventListener('evicted', () => {
        evicted = true
        es?.close()
        setStatus('evicted')
      })
      es.onerror = () => {
        es?.close()
        if (stopped || evicted) return
        setStatus('closed')
        timer = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 30_000)
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && evicted) connect()
    }
    dbg.close = () => {
      clearTimeout(timer)
      es?.close()
      setStatus('closed')
    }
    dbg.reconnect = connect
    document.addEventListener('visibilitychange', onVisible)
    connect()
    return () => {
      stopped = true
      clearTimeout(timer)
      clearTimeout(flushTimer)
      es?.close()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, qc, onStatus])
}
