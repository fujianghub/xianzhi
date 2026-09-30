/**
 * Bug 属性的服务端规范化（ADR-0033、REQ-BUG-002）：优先级缺省 p2、发现日期缺省、解决日期随状态维护。
 * 只在 createEntry / patchEntry 里调用（批量 fields / retype 都经 patchEntry）；规范化后再按 strict schema 校验一次。
 */
import { eq } from 'drizzle-orm'
import { BUG_CLOSED_STATUSES, bugFields } from '../../shared/schemas/entryFields.ts'
import { splitExtraFields } from '../../shared/schemas/fieldDefs.ts'
import { formatLocalDate, isValidTimeZone, localDateOf } from '../../shared/tz.ts'
import type { DbOrTx } from '../db/index.ts'
import { user } from '../db/schema/auth.ts'
import { AppError } from '../lib/errors.ts'

type Fields = Record<string, unknown>

const DEFAULT_TZ = 'Asia/Shanghai'
export const isBugClosed = (status: unknown) => BUG_CLOSED_STATUSES.includes(String(status))

/**
 * @param prev 改前的 bug fields（新建或从别的类型改来时为 null）
 * @param next 已按 schema 校验过的目标 fields
 * @param dates.today 操作者时区的今天；dates.createdOn 记录创建日（从别的类型改来时作发现日期）
 */
export function normalizeBugFields(
  prev: Fields | null,
  next: Fields,
  dates: { today: string; createdOn?: string },
): Fields {
  const { today } = dates
  const out: Fields = { ...next }
  out.priority ??= prev?.priority ?? 'p2'
  // 发现日期：显式给出 > 原值 > 创建日（改类型）> 今天
  out.foundAt ??= prev?.foundAt ?? dates.createdOn ?? today
  if (String(out.foundAt) > today)
    throw AppError.validation([{ path: 'fields.foundAt', message: '发现日期不能晚于今天' }])
  if (!isBugClosed(out.status)) delete out.resolvedAt
  else if (prev && isBugClosed(prev.status)) out.resolvedAt ??= prev.resolvedAt ?? today
  else out.resolvedAt ??= today
  // 追加字段（x 键，ADR-0036）已按定义校验过，这里只校验内置字段
  const r = bugFields.safeParse(splitExtraFields(out).base)
  if (!r.success)
    throw AppError.validation(
      r.error.issues.map((i) => ({ path: ['fields', ...i.path].join('.'), message: i.message })),
    )
  return out
}

/** 操作者时区（会话注入 > user.timezone > Asia/Shanghai）。 */
export async function timezoneOf(
  db: DbOrTx,
  userId: string,
  given?: string | null,
): Promise<string> {
  if (given && isValidTimeZone(given)) return given
  const [u] = await db.select({ tz: user.timezone }).from(user).where(eq(user.id, userId)).limit(1)
  return u?.tz && isValidTimeZone(u.tz) ? u.tz : DEFAULT_TZ
}

export const localDay = (tz: string, at: Date) => formatLocalDate(localDateOf(tz, at))
