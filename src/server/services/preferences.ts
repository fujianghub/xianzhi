/**
 * 阅读与写作偏好（ADR-0024、REQ-READ-001）：`user_preferences` 一人一行，只能读写自己的（无跨人授权面，不经 can()）。
 * PATCH 按键合并（`reading || $patch`）：多标签页 / 防抖写乱序也不会互相覆盖未改的键，故不要求 ifUpdatedAt。
 */
import { sql } from 'drizzle-orm'
import type { z } from 'zod'
import {
  normalizeReading,
  type patchPreferencesSchema,
  type ReadingPrefs,
} from '../../shared/schemas/preferences.ts'
import type { DbOrTx } from '../db/index.ts'
import { userPreferences } from '../db/schema/business.ts'

export interface PreferencesView {
  reading: ReadingPrefs
}

export async function getPreferences(db: DbOrTx, userId: string): Promise<PreferencesView> {
  const [row] = await db
    .select({ reading: userPreferences.reading })
    .from(userPreferences)
    .where(sql`${userPreferences.userId} = ${userId}`)
  return { reading: normalizeReading(row?.reading) }
}

export async function patchPreferences(
  db: DbOrTx,
  userId: string,
  input: z.infer<typeof patchPreferencesSchema>,
): Promise<PreferencesView> {
  const patch = JSON.stringify(input.reading)
  const [row] = await db
    .insert(userPreferences)
    .values({ userId, reading: input.reading })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        reading: sql`${userPreferences.reading} || ${patch}::jsonb`,
        updatedAt: new Date(),
      },
    })
    .returning({ reading: userPreferences.reading })
  return { reading: normalizeReading(row?.reading) }
}
