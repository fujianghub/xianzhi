/** ADR-0054 §D：网页链接预览（REQ-LINK-007）与 SSRF 防护。 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  clearLinkPreviewCache,
  decodeHtml,
  type FetchDeps,
  isPublicAddress,
  parseHtmlMeta,
} from '../services/link-preview.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

describe('REQ-LINK-007 link preview', () => {
  it('REQ-LINK-007 isPublicAddress：私网 / 回环 / 链路本地 / 元数据 / 映射地址一律拒', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
      '2002:a00::1',
    ])
      expect(isPublicAddress(ip), ip).toBe(false)
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
      expect(isPublicAddress(ip), ip).toBe(true)
  })

  it('REQ-LINK-007 parseHtmlMeta：og 优先、实体解码、相对图标、缺省 /favicon.ico', () => {
    const base = new URL('https://ex.test/a/b')
    const m = parseHtmlMeta(
      `<html><head><title>Fallback</title>
       <meta property="og:title" content="Tom &amp; Jerry &#x4E2D;">
       <meta name="description" content='  多   空格  '>
       <meta property="og:site_name" content="Ex">
       <link rel="shortcut icon" href="/i.png"></head></html>`,
      base,
    )
    expect(m).toEqual({
      title: 'Tom & Jerry 中',
      description: '多 空格',
      siteName: 'Ex',
      icon: 'https://ex.test/i.png',
    })
    expect(parseHtmlMeta('<title>x</title>', base).icon).toBe('https://ex.test/favicon.ico')
    // javascript: 图标被丢弃 → 回落 /favicon.ico
    expect(parseHtmlMeta('<link rel=icon href="javascript:alert(1)">', base).icon).toBe(
      'https://ex.test/favicon.ico',
    )
  })

  it('REQ-LINK-007 decodeHtml：按 meta charset 解 GBK', () => {
    const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]) // 「你好」
    const html = Buffer.concat([Buffer.from('<meta charset="gbk"><title>'), gbk])
    expect(decodeHtml(html, 'text/html')).toContain('你好')
  })

  describe('api', () => {
    let server: Server
    let port = 0
    let cookie = ''
    let app: ReturnType<typeof buildApp>['app']
    let hits = 0
    // 测试主机名 → 本机测试服务器；evil.test → 私网地址（用于重定向校验）
    const fetchDeps: FetchDeps = {
      allowAddress: (ip) => ip === '127.0.0.1' || isPublicAddress(ip),
      resolve: async (h) =>
        h === 'evil.test'
          ? [{ address: '10.0.0.5', family: 4 }]
          : [{ address: '127.0.0.1', family: 4 }],
      allowPort: (p) => p === String(port),
    }
    const get = (url: string, a = app) =>
      a.request(`/api/v1/link-preview?url=${encodeURIComponent(url)}`, {
        headers: jsonHeaders({ cookie }),
      })

    beforeAll(async () => {
      const icon = await sharp({
        create: { width: 4, height: 4, channels: 3, background: '#2a6' },
      })
        .png()
        .toBuffer()
      server = createServer((req, res) => {
        hits++
        if (req.url === '/page') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(
            '<title>页面</title><meta property="og:description" content="描述"><link rel=icon href="/i.png">',
          )
        } else if (req.url === '/i.png') {
          res.writeHead(200, { 'content-type': 'image/png' })
          res.end(icon)
        } else if (req.url === '/go') {
          res.writeHead(302, { location: `http://pub.test:${port}/page` })
          res.end()
        } else if (req.url === '/evil') {
          res.writeHead(302, { location: 'http://evil.test/' })
          res.end()
        } else if (req.url === '/json') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{}')
        } else {
          res.writeHead(404)
          res.end()
        }
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      port = (server.address() as AddressInfo).port
      await truncateAll()
      await seedOwner()
      app = buildApp({ linkFetch: fetchDeps }).app
      cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    })
    afterAll(() => new Promise<void>((r) => server.close(() => r())))
    beforeEach(() => clearLinkPreviewCache())

    it('REQ-LINK-007 抓取标题 / 描述 / 站点名 / 图标（data URI），跟随重定向并重新校验', async () => {
      const r = await get(`http://pub.test:${port}/go`)
      expect(r.status).toBe(200)
      const v = (await r.json()) as Record<string, string | null>
      expect(v.title).toBe('页面')
      expect(v.description).toBe('描述')
      expect(v.siteName).toBe('pub.test')
      expect(v.favicon?.startsWith('data:image/png;base64,')).toBe(true)
      // 同一 URL 再取：走缓存，不再请求上游
      const before = hits
      expect((await get(`http://pub.test:${port}/go`)).status).toBe(200)
      expect(hits).toBe(before)
    })

    it('REQ-LINK-007 重定向到私网 → 422；非网页 415；上游 404 → 502', async () => {
      expect((await get(`http://pub.test:${port}/evil`)).status).toBe(422)
      expect((await get(`http://pub.test:${port}/json`)).status).toBe(415)
      expect((await get(`http://pub.test:${port}/nope`)).status).toBe(502)
    })

    it('REQ-LINK-007 默认防护：内网 / 回环 / 元数据 / 非 http / 非默认端口 / 带凭据 → 422；未登录 401', async () => {
      const plain = buildApp().app
      for (const u of [
        'http://127.0.0.1/',
        'http://169.254.169.254/latest/meta-data/',
        'http://localhost/',
        'http://[::1]/',
        'http://[::ffff:127.0.0.1]/',
        'http://10.0.0.1/',
        'ftp://example.com/',
        'file:///etc/passwd',
        'http://example.com:8080/',
        'http://user:pw@example.com/',
        'javascript:alert(1)',
      ])
        expect((await get(u, plain)).status, u).toBe(422)
      const anon = await plain.request(
        `/api/v1/link-preview?url=${encodeURIComponent('https://example.com/')}`,
        { headers: jsonHeaders() },
      )
      expect(anon.status).toBe(401)
    })
  })
})
