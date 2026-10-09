/**
 * 网页链接预览（ADR-0054 §D、REQ-LINK-007；修订 REQ-LINK-004 / 07 §2.5）：抓取外链的标题 / 描述 / 站点名 / 图标，
 * 供链接卡片、粘贴自动取标题、只读悬停预览使用。
 *
 * SSRF 防护（07 §2.5，本 ADR 起不设域名白名单，改为逐跳地址校验）：
 * - 只接受 http / https、默认端口（80 / 443）、不带用户名密码；
 * - DNS 解析后**每个**地址都须是公网地址（拒私网 / 回环 / 链路本地 / 云元数据 / 保留 / 组播 / IPv4 映射到这些的 IPv6），
 *   连接时用 `lookup` 钉住校验过的地址（不二次解析，无 DNS rebinding 窗口）；
 * - 不自动跟随重定向：手动最多 3 跳，每跳重新校验；
 * - 总超时 5s；HTML 只读前 1 MB、只认 text/html / xhtml；图标 ≤ 64 KB、按魔数识别为位图才收（SVG 不收）；
 * - 抓到的文本只作纯文本返回（React 转义），图标以 data URI 返回（CSP img-src 不放开外站）。
 * 结果按 URL 缓存在进程内（成功 24h、失败 10min，最多 1000 条）；路由层另按人限流。
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { AppError } from '../lib/errors.ts'
import { sniffMime } from '../lib/sniff.ts'

export interface LinkPreview {
  url: string
  title: string
  description: string | null
  siteName: string
  favicon: string | null
}

const TIMEOUT_MS = 5000
const MAX_HTML = 1024 * 1024
const MAX_ICON = 64 * 1024
const MAX_HOPS = 3
const UA =
  'Mozilla/5.0 (compatible; XianzhiLinkPreview/1.0; +https://github.com/fujianghub/xianzhi)'

// ---------- 地址校验 ----------

const v4ToInt = (ip: string) =>
  ip.split('.').reduce((n, p) => ((n << 8) | (Number(p) & 255)) >>> 0, 0)
const inV4 = (ip: string, cidr: string) => {
  const [base, bits] = cidr.split('/') as [string, string]
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask)
}
/** 非公网 IPv4 段（RFC 6890 等） */
const V4_BLOCKED = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
]

