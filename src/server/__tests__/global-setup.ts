/** vitest globalSetup：确保 xz_test 存在并迁移到最新（05 §2「首次自动建库并迁移」）。 */
import { ensureDatabase, migrateDatabase } from '../db/migrate.ts'

export default async function setup(): Promise<void> {
  const url = process.env.XZ_TEST_DATABASE_URL ?? 'postgres://xz:xz@localhost:5433/xz_test'
  await ensureDatabase(url)
  await migrateDatabase(url)
}
