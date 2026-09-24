/**
 * pino（05 §10、07 §2.9）：JSON 到 stdout；redact 敏感字段；请求日志不记 body。
 */
import pino, { type Logger } from 'pino'
import { getEnv } from '../env.ts'

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.token',
  '*.ydoc',
  '*.pmJson',
  'password',
  'token',
  'ydoc',
  'pmJson',
]

export function createLogger(
  opts: { level?: string; pretty?: boolean; destination?: pino.DestinationStream } = {},
): Logger {
  const base = {
    level: opts.level ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  }
  if (opts.destination) return pino(base, opts.destination)
  if (opts.pretty)
    return pino({
      ...base,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
    })
  return pino(base)
}

let root: Logger | undefined
export function getLogger(): Logger {
  if (!root) {
    const env = getEnv()
    root = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV === 'development' })
  }
  return root
}

/** 测试注入。 */
export function setLogger(l: Logger): void {
  root = l
}
