/**
 * 批量接口的失败项（ADR-0014 · 0021）：逐条执行时把异常归成 `{ id, code, message }`。
 * assertCan 抛的 ForbiddenError 平时由 app.onError 映射成 403；批量里逐条收集，这里同样归为 FORBIDDEN，
 * 不把 `forbidden: entry.write` 这类内部动作名透给前端。其它未知异常只给 INTERNAL，不带原文。
 */
import { ForbiddenError } from '../authz.ts'
import { AppError } from './errors.ts'

export interface BatchFailure {
  id: string
  code: string
  message: string
}

export function batchFailure(id: string, err: unknown, forbiddenMessage: string): BatchFailure {
  if (err instanceof AppError) return { id, code: err.code, message: err.message }
  if (err instanceof ForbiddenError) return { id, code: 'FORBIDDEN', message: forbiddenMessage }
  return { id, code: 'INTERNAL', message: '' }
}
