/**
 * 测试库工具：清空全部业务与认证表（每文件 beforeAll），并提供 db 句柄。
 * 说明：05 §5 写「每文件事务回滚」；Better Auth 持有独立连接，无法共享一个事务，
 * 故改为文件级 TRUNCATE（fileParallelism=false 保证串行）。
 */
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../db/index.ts'

export const db = () => getDb()

export async function truncateAll(): Promise<void> {
  const d = getDb()
  const rows = await d.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename not like '\\_\\_drizzle%'`,
  )
  const names = rows.rows.map((r) => `"${r.tablename}"`)
  if (names.length)
    await d.execute(sql.raw(`truncate table ${names.join(', ')} restart identity cascade`))
}

export { closeDb }