/** 展开 IPv6 为 8 组 16 位 */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0] ?? ''
  // 末尾内嵌 IPv4（::ffff:1.2.3.4）
  const m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (m?.[1]) {
    const n = v4ToInt(m[1])
    s = `${s.slice(0, -m[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const [head, tail] = s.split('::') as [string, string | undefined]
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const fill = tail === undefined ? [] : new Array(8 - h.length - t.length).fill('0')
  const all = [...h, ...fill, ...t]
  if (all.length !== 8) return null
  const out = all.map((g) => Number.parseInt(g || '0', 16))
  return out.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff) ? null : out
}

/** 是否公网可达的单播地址（拒绝一切内网 / 特殊用途地址） */
export function isPublicAddress(ip: string): boolean {
  const fam = isIP(ip)
  if (fam === 4) return !V4_BLOCKED.some((c) => inV4(ip, c))
  if (fam !== 6) return false
  const g = v6Groups(ip)
  if (!g) return false
  const [a = 0, b = 0, , , , f = 0, g6 = 0, g7 = 0] = g
  if (g.every((x) => x === 0)) return false // ::
  if (g.slice(0, 7).every((x) => x === 0) && g7 === 1) return false // ::1
  // IPv4 映射 / 兼容 / NAT64：按内嵌的 IPv4 判
  const embedded = `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`
  if (g.slice(0, 5).every((x) => x === 0) && (f === 0xffff || f === 0))
    return isPublicAddress(embedded)
  if (a === 0x64 && b === 0xff9b) return isPublicAddress(embedded)
  if ((a & 0xfe00) === 0xfc00) return false // fc00::/7 ULA
  if ((a & 0xffc0) === 0xfe80) return false // fe80::/10 链路本地
  if ((a & 0xffc0) === 0xfec0) return false // fec0::/10 站点本地（已废弃）
  if ((a & 0xff00) === 0xff00) return false // 组播
  if (a === 0x2001 && b === 0x0db8) return false // 文档
  if (a === 0x2002) return false // 6to4（可嵌私网）
  if (a === 0x2001 && b < 0x0200) return false // 2001::/23 IETF 协议（Teredo 等）
  return true
}

/** URL 基本校验：http(s)、默认端口、无凭据；不合格 → 422 */
export function assertFetchableUrl(raw: string, deps: FetchDeps = {}): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw AppError.validation([{ path: 'url', message: '不是有效的网址' }])
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw AppError.validation([{ path: 'url', message: '只支持 http / https 网址' }])
  if (u.username || u.password)
    throw AppError.validation([{ path: 'url', message: '网址不能带用户名或密码' }])
  if (u.port && u.port !== '80' && u.port !== '443' && !deps.allowPort?.(u.port))
    throw AppError.validation([{ path: 'url', message: '只支持默认端口' }])
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    throw AppError.validation([{ path: 'url', message: '不能访问内网地址' }])
  return u
}

export interface FetchDeps {
  /** 地址校验（测试注入以连本机测试服务器）；缺省 isPublicAddress */
  allowAddress?: (ip: string) => boolean
  /** DNS 解析（测试注入）；缺省系统解析 */
  resolve?: (host: string) => Promise<{ address: string; family: number }[]>
  /** 非默认端口放行（测试服务器用随机端口）；缺省只认 80 / 443 */
  allowPort?: (port: string) => boolean
}

/** 解析并校验主机：所有地址都须放行；返回第一个用于连接 */
async function resolveSafe(host: string, deps: FetchDeps) {
  const allow = deps.allowAddress ?? isPublicAddress
  const literal = host.replace(/^\[|\]$/g, '')
  const addrs = isIP(literal)
    ? [{ address: literal, family: isIP(literal) }]
    : await (deps.resolve ?? ((h) => dnsLookup(h, { all: true, verbatim: true })))(host).catch(
        () => [],
      )
  if (!addrs.length) throw new AppError(502, 'UPSTREAM', '无法解析该网址')
  if (addrs.some((a) => !allow(a.address)))
    throw AppError.validation([{ path: 'url', message: '不能访问内网地址' }])
  return addrs[0] as { address: string; family: number }
}

interface Fetched {
  url: URL
  status: number
  type: string
  body: Buffer
}

/** 单跳请求：钉住地址、限时、限量；返回 3xx 时由调用方处理 Location */
function once(url: URL, addr: { address: string; family: number }, max: number, deadline: number) {
  return new Promise<Fetched & { location?: string }>((resolve, reject) => {
    const pinned: LookupFunction = (_h, opts, cb) => {
      if ((opts as { all?: boolean }).all)
        (cb as (e: null, a: { address: string; family: number }[]) => void)(null, [addr])
      else cb(null, addr.address, addr.family)
    }
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        lookup: pinned,
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
        },
        timeout: Math.max(1, deadline - Date.now()),
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0
        const type = String(res.headers['content-type'] ?? '').toLowerCase()
        if (status >= 300 && status < 400) {
          res.resume()
          resolve({ url, status, type, body: Buffer.alloc(0), location: res.headers.location })
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > max) {
            chunks.push(c.subarray(0, c.length - (size - max)))
            res.destroy()
            resolve({ url, status, type, body: Buffer.concat(chunks) })
            return
          }
          chunks.push(c)
        })
        res.on('end', () => resolve({ url, status, type, body: Buffer.concat(chunks) }))
        res.on('error', reject)
      },
    )
    const timer = setTimeout(
      () => req.destroy(new Error('timeout')),
      Math.max(1, deadline - Date.now()),
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    req.on('close', () => clearTimeout(timer))
    req.end()
  })
}

/** 安全抓取：逐跳校验 + 手动重定向 */
export async function safeFetch(
  raw: string,
  opts: { max: number; deadline?: number },
  deps: FetchDeps = {},
): Promise<Fetched> {
  const deadline = opts.deadline ?? Date.now() + TIMEOUT_MS
  let url = assertFetchableUrl(raw, deps)
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const addr = await resolveSafe(url.hostname, deps)
    let r: Fetched & { location?: string }
    try {
      r = await once(url, addr, opts.max, deadline)
    } catch {
      throw new AppError(502, 'UPSTREAM', '网页无法访问或超时')
    }
    if (r.status >= 300 && r.status < 400) {
      if (!r.location) throw new AppError(502, 'UPSTREAM', '网页重定向缺少目标')
      url = assertFetchableUrl(new URL(r.location, url).toString(), deps)
      continue
    }
    return r
  }
  throw new AppError(502, 'UPSTREAM', '网页重定向次数过多')
}

// ---------- HTML 解析 ----------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
}
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}
const clean = (s: string | undefined, max: number) =>
  s
    ? decodeEntities(s)
        .replace(/\p{Cc}/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''

/** 标签属性（大小写不敏感，单 / 双 / 无引号） */
function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  for (let m = re.exec(tag); m; m = re.exec(tag))
    out[(m[1] ?? '').toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? ''
  return out
}

/** 从 HTML 提取元数据（纯函数）：og / twitter / <title> / description / 图标 */
export function parseHtmlMeta(html: string, base: URL) {
  const head = html.slice(0, MAX_HTML)
  const meta: Record<string, string> = {}
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrsOf(m[0])
    const k = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase()
    if (k && a.content !== undefined && meta[k] === undefined) meta[k] = a.content
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
  let icon: string | null = null
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrsOf(m[0])
    const rel = (a.rel ?? '').toLowerCase().split(/\s+/)
    if (a.href && (rel.includes('icon') || rel.includes('apple-touch-icon'))) {
      // 优先普通 icon（apple-touch-icon 常是大图）
      if (!icon || rel.includes('icon')) icon = a.href
      if (rel.includes('icon') && !/\.svg(\?|$)/i.test(a.href)) break
    }
  }
  const resolve = (href: string | null) => {
    if (!href) return null
    try {
      const u = new URL(decodeEntities(href), base)
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
    } catch {
      return null
    }
  }
  return {
    title: clean(meta['og:title'] ?? meta['twitter:title'] ?? titleTag, 200),
    description:
      clean(meta['og:description'] ?? meta.description ?? meta['twitter:description'], 300) || null,
    siteName: clean(meta['og:site_name'] ?? meta['application-name'], 80),
    icon: resolve(icon) ?? new URL('/favicon.ico', base).toString(),
  }
}

/** 字节 → 字符串：按 Content-Type 或 <meta charset> 解码（GBK 等靠 ICU） */
export function decodeHtml(body: Buffer, contentType: string): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1]
  const sniff = body.subarray(0, 2048).toString('latin1')
  const fromMeta =
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(sniff)?.[1] ??
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(sniff)?.[1]
  for (const cs of [fromHeader, fromMeta, 'utf-8']) {
    if (!cs) continue
    try {
      return new TextDecoder(cs.toLowerCase()).decode(body)
    } catch {
      // 不认识的编码：试下一个
    }
  }
  return body.toString('utf8')
}

/** 图标：按魔数识别位图（含 ICO），SVG 与其它一律不收 */
function iconDataUri(body: Buffer): string | null {
  if (!body.length || body.length >= MAX_ICON) return null
  const ico = body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0
  const mime = ico ? 'image/x-icon' : sniffMime(body)
  if (!mime || !/^image\/(png|jpeg|gif|webp|x-icon)$/.test(mime)) return null
  return `data:${mime};base64,${body.toString('base64')}`
}

// ---------- 缓存 + 入口 ----------

const cache = new Map<string, { at: number; ok: LinkPreview | null; err?: AppError }>()
const OK_TTL = 24 * 3600_000
const FAIL_TTL = 10 * 60_000
const CACHE_MAX = 1000

export function clearLinkPreviewCache() {
  cache.clear()
}

export async function getLinkPreview(raw: string, deps: FetchDeps = {}): Promise<LinkPreview> {
  const key = assertFetchableUrl(raw.trim(), deps).toString()
  const hit = cache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < (hit.ok ? OK_TTL : FAIL_TTL)) {
    if (hit.ok) return hit.ok
    if (hit.err) throw hit.err
  }
  try {
    const deadline = now + TIMEOUT_MS
    const page = await safeFetch(key, { max: MAX_HTML, deadline }, deps)
    if (page.status < 200 || page.status >= 300)
      throw new AppError(502, 'UPSTREAM', `网页返回 ${page.status}`)
    if (!/text\/html|application\/xhtml\+xml/.test(page.type))
      throw new AppError(415, 'UNSUPPORTED_MEDIA', '不是网页')
    const meta = parseHtmlMeta(decodeHtml(page.body, page.type), page.url)
    let favicon: string | null = null
    try {
      const ic = await safeFetch(meta.icon, { max: MAX_ICON, deadline: Date.now() + 2500 }, deps)
      if (ic.status >= 200 && ic.status < 300) favicon = iconDataUri(ic.body)
    } catch {
      // 图标可缺
    }
    const host = page.url.hostname.replace(/^www\./, '')
    const out: LinkPreview = {
      url: key,
      title: meta.title || host,
      description: meta.description,
      siteName: meta.siteName || host,
      favicon,
    }
    remember(key, { at: now, ok: out })
    return out
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError(502, 'UPSTREAM', '网页无法访问')
    // 校验类（422 内网地址等）不缓存也无妨，但缓存可挡住重复请求
    remember(key, { at: now, ok: null, err: e })
    throw e
  }
}

function remember(key: string, v: { at: number; ok: LinkPreview | null; err?: AppError }) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(key, v)
}
