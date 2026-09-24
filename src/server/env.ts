/**
 * 环境变量（05 §2）。启动时一次性校验；缺必填项时列出字段名并退出（T0-004）。
 * 只在这里读 process.env；其他模块 import { env }。
 */
import { existsSync } from 'node:fs'
import { z } from 'zod'

const nonEmpty = z.string().trim().min(1)
const optionalStr = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional()
const port = z.coerce.number().int().min(1).max(65535)

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: nonEmpty.regex(/^postgres(ql)?:\/\//, '必须是 postgres:// URL'),
  APP_URL: z.url(),
  API_PORT: port.default(8010),
  COLLAB_PORT: port.default(8011),
  BETTER_AUTH_SECRET: nonEmpty.min(32, '至少 32 字符（openssl rand -base64 48）'),
  BETTER_AUTH_URL: z.url(),
  COLLAB_TOKEN_SECRET: nonEmpty.min(32, '至少 32 字符（openssl rand -base64 48）'),
  AGE_RECIPIENT: optionalStr,
  SMTP_HOST: optionalStr,
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: optionalStr,
  SMTP_PASS: optionalStr,
  MAIL_FROM: optionalStr,
  VAPID_PUBLIC_KEY: optionalStr,
  VAPID_PRIVATE_KEY: optionalStr,
  VAPID_SUBJECT: optionalStr,
  ANTHROPIC_API_KEY: optionalStr,
  AI_MODEL: optionalStr,
  DATA_DIR: nonEmpty.default('./data'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Env = z.infer<typeof envSchema>

/** 从 .env 加载（存在时；测试与容器由外部注入，不覆盖已存在的变量）。 */
export function loadDotenv(file = '.env'): void {
  if (process.env.XZ_SKIP_DOTENV === '1') return
  if (!existsSync(file)) return
  // Node ≥ 21：不覆盖已存在的变量
  const before = { ...process.env }
  process.loadEnvFile(file)
  for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v
}

/** 解析并校验；失败返回缺失 / 非法字段清单（供 CLI 与启动打印）。 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = envSchema.safeParse(source)
  if (r.success) return r.data
  const lines = r.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
  throw new EnvError(
    `环境变量校验失败（参考 .env.example）：\n${lines.join('\n')}`,
    r.error.issues.map((i) => String(i.path[0])),
  )
}

export class EnvError extends Error {
  readonly fields: string[]
  constructor(message: string, fields: string[]) {
    super(message)
    this.name = 'EnvError'
    this.fields = fields
  }
}

let cached: Env | undefined
/** 惰性单例：首次访问时加载 .env 并校验；校验失败直接抛 EnvError，由入口决定退出。 */
export function getEnv(): Env {
  if (!cached) {
    loadDotenv()
    cached = parseEnv()
  }
  return cached
}

/** 测试用：重置缓存。 */
export function resetEnvCache(): void {
  cached = undefined
}
