import { describe, expect, it } from 'vitest'
import { fmtBytes, fmtWhen, renderNotification } from '../services/notify.ts'

describe('通知正文格式', () => {
  it('REQ-NOTIF-017 大小按 B / KB / MB 呈现，非法值原样返回', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(382_827)).toBe('374 KB')
    expect(fmtBytes(11_777)).toBe('12 KB')
    expect(fmtBytes(5 * 1024 * 1024 + 300_000)).toBe('5.3 MB')
    expect(fmtBytes('abc')).toBe('abc')
  })

  it('REQ-NOTIF-017 时间按 Asia/Shanghai 呈现为 M/D HH:mm，非法值原样返回', () => {
    expect(fmtWhen('2026-10-01T11:47:06.496Z')).toBe('10/1 19:47')
    expect(fmtWhen('not-a-date')).toBe('not-a-date')
  })

  it('REQ-NOTIF-017 导出完成通知不直出 ISO 与字节数', () => {
    const r = renderNotification('system.export_done', {
      jobId: 'j1',
      fileName: 'x.zip',
      sizeBytes: 382_827,
      expiresAt: '2026-10-01T11:47:06.496Z',
    })
    expect(r?.body).toBe('374 KB · 10/1 19:47 前可下载')
  })
})
