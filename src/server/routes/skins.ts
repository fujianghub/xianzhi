/**
 * /api/v1/skins*（ADR-0059、REQ-UI-057）：已安装皮肤列表 / 样式表 / 背景图 / 缩略图。只给登录用户；只读（安装走运维 CLI）。
 * 皮肤是本机安装资源，不属于任何工作区数据，不经 can()（同 /link-preview：requireAuth 即可）。
 * 图片地址带 `?v=<version>`，版本随内容哈希变化 → 私有长缓存 + immutable；ETag 兜底。
 */
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { SKIN_ID_RE, skinCss, skinSummary } from '../../shared/skins.ts'
import { validate } from '../lib/validate.ts'
import { requireAuth } from '../middleware/session.ts'
import * as svc from '../services/skins.ts'
import type { AppEnv } from '../types.ts'

const skinParam = z.object({ id: z.string().regex(SKIN_ID_RE) })

export function skinRoutes(deps: { dataDir: string }) {
  const asset = (kind: 'art' | 'thumb') => async (c: Context<AppEnv>) => {
    const { rec, path, size } = await svc.skinAsset(deps.dataDir, c.req.param('id') ?? '', kind)
    const etag = `"${rec.id}-${rec.version}-${kind}"`
    const headers = {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    }
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers)
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream
    return c.body(stream, 200, { ...headers, 'Content-Length': String(size) })
  }

  return new Hono<AppEnv>()
    .use(requireAuth)
    .get('/', async (c) => {
      const list = await svc.listSkins(deps.dataDir)
      return c.json({ items: list.map(skinSummary) })
    })
    .get('/:id', validate('param', skinParam), async (c) => {
      const rec = await svc.getSkin(deps.dataDir, c.req.valid('param').id)
      return c.json({ ...skinSummary(rec), css: skinCss(rec) })
    })
    .get('/:id/art', validate('param', skinParam), (c) => asset('art')(c))
    .get('/:id/thumb', validate('param', skinParam), (c) => asset('thumb')(c))
}
