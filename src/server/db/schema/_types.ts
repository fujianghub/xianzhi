import { customType } from 'drizzle-orm/pg-core'

/** tsvector：只写不读（服务端派生列）。 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
})

/** bytea：Yjs 二进制。 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

/** pgvector 向量列（二期使用，一期建列）。 */
export const vector = (dims: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${dims})`,
    toDriver: (v) => `[${v.join(',')}]`,
    fromDriver: (v) => v.slice(1, -1).split(',').map(Number),
  })
