/**
 * 阅读与写作偏好（ADR-0024、REQ-READ-001）与外观偏好（ADR-0049、REQ-UI-051）：`user_preferences` 一人一行，只能读写自己的（无跨人授权面，不经 can()）。
 * PATCH 按键合并（`reading || $patch`、`appearance || $set - $removed`）：多标签页 / 防抖写乱序也不会互相覆盖未改的键，故不要求 ifUpdatedAt。
 * 读取时附带工作区默认外观（organization.metadata.settings.appearance，REQ-WS-024），由客户端合成生效值。
 */
import { eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import {
  type AppearancePrefs,
  normalizeAppearance,
  normalizeReading,
  type patchPreferencesSchema,
  type ReadingPrefs,
} from '../../shared/schemas/preferences.ts'
import type { DbOrTx } from '../db/index.ts'
import { organization } from '../db/schema/auth.ts'
import { userPreferences } from '../db/schema/business.ts'

export interface PreferencesView {
  reading: ReadingPrefs
  /** 用户明确选过的外观键（缺的跟随工作区默认） */
  appearance: Partial<AppearancePrefs>
  /** 工作区默认外观（缺的跟随内置默认） */
  workspaceAppearance: Partial<AppearancePrefs>
}

/** 工作区默认外观：metadata 是 Better Auth 的 JSON 文本，坏值 / 缺失一律视为无默认。 */
export async function workspaceAppearance(
  db: DbOrTx,
  workspaceId: string | null | undefined,
): Promise<Partial<AppearancePrefs>> {
  if (!workspaceId) return {}
  const [ws] = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, workspaceId))
    .limit(1)
  try {
    const settings = ws?.metadata ? (JSON.parse(ws.metadata) as Record<string, unknown>) : {}
    return normalizeAppearance(settings?.appearance)
  } catch {
    return {}
  }
}

export async function getPreferences(
  db: DbOrTx,
  userId: string,
  workspaceId?: string | null,
): Promise<PreferencesView> {
  const [row] = await db
    .select({ reading: userPreferences.reading, appearance: userPreferences.appearance })
    .from(userPreferences)
    .where(sql`${userPreferences.userId} = ${userId}`)
  return {
    reading: normalizeReading(row?.reading),
    appearance: normalizeAppearance(row?.appearance),
    workspaceAppearance: await workspaceAppearance(db, workspaceId),
  }
}

export async function patchPreferences(
  db: DbOrTx,
  userId: string,
  input: z.infer<typeof patchPreferencesSchema>,
  workspaceId?: string | null,
): Promise<PreferencesView> {
  const reading = input.reading ?? {}
  const set: Record<string, string> = {}
  const removed: string[] = []
  for (const [k, v] of Object.entries(input.appearance ?? {}))
    if (v === null) removed.push(k)
    else if (v !== undefined) set[k] = v
  await db
    .insert(userPreferences)
    .values({ userId, reading, appearance: set })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        reading: sql`${userPreferences.reading} || ${JSON.stringify(reading)}::jsonb`,
        // jsonb - text[]：删除改回「跟随默认」的键
        // drizzle 会把 JS 数组展开成元组，空数组即语法错误：显式拼 ARRAY[...]::text[]
        appearance: sql`(${userPreferences.appearance} || ${JSON.stringify(set)}::jsonb) - ARRAY[${sql.join(
          removed.map((k) => sql`${k}`),
          sql`, `,
        )}]::text[]`,
        updatedAt: new Date(),
      },
    })
  return getPreferences(db, userId, workspaceId)
}
