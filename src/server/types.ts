/** Hono Env 与请求上下文类型（02 §2）。 */
import type { Logger } from 'pino'
import type { ApiKeyScope, WorkspaceRole } from '../shared/schemas/enums.ts'
import type { MaybeActor } from './authz.ts'

export interface SessionUser {
  id: string
  email: string
  name: string
  displayName: string | null
  /** 用户名原样（displayUsername）；旧账号可能为空 */
  username: string | null
  /** 头像 URL（附件 md 变体） */
  image: string | null
  locale: string
  timezone: string
  weekStartsOn: number
  banned: boolean
}

export interface AppVariables {
  requestId: string
  log: Logger
  /** 已解析的用户；未登录 null */
  user: SessionUser | null
  workspaceId: string | null
  workspaceRole: WorkspaceRole | null
  /** authz 入参 */
  actor: MaybeActor
  authKind: 'session' | 'apikey' | null
  /** API Key 有效 scope = min(scope, 角色)（02 §2） */
  apiKeyScope: ApiKeyScope | null
}

export type AppEnv = { Variables: AppVariables }
