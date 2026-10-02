/**
 * 一期业务表（01 §3.1–3.13）。列名 = 01 §3 的 snake_case（db 实例 casing: 'snake_case' 自动映射）。
 * 枚举用 text + CHECK（01 §1）；主键 UUID v7 应用侧生成。认证域表见 ./auth.ts（Better Auth 生成）。
 */
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { BaseFieldOverrides } from '../../../shared/schemas/baseFields.ts'
import {
  ATTACHMENT_TARGET_TYPES,
  AUDIT_ACTIONS,
  BUILTIN_ENTRY_KINDS,
  COMMENT_TARGET_TYPES,
  CYCLE_KINDS,
  CYCLE_STATUSES,
  DELIVERY_CHANNELS,
  DELIVERY_STATUSES,
  DIGESTS,
  ENTRY_KINDS,
  ENTRY_VISIBILITIES,
  EVENT_KINDS,
  EVENT_TARGET_TYPES,
  JOIN_REQUEST_STATUSES,
  LINK_FROM_TYPES,
  LINK_KINDS,
  LINK_TO_TYPES,
  PALETTE_COLORS,
  SPACE_KINDS,
  SPACE_ROLES,
  SPACE_VISIBILITIES,
  TASK_LIST_KINDS,
  TASK_STATUSES,
  TEMPLATE_SCOPES,
  TRACKED_ENTRY_FIELDS,
} from '../../../shared/schemas/enums.ts'
import type { FieldDef } from '../../../shared/schemas/fieldDefs.ts'
import { createdAt, inList, pk, timestamptz, updatedAt } from './_helpers.ts'
import { bytea, tsvector, vector } from './_types.ts'
import { organization, user } from './auth.ts'

const orgRef = () =>
  text()
    .notNull()
    .references(() => organization.id)
const userRef = () => text().references(() => user.id)

// ---------- 3.0 space_groups（ADR-0012 大类）----------
/** 大类（产品开发 / 技术学习规划 / 生活…）：工作区共享、管理员维护；删大类 → 其下空间变「未分类」。 */
export const spaceGroups = pgTable(
  'space_groups',
  {
    id: pk(),
    workspaceId: orgRef(),
    name: text().notNull(),
    color: text(),
    icon: text(),
    description: text(),
    // 同 spaces.sort_key：列级 COLLATE "C"（迁移 0010 手写）
    sortKey: text().notNull(),
    createdBy: userRef(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('space_groups_workspace_name_uq').on(t.workspaceId, t.name),
    check('space_groups_color_ck', sql`${t.color} is null or ${inList(t.color, PALETTE_COLORS)}`),
  ],
)

// ---------- 3.1 spaces ----------
export const spaces = pgTable(
  'spaces',
  {
    id: pk(),
    workspaceId: orgRef(),
    name: text().notNull(),
    slug: text().notNull(),
    kind: text().notNull(),
    icon: text(),
    color: text(),
    visibility: text().notNull(),
    isPersonal: boolean().notNull().default(false),
    description: text(),
    /** 所属大类（ADR-0012）；null = 未分类；个人空间恒为 null */
    groupId: uuid().references(() => spaceGroups.id, { onDelete: 'set null' }),
    /** 在此空间新建记录时的默认类型（ADR-0019）：仅内置类型；null = 随笔 */
    defaultKind: text(),
    /** 在此空间新建记录时的默认模板（ADR-0019）：`builtin:<key>` 或工作区模板 uuid；个人模板不可（他人用不了） */
    defaultTemplateId: text(),
    /** 默认类型为自定义 / 空间类型时（ADR-0036）；与 defaultKind 互斥（service 校验） */
    defaultTypeId: uuid().references((): AnyPgColumn => entryTypes.id, { onDelete: 'set null' }),
    /**
     * 启用类型清单（ADR-0036、REQ-KB-014）：有序，元素为内置 kind 名或 `type:<uuid>`；
     * null = 按空间种类推导的默认（不做数据迁移）。无外键：删类型时 service 清理，读时忽略悬空项。
     */
    enabledKinds: jsonb().$type<string[]>(),
    // 列级 COLLATE "C"（drizzle/0003_sort_key_collate_c.sql）：fractional-indexing 键须按字节序比较
    sortKey: text().notNull(),
    archivedAt: timestamptz(),
    deletedAt: timestamptz(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('spaces_workspace_slug_uq').on(t.workspaceId, t.slug),
    uniqueIndex('spaces_personal_uq').on(t.workspaceId, t.createdBy).where(sql`${t.isPersonal}`),
    check('spaces_kind_ck', inList(t.kind, SPACE_KINDS)),
    check(
      'spaces_default_kind_ck',
      sql`${t.defaultKind} is null or ${inList(t.defaultKind, BUILTIN_ENTRY_KINDS)}`,
    ),
    check('spaces_visibility_ck', inList(t.visibility, SPACE_VISIBILITIES)),
  ],
)

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: userRef().notNull(),
    role: text().notNull(),
    joinedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.userId] }),
    check('space_members_role_ck', inList(t.role, SPACE_ROLES)),
  ],
)

