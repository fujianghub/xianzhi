/**
 * 枚举单源（01 §3、§3.12、§4）。Drizzle CHECK 约束与 Zod 枚举都从这里取；新增值先改 01 再改这里。
 */

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'guest'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const SPACE_ROLES = ['admin', 'member', 'viewer'] as const
export type SpaceRole = (typeof SPACE_ROLES)[number]

export const SPACE_KINDS = ['project', 'learning', 'work'] as const
export type SpaceKind = (typeof SPACE_KINDS)[number]
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
  // ADR-0011 §3（2026-09-25）：产品优化 / 学习计划
  'optimize',
  'plan',
  // ADR-0016（2026-09-27）：自定义类型——具体名 / 色 / 状态列表在 entry_types，entries.type_id 指向它
  'custom',
] as const
export type EntryKind = (typeof ENTRY_KINDS)[number]
/** 内置类型（有固定 fields schema、图标、正文模板）；模板与「隐藏内置类型」只接受这些。 */
export const BUILTIN_ENTRY_KINDS = ENTRY_KINDS.filter(
  (k): k is Exclude<EntryKind, 'custom'> => k !== 'custom',
)
export type BuiltinEntryKind = Exclude<EntryKind, 'custom'>
/** 用户模板范围（ADR-0011 §2）：个人 / 工作区；内置模板不入表。 */
/** 模板范围：个人 · 工作区 · 内置（ADR-0038：所有者新增的内置模板入库为 builtin，全员可见、仅所有者可改） */
export const TEMPLATE_SCOPES = ['personal', 'workspace', 'builtin'] as const
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number]
/** 流转记录跟踪的记录属性（ADR-0033）。 */
export const TRACKED_ENTRY_FIELDS = ['status', 'priority', 'severity'] as const
export type TrackedEntryField = (typeof TRACKED_ENTRY_FIELDS)[number]
export const ENTRY_VISIBILITIES = ['private', 'space', 'workspace'] as const
export type EntryVisibility = (typeof ENTRY_VISIBILITIES)[number]

export const LINK_FROM_TYPES = ['entry', 'task', 'cycle'] as const
export const LINK_TO_TYPES = ['entry', 'task', 'cycle', 'external'] as const
export const LINK_KINDS = ['relates', 'blocks', 'caused_by', 'resolves', 'mentions'] as const
export type LinkKind = (typeof LINK_KINDS)[number]
/** 可手动建的关联类型（mentions 只由正文派生，REQ-LINK-001） */
export const MANUAL_LINK_KINDS = ['relates', 'blocks', 'caused_by', 'resolves'] as const
export type LinkFromType = (typeof LINK_FROM_TYPES)[number]

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

/** 01 §3.12 审计 action 枚举（32 项；+3 注册审批 ADR-0008；+3 用户管理 / 个人资料 ADR-0010；+1 删自定义类型 ADR-0016）；写入非枚举值即抛错（REQ-WS-017）。 */
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
  'space.merged',
  'task.permanently_deleted',
  'entry.permanently_deleted',
  'entry.restored',
  'export.requested',
  'export.done',
  'export.failed',
  'api_key.created',
  'api_key.revoked',
  'gc.failed',
  'backup.failed',
  // ADR-0016：删自定义类型会把其下记录转为随手记，留痕
  'entry_type.deleted',
  'entry_type.fields_changed',
  // ADR-0039：改 / 删模板自有字段时同步改了记录里的值，留痕
  'template.fields_changed',
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
