/**
 * 基础设施层（00 测试层「e2e（infra）」，`pnpm e2e:infra` 单独运行）：
 * 用生产镜像 + infra/docker-compose.prod.yml 在本机起三服务（项目名 xz-e2e-infra、测试密钥、端口 18110/18111），
 * 前面再放一个 Caddy 容器，配置由 infra/Caddyfile.snippet 只替换域名与端口生成——测的就是要部署的那份片段。
 * 镜像不存在时先构建；XZ_IMAGE 可指定已有镜像。
 */
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const IMAGE = process.env.XZ_IMAGE ?? 'xianzhi:local'
const P = 'xz-e2e-infra'
const CADDY = `${P}-caddy`
const APP = 'http://127.0.0.1:18110'
const EDGE = 'http://127.0.0.1:18180'
const dir = mkdtempSync(join(tmpdir(), 'xz-infra-'))
const envFile = join(dir, 'prod.env')
const sh = (cmd: string) =>
  execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      XZ_IMAGE: IMAGE,
      XZ_ENV_FILE: envFile,
      XZ_APP_BIND: '127.0.0.1:18110',
      XZ_COLLAB_BIND: '127.0.0.1:18111',
    },
  })
const compose = (args: string) =>
  sh(`docker compose -p ${P} -f infra/docker-compose.prod.yml --env-file ${envFile} ${args}`)
const wsHandshake = (url: string, origin: string) =>
  sh(
    `curl -s -i --max-time 3 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Origin: ${origin}' ${url} || true`,
  ).split('\n')[0] ?? ''

test.describe.configure({ mode: 'serial', timeout: 600_000 })

