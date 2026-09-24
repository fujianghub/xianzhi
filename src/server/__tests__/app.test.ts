/** T0-008：健康、错误信封、日志脱敏、CSRF、限流、安全头。 */
import { beforeAll, describe, expect, it } from 'vitest'
import { PROBLEM_CONTENT_TYPE } from '../lib/errors.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, problemOf } from './helpers.ts'

describe('app skeleton', () => {
  beforeAll(async () => {
    await truncateAll()
  })

  it('REQ-OPS-001 /api/health 公开只回 {ok, version}；/details 匿名 401', async () => {
    const { app } = buildApp()
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['ok', 'version'])
    const d = await app.request('/api/health/details')
    expect(d.status).toBe(401)
    expect((await problemOf(d)).code).toBe('UNAUTHENTICATED')
  })

  it('REQ-OPS-014 错误响应为 problem+json 且带 requestId；404/401/403/429 齐全', async () => {
    const { app } = buildApp({ generalLimit: 2 })
    const nf = await app.request('/api/v1/nope')
    expect(nf.status).toBe(404)
    expect(nf.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE)
    const p = await problemOf(nf)
    expect(p.code).toBe('NOT_FOUND')
    expect(p.status).toBe(404)
    expect(p.requestId).toMatch(/.+/)
    expect(nf.headers.get('x-request-id')).toBe(p.requestId)

    const csrf = await app.request('/api/v1/_debug/echo', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(csrf.status).toBe(403)
    expect((await problemOf(csrf)).code).toBe('CSRF')

    // 第 3 次超限（limit=2）
    await app.request('/api/v1/nope')
    const rl = await app.request('/api/v1/nope')
    expect(rl.status).toBe(429)
    expect((await problemOf(rl)).code).toBe('RATE_LIMITED')
  })

  it('REQ-OPS-014 500 只含 requestId 无 stack；REQ-OPS-003 日志含 stack 且脱敏', async () => {
    const { app, logs } = buildApp()
    const res = await app.request('/api/v1/_debug/boom', {
      headers: {
        authorization: 'Bearer xz_should_not_leak',
        cookie: 'xz.session_token=should_not_leak',
      },
    })
    // Bearer 非法 key → 401（先于 boom）；换成无鉴权头触发 500
    expect([401, 500]).toContain(res.status)
    const res2 = await app.request('/api/v1/_debug/boom')
    expect(res2.status).toBe(500)
    const p = await problemOf(res2)
    expect(p.code).toBe('INTERNAL')
    expect(JSON.stringify(p)).not.toContain('secret-stack-content')
    expect(JSON.stringify(p)).not.toContain('stack')
    const joined = logs.join('')
    expect(joined).toContain('secret-stack-content') // 日志有 stack
    expect(joined).not.toContain('should_not_leak')
    expect(joined).toContain('"reqId"')
    expect(joined).toMatch(/"ms":\d+/)
  })

  it('REQ-OPS-004 通用限流 600/min：第 601 次 429 且带 RateLimit-* 头', async () => {
    const { app } = buildApp()
    let last: Response | undefined
    for (let i = 0; i < 601; i++) last = await app.request('/api/v1/nope')
    expect(last?.status).toBe(429)
    expect(last?.headers.get('ratelimit-limit')).toBe('600')
    expect(last?.headers.get('ratelimit-remaining')).toBe('0')
    expect(last?.headers.get('ratelimit-reset')).toMatch(/^\d+$/)
  })

  it('REQ-OPS-009 安全头：CSP 含 script-src self wasm-unsafe-eval，无 inline script', async () => {
    const { app } = buildApp()
    const res = await app.request('/api/health')
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('REQ-AUTH-011 同站 POST 放行；API Key 跨站豁免（走鉴权而非 CSRF）', async () => {
    const { app } = buildApp()
    const ok = await app.request('/api/v1/_debug/echo', { method: 'POST', headers: jsonHeaders() })
    expect(ok.status).toBe(200)
    const bearer = await app.request('/api/v1/_debug/echo', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site', authorization: 'Bearer xz_invalid' },
    })
    expect(bearer.status).toBe(401) // 不是 403 CSRF
    expect((await problemOf(bearer)).code).toBe('UNAUTHENTICATED')
  })
})
