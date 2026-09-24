/**
 * Hono 应用组装（T0-008；02 §1–3）。routes 只做校验 → service → 序列化。
 * createApp() 无副作用（不监听端口），供 app.request() 测试与 index.ts / start.ts 复用。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import type { Logger } from 'pino'
import { ZodError } from 'zod'
import type { Auth } from './auth.ts'
import { ForbiddenError } from './authz.ts'
import type { Db } from './db/index.ts'
import { getEnv } from './env.ts'
import { AppError, PROBLEM_CONTENT_TYPE, toProblem } from './lib/errors.ts'
import { type EventBus, getEventBus } from './lib/event-bus.ts'
import { type JobQueue, pgBossQueue } from './lib/job-queue.ts'
import { SSE_LIMITS, SseHub } from './lib/sse-hub.ts'
import { csrf } from './middleware/csrf.ts'
import { LoginGuard, loginGuard } from './middleware/login-guard.ts'
import { logoutAudit } from './middleware/logout-audit.ts'
import { FixedWindowLimiter, rateLimit } from './middleware/rate-limit.ts'
import { requestContext } from './middleware/request-context.ts'
import { session } from './middleware/session.ts'
import { attachmentRoutes, avatarRoutes } from './routes/attachments.ts'
import { collabRoutes } from './routes/collab.ts'
import { commentRoutes } from './routes/comments.ts'
import { entryRoutes } from './routes/entries.ts'
import { entryExportRoutes, exportRoutes } from './routes/exports.ts'
import { healthRoutes } from './routes/health.ts'
import { meRoutes } from './routes/me.ts'
import { notificationRoutes } from './routes/notifications.ts'
import { searchRoutes } from './routes/search.ts'
import { spaceRoutes } from './routes/spaces.ts'
import { streamRoutes } from './routes/stream.ts'
import { tagRoutes } from './routes/tags.ts'
import { taskRoutes } from './routes/tasks.ts'
import { workspaceRoutes } from './routes/workspace.ts'
import { spaceReaders } from './services/realtime.ts'
import type { AppEnv } from './types.ts'

export interface AppDeps {
  auth: Auth
  db: Db
  logger: Logger
  appUrl: string
  collabSecret: string
  dataDir: string
  nodeEnv: 'development' | 'test' | 'production'
  /** 通用限流（默认 600/min） */
  generalLimiter?: FixedWindowLimiter
  /** 附件上传限流（REQ-ATTACH-009，缺省 30/min/user）；测试可注入 */
  uploadLimiter?: FixedWindowLimiter
  /** 作业队列（02 §8）；缺省为懒启动的只发 pg-boss，测试注入 inlineQueue */
  jobQueue?: JobQueue
  bus?: EventBus
  sseHub?: SseHub
  loginGuard?: LoginGuard
  /** 生产托管的前端构建目录（dist/client）；dev 下由 Vite 提供 */
  staticDir?: string
}

export const VERSION: string = (() => {
  try {
    return (
      JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
        version: string
      }
    ).version
  } catch {
    return '0.0.0'
  }
})()

/** 一期禁用 impersonation（REQ-AUTH-015 / 07 §2.1）：路由层直接 404。 */
const DISABLED_AUTH_PATHS = [
  '/api/auth/admin/impersonate-user',
  '/api/auth/admin/stop-impersonating',
]

