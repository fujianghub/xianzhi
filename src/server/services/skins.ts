/**
 * 皮肤安装与读取（ADR-0059、REQ-UI-056 · 057）。
 * - 安装只走运维 CLI（`pnpm xz skin install`）：来源 = codexthemes.ai 主题 id / https 链接 / 本地 `.codex-theme` 文件；
 *   出站请求复用 `safeFetch`（ADR-0054 §D）；包 ≤ 30 MB；只取 mode / palette / 背景图 / 焦点，包内 CSS 丢弃；
 *   图片按魔数只收 png / jpeg / webp，经 sharp 重编码为 webp（剥离元数据），缩略图按焦点裁切。
 * - 落盘 `DATA_DIR/skins/<id>/{skin.json, art.webp, thumb.webp}`（不进 git、不进备份，可重装）；先写临时目录再整体换入。
 * - 读取按目录 mtime 缓存；坏的 skin.json 跳过不报错。
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  type CodexPackage,
  codexPackageSchema,
  inferMode,
  normalizeFocal,
  normalizePalette,
  normalizeVersion,
  SKIN_ID_RE,
  type SkinMode,
  type SkinRecord,
  skinIdSchema,
  skinRecordSchema,
  slugSkinId,
} from '../../shared/skins.ts'
import { AppError } from '../lib/errors.ts'
import { dataPath } from '../lib/files.ts'
import { sniffMime } from '../lib/sniff.ts'
import { type FetchDeps, safeFetch } from './link-preview.ts'

export const SKIN_LIMITS = {
  /** 主题包上限（与 codexthemes 导出约定一致） */
  maxPackageBytes: 30 * 1024 * 1024,
  maxPixels: 60_000_000,
  art: { width: 2560, height: 1600, quality: 78 },
  thumb: { width: 640, height: 400, quality: 72 },
  fetchMs: 180_000,
} as const

export const CODEXTHEMES_ORIGIN = 'https://codexthemes.ai'
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export const skinsDir = (dataDir: string) => dataPath(dataDir, 'skins')

// ---------- 读取 ----------

let cache: { dir: string; mtimeMs: number; list: SkinRecord[] } | null = null

/** 已安装皮肤（按安装时间先后） */
export async function listSkins(dataDir: string): Promise<SkinRecord[]> {
  const dir = skinsDir(dataDir)
  const st = await stat(dir).catch(() => null)
  if (!st?.isDirectory()) return []
  if (cache && cache.dir === dir && cache.mtimeMs === st.mtimeMs) return cache.list
  const list: SkinRecord[] = []
  for (const name of await readdir(dir)) {
    if (!SKIN_ID_RE.test(name)) continue
    const raw = await readFile(join(dir, name, 'skin.json'), 'utf8').catch(() => null)
    if (!raw) continue
    try {
      const rec = skinRecordSchema.parse(JSON.parse(raw))
      if (rec.id === name) list.push(rec)
    } catch {
      /* 坏文件跳过 */
    }
  }
  list.sort((a, b) => a.installedAt.localeCompare(b.installedAt) || a.id.localeCompare(b.id))
  cache = { dir, mtimeMs: st.mtimeMs, list }
  return list
}

export async function getSkin(dataDir: string, id: string): Promise<SkinRecord> {
  const rec = SKIN_ID_RE.test(id) ? (await listSkins(dataDir)).find((s) => s.id === id) : undefined
  if (!rec) throw AppError.notFound('皮肤')
  return rec
}

/** 背景图 / 缩略图的磁盘路径；不存在 → 404 */
export async function skinAsset(dataDir: string, id: string, kind: 'art' | 'thumb') {
  const rec = await getSkin(dataDir, id)
  const path = dataPath(dataDir, 'skins', rec.id, `${kind}.webp`)
  const st = await stat(path).catch(() => null)
  if (!st?.isFile()) throw AppError.notFound('皮肤图片')
  return { rec, path, size: st.size }
}

// ---------- 安装 ----------

export interface InstallOptions {
  /** 本地 id（缺省取主题包 id） */
  id?: string
  /** 显示名（缺省取主题包 displayName） */
  name?: string
  /** 不用背景图（只取配色；有的包 art 本身是界面截图）；缩略图仍取自原图 */
  noArt?: boolean
  fetch?: FetchDeps
  /** 测试注入：codexthemes 源站 */
  origin?: string
}

