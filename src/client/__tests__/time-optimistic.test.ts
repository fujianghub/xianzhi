/** REQ-UI-018 相对时间；REQ-UI-010 乐观更新回滚与 409 覆盖（node 环境，QueryClient 无需 DOM）。 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.ts'
import { optimisticPatch } from '../lib/optimistic.ts'
import { absoluteTime, displayTime, dueLabel } from '../lib/time.ts'

describe('time', () => {
  const now = new Date('2026-09-24T06:00:00Z') // 上海 14:00
  it('REQ-UI-018 24h 内相对时间，悬停为绝对时间；跨年带年份；按时区取日期', () => {
    expect(displayTime(new Date(now.getTime() - 5 * 60_000), now)).toBe('5分钟前')
    expect(displayTime(new Date(now.getTime() - 20_000), now)).toBe('现在')
    expect(displayTime(new Date(now.getTime() + 3 * 3_600_000), now)).toBe('3小时后')
    expect(displayTime(new Date('2026-09-20T06:00:00Z'), now)).toBe('9月20日')
    expect(displayTime(new Date('2025-09-20T06:00:00Z'), now)).toBe('2025年9月20日')
    expect(absoluteTime(new Date(now.getTime() - 5 * 60_000))).toBe('2026年9月24日 13:55')
    expect(absoluteTime(now, 'zh-CN', 'America/Los_Angeles')).toBe('2026年9月23日 23:00')
    expect(dueLabel(new Date('2026-09-24T15:00:00Z'), now)).toBe('今天')
    expect(dueLabel(new Date('2026-09-24T17:00:00Z'), now)).toBe('明天')
  })
})

describe('optimisticPatch', () => {
  const setup = () => {
    const qc = new QueryClient()
    qc.setQueryData(['task', 't1'], { id: 't1', title: '旧', updatedAt: 'v1' })
    qc.setQueryData(
      ['tasks'],
      [
        { id: 't1', title: '旧' },
        { id: 't2', title: '别的' },
      ],
    )
    const apply = (d: unknown) =>
      Array.isArray(d)
        ? d.map((x) => (x.id === 't1' ? { ...x, title: '新' } : x))
        : { ...(d as object), title: '新' }
    const settle = (d: unknown, s: { id: string; title: string }) =>
      Array.isArray(d)
        ? d.map((x) => (x.id === s.id ? { ...x, ...s } : x))
        : { ...(d as object), ...s }
    return { qc, apply, settle }
  }

  it('REQ-UI-010 立即显示新值；网络 500 回滚并提示', async () => {
    const { qc, apply, settle } = setup()
    const onError = vi.fn()
    let fail: () => void = () => undefined
    const p = optimisticPatch<{ id: string; title: string }>({
      qc,
      keys: [['task', 't1'], ['tasks']],
      apply,
      settle,
      request: () =>
        new Promise((_, rej) => {
          fail = () => rej(new ApiError({ status: 500, code: 'INTERNAL', detail: '服务器出错了' }))
        }),
      onError,
    })
    await new Promise((r) => setTimeout(r, 0))
    expect((qc.getQueryData(['task', 't1']) as { title: string }).title).toBe('新')
    expect((qc.getQueryData(['tasks']) as { title: string }[])[0]?.title).toBe('新')
    fail()
    await expect(p).rejects.toBeInstanceOf(ApiError)
    expect((qc.getQueryData(['task', 't1']) as { title: string }).title).toBe('旧')
    expect((qc.getQueryData(['tasks']) as { title: string }[])[0]?.title).toBe('旧')
    expect(onError).toHaveBeenCalledWith('服务器出错了', expect.any(ApiError))
  })

  it('REQ-TASK-012 409 用 current 覆盖缓存并回调 onConflict', async () => {
    const { qc, apply, settle } = setup()
    const onConflict = vi.fn()
    await expect(
      optimisticPatch<{ id: string; title: string }>({
        qc,
        keys: [['task', 't1'], ['tasks']],
        apply,
        settle,
        request: async () => {
          throw new ApiError({
            status: 409,
            code: 'CONFLICT_STALE',
            current: { id: 't1', title: '他人改的', updatedAt: 'v2' },
          })
        },
        onConflict,
      }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(qc.getQueryData(['task', 't1'])).toMatchObject({ title: '他人改的', updatedAt: 'v2' })
    expect((qc.getQueryData(['tasks']) as { title: string }[])[0]?.title).toBe('他人改的')
    expect(onConflict).toHaveBeenCalledWith({ id: 't1', title: '他人改的', updatedAt: 'v2' })
  })

  it('成功：服务端返回值覆盖', async () => {
    const { qc, apply, settle } = setup()
    await optimisticPatch({
      qc,
      keys: [['task', 't1']],
      apply,
      settle,
      request: async () => ({ id: 't1', title: '新', updatedAt: 'v3' }),
    })
    expect(qc.getQueryData(['task', 't1'])).toMatchObject({ updatedAt: 'v3' })
  })
})