export function createApp(deps: AppDeps) {
  const generalLimiter = deps.generalLimiter ?? new FixedWindowLimiter(600, 60_000)
  const guard = deps.loginGuard ?? new LoginGuard()
  const wsHost = new URL(deps.appUrl).host

  // SSE：EventBus notify → hub；user.revoked → 断开（07 §4）
  const bus = deps.bus ?? getEventBus()
  const hub = deps.sseHub ?? new SseHub()
  bus.subscribe('notify', ({ userId, frame }) => hub.push(userId, frame.type, frame.data))
  bus.subscribe('user.revoked', ({ userId }) => hub.disconnectUser(userId))
  // 数据变更 → 在线且可读的用户推 invalidate（REQ-NOTIF-004）
  bus.subscribe('data.changed', ({ spaceIds, keys }) => {
    const online = hub.onlineUserIds()
    if (!online.length) return
    spaceReaders(deps.db, spaceIds, online)
      .then((ids) => {
        for (const id of ids) hub.push(id, 'invalidate', { keys })
      })
      .catch((err) => deps.logger.warn({ err }, 'data.changed broadcast failed'))
  })
  if (!deps.sseHub) setInterval(() => hub.heartbeat(), SSE_LIMITS.heartbeatMs).unref()

  const app = new Hono<AppEnv>()

  // ---- 全局中间件 ----
  app.use(requestContext(deps.logger))
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        connectSrc: ["'self'", `wss://${wsHost}`, `ws://${wsHost}`],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'same-origin',
      crossOriginEmbedderPolicy: false,
    }),
  )

  // ---- Better Auth（/api/auth/*） ----
  app.use('/api/auth/*', async (c, next) => {
    if (DISABLED_AUTH_PATHS.includes(c.req.path)) throw AppError.notFound()
    await next()
  })
  app.use('/api/auth/sign-in/email', loginGuard(guard, deps.db))
  app.use('/api/auth/sign-out', logoutAudit(deps.auth, deps.db))
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw))

  // ---- 业务 API ----
  app.use('/api/*', session(deps.auth, deps.db))
  app.use('/api/v1/*', csrf(deps.appUrl))
  app.use('/api/v1/*', rateLimit(generalLimiter))
  app.use('/api/health/details', rateLimit(generalLimiter))

  const health = healthRoutes({ db: deps.db, version: VERSION, dataDir: deps.dataDir })
  const v1 = new Hono<AppEnv>()
  if (deps.nodeEnv === 'test') {
    v1.get('/_debug/boom', () => {
      throw new Error('boom: secret-stack-content')
    })
    v1.post('/_debug/echo', (c) => c.json({ ok: true, user: c.var.user?.id ?? null }))
  }

  let queue: JobQueue | undefined = deps.jobQueue
  const exp = exportRoutes({
    db: deps.db,
    dataDir: deps.dataDir,
    queue: () =>
      (queue ??= pgBossQueue(async () => {
        const { PgBoss } = await import('pg-boss')
        const b = new PgBoss({
          connectionString: getEnv().DATABASE_URL,
          schema: 'pgboss',
          schedule: false,
          supervise: false,
        })
        await b.start()
        return b
      })),
  })
  const workspace = workspaceRoutes({ db: deps.db, auth: deps.auth, appUrl: deps.appUrl })
  const routes = app
    .route('/api/health', health)
    .route('/api/v1', v1)
    .route('/api/v1/workspace', workspace)
    .route('/api/v1/me', meRoutes({ db: deps.db, auth: deps.auth }))
    .route('/api/v1/entries', entryRoutes({ db: deps.db }))
    .route('/api/v1/spaces', spaceRoutes({ db: deps.db, dataDir: deps.dataDir }))
    .route('/api/v1/tasks', taskRoutes({ db: deps.db, dataDir: deps.dataDir }))
    .route('/api/v1/tags', tagRoutes({ db: deps.db }))
    .route('/api/v1/comments', commentRoutes({ db: deps.db }))
    .route('/api/v1/search', searchRoutes({ db: deps.db }))
    .route('/api/v1/exports', exp.exportsApp)
    .route('/api/v1/jobs', exp.jobsApp)
    .route('/api/v1/entries', entryExportRoutes({ db: deps.db, dataDir: deps.dataDir }))
    .route(
      '/api/v1/attachments',
      attachmentRoutes({ db: deps.db, dataDir: deps.dataDir, uploadLimiter: deps.uploadLimiter }),
    )
    .route('/api/v1/me', avatarRoutes({ db: deps.db, dataDir: deps.dataDir }))
    .route('/api/v1/collab', collabRoutes({ db: deps.db, secret: deps.collabSecret }))
    .route('/api/v1/notifications', notificationRoutes({ db: deps.db }))
    .route('/api/v1/stream', streamRoutes({ hub }))

  // ---- 生产：托管 dist/client（05 §2），/assets 长缓存，其余非 API 路径回退 index.html ----
  if (deps.staticDir && existsSync(join(deps.staticDir, 'index.html'))) {
    const indexHtml = readFileSync(join(deps.staticDir, 'index.html'), 'utf8')
    app.use('/assets/*', async (c, next) => {
      await next()
      if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable')
    })
    app.use('/*', serveStatic({ root: deps.staticDir }))
    app.get('*', (c, next) =>
      c.req.path.startsWith('/api/') ||
      c.req.path.startsWith('/collab') ||
      // data/ 永不直出（REQ-ATTACH-010）：不让 SPA 兜底把 /data/... /uploads/... 回成 200
      /^\/(data|uploads)(\/|$)/.test(c.req.path)
        ? next()
        : c.html(indexHtml),
    )
  }

  // ---- 错误信封（02 §3、REQ-OPS-014） ----
  app.notFound((c) => problem(c, AppError.notFound(`${c.req.method} ${c.req.path}`)))
  app.onError((err, c) => {
    if (err instanceof AppError) return problem(c, err)
    if (err instanceof ForbiddenError) return problem(c, AppError.forbidden(err.message))
    if (err instanceof ZodError)
      return problem(
        c,
        AppError.validation(
          err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      )
    if (err instanceof HTTPException) {
      const status = err.status
      const code =
        status === 401
          ? 'UNAUTHENTICATED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 404
              ? 'NOT_FOUND'
              : status === 413
                ? 'PAYLOAD_TOO_LARGE'
                : 'BAD_REQUEST'
      return problem(c, new AppError(status, code, err.message))
    }
    c.var.log?.error({ err, stack: err.stack }, 'unhandled error')
    return problem(c, new AppError(500, 'INTERNAL', '服务器内部错误'))
  })

  return routes
}

export type App = ReturnType<typeof createApp>
export type AppType = App

function problem(c: Parameters<Parameters<Hono<AppEnv>['onError']>[0]>[1], err: AppError) {
  const requestId = c.var.requestId ?? ''
  if (err.status >= 500) {
    // 500 只带 requestId（02 §3）
    const p = toProblem(new AppError(500, 'INTERNAL', '服务器内部错误'), requestId)
    return c.body(JSON.stringify(p), 500, { 'Content-Type': PROBLEM_CONTENT_TYPE })
  }
  const p = toProblem(err, requestId)
  return c.body(JSON.stringify(p), err.status as 400, { 'Content-Type': PROBLEM_CONTENT_TYPE })
}