// ---------- 3.3 cycles（tasks 引用它，先声明） ----------
export const cycles = pgTable(
  'cycles',
  {
    id: pk(),
    workspaceId: orgRef(),
    ownerId: userRef().notNull(),
    kind: text().notNull(),
    startDate: date().notNull(),
    endDate: date().notNull(),
    title: text().notNull(),
    goals: jsonb().notNull().default(sql`'[]'::jsonb`),
    reviewEntryId: uuid(),
    status: text().notNull().default('planning'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('cycles_owner_kind_start_uq').on(t.ownerId, t.kind, t.startDate),
    check('cycles_kind_ck', inList(t.kind, CYCLE_KINDS)),
    check('cycles_status_ck', inList(t.status, CYCLE_STATUSES)),
  ],
)

// ---------- 3.2 tasks ----------
export const tasks = pgTable(
  'tasks',
  {
    id: pk(),
    workspaceId: orgRef(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    parentId: uuid(),
    title: text().notNull(),
    descriptionPm: jsonb(),
    descriptionPlain: text(),
    status: text().notNull().default('inbox'),
    priority: smallint().notNull().default(0),
    dueAt: timestamptz(),
    scheduledAt: timestamptz(),
    completedAt: timestamptz(),
    estimateMinutes: integer(),
    assigneeId: userRef(),
    creatorId: userRef().notNull(),
    cycleId: uuid().references(() => cycles.id, { onDelete: 'set null' }),
    recurrence: jsonb(),
    // 列级 COLLATE "C"（drizzle/0003_sort_key_collate_c.sql）：fractional-indexing 键须按字节序比较
    sortKey: text().notNull(),
    tsv: tsvector(),
    deletedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tasks_space_status_sort_idx').on(t.spaceId, t.status, t.sortKey),
    index('tasks_assignee_status_due_idx').on(t.assigneeId, t.status, t.dueAt),
    index('tasks_cycle_idx').on(t.cycleId),
    index('tasks_tsv_idx').using('gin', t.tsv),
    // 标题子串兜底（02 §4.1、REQ-SEARCH-003）
    index('tasks_title_trgm_idx').using('gin', sql`${t.title} gin_trgm_ops`),
    check('tasks_status_ck', inList(t.status, TASK_STATUSES)),
    check('tasks_priority_ck', sql`${t.priority} between 0 and 4`),
  ],
)

export const taskWatchers = pgTable(
  'task_watchers',
  {
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] })],
)

