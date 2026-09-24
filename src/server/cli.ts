/**
 * 运维 CLI（05 §3 `pnpm xz <cmd>`）：create-owner | seed | rebuild-derived | snapshot | backup | restore | export | migrate-prefix。
 * 只做参数解析 → service；不含业务。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { eq } from 'drizzle-orm'
import { insertSnapshot } from '../collab/snapshots.ts'
import { getAuth } from './auth.ts'
import { closeDb, getDb } from './db/index.ts'
import { entries } from './db/schema/business.ts'
import { EnvError, getEnv } from './env.ts'
import { JOBS, runJob } from './jobs/index.ts'
import { dataPath } from './lib/files.ts'
import { getLogger } from './lib/logger.ts'
import { readIdentityFile, runBackup, runRestore, tableCounts } from './services/backup.ts'
import { rebuildComments, rebuildEntries, rebuildTasks } from './services/derived.ts'
import { migrateLegacyPrefix } from './services/rebrand.ts'
import { seed } from './services/seed.ts'
import { createOwner, OwnerExistsError } from './services/workspace.ts'

const USAGE = `用法：pnpm xz <cmd>
  create-owner [--email <e>] [--name <n>] [--password <p>] [--workspace <name>]   创建首个 owner + 默认工作区
  rebuild-derived [--entries] [--tasks] [--comments]                              重建派生列（缺省全部）
  snapshot <entryId> [--label <l>]                                                为已落库正文生成快照
  job <name>                                                                       手动触发一个 pg-boss 作业（同步执行）
  backup                                                                           pg_dump → age 加密 → data/backups/
  restore <file.dump.age> --identity <keyfile> [--db xz_verify]                   解密恢复到演练库并核对行数
  export --workspace                                                               导出骨架（完整导出见 T1-028）
  seed                                                                             写入 08 §7 示例数据（生产禁用）
  migrate-prefix                                                                   品牌更名数据迁移：gi: → xz:（正文、描述、评论、工作区、outbox 触发器；幂等）`

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function ask(q: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    if (!hidden) return (await rl.question(q)).trim()
    process.stdout.write(q)
    return await new Promise<string>((resolve) => {
      let buf = ''
      const onData = (ch: Buffer) => {
        const s = ch.toString()
        if (s === '\n' || s === '\r') {
          process.stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(buf.trim())
        } else buf += s
      }
      process.stdin.on('data', onData)
    })
  } finally {
    rl.close()
  }
}

async function main(): Promise<number> {
  const cmd = process.argv[2]
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE)
    return cmd ? 0 : 1
  }
  getEnv()
  switch (cmd) {
    case 'create-owner': {
      const email = arg('email') ?? (await ask('owner 邮箱：'))
      const name = arg('name') ?? (await ask('显示名：'))
      const password = arg('password') ?? (await ask('密码（≥ 10 位）：', true))
      if (!email || !name || password.length < 10) {
        console.error('邮箱 / 显示名不能为空，密码至少 10 位')
        return 1
      }
      try {
        const r = await createOwner(getDb(), getAuth(), {
          email,
          name,
          password,
          workspaceName: arg('workspace'),
        })
        console.log(`owner 已创建：user=${r.userId} workspace=${r.workspaceId}`)
        return 0
      } catch (err) {
        if (err instanceof OwnerExistsError) {
          console.error(err.message)
          return 2
        }
        throw err
      }
    }
    case 'rebuild-derived': {
      const flags = process.argv.slice(3)
      const all = flags.length === 0
      const db = getDb()
      if (all || flags.includes('--entries')) {
        const r = await rebuildEntries(db)
        console.log(`entries: ${r.ok}/${r.total} ok, ${r.failed} failed`)
      }
      if (all || flags.includes('--tasks')) console.log(`tasks: ${(await rebuildTasks(db)).ok} ok`)
      if (all || flags.includes('--comments'))
        console.log(`comments: ${(await rebuildComments(db)).ok} ok`)
      return 0
    }
    case 'snapshot': {
      const id = process.argv[3]
      if (!id) {
        console.error('用法：pnpm xz snapshot <entryId> [--label <l>]')
        return 1
      }
      const [row] = await getDb()
        .select({ ydoc: entries.ydoc, v: entries.ydocVersion })
        .from(entries)
        .where(eq(entries.id, id))
      if (!row) {
        console.error(`记录不存在：${id}`)
        return 1
      }
      const s = await insertSnapshot(getDb(), id, row.ydoc, row.v, { label: arg('label') ?? null })
      console.log(`snapshot ${s.id} @ ydoc_version=${row.v}`)
      return 0
    }
    case 'job': {
      const name = process.argv[3]
      if (!name) {
        console.log(JOBS.map((j) => `${j.name}${j.cron ? `  (${j.cron})` : ''}`).join('\n'))
        return 1
      }
      const env = getEnv()
      const r = await runJob(name, {
        db: getDb(),
        dataDir: env.DATA_DIR,
        databaseUrl: env.DATABASE_URL,
        ageRecipient: env.AGE_RECIPIENT,
        logger: getLogger(),
      })
      console.log(JSON.stringify(r ?? null))
      return 0
    }
    case 'backup': {
      const env = getEnv()
      const r = await runBackup({
        db: getDb(),
        databaseUrl: env.DATABASE_URL,
        dataDir: env.DATA_DIR,
        ageRecipient: env.AGE_RECIPIENT,
      })
      console.log(`backup ok: ${r.file} (${r.bytes} bytes)，清理过期 ${r.pruned} 个`)
      return 0
    }
    case 'restore': {
      const file = process.argv[3]
      const keyFile = arg('identity') ?? process.env.AGE_IDENTITY_FILE
      if (!file || !keyFile) {
        console.error(
          '用法：pnpm xz restore <file.dump.age> --identity <age 私钥文件> [--db xz_verify]',
        )
        return 1
      }
      const env = getEnv()
      const before = await tableCounts(env.DATABASE_URL)
      const r = await runRestore({
        file,
        identity: await readIdentityFile(keyFile),
        sourceUrl: env.DATABASE_URL,
        targetDb: arg('db') ?? 'xz_verify',
      })
      console.table(
        Object.keys(r.counts).map((t) => ({ table: t, source: before[t], restored: r.counts[t] })),
      )
      return 0
    }
    case 'export': {
      if (!process.argv.includes('--workspace')) {
        console.error('用法：pnpm xz export --workspace')
        return 1
      }
      const env = getEnv()
      const counts = await tableCounts(env.DATABASE_URL)
      const dir = dataPath(env.DATA_DIR, 'exports')
      await mkdir(dir, { recursive: true })
      const file = dataPath(
        env.DATA_DIR,
        'exports',
        `workspace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      )
      await writeFile(
        file,
        JSON.stringify(
          { format: 'xz-export-skeleton', version: 1, createdAt: new Date().toISOString(), counts },
          null,
          2,
        ),
      )
      console.log(`导出骨架：${file}（Markdown zip 完整导出在 T1-028）`)
      return 0
    }
    case 'migrate-prefix': {
      const r = await migrateLegacyPrefix(getDb())
      console.log(JSON.stringify(r))
      return 0
    }
    case 'seed': {
      const env = getEnv()
      if (env.NODE_ENV === 'production') {
        console.error('生产环境禁止执行 seed（08 §7）')
        return 2
      }
      const r = await seed({
        db: getDb(),
        auth: getAuth(),
        dataDir: env.DATA_DIR,
        nodeEnv: env.NODE_ENV,
      })
      console.log(
        `seed ok：${JSON.stringify(r)}\n登录：owner@demo.local / demo-owner · member@demo.local / demo-member · guest@demo.local / demo-guest`,
      )
      return 0
    }
    default:
      console.error(`未知命令：${cmd}\n${USAGE}`)
      return 1
  }
}

main()
  .then(async (code) => {
    await closeDb()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error(err instanceof EnvError ? err.message : err)
    await closeDb()
    process.exit(1)
  })
