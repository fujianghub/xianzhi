/**
 * /api/v1/attachments（02 §7 · §9、REQ-ATTACH-001 ~ 011）与 /api/v1/me/avatar（REQ-ATTACH-007）。
 * 上传：multipart 字段 `file` + 可选 targetType / targetId；每用户 30 次 / 分钟（REQ-ATTACH-009）。
 * 下载：鉴权后流式输出；Range → 206；ETag / If-None-Match → 304；Cache-Control: private, max-age=86400；?download=1 → attachment。
 */
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { attachmentVariantQuery, uploadAttachmentFields } from '../../shared/schemas/attachments.ts'
import { uuidSchema } from '../../shared/schemas/common.ts'
import type { Actor } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { idempotency } from '../middleware/idempotency.ts'
import { FixedWindowLimiter, rateLimit } from '../middleware/rate-limit.ts'
import { requireAuth, requireScope } from '../middleware/session.ts'
import * as svc from '../services/attachments.ts'
import type { AppEnv } from '../types.ts'

const idParam = z.object({ id: uuidSchema })
/** 最大单文件 100MB（PDF）+ multipart 开销。 */
const MAX_BODY = 101 * 1024 * 1024

const tooLarge = () => {
  throw new AppError(413, 'PAYLOAD_TOO_LARGE', '文件过大')
}

async function readFile(c: { req: { parseBody: () => Promise<Record<string, unknown>> } }) {
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File))
    throw AppError.validation([{ path: 'file', message: '缺少文件字段 file' }])
  const fields = uploadAttachmentFields.safeParse({
    targetType: typeof body.targetType === 'string' ? body.targetType : undefined,
    targetId: typeof body.targetId === 'string' ? body.targetId : undefined,
  })
  if (!fields.success)
    throw AppError.validation(
      fields.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  return { file, bytes: new Uint8Array(await file.arrayBuffer()), ...fields.data }
}

export function attachmentRoutes(deps: {
  db: Db
  dataDir: string
  uploadLimiter?: FixedWindowLimiter
}) {
  const limiter = deps.uploadLimiter ?? new FixedWindowLimiter(30, 60_000)
  const ctxOf = (c: { var: AppEnv['Variables'] }): svc.AttachmentCtx => {
    if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
    return { actor: c.var.actor as Actor, workspaceId: c.var.workspaceId, dataDir: deps.dataDir }
  }

  // biome-ignore lint/suspicious/noExplicitAny: 两个 GET 的路径参数类型不同，这里只用 req / body / var
  const serve = async (c: Context<AppEnv, any, any>, id: string, variant?: svc.Variant) => {
    const f = await svc.resolveDownload(deps.db, ctxOf(c), id, variant)
    const headers: Record<string, string> = {
      'Content-Type': f.mime,
      'Cache-Control': 'private, max-age=86400',
      ETag: f.etag,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    }
    if (c.req.query('download') === '1')
      headers['Content-Disposition'] =
        `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`
    if (c.req.header('if-none-match') === f.etag) return c.body(null, 304, headers)
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '')
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, f.size - Number(range[2]))
      let end = range[1] && range[2] ? Number(range[2]) : f.size - 1
      end = Math.min(end, f.size - 1)
      if (start > end || start >= f.size)
        return c.body(null, 416, { ...headers, 'Content-Range': `bytes */${f.size}` })
      start = Math.max(0, start)
      const stream = Readable.toWeb(createReadStream(f.path, { start, end })) as ReadableStream
      return c.body(stream, 206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${f.size}`,
        'Content-Length': String(end - start + 1),
      })
    }
    const stream = Readable.toWeb(createReadStream(f.path)) as ReadableStream
    return c.body(stream, 200, { ...headers, 'Content-Length': String(f.size) })
  }

  return new Hono<AppEnv>()
    .use(requireAuth)
    .post(
      '/',
      requireScope('write'),
      rateLimit(limiter),
      bodyLimit({ maxSize: MAX_BODY, onError: tooLarge }),
      idempotency(deps.db),
      async (c) => {
        const f = await readFile(c)
        const r = await svc.uploadAttachment(deps.db, ctxOf(c), {
          filename: f.file.name,
          bytes: f.bytes,
          targetType: f.targetType,
          targetId: f.targetId,
        })
        return c.json(r.view, 201)
      },
    )
    .get('/:id', validate('param', idParam), validate('query', attachmentVariantQuery), (c) =>
      serve(c, c.req.valid('param').id),
    )
    .get('/:id/thumb', validate('param', idParam), validate('query', attachmentVariantQuery), (c) =>
      serve(c, c.req.valid('param').id, 'thumb'),
    )
    .get('/:id/md', validate('param', idParam), validate('query', attachmentVariantQuery), (c) =>
      serve(c, c.req.valid('param').id, 'md'),
    )
}

/** POST /me/avatar（REQ-ATTACH-007）：与 /me 其他路由同前缀，独立挂载。 */
export function avatarRoutes(deps: { db: Db; dataDir: string }) {
  return new Hono<AppEnv>()
    .use(requireAuth)
    .post(
      '/avatar',
      requireScope('write'),
      bodyLimit({ maxSize: 21 * 1024 * 1024, onError: tooLarge }),
      async (c) => {
        if (!c.var.actor || !c.var.workspaceId) throw AppError.unauthenticated()
        const f = await readFile(c)
        return c.json(
          await svc.uploadAvatar(
            deps.db,
            { actor: c.var.actor as Actor, workspaceId: c.var.workspaceId, dataDir: deps.dataDir },
            f.file.name,
            f.bytes,
          ),
          201,
        )
      },
    )
    .delete('/avatar', requireScope('write'), async (c) => {
      if (!c.var.actor) throw AppError.unauthenticated()
      await svc.removeAvatar(deps.db, { actor: c.var.actor as Actor })
      return c.body(null, 204)
    })
}