// ---------- 3.4c entry_types（ADR-0016 自定义记录类型）----------
/** 工作区共享的自定义类型：名字唯一、9 色板、可选状态列表（有序，0–12 项）；记录 kind = 'custom' 且 type_id 指向它。 */
export const entryTypes = pgTable(
  'entry_types',
  {
    id: pk(),
    workspaceId: orgRef(),
    name: text().notNull(),
    color: text().notNull(),
    statuses: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** 状态颜色（ADR-0036）：状态名 → 色板色；未设按位置轮换 */
    statusColors: jsonb().$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    /** 字段定义（ADR-0036、REQ-ENTRY-027）：值存于 entries.fields 的 x 键 */
    fieldDefs: jsonb().$type<FieldDef[]>().notNull().default(sql`'[]'::jsonb`),
    /** 空间类型（ADR-0036）：非 null = 属于该空间、空间成员共用；null = 个人类型（ADR-0017） */
    spaceId: uuid().references(() => spaces.id, { onDelete: 'cascade' }),
    /** 所有者（ADR-0017：个人类型只有本人能用来新建 / 改类型、能管理；空间类型为创建者，仅作记录） */
    createdBy: userRef(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // 个人类型按人唯一（ADR-0017）；空间类型按空间唯一（ADR-0036）
    uniqueIndex('entry_types_owner_name_uq')
      .on(t.workspaceId, t.createdBy, t.name)
      .where(sql`${t.spaceId} is null`),
    uniqueIndex('entry_types_space_name_uq')
      .on(t.spaceId, t.name)
      .where(sql`${t.spaceId} is not null`),
    check('entry_types_color_ck', inList(t.color, PALETTE_COLORS)),
  ],
)

/**
 * 内置类型的工作区覆盖（ADR-0017）：改名 / 改色 / 已删除（删除时其下记录已转走；可恢复）。
 * 取代 hidden_entry_kinds（迁移时隐藏 → 已删除）。
 */
export const entryKindOverrides = pgTable(
  'entry_kind_overrides',
  {
    workspaceId: orgRef(),
    kind: text().notNull(),
    name: text(),
    color: text(),
    deleted: boolean().notNull().default(false),
    /** 内置类型追加的字段（ADR-0036、REQ-ENTRY-028）：工作区统一，仅所有者维护 */
    fieldDefs: jsonb().$type<FieldDef[]>().notNull().default(sql`'[]'::jsonb`),
    /** 内置字段覆盖（ADR-0042、REQ-ENTRY-034）：字段名 → { hidden?, label?, options? } */
    baseFields: jsonb().$type<BaseFieldOverrides>().notNull().default(sql`'{}'::jsonb`),
    /** 属性顺序（内置字段名与追加字段 x 键混排，ADR-0042） */
    fieldOrder: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.kind] }),
    check('entry_kind_overrides_kind_ck', inList(t.kind, BUILTIN_ENTRY_KINDS)),
    check(
      'entry_kind_overrides_color_ck',
      sql`${t.color} is null or ${inList(t.color, PALETTE_COLORS)}`,
    ),
  ],
)