type Source = { kind: SkinRecord['source']['kind']; ref: string; page?: string; bytes: Buffer }

async function fetchJson(url: string, deps?: FetchDeps): Promise<Buffer> {
  const max = SKIN_LIMITS.maxPackageBytes
  const r = await safeFetch(url, { max: max + 1, deadline: Date.now() + SKIN_LIMITS.fetchMs }, deps)
  if (r.body.length > max)
    throw AppError.validation([{ path: 'source', message: '主题包超过 30 MB' }])
  if (r.status === 404)
    throw AppError.validation([
      { path: 'source', message: '该主题没有可下载的主题包（可能只是设计参考）' },
    ])
  if (r.status !== 200) throw new AppError(502, 'UPSTREAM', `下载失败：HTTP ${r.status}`)
  return r.body
}

/** 来源：本地文件 → https 链接 → codexthemes 主题 id */
async function readSource(src: string, opts: InstallOptions): Promise<Source> {
  const origin = opts.origin ?? CODEXTHEMES_ORIGIN
  const st = await stat(src).catch(() => null)
  if (st?.isFile()) {
    if (st.size > SKIN_LIMITS.maxPackageBytes)
      throw AppError.validation([{ path: 'source', message: '主题包超过 30 MB' }])
    return { kind: 'file', ref: src, bytes: await readFile(src) }
  }
  if (/^https?:\/\//i.test(src))
    return { kind: 'url', ref: src, bytes: await fetchJson(src, opts.fetch) }
  if (!/^[A-Za-z0-9][\w-]{0,119}$/.test(src))
    throw AppError.validation([{ path: 'source', message: '既不是文件、链接，也不是主题 id' }])
  return {
    kind: 'codexthemes',
    ref: src,
    page: `${CODEXTHEMES_ORIGIN}/themes/${src}`,
    bytes: await fetchJson(`${origin}/api/themes/${encodeURIComponent(src)}/download`, opts.fetch),
  }
}

function parsePackage(bytes: Buffer): CodexPackage {
  let json: unknown
  try {
    json = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw AppError.validation([
      { path: 'source', message: '不是 .codex-theme 主题包（JSON 解析失败）' },
    ])
  }
  const r = codexPackageSchema.safeParse(json)
  if (!r.success)
    throw AppError.validation([{ path: 'source', message: '不是 .codex-theme 主题包（格式不符）' }])
  return r.data
}

/** base64 图片 → 按魔数校验 → Buffer；不在白名单 → 422 */
function decodeImage(img: CodexPackage['art'], label: string): Buffer | null {
  if (!img?.base64) return null
  const buf = Buffer.from(img.base64, 'base64')
  const mime = sniffMime(buf)
  if (!mime || !IMAGE_MIMES.has(mime))
    throw AppError.validation([{ path: label, message: '图片只支持 PNG / JPEG / WebP' }])
  return buf
}

const sharpIn = (buf: Buffer) =>
  sharp(buf, { limitInputPixels: SKIN_LIMITS.maxPixels, animated: false }).rotate()

async function toArt(buf: Buffer): Promise<Buffer> {
  const { width, height, quality } = SKIN_LIMITS.art
  return sharpIn(buf)
    .resize({ width, height, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer()
}

/** 按焦点裁出缩略图（cover） */
async function toThumb(buf: Buffer, focal: string): Promise<Buffer> {
  const { width: W, height: H, quality } = SKIN_LIMITS.thumb
  const meta = await sharpIn(buf).metadata()
  const w = meta.autoOrient?.width ?? meta.width ?? W
  const h = meta.autoOrient?.height ?? meta.height ?? H
  const scale = Math.max(W / w, H / h)
  const rw = Math.max(W, Math.round(w * scale))
  const rh = Math.max(H, Math.round(h * scale))
  const [fx, fy] = focal.split(' ').map((x) => Number.parseFloat(x) / 100) as [number, number]
  const left = Math.min(rw - W, Math.max(0, Math.round(fx * rw - W / 2)))
  const top = Math.min(rh - H, Math.max(0, Math.round(fy * rh - H / 2)))
  return sharpIn(buf)
    .resize({ width: rw, height: rh, fit: 'fill' })
    .extract({ left, top, width: W, height: H })
    .webp({ quality })
    .toBuffer()
}

const authorOf = (m: CodexPackage['manifest']) =>
  (typeof m.author === 'string' ? m.author : (m.author?.name ?? '')).trim().slice(0, 80)

export async function installSkin(
  dataDir: string,
  src: string,
  opts: InstallOptions = {},
): Promise<SkinRecord> {
  const source = await readSource(src, opts)
  const pkg = parsePackage(source.bytes)
  const m = pkg.manifest
  const id = opts.id ?? slugSkinId(m.id ?? (source.kind === 'codexthemes' ? source.ref : ''))
  if (!id || !skinIdSchema.safeParse(id).success)
    throw AppError.validation([
      { path: 'id', message: '皮肤 id 只能是小写字母、数字与连字符（--id 指定）' },
    ])

  const palette = normalizePalette(m.palette)
  const mode: SkinMode = m.mode === 'light' || m.mode === 'dark' ? m.mode : inferMode(palette)
  const focal = normalizeFocal(m.design?.artFocalPoint)
  const artIn = decodeImage(pkg.art, 'art')
  const previewIn = decodeImage(pkg.preview, 'preview')
  const art = artIn && !opts.noArt ? await toArt(artIn) : null
  const thumbSrc = artIn ?? previewIn
  const thumb = thumbSrc ? await toThumb(thumbSrc, artIn ? focal : '50% 0%') : null

  const hash = createHash('sha256')
    .update(JSON.stringify({ palette, mode, focal }))
    .update(art ?? '')
    .digest('hex')
    .slice(0, 8)
  const rec = skinRecordSchema.parse({
    schema: 1,
    id,
    name: (opts.name ?? m.displayName ?? id).trim().slice(0, 60) || id,
    description: (m.description ?? '').trim().slice(0, 400),
    author: authorOf(m),
    mode,
    version: `${normalizeVersion(m.version).slice(0, 22)}-${hash}`,
    palette,
    focal,
    art: Boolean(art),
    source: {
      kind: source.kind,
      ref: source.ref.slice(0, 500),
      ...(source.page ? { page: source.page } : {}),
    },
    installedAt: new Date().toISOString(),
  } satisfies SkinRecord)

  const root = skinsDir(dataDir)
  await mkdir(root, { recursive: true })
  // 重装保留原安装时间（画廊顺序不变）
  const prev = (await listSkins(dataDir)).find((s) => s.id === id)
  if (prev) rec.installedAt = prev.installedAt
  const tmp = dataPath(dataDir, 'skins', `.tmp-${id}-${randomBytes(4).toString('hex')}`)
  await mkdir(tmp)
  try {
    await writeFile(join(tmp, 'skin.json'), `${JSON.stringify(rec, null, 2)}\n`)
    if (art) await writeFile(join(tmp, 'art.webp'), art)
    if (thumb) await writeFile(join(tmp, 'thumb.webp'), thumb)
    const dest = dataPath(dataDir, 'skins', id)
    await rm(dest, { recursive: true, force: true })
    await rename(tmp, dest)
  } catch (e) {
    await rm(tmp, { recursive: true, force: true })
    throw e
  }
  cache = null
  return rec
}

export async function removeSkin(dataDir: string, id: string): Promise<void> {
  await getSkin(dataDir, id)
  await rm(dataPath(dataDir, 'skins', id), { recursive: true, force: true })
  cache = null
}

// ---------- 搜索（codexthemes.ai 公开目录） ----------

export interface RemoteTheme {
  id: string
  name: string
  mode: string
  installable: boolean
  author: string
}

export async function searchSkins(
  q: string,
  opts: { fetch?: FetchDeps; origin?: string } = {},
): Promise<{ total: number; themes: RemoteTheme[] }> {
  const url = `${opts.origin ?? CODEXTHEMES_ORIGIN}/api/themes?q=${encodeURIComponent(q)}&limit=50`
  const r = await safeFetch(url, { max: 2 * 1024 * 1024 }, opts.fetch)
  if (r.status !== 200) throw new AppError(502, 'UPSTREAM', `搜索失败：HTTP ${r.status}`)
  const d = JSON.parse(r.body.toString('utf8')) as {
    total?: number
    themes?: { id?: string; name?: string; mode?: string; installable?: boolean; author?: string }[]
  }
  const themes = (d.themes ?? [])
    .filter((t) => typeof t.id === 'string')
    .map((t) => ({
      id: String(t.id),
      name: String(t.name ?? t.id),
      mode: String(t.mode ?? ''),
      installable: t.installable === true,
      author: String(t.author ?? ''),
    }))
  return { total: d.total ?? themes.length, themes }
}