test.beforeAll(() => {
  writeFileSync(
    envFile,
    [
      'PG_PASSWORD=infra-e2e-pg',
      'APP_URL=http://localhost:18110',
      'BETTER_AUTH_URL=http://localhost:18110',
      'BETTER_AUTH_SECRET=infra-e2e-secret-0123456789abcdefghijklmn',
      'COLLAB_TOKEN_SECRET=infra-e2e-collab-0123456789abcdefghijklmn',
      'LOG_LEVEL=warn',
    ].join('\n'),
  )
  try {
    sh(`docker image inspect ${IMAGE}`)
  } catch {
    sh(`docker build --network host -f infra/Dockerfile -t ${IMAGE} .`)
  }
  compose('up -d --no-build --wait --wait-timeout 180')
  const caddyfile = readFileSync('infra/Caddyfile.snippet', 'utf8')
    .replace(/^xz\.<domain> \{/m, ':18180 {')
    .replace('127.0.0.1:18011', '127.0.0.1:18111')
    .replace('127.0.0.1:18010', '127.0.0.1:18110')
  writeFileSync(join(dir, 'Caddyfile'), caddyfile)
  sh(`chmod a+r ${join(dir, 'Caddyfile')}`)
  sh(`docker rm -f ${CADDY} >/dev/null 2>&1 || true`)
  sh(
    `docker run -d --name ${CADDY} --network host -v ${join(dir, 'Caddyfile')}:/etc/caddy/Caddyfile:ro caddy:2-alpine`,
  )
  for (let i = 0; i < 40; i++) {
    if (sh(`curl -s -o /dev/null -w '%{http_code}' ${EDGE}/api/health || true`) === '200') return
    execSync('sleep 0.25')
  }
  throw new Error('Caddy 未就绪')
})
test.afterAll(() => {
  sh(`docker rm -f ${CADDY} >/dev/null 2>&1 || true`)
  compose('down -v')
})

test('REQ-OPS-005 生产 Compose 三服务 healthy；/api/health 200；/collab WebSocket 握手 101；非 root 且日志轮转', async ({
  request,
}) => {
  const ps = compose('ps --format "{{.Service}} {{.Health}}"')
  for (const s of ['xz-pg', 'xz-app', 'xz-collab']) expect(ps).toMatch(new RegExp(`${s} healthy`))
  const h = await request.get(`${APP}/api/health`)
  expect(h.status()).toBe(200)
  expect(wsHandshake('http://127.0.0.1:18111/collab', 'http://localhost:18110')).toContain('101')
  for (const svc of ['xz-app', 'xz-collab']) {
    expect(compose(`exec -T ${svc} id -un`).trim()).toBe('node')
    const cid = compose(`ps -q ${svc}`).trim()
    expect(sh(`docker inspect -f '{{json .HostConfig.LogConfig}}' ${cid}`)).toContain(
      '"max-size":"50m"',
    )
  }
})

test('REQ-OPS-005 Caddy 片段：/collab/* WebSocket 直通 101；/assets/* immutable（单个头）且压缩；其余反代到 xz-app', () => {
  expect(sh(`curl -s -o /dev/null -w '%{http_code}' ${EDGE}/api/health`)).toBe('200')
  expect(wsHandshake(`${EDGE}/collab`, 'http://localhost:18110')).toContain('101')
  const html = sh(`curl -s ${EDGE}/login`)
  const asset = /\/assets\/index-[^"]+\.js/.exec(html)?.[0]
  expect(asset).toBeTruthy()
  const headers = sh(`curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip, zstd' ${EDGE}${asset}`)
  expect(headers.match(/^cache-control:.*$/gim)).toEqual([
    expect.stringMatching(/public, max-age=31536000, immutable/i),
  ])
  expect(headers).toMatch(/^content-encoding: (zstd|gzip)/im)
})

test('REQ-ATTACH-010 经 Caddy：/data/... 与 /uploads/... 404（data/ 不直出），SPA 路由仍 200', () => {
  for (const p of ['/data/uploads/2026/09/x.png', '/uploads/2026/09/x.png', '/data'])
    expect(sh(`curl -s -o /dev/null -w '%{http_code}' ${EDGE}${p}`), p).toBe('404')
  expect(sh(`curl -s -o /dev/null -w '%{http_code}' ${EDGE}/spaces/product`)).toBe('200')
})

test('REQ-UI-015 经 Caddy 的生产栈 /login：Lighthouse Performance ≥ 90（默认移动端节流，取 3 次中位数）', () => {
  const scores: number[] = []
  let last: Record<string, unknown> = {}
  for (let i = 0; i < 3; i++) {
    const out = join(dir, `lh-${i}.json`)
    sh(
      `CHROME_PATH=\${CHROME_PATH:-/usr/bin/google-chrome} pnpm dlx lighthouse@12 ${EDGE}/login --only-categories=performance --output=json --output-path=${out} --quiet --chrome-flags="--headless=new --no-sandbox"`,
    )
    const r = JSON.parse(readFileSync(out, 'utf8')) as {
      categories: { performance: { score: number } }
      audits: Record<string, { numericValue?: number }>
    }
    scores.push(Math.round(r.categories.performance.score * 100))
    last = {
      fcpMs: r.audits['first-contentful-paint']?.numericValue,
      lcpMs: r.audits['largest-contentful-paint']?.numericValue,
      tbtMs: r.audits['total-blocking-time']?.numericValue,
      cls: r.audits['cumulative-layout-shift']?.numericValue,
    }
  }
  const median = [...scores].sort((a, b) => a - b)[1] ?? 0
  mkdirSync('debug/perf', { recursive: true })
  writeFileSync(
    'debug/perf/lighthouse.json',
    `${JSON.stringify({ url: '/login', scores, median, ...last, at: new Date().toISOString() }, null, 2)}\n`,
  )
  expect(median).toBeGreaterThanOrEqual(90)
})

test('REQ-OPS-002 注入失败迁移：新容器退出码非 0，旧 xz-app 仍 healthy', async ({ request }) => {
  const bad = join(dir, 'drizzle')
  cpSync('drizzle', bad, { recursive: true })
  writeFileSync(
    join(bad, '0099_bad.sql'),
    'ALTER TABLE this_table_does_not_exist ADD COLUMN x int;\n',
  )
  const journalPath = join(bad, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] }
  journal.entries.push({
    idx: journal.entries.length,
    version: '7',
    when: Date.now(),
    tag: '0099_bad',
    breakpoints: true,
  })
  writeFileSync(journalPath, JSON.stringify(journal))
  sh(`chmod -R a+rX ${bad}`)
  let code = 0
  try {
    sh(
      `docker run --rm --network ${P}_default --env-file ${envFile} -e NODE_ENV=production -e DATABASE_URL=postgres://xz:infra-e2e-pg@xz-pg:5432/xz -v ${bad}:/app/drizzle:ro ${IMAGE}`,
    )
  } catch (e) {
    code = (e as { status: number }).status
  }
  expect(code).not.toBe(0)
  expect(compose('ps --format "{{.Service}} {{.Health}}"')).toMatch(/xz-app healthy/)
  expect((await request.get(`${APP}/api/health`)).status()).toBe(200)
})