// ---------- 3.4 entries ----------
export const entries = pgTable(
  'entries',
  {
    id: pk(),
    workspaceId: orgRef(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces.id),
    kind: text().notNull(),
    /** 自定义类型（ADR-0016）：kind = 'custom' 时必填，否则为空；删类型前 service 先把记录转为随手记 */
    typeId: uuid().references(() => entryTypes.id),
    /**
     * 来源模板（ADR-0039）：`builtin:<key>` 或用户模板 uuid，新建时写入、之后不改；无外键（代码内置模板不入表）。
     * 记录的有效字段 = 类型字段 − 该模板移除的 + 该模板自有的；模板被删时 service 同事务置空。
     */
    templateId: text(),
    title: text().notNull(),
    fields: jsonb().notNull().default(sql`'{}'::jsonb`),
    visibility: text().notNull(),
    authorId: userRef().notNull(),
    ydoc: bytea().notNull(),
    ydocVersion: integer().notNull().default(0),
    pmJson: jsonb(),
    plain: text(),
    tsv: tsvector(),
    wordCount: integer(),
    derivedAt: timestamptz(),
    derivedError: text(),
    embedding: vector(1024)(),
    editorSchemaVersion: integer().notNull().default(1),
    pinned: boolean().notNull().default(false),
    /** 目录树（ADR-0012）：父页（同空间）；硬删父页时置空 */
    parentId: uuid(),
    /** 目录内同级顺序（fractional-indexing，列级 COLLATE "C"）；null = 不在目录里（「其余记录」） */
    treeOrder: text(),
    archivedAt: timestamptz(),
    deletedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('entries_space_kind_updated_idx').on(t.spaceId, t.kind, sql`${t.updatedAt} desc`),
    index('entries_author_updated_idx').on(t.authorId, sql`${t.updatedAt} desc`),
    index('entries_tsv_idx').using('gin', t.tsv),
    index('entries_title_trgm_idx').using('gin', sql`${t.title} gin_trgm_ops`),
    index('entries_fields_idx').using('gin', sql`${t.fields} jsonb_path_ops`),
    index('entries_space_tree_idx').on(t.spaceId, t.parentId, t.treeOrder),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: 'entries_parent_id_fk',
    }).onDelete('set null'),
    check('entries_kind_ck', inList(t.kind, ENTRY_KINDS)),
    check('entries_custom_type_ck', sql`(${t.kind} = 'custom') = (${t.typeId} is not null)`),
    index('entries_type_idx').on(t.typeId),
    index('entries_template_idx').on(t.templateId).where(sql`${t.templateId} is not null`),
    check('entries_visibility_ck', inList(t.visibility, ENTRY_VISIBILITIES)),
  ],
)

export const entrySnapshots = pgTable(
  'entry_snapshots',
  {
    id: pk(),
    entryId: uuid()
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    ydocVersion: integer().notNull(),
    snapshot: bytea().notNull(),
    label: text(),
    createdBy: userRef(),
    createdAt: createdAt(),
  },
  (t) => [index('entry_snapshots_entry_created_idx').on(t.entryId, sql`${t.createdAt} desc`)],
)

// ---------- 3.5b entry_templates（ADR-0011 §2）----------
/** 用户模板：个人（仅自己）/ 工作区（全员可用）；内置模板在代码（shared/editor/builtin-templates.ts），不入表。 */
export const entryTemplates = pgTable(
  'entry_templates',
  {
    id: pk(),
    workspaceId: orgRef(),
    ownerId: text()
      .notNull()
      .references(() => user.id),
    scope: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(''),
    kind: text().notNull(),
    /** 绑自定义 / 空间类型时（ADR-0036、REQ-TPL-011）；类型删除前 service 把模板转随笔 */
    typeId: uuid().references(() => entryTypes.id, { onDelete: 'set null' }),
    spaceKind: text(),
    body: jsonb().notNull(),
    fields: jsonb().notNull().default({}),
    /** 模板自有字段（ADR-0039、REQ-TPL-016）：值存于用它建的记录的 fields（x 键）与本模板的预填 fields */
    fieldDefs: jsonb().$type<FieldDef[]>().notNull().default(sql`'[]'::jsonb`),
    /** 本模板移除的类型字段名（ADR-0039、REQ-TPL-017）：类型的可省内置字段或其自定义字段键 */
    hiddenFields: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('entry_templates_workspace_scope_idx').on(t.workspaceId, t.scope),
    index('entry_templates_owner_idx').on(t.ownerId),
    check('entry_templates_scope_ck', inList(t.scope, TEMPLATE_SCOPES)),
    check('entry_templates_kind_ck', inList(t.kind, ENTRY_KINDS)),
    check(
      'entry_templates_custom_type_ck',
      sql`(${t.kind} = 'custom') = (${t.typeId} is not null)`,
    ),
    check(
      'entry_templates_space_kind_ck',
      sql`${t.spaceKind} is null or ${inList(t.spaceKind, SPACE_KINDS)}`,
    ),
  ],
)

