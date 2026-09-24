/** 作业类型（独立文件，避免 index ↔ outbox 循环依赖）。 */
import type pg from 'pg'
import type { PgBoss } from 'pg-boss'
import type { Logger } from 'pino'
import type { Db } from '../db/index.ts'
import type { EventBus } from '../lib/event-bus.ts'

export interface JobCtx {
  db: Db
  dataDir: string
  databaseUrl: string
  ageRecipient?: string
  appUrl?: string
  pool?: pg.Pool
  logger: Logger
  bus?: EventBus
  boss?: PgBoss
  now?: Date
}

export interface JobDef {
  name: string
  cron?: string
  policy?: 'standard' | 'singleton' | 'stately' | 'short'
  retryLimit?: number
  handler: (ctx: JobCtx, data: Record<string, unknown>, jobId: string) => Promise<unknown>
}
