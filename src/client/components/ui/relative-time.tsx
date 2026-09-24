/** 相对时间（04 §7、REQ-UI-018）：24h 内相对、超出绝对；title 为完整绝对时间；每分钟刷新一次。 */
import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { meQuery } from '../../hooks/useMe.ts'
import { absoluteTime, displayTime } from '../../lib/time.ts'

// 全局 1 分钟节拍：所有 RelativeTime 共用一个 interval
let now = Date.now()
const subs = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
function subscribe(cb: () => void) {
  subs.add(cb)
  timer ??= setInterval(() => {
    now = Date.now()
    for (const s of subs) s()
  }, 60_000)
  return () => {
    subs.delete(cb)
    if (!subs.size && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
}
const useNow = () =>
  useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  )

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export function useUserTimeZone(): { tz: string; locale: string } {
  const { data } = useQuery({ ...meQuery, enabled: false })
  return { tz: data?.timezone ?? browserTz(), locale: data?.locale ?? 'zh-CN' }
}

export function RelativeTime({ date, className }: { date: string | Date; className?: string }) {
  const d = typeof date === 'string' ? new Date(date) : date
  const t = useNow()
  const { tz, locale } = useUserTimeZone()
  return (
    <time
      dateTime={d.toISOString()}
      title={absoluteTime(d, locale, tz)}
      className={className}
      data-testid="relative-time"
    >
      {displayTime(d, new Date(Math.max(t, Date.now())), locale, tz)}
    </time>
  )
}
