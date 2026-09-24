/**
 * API 客户端（02 §11）：`hc<AppType>` 类型直通；错误统一 ApiError(code, status, problem)。
 * CSRF：同源请求浏览器自动带 Sec-Fetch-Site / Origin；不需要 token。GET 网络错误重试 2 次。
 */
import { hc } from 'hono/client'
import type { AppType } from '../../server/app.ts'

export interface Problem {
  status: number
  code: string
  detail?: string
  requestId?: string
  errors?: { path: string; message: string }[]
  [k: string]: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly problem: Problem
  constructor(problem: Problem) {
    super(problem.detail ?? problem.code)
    this.name = 'ApiError'
    this.status = problem.status
    this.code = problem.code
    this.problem = problem
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const fetchWithRetry: typeof fetch = async (input, init) => {
  const method = (init?.method ?? 'GET').toUpperCase()
  const attempts = method === 'GET' ? 3 : 1
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(input, { ...init, credentials: 'same-origin' })
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await sleep(300 * 2 ** i)
    }
  }
  throw new ApiError({ status: 0, code: 'NETWORK', detail: String(lastErr) })
}

export const client = hc<AppType>('/', { fetch: fetchWithRetry })
export const api = client.api.v1

/** 解包：非 2xx → ApiError（problem+json）；204 → undefined。 */
export async function unwrap<T>(p: Promise<Response> | Response): Promise<T> {
  const res = await p
  if (res.status === 204) return undefined as T
  const isProblem = res.headers.get('content-type')?.includes('problem+json')
  if (!res.ok || isProblem) {
    let problem: Problem = { status: res.status, code: 'INTERNAL' }
    try {
      problem = (await res.json()) as Problem
    } catch {
      /* 非 JSON */
    }
    throw new ApiError({ ...problem, status: res.status })
  }
  return (await res.json()) as T
}
