import { z } from 'zod'
import { uuidSchema } from './common.ts'
import { ENTRY_KINDS, SEARCH_TYPES, TASK_STATUSES } from './enums.ts'
import { csv } from './query.ts'

export const searchQuery = z.object({
  q: z.string().trim().max(200).default(''), // 07 §5 长度 200
  types: csv(SEARCH_TYPES),
  spaceId: uuidSchema.optional(),
  kind: z.enum(ENTRY_KINDS).optional(),
  status: csv(TASK_STATUSES),
  tag: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursorTasks: z.string().max(512).optional(),
  cursorEntries: z.string().max(512).optional(),
  /** 空 q 时客户端回传的最近访问 id（逗号分隔，≤ 20），服务端按可见性过滤后返回（02 §4.1） */
  recent: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(uuidSchema).max(20).optional()),
})
