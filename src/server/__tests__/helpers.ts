/**
 * API 测试工具：内存 logger（捕获日志断言脱敏）、可控 limiter、createApp 组装、登录取 Cookie。
 */
import { Writable } from 'node:stream'
import type pino from 'pino'
import { createApp } from '../app.ts'
import { getAuth } from '../auth.ts'
import { getDb } from '../db/index.ts'
import { getEnv } from '../env.ts'
import type { EventBus } from '../lib/event-bus.ts'
import type { JobQueue } from '../lib/job-queue.ts'
import { createLogger } from '../lib/logger.ts'
import type { SseHub } from '../lib/sse-hub.ts'
import type { MailMessage } from '../mail/index.ts'
import { setMailSender } from '../mail/index.ts'
import { LoginGuard } from '../middleware/login-guard.ts'
import { FixedWindowLimiter } from '../middleware/rate-limit.ts'
import type { CaptchaOptions } from '../services/captcha.ts'
import { createOwner } from '../services/workspace.ts'

export const ORIGIN = 'http://localhost:3010'

/** 每个 buildApp() 换一个客户端 IP：Better Auth 的按 IP 限流是进程内单例，避免用例间串扰。 */
let currentIp = '10.0.0.1'
let ipSeq = 1
export function clientIpForTests(): string {
  return currentIp
}

export function captureLogger() {
  const lines: string[] = []
  const dest = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString())
      cb()
    },
  })
  const logger = createLogger({
    level: 'info',
    destination: dest as unknown as pino.DestinationStream,
  })
  return { logger, lines }
}

export const mailbox: MailMessage[] = []
setMailSender(async (m) => {
  mailbox.push(m)
})

export function buildApp(
  opts: {
    generalLimit?: number
    now?: () => number
    bus?: EventBus
    sseHub?: SseHub
    jobQueue?: JobQueue
    captcha?: CaptchaOptions
    nodeEnv?: 'test' | 'production'
  } = {},
) {
  ipSeq++
  currentIp = `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`
  const env = getEnv()
  const { logger, lines } = captureLogger()
  const guard = new LoginGuard(opts.now)
  const app = createApp({
    auth: getAuth(),
    db: getDb(),
    logger,
    appUrl: env.APP_URL,
    collabSecret: env.COLLAB_TOKEN_SECRET,
    dataDir: env.DATA_DIR,
    nodeEnv: opts.nodeEnv ?? 'test',
    generalLimiter: new FixedWindowLimiter(opts.generalLimit ?? 600, 60_000, opts.now),
    loginGuard: guard,
    captcha: opts.captcha ?? { debug: true, minSolveMs: 0 },
    bus: opts.bus,
    sseHub: opts.sseHub,
    jobQueue: opts.jobQueue,
  })
  return { app, logs: lines, guard }
}

export const OWNER = { email: 'owner@xz.local', password: 'owner-password-123', name: 'Owner' }

export async function seedOwner() {
  return createOwner(getDb(), getAuth(), OWNER)
}

/** 同站 JSON 请求头（过 CSRF）。 */
export function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
    'x-forwarded-for': currentIp,
    ...extra,
  }
}

export async function signIn(
  app: ReturnType<typeof buildApp>['app'],
  email: string,
  password: string,
  headers: Record<string, string> = {},
) {
  // Better Auth 的按 IP 限流是进程内单例（10/min）：默认每次登录换一个 IP，只在专门测限流的用例里显式传 IP
  ipSeq++
  const perCallIp = `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`
  // 拼图（REQ-AUTH-016）：取题并用回显答案提交；显式传 x-captcha 的用例（测失败路径）不取题
  let captcha = headers['x-captcha']
  if (captcha === undefined) {
    const q = await app.request('/api/captcha', { headers: { 'x-forwarded-for': perCallIp } })
    const c = (await q.json()) as { id: string; debugX: number }
    captcha = `${c.id}:${c.debugX}`
  }
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: jsonHeaders({ 'x-forwarded-for': perCallIp, ...headers, 'x-captcha': captcha }),
    body: JSON.stringify({ email, password }),
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const cookie = setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')
  return { res, cookie, setCookie }
}

export async function problemOf(res: Response) {
  return (await res.json()) as {
    status: number
    code: string
    requestId: string
    errors?: { path: string; message: string }[]
    [k: string]: unknown
  }
}