// ---------- 3.5b' builtin_template_overrides（ADR-0038）----------
/**
 * 代码内置模板（`builtin:<key>`）的工作区覆盖：所有者改的名 / 描述 / 类型 / 适用空间 / 预填 fields / 正文，
 * 以及软删除（可恢复）。null 列 = 沿用代码默认；删整行 = 恢复默认。仅所有者维护（template.manage，scope builtin）。
 */
export const builtinTemplateOverrides = pgTable(
  'builtin_template_overrides',
  {
    workspaceId: orgRef(),
    key: text().notNull(),
    name: text(),
    description: text(),
    kind: text(),
    spaceKinds: jsonb().$type<string[]>(),
    fields: jsonb().$type<Record<string, unknown>>(),
    /** 模板自有字段 / 移除的类型字段（ADR-0039）；null = 代码默认（都为空） */
    fieldDefs: jsonb().$type<FieldDef[]>(),
    hiddenFields: jsonb().$type<string[]>(),
    body: jsonb(),
    deleted: boolean().notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.key] }),
    check(
      'builtin_template_overrides_kind_ck',
      sql`${t.kind} is null or ${inList(t.kind, BUILTIN_ENTRY_KINDS)}`,
    ),
  ],
)

// ---------- 3.5c entry_favorites（ADR-0014 收藏）----------
/** 个人收藏：仅本人可见；记录硬删时级联。 */
export const entryFavorites = pgTable(
  'entry_favorites',
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entryId: uuid()
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.entryId] }),
    index('entry_favorites_user_idx').on(t.userId, sql`${t.createdAt} desc`),
  ],
)

// ---------- 3.5d entry_field_changes（ADR-0033 流转）----------
/** 记录 status / priority / severity 的变化：entries service 同事务写入；记录硬删时级联。 */
export const entryFieldChanges = pgTable(
  'entry_field_changes',
  {
    id: pk(),
    workspaceId: orgRef(),
    entryId: uuid()
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    actorId: userRef(),
    field: text().notNull(),
    fromValue: text(),
    toValue: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('entry_field_changes_entry_idx').on(t.entryId, t.createdAt),
    index('entry_field_changes_ws_field_idx').on(t.workspaceId, t.field, t.createdAt),
    check('entry_field_changes_field_ck', inList(t.field, TRACKED_ENTRY_FIELDS)),
  ],
)

// ---------- 3.5e entry_views（ADR-0033 保存视图）----------
/** 个人保存的记录页筛选（同标签：只有本人看得到、管得了）；spaceId 非空 = 在该空间记录页打开。 */
export const entryViews = pgTable(
  'entry_views',
  {
    id: pk(),
    workspaceId: orgRef(),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    spaceId: uuid().references(() => spaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    search: jsonb().notNull().default({}),
    sortKey: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('entry_views_owner_idx').on(t.workspaceId, t.ownerId, t.sortKey)],
)

// ---------- 3.6 links ----------
export const links = pgTable(
  'links',
  {
    id: pk(),
    workspaceId: orgRef(),
    fromType: text().notNull(),
    fromId: uuid().notNull(),
    toType: text().notNull(),
    toId: uuid(),
    externalUrl: text(),
    externalTitle: text(),
    kind: text().notNull(),
    createdBy: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('links_tuple_uq').on(
      t.fromType,
      t.fromId,
      t.toType,
      sql`coalesce(${t.toId}::text, ${t.externalUrl})`,
      t.kind,
    ),
    index('links_to_idx').on(t.toType, t.toId),
    check('links_from_type_ck', inList(t.fromType, LINK_FROM_TYPES)),
    check('links_to_type_ck', inList(t.toType, LINK_TO_TYPES)),
    check('links_kind_ck', inList(t.kind, LINK_KINDS)),
    check(
      'links_external_ck',
      sql`(${t.toType} = 'external' and ${t.toId} is null and ${t.externalUrl} is not null) or (${t.toType} <> 'external' and ${t.toId} is not null)`,
    ),
  ],
)

// ---------- 3.7 tags ----------
export const tags = pgTable(
  'tags',
  {
    id: pk(),
    workspaceId: orgRef(),
    name: text().notNull(),
    color: text().notNull(),
    /** 所有者（ADR-0017：标签是个人的，只有本人看得到、用得了、管得了）；迁移 0016 把无主旧标签归给工作区所有者 */
    createdBy: userRef(),
    createdAt: createdAt(),
  },
  (t) => [
    // 标签是个人的（ADR-0017）：同一人名下不重名；不同人可各有同名标签
    unique('tags_owner_name_uq').on(t.workspaceId, t.createdBy, t.name),
    index('tags_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
)

export const taskTags = pgTable(
  'task_tags',
  {
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] })],
)

