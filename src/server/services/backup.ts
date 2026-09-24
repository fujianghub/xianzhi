/**
 * 备份与恢复（05 §8、T0-027、REQ-EXPORT-005）：pg_dump -Fc → age（AGE_RECIPIENT 公钥）→ data/backups/xz-YYYYMMDD.dump.age，保留 14 天；
 * 恢复：age 私钥解密 → pg_restore 到指定库（演练库 xz_verify），清空 session，对照行数。
 * PG 客户端：优先本机 pg_dump / pg_restore；本机没有时回落 `docker exec <PG_DOCKER_CONTAINER|xz-dev-pg>`（dev）。生产镜像自带 PG16 客户端。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Decrypter, Encrypter } from 'age-encryption'
import { inArray, sql } from 'drizzle-orm'
import pg from 'pg'
import type { Db } from '../db/index.ts'
import { member } from '../db/schema/auth.ts'
import { dataPath, removeOlderThan } from '../lib/files.ts'
import { audit } from './audit.ts'
import { emit } from './events.ts'

export const BACKUP_RETENTION_DAYS = 14

interface PgTarget {
  user: string
  password: string
  host: string
  port: string
  database: string
}
const parseUrl = (url: string): PgTarget => {
  const u = new URL(url)
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    port: u.port || '5432',
    database: u.pathname.slice(1),
  }
}

const onPath = (bin: string) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0

/** 生成 pg_dump / pg_restore 的 spawn 参数（本机或 docker exec）。 */
function pgCommand(
  bin: 'pg_dump' | 'pg_restore',
  t: PgTarget,
  args: string[],
): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (onPath(bin)) {
    return {
      cmd: bin,
      args: ['-h', t.host, '-p', t.port, '-U', t.user, ...args],
      env: { ...process.env, PGPASSWORD: t.password },
    }
  }
  const container = process.env.PG_DOCKER_CONTAINER ?? 'xz-dev-pg'
  return {
    cmd: 'docker',
    args: ['exec', '-i', '-e', `PGPASSWORD=${t.password}`, container, bin, '-U', t.user, ...args],
    env: process.env,
  }
}

