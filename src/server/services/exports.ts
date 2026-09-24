/**
 * 导出请求与作业查询（02 §8、REQ-EXPORT-001 · 008）：路由 → 这里校验权限并入队；执行见 jobs/export.ts。
 */
import { stat } from 'node:fs/promises'
import type { z } from 'zod'
import type { createExportSchema } from '../../shared/schemas/exports.ts'
import { type Actor, assertCan, can } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { buildExport, type ExportJobData, type ExportResult, fileSlug } from '../jobs/export.ts'
import { AppError } from '../lib/errors.ts'
import { dataPath } from '../lib/files.ts'
import type { JobQueue } from '../lib/job-queue.ts'
import { audit } from './audit.ts'
import { loadEntry, loadSpaceRef } from './entries.ts'

export interface ExportCtx {
  actor: Actor
  workspaceId: string
  dataDir: string
  queue: JobQueue
}

export const EXPORT_QUEUE = 'export.run'

/** POST /exports → 202 { jobId }：scope=workspace 仅 owner/admin（403）；space / entry 不可见 → 404。 */
export async function requestExport(
  db: Db,
  ctx: ExportCtx,
  input: z.infer<typeof createExportSchema>,
) {
  if (input.scope === 'workspace') assertCan(ctx.actor, 'workspace.manage', null)
  if (input.scope === 'space') {
    const sp = await loadSpaceRef(db, ctx.actor, input.id as string)
    if (!sp || sp.row.workspaceId !== ctx.workspaceId || !can(ctx.actor, 'space.read', sp.ref))
      throw AppError.notFound('空间不存在')
  }
  if (input.scope === 'entry') {
    const e = await loadEntry(db, ctx.actor, input.id as string)
    if (!e || e.row.workspaceId !== ctx.workspaceId || !can(ctx.actor, 'entry.read', e.ref))
      throw AppError.notFound('记录不存在')
  }
  const data: ExportJobData = {
    userId: ctx.actor.id,
    workspaceId: ctx.workspaceId,
    scope: input.scope,
    id: input.id,
    format: input.format,
  }
  const jobId = await ctx.queue.send(EXPORT_QUEUE, data as unknown as Record<string, unknown>)
  await audit(db, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.actor.id,
    action: 'export.requested',
    targetType: 'job',
    targetId: jobId,
    meta: { scope: input.scope, id: input.id ?? null, format: input.format },
  })
  return { jobId }
}

export interface JobView {
  id: string
  kind: 'export'
  status: 'queued' | 'active' | 'completed' | 'failed'
  progress: number
  resultUrl?: string
  fileName?: string
  sizeBytes?: number
  error?: string
  createdAt: string
  completedAt: string | null
}

async function ownJob(ctx: ExportCtx, id: string) {
  const j = await ctx.queue.get(EXPORT_QUEUE, id).catch(() => null)
  // 只有发起人可见；他人 / 不存在 → 404（不泄露存在性）
  if (!j || j.data.userId !== ctx.actor.id || j.data.workspaceId !== ctx.workspaceId)
    throw AppError.notFound('作业不存在')
  return j
}

/** GET /jobs/:id（REQ-EXPORT-001）。 */
export async function getJob(ctx: ExportCtx, id: string): Promise<JobView> {
  const j = await ownJob(ctx, id)
  const out = (j.output ?? {}) as Partial<ExportResult> & { message?: string }
  const v: JobView = {
    id: j.id,
    kind: 'export',
    status: j.state,
    progress: j.state === 'completed' ? 100 : j.state === 'active' ? 50 : 0,
    createdAt: j.createdAt,
    completedAt: j.completedAt,
  }
  if (j.state === 'completed')
    Object.assign(v, {
      resultUrl: `/api/v1/jobs/${j.id}/download`,
      fileName: out.fileName,
      sizeBytes: out.sizeBytes,
    })
  if (j.state === 'failed') v.error = '导出失败，请稍后重试'
  return v
}

/** GET /jobs/:id/download：仅发起人；产物过期被清理 → 404。 */
export async function jobDownload(ctx: ExportCtx, id: string) {
  const j = await ownJob(ctx, id)
  const out = j.output as Partial<ExportResult> | null
  if (j.state !== 'completed' || !out?.fileKey) throw AppError.notFound('产物不存在')
  const path = dataPath(ctx.dataDir, out.fileKey)
  const st = await stat(path).catch(() => null)
  if (!st) throw AppError.notFound('产物已过期')
  return {
    path,
    size: st.size,
    fileName: out.fileName ?? 'export.zip',
    mime: out.mime ?? 'application/zip',
  }
}

/** POST /entries/:id/export?format=md|html（REQ-EXPORT-003 · 006）：单篇同步导出。 */
export async function exportEntryNow(
  db: Db,
  ctx: Omit<ExportCtx, 'queue'>,
  id: string,
  format: 'md' | 'html',
) {
  const e = await loadEntry(db, ctx.actor, id)
  if (!e || e.row.workspaceId !== ctx.workspaceId || !can(ctx.actor, 'entry.read', e.ref))
    throw AppError.notFound('记录不存在')
  const out = await buildExport(db, ctx.dataDir, ctx.actor, {
    userId: ctx.actor.id,
    workspaceId: ctx.workspaceId,
    scope: 'entry',
    id,
    format,
  })
  if (!('single' in out) || !out.single) throw new Error('单篇导出应为单文件')
  return { ...out.single, name: out.single.name || `${fileSlug(e.row.title)}.${format}` }
}
