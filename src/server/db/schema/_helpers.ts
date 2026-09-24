import { type SQL, sql } from 'drizzle-orm'
import { timestamp, uuid } from 'drizzle-orm/pg-core'
import { v7 } from 'uuid'

/** UUID v7 主键，应用侧生成（01 §1）。 */
export const pk = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => v7())

/**
 * 业务表时间列统一毫秒精度 timestamptz(3)（迁移 0004）：JS Date 只有毫秒，微秒精度会让
 * 游标 `(col, id) > (cursorISO, id)` 反复命中同一行、乐观锁 ifUpdatedAt 比较失真
 * （debug/2026-09-24-timestamp-precision-cursor）。
 */
const ts = () => timestamp({ withTimezone: true, precision: 3 })
export const createdAt = () => ts().notNull().defaultNow()
export const updatedAt = () => ts().notNull().defaultNow()
export const timestamptz = () => ts()

/** `col IN ('a','b')` CHECK 表达式。 */
export const inList = (col: unknown, values: readonly string[]): SQL =>
  sql`${col} in (${sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '))})`
