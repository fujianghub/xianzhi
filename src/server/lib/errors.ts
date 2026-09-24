/**
 * 错误信封（02 §3）：RFC 9457 Problem Details，`application/problem+json`。
 * 服务端只用 AppError；ForbiddenError（authz）与 ZodError 由 app.onError 映射。
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF'
  | 'SCOPE'
  | 'ACCOUNT_LOCKED'
  | 'NOT_FOUND'
  | 'CONFLICT_STALE'
  | 'CONFLICT_UNIQUE'
  | 'CONFLICT_LAST_OWNER'
  | 'CONFLICT_IN_FLIGHT'
  | 'INVITATION_EXPIRED'
  | 'LINK_EXPIRED'
  | 'PAYLOAD_TOO_LARGE'
  | 'QUOTA_EXCEEDED'
  | 'UNSUPPORTED_MEDIA'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'INTERNAL'

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
}

export interface ProblemExtra {
  errors?: { path: string; message: string }[]
  current?: unknown
  [k: string]: unknown
}

export class AppError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly extra: ProblemExtra
  constructor(status: number, code: ErrorCode, detail?: string, extra: ProblemExtra = {}) {
    super(detail ?? code)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.extra = extra
  }

  static badRequest = (detail?: string) => new AppError(400, 'BAD_REQUEST', detail)
  static unauthenticated = (detail?: string) => new AppError(401, 'UNAUTHENTICATED', detail)
  static forbidden = (detail?: string) => new AppError(403, 'FORBIDDEN', detail)
  static notFound = (detail?: string) => new AppError(404, 'NOT_FOUND', detail)
  static validation = (errors: { path: string; message: string }[], detail = '请求校验失败') =>
    new AppError(422, 'VALIDATION', detail, { errors })
  static rateLimited = (detail?: string) => new AppError(429, 'RATE_LIMITED', detail)
}

export interface Problem {
  type: string
  title: string
  status: number
  code: ErrorCode
  detail?: string
  requestId: string
  errors?: { path: string; message: string }[]
  current?: unknown
  [k: string]: unknown
}

export function toProblem(err: AppError, requestId: string): Problem {
  return {
    type: `https://xz.local/errors/${err.code.toLowerCase().replace(/_/g, '-')}`,
    title: TITLES[err.status] ?? 'Error',
    status: err.status,
    code: err.code,
    detail: err.message,
    requestId,
    ...err.extra,
  }
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json'
