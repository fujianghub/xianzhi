/**
 * 枚举单源（01 §3、§3.12、§4）。Drizzle CHECK 约束与 Zod 枚举都从这里取；新增值先改 01 再改这里。
 */

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'guest'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const SPACE_ROLES = ['admin', 'member', 'viewer'] as const
export type SpaceRole = (typeof SPACE_ROLES)[number]

export const SPACE_KINDS = ['project', 'learning', 'work'] as const
export const SPACE_VISIBILITIES = ['workspace', 'members'] as const

export const TASK_STATUSES = ['inbox', 'todo', 'doing', 'blocked', 'done', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const CYCLE_KINDS = ['week', 'month', 'quarter'] as const
export const CYCLE_STATUSES = ['planning', 'active', 'reviewed'] as const

export const ENTRY_KINDS = [
  'decision',
  'iteration',
  'bug',
  'changelog',
  'journal',
  'note',
  'review',
] as const
export type EntryKind = (typeof ENTRY_KINDS)[number]
export const ENTRY_VISIBILITIES = ['private', 'space', 'workspace'] as const
export type EntryVisibility = (typeof ENTRY_VISIBILITIES)[number]

export const LINK_FROM_TYPES = ['entry', 'task', 'cycle'] as const
export const LINK_TO_TYPES = ['entry', 'task', 'cycle', 'external'] as const
export const LINK_KINDS = ['relates', 'blocks', 'caused_by', 'resolves', 'mentions'] as const

export const ATTACHMENT_TARGET_TYPES = ['entry', 'task', 'comment', 'user'] as const
export type AttachmentTargetType = (typeof ATTACHMENT_TARGET_TYPES)[number]
export const COMMENT_TARGET_TYPES = ['entry', 'task'] as const

export const EVENT_TARGET_TYPES = [
  'task',
  'entry',
  'cycle',
  'space',
  'comment',
  'member',
  'job',
  'system',
  'calendar_event',
] as const

export const EVENT_KINDS = [
  'entry.updated',
  'task.assigned',
  'task.unassigned',
  'task.due_soon',
  'task.completed',
  'task.uncompleted',
  'task.commented',
  'entry.commented',
  'mention.created',
  'space.invited',
  'member.joined',
  'member.requested',
  'workspace.owner_transferred',
  'cycle.review_due',
  'calendar.reminder',
  'system.export_done',
  'system.backup_failed',
  'system.outbox_stalled',
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const NOTIFICATION_CHANNELS = ['in_app', 'sse', 'webpush', 'email'] as const
export const DELIVERY_CHANNELS = ['in_app', 'webpush', 'email'] as const
export const DELIVERY_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const
export const DIGESTS = ['instant', 'daily'] as const

/** 01 §3.12 审计 action 枚举（32 项；+3 注册审批 ADR-0008；+3 用户管理 / 个人资料 ADR-0010）；写入非枚举值即抛错（REQ-WS-017）。 */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.login_failed',
  'auth.locked',
  'auth.password_reset',
  'auth.password_changed',
  'auth.2fa_enabled',
  'auth.2fa_disabled',
  'auth.2fa_reset_by_admin',
  'member.invited',
  'member.joined',
  'member.registered',
  'member.approved',
  'member.rejected',
  'member.role_changed',
  'member.suspended',
  'member.unsuspended',
  'member.removed',
  'member.content_transferred',
  'user.created',
  'user.updated',
  'user.deleted',
  'workspace.owner_transferred',
  'workspace.settings_changed',
  'space.deleted',
  'space.permanently_deleted',
  'task.permanently_deleted',
  'entry.permanently_deleted',
  'export.requested',
  'export.done',
  'export.failed',
  'api_key.created',
  'api_key.revoked',
  'gc.failed',
  'backup.failed',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const API_KEY_SCOPES = ['read', 'write', 'admin'] as const
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

/**
 * 04 §2.1 空间 / 标签 / 日历 9 色鲜艳色板（ADR-0010；token `--xz-palette-<name>-solid/-bg/-fg`）；中英对照见 glossary。
 */
export const PALETTE_COLORS = [
  'blue',
  'orange',
  'yellow',
  'red',
  'green',
  'purple',
  'pink',
  'cyan',
  'gray',
] as const
export type PaletteColor = (typeof PALETTE_COLORS)[number]

/** 注册申请状态（ADR-0008；驳回即删号，不留 rejected 行）。 */
export const JOIN_REQUEST_STATUSES = ['pending', 'approved'] as const

/** 日程重复频率（ADR-0009；RRULE FREQ 子集）。 */
export const CAL_FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const
export type CalFreq = (typeof CAL_FREQS)[number]

export const TASK_PRIORITIES = [0, 1, 2, 3, 4] as const
export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly'] as const
export const EXPORT_SCOPES = ['workspace', 'space', 'entry'] as const
export const EXPORT_FORMATS = ['zip', 'md', 'html'] as const
export const ENTRY_EXPORT_FORMATS = ['md', 'html'] as const
export const SEARCH_TYPES = ['task', 'entry'] as const
