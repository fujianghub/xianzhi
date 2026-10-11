/**
 * /api/v1/skins*（ADR-0059 · 0060、REQ-UI-057 · 064）：已安装主题列表 / 样式表 / 背景图 / 缩略图。只读（安装走运维 CLI）。
 * - 列表与详情只给登录用户；主题是本机安装资源，不属于任何工作区数据，不经 can()（同 /link-preview）。
 * - `GET /default` 公开：返回工作区默认主题（登录 / 注册页用，ADR-0060）；默认主题的背景图 / 缩略图也允许未登录读取，其余仍要登录。
 * 图片地址带 `?v=<version>`，版本随内容哈希变化 → 长缓存 + immutable；ETag 兜底。
 */
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { SKIN_ID_RE, SKIN_NONE, skinCss, skinSummary } from '../../shared/skins.ts'
import type { Db } from '../db/index.ts'
import { AppError } from '../lib/errors.ts'
import { validate } from '../lib/validate.ts'
import { requireAuth } from '../middleware/session.ts'
import { workspaceAppearance } from '../services/preferences.ts'
import * as svc from '../services/skins.ts'
import { findWorkspace } from '../services/workspace.ts'
import type { AppEnv } from '../types.ts'

const skinParam = z.object({ id: z.string().regex(SKIN_ID_RE) })

export function skinRoutes(deps: { dataDir: string; db: Db }) {
  /** 工作区默认主题 id（未设 / 未安装 → null） */
  const defaultSkinId = async () => {
    const ws = await findWorkspace(deps.db)
    const id = ws ? (await workspaceAppearance(deps.db, ws.id)).skin : undefined
    if (!id || id === SKIN_NONE) return null
    return (await svc.listSkins(deps.dataDir)).some((s) => s.id === id) ? id : null
  }

  const asset = (kind: 'art' | 'thumb') => async (c: Context<AppEnv>) => {
    const id = c.req.param('id') ?? ''
    const authed = Boolean(c.var.user && !c.var.user.banned)
    if (!authed && id !== (await defaultSkinId())) throw AppError.unauthenticated()
    const { rec, path, size } = await svc.skinAsset(deps.dataDir, id, kind)
    const etag = `"${rec.id}-${rec.version}-${kind}"`
    const headers = {
      'Content-Type': 'image/webp',
      'Cache-Control': `${authed ? 'private' : 'public'}, max-age=31536000, immutable`,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    }
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers)
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream
    return c.body(stream, 200, { ...headers, 'Content-Length': String(size) })
  }

  return (
    new Hono<AppEnv>()
      // 公开：登录 / 注册页套用工作区默认主题（ADR-0060）
      .get('/default', async (c) => {
        const id = await defaultSkinId()
        c.header('Cache-Control', 'no-cache')
        if (!id) return c.json({ skin: null })
        const rec = await svc.getSkin(deps.dataDir, id)
        return c.json({ skin: { ...skinSummary(rec), css: skinCss(rec) } })
      })
      .get('/:id/art', validate('param', skinParam), (c) => asset('art')(c))
      .get('/:id/thumb', validate('param', skinParam), (c) => asset('thumb')(c))
      .get('/', requireAuth, async (c) => {
        const list = await svc.listSkins(deps.dataDir)
        return c.json({ items: list.map(skinSummary) })
      })
      .get('/:id', requireAuth, validate('param', skinParam), async (c) => {
        const rec = await svc.getSkin(deps.dataDir, c.req.valid('param').id)
        return c.json({ ...skinSummary(rec), css: skinCss(rec) })
      })
  )
}
