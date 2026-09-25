/**
 * 附件（01 §3.8、02 §7、07 §2.4、REQ-ATTACH-001 ~ 011 · REQ-OPS-008）。
 * 上传：魔数识别 MIME（白名单外 415）→ 按类型限大小（413）→ 配额 5GB（413 QUOTA_EXCEEDED）→ 同 owner sha256 去重
 * → SVG 栅格化为 PNG（原件丢弃）→ 图片同步生成 thumb(320) / md(1280) webp 变体与 blurhash（limitInputPixels 50e6，不入队列）。
 * 存储：DATA_DIR/uploads/<yyyy>/<mm>/<id>.<ext>，只经 GET /attachments/:id 鉴权后流式输出，data/ 不直出。
 */
import { createHash } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { encode as encodeBlurhash } from 'blurhash'
import { and, eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { ALLOWED_MIME, ATTACHMENT_LIMITS } from '../../shared/schemas/attachments.ts'
import type { AttachmentTargetType } from '../../shared/schemas/enums.ts'
import { type Actor, assertCan, can } from '../authz.ts'
import type { DbOrTx } from '../db/index.ts'
import { user as userTable } from '../db/schema/auth.ts'
import { attachments } from '../db/schema/business.ts'
import { AppError } from '../lib/errors.ts'
import { dataPath } from '../lib/files.ts'
import { sniffMime } from '../lib/sniff.ts'
import { loadAttachmentRef, loadCommentRef, loadEntryRef, loadTaskRef } from './refs.ts'

export interface AttachmentCtx {
  actor: Actor
  workspaceId: string
  dataDir: string
}

type Row = typeof attachments.$inferSelect
export type Variant = 'thumb' | 'md'
const VARIANT_WIDTH: Record<Variant, number> = { thumb: 320, md: 1280 }
const RASTER = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/zip': 'zip',
  'application/json': 'json',
}

export interface AttachmentView {
  id: string
  url: string
  filename: string
  mime: string
  size: number
  width: number | null
  height: number | null
  blurhash: string | null
  variants: Partial<Record<Variant, string>>
  targetType: string | null
  targetId: string | null
  createdAt: string
}

const urlOf = (id: string, v?: Variant) => `/api/v1/attachments/${id}${v ? `/${v}` : ''}`

export function toView(r: Row): AttachmentView {
  const keys = (r.variants ?? {}) as Partial<Record<Variant, string>>
  return {
    id: r.id,
    url: urlOf(r.id),
    filename: r.filename,
    mime: r.mime,
    size: r.size,
    width: r.width,
    height: r.height,
    blurhash: r.blurhash,
    variants: Object.fromEntries(
      (Object.keys(keys) as Variant[]).map((v) => [v, urlOf(r.id, v)]),
    ) as AttachmentView['variants'],
    targetType: r.targetType,
    targetId: r.targetId,
    createdAt: r.createdAt.toISOString(),
  }
}

const limitFor = (mime: string) =>
  mime.startsWith('image/')
    ? ATTACHMENT_LIMITS.image
    : mime === 'application/pdf'
      ? ATTACHMENT_LIMITS.pdf
      : ATTACHMENT_LIMITS.other

/** 上传即带 target（02 §7）：entry / task 需写权限；comment 须是自己的评论；user 只能是自己（头像）。 */
async function assertTarget(
  db: DbOrTx,
  ctx: AttachmentCtx,
  type: AttachmentTargetType,
  id: string,
): Promise<void> {
  if (type === 'user') {
    if (id !== ctx.actor.id) throw AppError.forbidden('只能给自己上传头像')
    return
  }
  if (type === 'entry') {
    const e = await loadEntryRef(db, ctx.actor, ctx.workspaceId, id)
    if (!e || !can(ctx.actor, 'entry.read', e.ref)) throw AppError.notFound('记录不存在')
    assertCan(ctx.actor, 'entry.write', e.ref)
    return
  }
  if (type === 'task') {
    const t = await loadTaskRef(db, ctx.actor, ctx.workspaceId, id)
    if (!t || !can(ctx.actor, 'task.read', t.ref)) throw AppError.notFound('任务不存在')
    assertCan(ctx.actor, 'task.write', t.ref)
    return
  }
  const c = await loadCommentRef(db, ctx.actor, ctx.workspaceId, id)
  if (!c || c.row.deletedAt) throw AppError.notFound('评论不存在')
  if (c.row.authorId !== ctx.actor.id) throw AppError.forbidden('只能给自己的评论上传附件')
}