function run(c: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }, stdin?: Readable) {
  const child = spawn(c.cmd, c.args, {
    env: c.env,
    stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
  })
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${c.args.find((a) => a.startsWith('pg_')) ?? c.cmd} 退出码 ${code}: ${stderr.trim().slice(0, 400)}`,
            ),
          ),
    )
  })
  if (stdin && child.stdin) stdin.pipe(child.stdin)
  return { child, done }
}

export interface BackupDeps {
  db: Db
  databaseUrl: string
  dataDir: string
  ageRecipient?: string
  workspaceId?: string | null
  now?: Date
}

/** 备份文件名日期按工作区时区（容器默认 UTC，凌晨 3 点的备份会落到前一天）。 */
const ymd = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(d)
    .replace(/-/g, '')

/** 生成加密备份；返回文件路径与字节数。失败时写 audit(backup.failed) 并发 system.backup_failed（admin）。 */
export async function runBackup(
  deps: BackupDeps,
  jobId = 'manual',
): Promise<{ file: string; bytes: number; pruned: number }> {
  const now = deps.now ?? new Date()
  try {
    if (!deps.ageRecipient) throw new Error('AGE_RECIPIENT 未配置（05 §8），拒绝写明文备份')
    const dir = dataPath(deps.dataDir, 'backups')
    await mkdir(dir, { recursive: true })
    const file = dataPath(deps.dataDir, 'backups', `xz-${ymd(now)}.dump.age`)
    const t = parseUrl(deps.databaseUrl)
    const dump = run(pgCommand('pg_dump', t, ['-d', t.database, '-Fc', '--no-owner']))
    const enc = new Encrypter()
    enc.addRecipient(deps.ageRecipient)
    const encrypted = await enc.encrypt(
      Readable.toWeb(dump.child.stdout as Readable) as ReadableStream<Uint8Array>,
    )
    await Promise.all([
      pipeline(Readable.fromWeb(encrypted as never), createWriteStream(file)),
      dump.done,
    ])
    const bytes = (await stat(file)).size
    const pruned = await removeOlderThan(
      dir,
      new Date(now.getTime() - BACKUP_RETENTION_DAYS * 86_400_000),
      /\.dump\.age$/,
    )
    return { file, bytes, pruned }
  } catch (err) {
    await reportBackupFailure(deps, jobId, now, err).catch(() => undefined)
    throw err
  }
}

async function reportBackupFailure(
  deps: BackupDeps,
  jobId: string,
  now: Date,
  err: unknown,
): Promise<void> {
  const summary = String(err instanceof Error ? err.message : err).slice(0, 300)
  const workspaceId =
    deps.workspaceId ??
    (await deps.db.execute<{ id: string }>(sql`select id from organization limit 1`)).rows[0]?.id ??
    null
  await deps.db.transaction(async (tx) => {
    await audit(tx, {
      workspaceId,
      action: 'backup.failed',
      targetType: 'job',
      targetId: jobId,
      meta: { errorSummary: summary },
    })
    if (!workspaceId) return
    const admins = await tx
      .select({ id: member.userId })
      .from(member)
      .where(inArray(member.role, ['owner', 'admin']))
    await emit(tx, {
      kind: 'system.backup_failed',
      workspaceId,
      actorId: null,
      targetType: 'system',
      targetId: null,
      visibilityScope: { userIds: admins.map((a) => a.id) },
      payload: {
        jobId,
        backupDate: now.toISOString().slice(0, 10),
        errorCode: err instanceof Error ? err.name : 'Error',
        errorSummary: summary,
      },
    })
  })
}

/** 业务表 + 认证核心表行数（恢复核对用）。 */
export const COUNTED_TABLES = [
  'user',
  'organization',
  'member',
  'spaces',
  'space_members',
  'tasks',
  'entries',
  'entry_snapshots',
  'comments',
  'links',
  'tags',
  'attachments',
  'events',
  'notifications',
  'audit_log',
] as const

export async function tableCounts(url: string): Promise<Record<string, number>> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const out: Record<string, number> = {}
    for (const t of COUNTED_TABLES) {
      const r = await client
        .query(`select count(*)::int as n from "${t}"`)
        .catch(() => ({ rows: [{ n: -1 }] }))
      out[t] = r.rows[0].n as number
    }
    return out
  } finally {
    await client.end()
  }
}

/** 恢复到目标库（默认 xz_verify）：拒绝恢复到当前业务库；恢复后清空 session（07 §2.8）。 */
export async function runRestore(opts: {
  file: string
  identity: string
  sourceUrl: string
  targetDb: string
}): Promise<{ targetUrl: string; counts: Record<string, number> }> {
  const src = parseUrl(opts.sourceUrl)
  if (opts.targetDb === src.database)
    throw new Error(`拒绝恢复到当前业务库 ${opts.targetDb}；演练请用 --db xz_verify`)
  const target = new URL(opts.sourceUrl)
  target.pathname = `/${opts.targetDb}`
  const targetUrl = target.toString()
  // 目标库重建为空库
  const admin = new URL(opts.sourceUrl)
  admin.pathname = '/postgres'
  const ac = new pg.Client({ connectionString: admin.toString() })
  await ac.connect()
  try {
    await ac.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [opts.targetDb],
    )
    await ac.query(`drop database if exists "${opts.targetDb.replace(/"/g, '""')}"`)
    await ac.query(
      `create database "${opts.targetDb.replace(/"/g, '""')}" owner "${src.user.replace(/"/g, '""')}"`,
    )
  } finally {
    await ac.end()
  }
  const dec = new Decrypter()
  dec.addIdentity(opts.identity.trim())
  const plain = await dec.decrypt(
    Readable.toWeb(createReadStream(opts.file)) as ReadableStream<Uint8Array>,
  )
  const t = { ...src, database: opts.targetDb }
  const r = run(
    pgCommand('pg_restore', t, ['-d', opts.targetDb, '--no-owner', '--exit-on-error']),
    Readable.fromWeb(plain as never),
  )
  await r.done
  const c = new pg.Client({ connectionString: targetUrl })
  await c.connect()
  await c.query('truncate table "session"').catch(() => undefined)
  await c.end()
  return { targetUrl, counts: await tableCounts(targetUrl) }
}

/** 从文件读取 age 私钥（AGE-SECRET-KEY-…，忽略注释行）。 */
export async function readIdentityFile(path: string): Promise<string> {
  const text = await readFile(path, 'utf8')
  const line = text.split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-'))
  if (!line) throw new Error(`${path} 中没有 AGE-SECRET-KEY-`)
  return line.trim()
}
