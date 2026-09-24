/**
 * 迁移执行（01 §7、05 §7）：容器启动先 migrate，失败即退出非 0（REQ-OPS-002）。
 * 用法：`pnpm db:migrate`（读 .env / DATABASE_URL）；测试用 migrateDatabase(url)。
 */
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url))

export async function migrateDatabase(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const db = drizzle({ client: pool })
    await migrate(db, { migrationsFolder })
  } finally {
    await pool.end()
  }
}

/** 建库（不存在时）；用于 xz_test 自动建库（05 §2）。 */
export async function ensureDatabase(connectionString: string): Promise<void> {
  const target = new URL(connectionString)
  const dbName = target.pathname.slice(1)
  const admin = new URL(connectionString)
  admin.pathname = '/postgres'
  const client = new pg.Client({ connectionString: admin.toString() })
  await client.connect()
  try {
    const r = await client.query('select 1 from pg_database where datname = $1', [dbName])
    if (r.rowCount === 0) await client.query(`create database "${dbName.replace(/"/g, '""')}"`)
  } finally {
    await client.end()
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const { getEnv } = await import('../env.ts')
  const env = getEnv()
  const t = performance.now()
  migrateDatabase(env.DATABASE_URL)
    .then(() => {
      console.info(
        `[migrate] ok (${(performance.now() - t).toFixed(0)}ms) ${env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`,
      )
    })
    .catch((err) => {
      console.error('[migrate] failed:', err)
      process.exit(1)
    })
}
