/** dev 入口：`tsx watch src/server/index.ts`（不 migrate；生产入口 start.ts）。 */
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { getAuth } from './auth.ts'
import { getDb, getPool } from './db/index.ts'
import { EnvError, getEnv } from './env.ts'
import { startWorker } from './jobs/index.ts'
import { relayToPg } from './lib/bus-pg.ts'
import { getEventBus } from './lib/event-bus.ts'
import { getLogger } from './lib/logger.ts'
import { configureMail } from './mail/transport.ts'

export function startApi() {
  const env = getEnv()
  const logger = getLogger()
  logger.info({ smtp: configureMail(env) }, 'mail transport')
  relayToPg(getEventBus(), getPool(), (e) => logger.error({ err: e }, 'bus relay failed'))
  const app = createApp({
    auth: getAuth(),
    db: getDb(),
    logger,
    appUrl: env.APP_URL,
    collabSecret: env.COLLAB_TOKEN_SECRET,
    staticDir:
      env.NODE_ENV === 'production'
        ? fileURLToPath(new URL('../client', import.meta.url))
        : undefined,
    dataDir: env.DATA_DIR,
    nodeEnv: env.NODE_ENV,
  })
  const server = serve({ fetch: app.fetch, port: env.API_PORT, hostname: '0.0.0.0' }, (info) => {
    logger.info({ port: info.port }, 'api listening')
  })
  // pg-boss worker 与 API 同进程（05 §3）；XZ_WORKER=0 可关闭（如验证实例）
  if (process.env.XZ_WORKER !== '0') {
    startWorker({
      db: getDb(),
      dataDir: env.DATA_DIR,
      databaseUrl: env.DATABASE_URL,
      ageRecipient: env.AGE_RECIPIENT,
      appUrl: env.APP_URL,
      logger: logger.child({ svc: 'worker' }),
      bus: getEventBus(),
    })
      .then(() => logger.info('worker started'))
      .catch((err) => logger.error({ err }, 'worker failed to start'))
  }
  return server
}

// 只有直接运行本文件（dev：tsx watch src/server/index.ts）时自启；start.ts 导入后自行调用
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  try {
    startApi()
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(err.message)
      process.exit(1)
    }
    throw err
  }
}
