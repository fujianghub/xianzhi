/** 生产入口（05 §3 `pnpm start`）：migrate → api + pg-boss worker 同进程；迁移失败退出非 0（REQ-OPS-002）。 */
import { migrateDatabase } from './db/migrate.ts'
import { EnvError, getEnv } from './env.ts'

async function main() {
  const env = getEnv()
  await migrateDatabase(env.DATABASE_URL)
  const { startApi } = await import('./index.ts')
  startApi()
}

main().catch((err) => {
  console.error(err instanceof EnvError ? err.message : err)
  process.exit(1)
})