/**
 * 个人清单（ADR-0044、REQ-TASK-029）：任务的按人分类（同标签按人私有，ADR-0017）。
 * kind = list（带色）/ folder（无色，只装清单，深度 1）；删文件夹 → 其下清单回到根；删清单 → 归类随之删除，任务不动。
 */
export const taskLists = pgTable(
  'task_lists',
  {
    id: pk(),
    workspaceId: orgRef(),
    ownerId: userRef().notNull(),
    kind: text().notNull(),
    parentId: uuid().references((): AnyPgColumn => taskLists.id, { onDelete: 'set null' }),
    name: text().notNull(),
    color: text(),
    // 列级 COLLATE "C"（0026 手写）：fractional-indexing 键须按字节序比较
    sortKey: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('task_lists_owner_name_uq').on(t.workspaceId, t.ownerId, t.kind, t.name),
    index('task_lists_owner_idx').on(t.ownerId, t.sortKey),
    check('task_lists_kind_ck', inList(t.kind, TASK_LIST_KINDS)),
    check('task_lists_color_ck', sql`${t.color} is null or ${inList(t.color, PALETTE_COLORS)}`),
    check('task_lists_folder_color_ck', sql`(${t.kind} = 'folder') = (${t.color} is null)`),
  ],
)

/**
 * 任务归入谁的哪个清单（ADR-0044）：按人一行——同一任务各人各归各的，互不覆盖；不动 tasks 行（不改 updatedAt）。
 */
export const taskListItems = pgTable(
  'task_list_items',
  {
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: userRef().notNull(),
    listId: uuid()
      .notNull()
      .references(() => taskLists.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index('task_list_items_list_idx').on(t.listId),
  ],
)

export const entryTags = pgTable(
  'entry_tags',
  {
    entryId: uuid()
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.tagId] })],
)

// ---------- 3.8 attachments ----------
export const attachments = pgTable(
  'attachments',
  {
    id: pk(),
    workspaceId: orgRef(),
    ownerId: userRef().notNull(),
    targetType: text(),
    targetId: uuid(),
    filename: text().notNull(),
    mime: text().notNull(),
    size: integer().notNull(),
    sha256: text().notNull(),
    storageKey: text().notNull(),
    width: integer(),
    height: integer(),
    blurhash: text(),
    variants: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    index('attachments_target_idx').on(t.targetType, t.targetId),
    unique('attachments_owner_sha_uq').on(t.workspaceId, t.ownerId, t.sha256),
    check('attachments_target_type_ck', inList(t.targetType, ATTACHMENT_TARGET_TYPES)),
    check('attachments_target_pair_ck', sql`(${t.targetType} is null) = (${t.targetId} is null)`),
  ],
)

