import { describe, expect, it, vi } from 'vitest'
import { onPreloadError, RELOAD_DELAY_MS, STALE_RELOAD_WINDOW_MS } from '../lib/stale-reload.ts'

const fakeWin = (storage: Map<string, string> | null) => ({
  addEventListener: vi.fn(),
  sessionStorage: {
    getItem: (k: string) => {
      if (!storage) throw new Error('blocked')
      return storage.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (!storage) throw new Error('blocked')
      storage.set(k, v)
    },
  },
  location: { reload: vi.fn() },
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
})

describe('stale-reload', () => {
  it('REQ-OPS-016 旧 chunk 加载失败：推迟刷新一次（错误照常抛出，路由 chunk 先交 TanStack）；10 秒内再失败不再刷新（防循环）', () => {
    vi.useFakeTimers()
    const win = fakeWin(new Map())
    expect(onPreloadError(win, 1_000_000)).toBe(true)
    // 推迟刷新：先让 TanStack 处理路由 chunk（它刷新时这个定时器随页面卸载作废）
    expect(win.location.reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(RELOAD_DELAY_MS)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
    expect(onPreloadError(win, 1_000_000 + STALE_RELOAD_WINDOW_MS - 1)).toBe(false)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
    // 隔够时间（又一次部署）可以再刷
    expect(onPreloadError(win, 1_000_000 + STALE_RELOAD_WINDOW_MS + 1)).toBe(true)
    vi.advanceTimersByTime(RELOAD_DELAY_MS)
    expect(win.location.reload).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('REQ-OPS-016 会话存储不可用时不刷新（无法防循环），错误照常交给错误边界', () => {
    const win = fakeWin(null)
    expect(onPreloadError(win)).toBe(false)
    expect(win.location.reload).not.toHaveBeenCalled()
  })
})
