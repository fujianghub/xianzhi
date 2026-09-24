/**
 * 事件出箱（01 §3.10；CLAUDE.md 不变量 3）：service 内同事务 `emit()`；扇出由 pg-boss（T0-024）。
 */

import { type EventInput, eventInputSchema } from '../../shared/schemas/events.ts'
import type { DbOrTx } from '../db/index.ts'
import { events } from '../db/schema/business.ts'

export async function emit(db: DbOrTx, input: EventInput): Promise<string> {
  const v = eventInputSchema.parse(input) as EventInput
  const [row] = await db
    .insert(events)
    .values({
      workspaceId: v.workspaceId,
      kind: v.kind,
      actorId: v.actorId ?? null,
      targetType: v.targetType,
      targetId: v.targetId ?? null,
      payload: v.payload,
      visibilityScope: v.visibilityScope ?? {},
    })
    .returning({ id: events.id })
  if (!row) throw new Error('insert events returned nothing')
  return row.id
}