// ---------- 3.9 comments / mentions ----------
export const comments = pgTable(
  'comments',
  {
    id: pk(),
    workspaceId: orgRef(),
    targetType: text().notNull(),
    targetId: uuid().notNull(),
    threadId: uuid().notNull(),
    parentId: uuid(),
    authorId: userRef().notNull(),
    bodyPm: jsonb().notNull(),
    bodyPlain: text().notNull().default(''),
    orphaned: boolean().notNull().default(false),
    resolvedAt: timestamptz(),
    resolvedBy: userRef(),
    deletedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('comments_target_created_idx').on(t.targetType, t.targetId, t.createdAt),
    index('comments_thread_idx').on(t.threadId),
    check('comments_target_type_ck', inList(t.targetType, COMMENT_TARGET_TYPES)),
  ],
)

export const mentions = pgTable(
  'mentions',
  {
    id: pk(),
    commentId: uuid().references(() => comments.id, { onDelete: 'cascade' }),
    entryId: uuid().references(() => entries.id, { onDelete: 'cascade' }),
    userId: userRef().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('mentions_one_source_ck', sql`(${t.commentId} is null) <> (${t.entryId} is null)`),
    index('mentions_user_idx').on(t.userId),
  ],
)

// ---------- 3.10 events ----------
export const events = pgTable(
  'events',
  {
    id: pk(),
    workspaceId: orgRef(),
    kind: text().notNull(),
    actorId: userRef(),
    targetType: text().notNull(),
    targetId: uuid(),
    payload: jsonb().notNull(),
    visibilityScope: jsonb().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    processedAt: timestamptz(),
  },
  (t) => [
    index('events_pending_idx').on(t.processedAt).where(sql`${t.processedAt} is null`),
    index('events_workspace_created_idx').on(t.workspaceId, sql`${t.createdAt} desc`),
    check('events_kind_ck', inList(t.kind, EVENT_KINDS)),
    check('events_target_type_ck', inList(t.targetType, EVENT_TARGET_TYPES)),
  ],
)

// ---------- 3.11 notifications 域 ----------
export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: userRef().notNull(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    title: text().notNull(),
    body: text(),
    url: text().notNull(),
    readAt: timestamptz(),
    archivedAt: timestamptz(),
    meta: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_read_idx').on(t.userId, t.readAt),
    index('notifications_user_created_idx').on(t.userId, sql`${t.createdAt} desc`),
    unique('notifications_user_event_uq').on(t.userId, t.eventId),
  ],
)

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: pk(),
    notificationId: uuid()
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    channel: text().notNull(),
    status: text().notNull().default('pending'),
    sentAt: timestamptz(),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('notification_deliveries_notification_idx').on(t.notificationId),
    check('notification_deliveries_channel_ck', inList(t.channel, DELIVERY_CHANNELS)),
    check('notification_deliveries_status_ck', inList(t.status, DELIVERY_STATUSES)),
  ],
)

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: userRef().notNull(),
    eventKind: text().notNull(),
    channels: text().array().notNull(),
    digest: text().notNull().default('instant'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.eventKind] }),
    check('notification_preferences_digest_ck', inList(t.digest, DIGESTS)),
  ],
)

/** 阅读与写作偏好（ADR-0024）：一人一行；reading 只存用户改过的键，读取时补默认。appearance = 外观偏好（ADR-0049，同理）。 */
export const userPreferences = pgTable('user_preferences', {
  userId: userRef().primaryKey(),
  reading: jsonb().notNull().default({}),
  appearance: jsonb().notNull().default({}),
  updatedAt: updatedAt(),
})

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: pk(),
    userId: userRef().notNull(),
    endpoint: text().notNull(),
    keys: jsonb().notNull(),
    userAgent: text(),
    createdAt: createdAt(),
    lastUsedAt: timestamptz(),
  },
  (t) => [unique('push_subscriptions_endpoint_uq').on(t.endpoint)],
)

