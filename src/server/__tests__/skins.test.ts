/** ADR-0059 皮肤：安装（REQ-UI-056）、读取 / 图片（REQ-UI-057）、偏好 skin 键（REQ-UI-058）。只用合成图，不含任何主题包原图。 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '../env.ts'
import { type FetchDeps, isPublicAddress } from '../services/link-preview.ts'
import { installSkin, listSkins, removeSkin, skinsDir } from '../services/skins.ts'
import { truncateAll } from './db.ts'
import { buildApp, jsonHeaders, OWNER, seedOwner, signIn } from './helpers.ts'

const pkg = (over: Record<string, unknown> = {}, art?: Buffer | null) => ({
  format: 'codex-theme',
  schemaVersion: 1,
  manifest: {
    id: 'Test_Halo',
    displayName: '测试晕环',
    description: '合成测试主题',
    version: '0.1.0',
    mode: 'dark',
    design: { artFocalPoint: '62% 58%' },
    palette: { canvas: '#0b1728', text: '#e5edf8', accent: '#91d9f2', border: 'native unchanged' },
    author: { name: 'tester' },
    ...over,
  },
  css: 'body{background:red!important}',
  ...(art
    ? { art: { filename: 'a.png', mimeType: 'image/png', base64: art.toString('base64') } }
    : {}),
})

describe('skins', () => {
  const dataDir = getEnv().DATA_DIR
  const tmp = join(dataDir, 'skin-fixtures')
  let art: Buffer
  let server: Server
  let port = 0
  const fetchDeps: FetchDeps = {
    allowAddress: (ip) => ip === '127.0.0.1' || isPublicAddress(ip),
    resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    allowPort: (p) => p === String(port),
  }
  const file = async (name: string, body: unknown) => {
    const p = join(tmp, name)
    await writeFile(p, typeof body === 'string' ? body : JSON.stringify(body))
    return p
  }

  beforeAll(async () => {
    await rm(skinsDir(dataDir), { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    art = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: '#335577' } })
      .png()
      .toBuffer()
    server = createServer((req, res) => {
      if (req.url === '/api/themes/remote-one/download') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify(pkg({ id: 'remote-one', mode: 'light', palette: { canvas: '#fffaf6' } })),
        )
      } else {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('{"error":"not_found"}')
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })
  afterAll(async () => {
    server.close()
    await rm(skinsDir(dataDir), { recursive: true, force: true })
    await rm(tmp, { recursive: true, force: true })
  })

  it('REQ-UI-056 本地包安装：规范化 id / palette / 焦点，背景图转 webp 且限尺寸，包内 CSS 丢弃；重装保留安装时间', async () => {
    const rec = await installSkin(dataDir, await file('a.codex-theme', pkg({}, art)))
    expect(rec).toMatchObject({
      id: 'test-halo',
      name: '测试晕环',
      mode: 'dark',
      focal: '62% 58%',
      art: true,
      palette: { canvas: '#0b1728', text: '#e5edf8', accent: '#91d9f2' },
      source: { kind: 'file' },
    })
    expect(rec.version).toMatch(/^0\.1\.0-[0-9a-f]{8}$/)
    const dir = join(skinsDir(dataDir), 'test-halo')
    const meta = await sharp(await readFile(join(dir, 'art.webp'))).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBeLessThanOrEqual(2560)
    const thumb = await sharp(await readFile(join(dir, 'thumb.webp'))).metadata()
    expect([thumb.width, thumb.height]).toEqual([640, 400])
    expect(JSON.stringify(rec)).not.toContain('important')

    const again = await installSkin(dataDir, await file('a.codex-theme', pkg({}, art)), {
      name: '改名',
    })
    expect(again.installedAt).toBe(rec.installedAt)
    expect(again.name).toBe('改名')
    expect((await listSkins(dataDir)).map((s) => s.id)).toEqual(['test-halo'])
  })

  it('REQ-UI-056 拒绝：非主题包 / 坏图片魔数 / 非法 id / 保留字 none；codexthemes 404 给出说明', async () => {
    const bad = async (p: Promise<unknown>) => {
      const e = (await p.catch((x) => x)) as { status?: number }
      expect(e.status).toBe(422)
    }
    await bad(installSkin(dataDir, await file('b.json', '{"hello":1}')))
    await bad(installSkin(dataDir, await file('c.json', 'not json')))
    await bad(
      installSkin(
        dataDir,
        await file('d.codex-theme', {
          ...pkg(),
          art: {
            filename: 'x.png',
            mimeType: 'image/png',
            base64: Buffer.from('<html>').toString('base64'),
          },
        }),
      ),
    )
    await bad(installSkin(dataDir, await file('e.codex-theme', pkg()), { id: '../x' }))
    await bad(installSkin(dataDir, await file('f.codex-theme', pkg({ id: 'none' }))))
    await bad(installSkin(dataDir, 'not a file; rm -rf'))
    await bad(
      installSkin(dataDir, 'cyber-earth', { origin: `http://pub.test:${port}`, fetch: fetchDeps }),
    )
  })

  it('REQ-UI-056 按主题 id 下载（经 safeFetch）；无背景图 = 纯配色；卸载', async () => {
    const rec = await installSkin(dataDir, 'remote-one', {
      origin: `http://pub.test:${port}`,
      fetch: fetchDeps,
    })
    expect(rec).toMatchObject({
      id: 'remote-one',
      mode: 'light',
      art: false,
      source: { kind: 'codexthemes', page: 'https://codexthemes.ai/themes/remote-one' },
    })
    // 内网地址照样被 safeFetch 拦下（未注入放行）
    const e = (await installSkin(dataDir, 'remote-one', {
      origin: `http://127.0.0.1:${port}`,
    }).catch((x) => x)) as { status?: number }
    expect(e.status).toBe(422)
    await removeSkin(dataDir, 'remote-one')
    expect((await listSkins(dataDir)).map((s) => s.id)).toEqual(['test-halo'])
  })

  describe('api', () => {
    let app: ReturnType<typeof buildApp>['app']
    let cookie = ''
    const get = (path: string, headers: Record<string, string> = {}) =>
      app.request(`/api/v1${path}`, { headers: jsonHeaders({ cookie, ...headers }) })

    beforeAll(async () => {
      await truncateAll()
      await seedOwner()
      app = buildApp().app
      cookie = (await signIn(app, OWNER.email, OWNER.password)).cookie
    })

    it('REQ-UI-057 列表 / 详情含样式表 / 图片长缓存 + ETag；未登录 401；不存在 404', async () => {
      expect((await app.request('/api/v1/skins')).status).toBe(401)
      const list = (await (await get('/skins')).json()) as { items: { id: string; mode: string }[] }
      expect(list.items).toEqual([
        expect.objectContaining({ id: 'test-halo', mode: 'dark', art: true }),
      ])
      expect(JSON.stringify(list)).not.toContain('palette')

      const d = (await (await get('/skins/test-halo')).json()) as { css: string; version: string }
      expect(d.css).toContain(':root[data-skin="test-halo"]')
      expect(d.css).toContain(`/api/v1/skins/test-halo/art?v=${d.version}`)

      const img = await get(`/skins/test-halo/art?v=${d.version}`)
      expect(img.status).toBe(200)
      expect(img.headers.get('content-type')).toBe('image/webp')
      expect(img.headers.get('cache-control')).toContain('immutable')
      const etag = img.headers.get('etag') as string
      expect((await get('/skins/test-halo/art', { 'if-none-match': etag })).status).toBe(304)
      expect((await get('/skins/test-halo/thumb')).status).toBe(200)

      expect((await get('/skins/nope')).status).toBe(404)
      expect((await get('/skins/nope/art')).status).toBe(404)
      expect((await get('/skins/..%2Fetc/art')).status).toBe(422)
    })

    it('REQ-UI-058 · 065 偏好 skin / skinArt：按人保存、null 删除、none 可选、非法值 422；工作区默认可设', async () => {
      const patch = (body: unknown, path = '/me/preferences') =>
        app.request(`/api/v1${path}`, {
          method: 'PATCH',
          headers: jsonHeaders({ cookie }),
          body: JSON.stringify(body),
        })
      let r = await patch({ appearance: { skin: 'test-halo' } })
      expect(r.status).toBe(200)
      expect(((await r.json()) as { appearance: unknown }).appearance).toMatchObject({
        skin: 'test-halo',
      })
      expect((await patch({ appearance: { skin: 'Bad Id' } })).status).toBe(422)
      // REQ-UI-065 图片强度：淡 / 中 / 浓，其它值 422，null 删除
      r = await patch({ appearance: { skinArt: 'strong' } })
      expect(((await r.json()) as { appearance: { skinArt: string } }).appearance.skinArt).toBe(
        'strong',
      )
      expect((await patch({ appearance: { skinArt: 'max' } })).status).toBe(422)
      r = await patch({ appearance: { skinArt: null } })
      expect(
        ((await r.json()) as { appearance: Record<string, unknown> }).appearance,
      ).not.toHaveProperty('skinArt')
      r = await patch({ appearance: { skin: 'none' } })
      expect(((await r.json()) as { appearance: { skin: string } }).appearance.skin).toBe('none')
      r = await patch({ appearance: { skin: null } })
      expect(
        ((await r.json()) as { appearance: Record<string, unknown> }).appearance,
      ).not.toHaveProperty('skin')
      expect(
        (await patch({ settings: { appearance: { skin: 'test-halo' } } }, '/workspace')).status,
      ).toBe(200)
      const g = (await (await get('/me/preferences')).json()) as {
        workspaceAppearance: { skin?: string }
      }
      expect(g.workspaceAppearance.skin).toBe('test-halo')
      await patch({ settings: { appearance: {} } }, '/workspace')
    })

    it('REQ-UI-064 公开 /skins/default：未设 / 未安装 → null；设了 → 样式表；未登录只能读默认主题的图', async () => {
      const setDefault = (skin?: string) =>
        app.request('/api/v1/workspace', {
          method: 'PATCH',
          headers: jsonHeaders({ cookie }),
          body: JSON.stringify({ settings: { appearance: skin ? { skin } : {} } }),
        })
      const anon = (path: string) => app.request(`/api/v1${path}`)
      expect(await (await anon('/skins/default')).json()).toEqual({ skin: null })
      expect((await anon('/skins/test-halo/art')).status).toBe(401)

      expect((await setDefault('not-installed')).status).toBe(200)
      expect(await (await anon('/skins/default')).json()).toEqual({ skin: null })

      expect((await setDefault('test-halo')).status).toBe(200)
      const d = (await (await anon('/skins/default')).json()) as {
        skin: { id: string; css: string; mode: string }
      }
      expect(d.skin).toMatchObject({ id: 'test-halo', mode: 'dark' })
      expect(d.skin.css).toContain(':root[data-skin="test-halo"]')
      const img = await anon('/skins/test-halo/art')
      expect(img.status).toBe(200)
      expect(img.headers.get('cache-control')).toContain('public')
      // 列表 / 详情仍要登录
      expect((await anon('/skins')).status).toBe(401)
      expect((await anon('/skins/test-halo')).status).toBe(401)
      await setDefault()
    })
  })
})