async function usedBytes(db: DbOrTx, ctx: AttachmentCtx): Promise<number> {
  const [r] = await db
    .select({ n: sql<string>`coalesce(sum(${attachments.size}), 0)::bigint` })
    .from(attachments)
    .where(and(eq(attachments.workspaceId, ctx.workspaceId), eq(attachments.ownerId, ctx.actor.id)))
  return Number(r?.n ?? 0)
}

/** 栅格图 → 元数据 + 变体 + blurhash；输入像素上限 50e6（解压炸弹防护）。 */
async function imageDerivatives(buf: Buffer, basePath: string) {
  const img = sharp(buf, { limitInputPixels: ATTACHMENT_LIMITS.maxPixels, animated: false })
  const meta = await img.metadata()
  const variants: Partial<Record<Variant, string>> = {}
  for (const v of Object.keys(VARIANT_WIDTH) as Variant[]) {
    const out = `${basePath}.${v}.webp`
    await sharp(buf, { limitInputPixels: ATTACHMENT_LIMITS.maxPixels })
      .rotate()
      .resize({ width: VARIANT_WIDTH[v], withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(out)
    variants[v] = out
  }
  const { data, info } = await sharp(buf, { limitInputPixels: ATTACHMENT_LIMITS.maxPixels })
    .rotate()
    .resize(32, 32, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const blurhash = encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height, 4, 3)
  return {
    width: meta.autoOrient?.width ?? meta.width ?? null,
    height: meta.autoOrient?.height ?? meta.height ?? null,
    variants,
    blurhash,
  }
}

export interface UploadInput {
  filename: string
  bytes: Uint8Array
  targetType?: AttachmentTargetType
  targetId?: string
  /** 头像：方形裁切到 512（REQ-ATTACH-007） */
  squareCrop?: number
}

/** POST /attachments（REQ-ATTACH-001 · 002 · 004 · 005 · REQ-OPS-008）。返回 created=false 表示命中去重。 */
export async function uploadAttachment(
  db: DbOrTx,
  ctx: AttachmentCtx,
  input: UploadInput,
): Promise<{ view: AttachmentView; created: boolean }> {
  if ((input.targetType === undefined) !== (input.targetId === undefined))
    throw AppError.validation([{ path: 'targetId', message: 'targetType 与 targetId 须同时提供' }])
  if (input.targetType && input.targetId)
    await assertTarget(db, ctx, input.targetType, input.targetId)
  let mime = sniffMime(input.bytes, input.filename)
  if (!mime || !(ALLOWED_MIME as readonly string[]).includes(mime))
    throw new AppError(415, 'UNSUPPORTED_MEDIA', '不支持的文件类型')
  if (input.bytes.length > limitFor(mime))
    throw new AppError(
      413,
      'PAYLOAD_TOO_LARGE',
      `文件超过 ${Math.round(limitFor(mime) / 1048576)} MB 上限`,
    )
  let bytes = Buffer.from(input.bytes)
  let filename = input.filename.replace(/[/\\\0]/g, '_').slice(0, 200) || 'file'
  if (mime === 'image/svg+xml') {
    // SVG 栅格化为 PNG，原件（含脚本 / 外链）丢弃（REQ-ATTACH-005）
    bytes = await sharp(bytes, { density: 144, limitInputPixels: ATTACHMENT_LIMITS.maxPixels })
      .png()
      .toBuffer()
    mime = 'image/png'
    filename = `${filename.replace(/\.svg$/i, '')}.png`
  }
  if (input.squareCrop && RASTER.has(mime)) {
    bytes = await sharp(bytes, { limitInputPixels: ATTACHMENT_LIMITS.maxPixels })
      .rotate()
      .resize(input.squareCrop, input.squareCrop, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer()
    mime = 'image/png'
    filename = `${filename.replace(/\.[^.]+$/, '')}.png`
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const [dup] = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.workspaceId, ctx.workspaceId),
        eq(attachments.ownerId, ctx.actor.id),
        eq(attachments.sha256, sha256),
      ),
    )
    .limit(1)
  if (dup) {
    // 同人同文件：幂等返回；原先是孤儿而这次带了 target → 认领
    if (!dup.targetType && input.targetType && input.targetId) {
      const [upd] = await db
        .update(attachments)
        .set({ targetType: input.targetType, targetId: input.targetId })
        .where(eq(attachments.id, dup.id))
        .returning()
      return { view: toView(upd ?? dup), created: false }
    }
    return { view: toView(dup), created: false }
  }
  if ((await usedBytes(db, ctx)) + bytes.length > ATTACHMENT_LIMITS.quotaPerUser)
    throw new AppError(413, 'QUOTA_EXCEEDED', '附件总量已达 5 GB 上限')

  const id = crypto.randomUUID()
  const now = new Date()
  const rel = `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`
  const base = dataPath(ctx.dataDir, rel)
  const file = `${base}.${EXT[mime] ?? 'bin'}`
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.part`
  let derived: Awaited<ReturnType<typeof imageDerivatives>> | null = null
  try {
    await writeFile(tmp, bytes)
    if (RASTER.has(mime)) derived = await imageDerivatives(bytes, base)
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true })
    for (const p of Object.values(derived?.variants ?? {})) await rm(p as string, { force: true })
    if (err instanceof Error && /pixel limit|Input image exceeds/i.test(err.message))
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', '图片像素超过 5000 万上限')
    if (err instanceof Error && /unsupported image format|Input buffer/i.test(err.message))
      throw new AppError(415, 'UNSUPPORTED_MEDIA', '图片无法解码')
    throw err
  }
  const rootLen = dataPath(ctx.dataDir).length + 1
  const [row] = await db
    .insert(attachments)
    .values({
      id,
      workspaceId: ctx.workspaceId,
      ownerId: ctx.actor.id,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      filename,
      mime,
      size: bytes.length,
      sha256,
      storageKey: file.slice(rootLen),
      width: derived?.width ?? null,
      height: derived?.height ?? null,
      blurhash: derived?.blurhash ?? null,
      variants: derived
        ? Object.fromEntries(
            Object.entries(derived.variants).map(([k, p]) => [k, (p as string).slice(rootLen)]),
          )
        : null,
    })
    .returning()
  if (!row) throw new Error('insert attachments failed')
  return { view: toView(row), created: true }
}

/** 下载前的鉴权与定位（REQ-ATTACH-003 · 011）：无权 / 不存在 → 404。 */
export async function resolveDownload(
  db: DbOrTx,
  ctx: AttachmentCtx,
  id: string,
  variant?: Variant,
): Promise<{ path: string; size: number; mime: string; etag: string; filename: string }> {
  const a = await loadAttachmentRef(db, ctx.actor, ctx.workspaceId, id)
  if (!a || !can(ctx.actor, 'attachment.read', a.ref)) throw AppError.notFound('附件不存在')
  const keys = (a.row.variants ?? {}) as Partial<Record<Variant, string>>
  const key = variant ? keys[variant] : a.row.storageKey
  if (!key) throw AppError.notFound('没有这个尺寸')
  const path = dataPath(ctx.dataDir, key)
  const st = await stat(path).catch(() => null)
  if (!st) throw AppError.notFound('附件文件缺失')
  return {
    path,
    size: st.size,
    mime: variant ? 'image/webp' : a.row.mime,
    etag: `"${a.row.sha256.slice(0, 32)}${variant ? `-${variant}` : ''}"`,
    filename: a.row.filename,
  }
}

/** POST /me/avatar（REQ-ATTACH-007）：附件管线 + 方形裁切 512，写 user.image。 */
export async function uploadAvatar(
  db: DbOrTx,
  ctx: AttachmentCtx,
  filename: string,
  bytes: Uint8Array,
) {
  const mime = sniffMime(bytes, filename)
  if (!mime || !(RASTER.has(mime) || mime === 'image/svg+xml'))
    throw new AppError(415, 'UNSUPPORTED_MEDIA', '头像须为图片')
  const r = await uploadAttachment(db, ctx, {
    filename,
    bytes,
    targetType: 'user',
    targetId: ctx.actor.id,
    squareCrop: 512,
  })
  const image = r.view.variants.md ?? r.view.url
  await db
    .update(userTable)
    .set({ image, avatarAttachmentId: r.view.id, updatedAt: new Date() })
    .where(eq(userTable.id, ctx.actor.id))
  return { ...r.view, image }
}

/** DELETE /me/avatar（REQ-WS-023）：清空头像，回到首字母；附件行留给孤儿清理。 */
export async function removeAvatar(db: DbOrTx, ctx: { actor: Actor }): Promise<void> {
  await db
    .update(userTable)
    .set({ image: null, avatarAttachmentId: null, updatedAt: new Date() })
    .where(eq(userTable.id, ctx.actor.id))
}