// ---------- 3.12 audit_log ----------
export const auditLog = pgTable(
  'audit_log',
  {
    id: pk(),
    workspaceId: text().references(() => organization.id),
    actorId: userRef(),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    ip: text(),
    userAgent: text(),
    meta: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_workspace_created_idx').on(t.workspaceId, sql`${t.createdAt} desc`),
    index('audit_log_actor_created_idx').on(t.actorId, sql`${t.createdAt} desc`),
    index('audit_log_action_idx').on(t.action),
    check('audit_log_action_ck', inList(t.action, AUDIT_ACTIONS)),
  ],
)

// ---------- 3.13 idempotency_keys ----------
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: uuid().primaryKey(),
    userId: userRef().notNull(),
    responseStatus: smallint().notNull(),
    responseBody: jsonb().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('idempotency_keys_created_idx').on(t.createdAt)],
)

// ---------- 3.14 join_requests（ADR-0008 开放注册 + 待审批） ----------
export const joinRequests = pgTable(
  'join_requests',
  {
    id: pk(),
    workspaceId: orgRef(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text().notNull().default('pending'),
    ip: text(),
    decidedBy: userRef(),
    decidedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('join_requests_user_uq').on(t.userId),
    index('join_requests_status_created_idx').on(t.status, t.createdAt),
    check('join_requests_status_ck', inList(t.status, JOIN_REQUEST_STATUSES)),
  ],
)

// ---------- 3.15 calendars / calendar_events（ADR-0009 日程） ----------
/** 个人日历（macOS「日历」列表）：分类 + 颜色 + 是否显示；仅 owner 可见。 */
export const calendars = pgTable(
  'calendars',
  {
    id: pk(),
    workspaceId: orgRef(),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    color: text().notNull(),
    hidden: boolean().notNull().default(false),
    isDefault: boolean().notNull().default(false),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('calendars_owner_idx').on(t.ownerId, t.position),
    check('calendars_color_ck', inList(t.color, PALETTE_COLORS)),
  ],
)

/**
 * 日程（ADR-0009）：
 * - 定时事件：[startAt, endAt)；全天事件：startAt / endAt = `timezone` 下的本地零点（endAt 为次日零点，独占）
 * - 重复：`rrule` = RFC 5545 RRULE（不含 DTSTART），按 `timezone` 本地时刻展开；`exdates` = 被排除的发生时刻
 * - 单次改写：独立行 `recurrenceId` → 母事件 + `originalStartAt`（同时写入母事件 exdates）
 * - 提醒：`alarms` = 开始前分钟数（全天事件相对当天零点，可为负：-540 = 当天 09:00）
 */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: pk(),
    workspaceId: orgRef(),
    calendarId: uuid()
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    location: text(),
    notes: text(),
    url: text(),
    allDay: boolean().notNull().default(false),
    startAt: timestamptz().notNull(),
    endAt: timestamptz().notNull(),
    timezone: text().notNull(),
    rrule: text(),
    /** 重复截止（由 rrule UNTIL/COUNT 推得；null = 无限），用于区间查询剪枝 */
    repeatUntil: timestamptz(),
    exdates: timestamptz().array().notNull().default(sql`'{}'::timestamptz[]`),
    recurrenceId: uuid(),
    originalStartAt: timestamptz(),
    alarms: integer().array().notNull().default(sql`'{}'::integer[]`),
    deletedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('calendar_events_owner_range_idx').on(t.ownerId, t.startAt, t.endAt),
    index('calendar_events_recurrence_idx').on(t.recurrenceId),
    index('calendar_events_alarm_idx')
      .on(t.startAt)
      .where(sql`cardinality(${t.alarms}) > 0 and ${t.deletedAt} is null`),
    check('calendar_events_range_ck', sql`${t.endAt} > ${t.startAt}`),
    check(
      'calendar_events_override_ck',
      sql`(${t.recurrenceId} is null) = (${t.originalStartAt} is null)`,
    ),
  ],
)
