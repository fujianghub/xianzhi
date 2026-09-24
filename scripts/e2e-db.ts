/**
 * `pnpm e2e` 前置（05 §2 `xz_e2e` 每次重建并 seed）：drop → create → migrate → seed。只允许作用于 xz_e2e。
 */
import pg from 'pg'
import { ensureDatabase, migrateDatabase } from '../src/server/db/migrate.ts'

const url = process.env.E2E_DATABASE_URL ?? 'postgres://xz:xz@localhost:5433/xz_e2e'
const name = new URL(url).pathname.slice(1)
if (name !== 'xz_e2e') throw new Error(`e2e-db 只作用于 xz_e2e，拒绝 ${name}`)
const admin = new URL(url)
admin.pathname = '/postgres'
const c = new pg.Client({ connectionString: admin.toString() })
await c.connect()
await c.query(
  'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
  [name],
)
await c.query(`drop database if exists ${name}`)
await c.end()
await ensureDatabase(url)
await migrateDatabase(url)
process.env.DATABASE_URL = url
const { getAuth } = await import('../src/server/auth.ts')
const { getDb, closeDb } = await import('../src/server/db/index.ts')
const { seed } = await import('../src/server/services/seed.ts')
const r = await seed({
  db: getDb(),
  auth: getAuth(),
  dataDir: process.env.DATA_DIR ?? './data/e2e',
  nodeEnv: 'test',
})
console.info(`e2e-db：${name} 已重建并 seed ${JSON.stringify(r)}`)
await closeDb()
