# 术语表 Glossary

> 状态：已采纳 · 版本：v2 · 更新：2026-09-25 · 最后对照代码：2026-09-25（注册申请、用户名、日程、休 / 班、速览栏；此前：燕印、枝线、动效档位、展开指示、拼图滑块） · 依据 ADR-0001、01–08。本表是 Ubiquitous Language：代码标识符、表名、UI 文案、i18n key 必须与本表一致；**新增术语先加表再写代码**。i18n key 约定 `<area>.<term>[.<value>]`，area 与 `00-requirements.md` 的 REQ AREA 同名小写。

---

## 1. 主表

| 中文名 | 英文名 / 代码标识符 | 表名或类型 | UI 文案（zh-CN） | i18n key | 定义 | 出处 |
|---|---|---|---|---|---|---|
| 工作区 | Workspace / `workspaceId` | `organization`（Better Auth） | 工作区 | `ws.workspace` | 租户；一期只有一个 | 01 §2 |
| 成员 | Member / `member` | `member` | 成员 | `ws.member` | 加入工作区的用户及其角色 | 01 §2 |
| 所有者 | owner | `member.role` | 所有者 | `ws.role.owner` | 工作区最高角色，唯一可永久删除与转让 | 01 §5 |
| 管理员 | admin | `member.role` | 管理员 | `ws.role.admin` | 管理成员、设置、审计 | 01 §5 |
| 普通成员 | member | `member.role` | 成员 | `ws.role.member` | 可建空间、读写所在空间 | 01 §5 |
| 访客 | guest | `member.role` | 访客 | `ws.role.guest` | 只能拿到显式加入空间的 viewer | 01 §5 |
| 匿名 | anon | 无 | — | — | 未登录；一切 401 | 01 §5 |
| 邀请 | Invitation / `invitation` | `invitation` | 邀请 | `auth.invitation` | ~~邀请制注册的唯一入口~~ 加入工作区的两条途径之一（另一条为注册申请，ADR-0008） | 01 §2 |
| 注册申请 | Join request / `joinRequest` | `join_requests` | 申请注册 · 待审批 | `auth.register` · `settings.members.tab.requests` | 自助注册后待 owner/admin 批准的账号；批准前无 `member` 行、不能登录（`REGISTRATION_PENDING`） | 01 §3.14 · ADR-0008 |
| 用户名 | Username / `username` · `displayUsername` | `user.username`（小写唯一）· `user.display_username` | 用户名 | `auth.register.username` | 3–30 位字母 / 数字 / `_ . -`，可代替邮箱登录，大小写不敏感 | ADR-0008 |
| 空间 | Space / `space` | `spaces` | 空间 | `space.space` | 任务与记录的容器；隐喻「巢」 | 01 §3.1 |
| 空间管理员 / 成员 / 查看者 | admin / member / viewer | `space_members.role` | 空间管理员 / 空间成员 / 查看者 | `space.role.admin` `.member` `.viewer` | 空间级角色 | 01 §3.1 |
| 空间类型 | `space.kind` | `project` / `learning` / `work` | 项目 / 学习 / 工作 | `space.kind.project` 等 | 只影响图标与默认视图 | 01 §3.1 |
| 空间可见性 | `space.visibility` | `workspace` / `members` | 全员可见 / 仅成员 | `space.visibility.workspace` `.members` | | 01 §3.1 |
| 任务 | Task / `task` | `tasks` | 任务 | `task.task` | 待办；隐喻「枝」 | 01 §3.2 |
| 任务状态 | `task.status` | `inbox` `todo` `doing` `blocked` `done` `cancelled` | 收件箱 / 待办 / 进行中 / 阻塞 / 完成 / 取消 | `task.status.<value>` | 看板列即状态 | 01 §3.2 |
| 优先级 | `task.priority` | smallint 0–4 | 无 / 低 / 中 / 高 / 紧急 | `task.priority.<0-4>` | 色映射见 04 §2.1 | 01 §3.2 |
| 子任务 | Subtask / `parentId` | `tasks.parent_id` | 子任务 | `task.subtask` | 最多 2 层 | 01 §3.2 |
| 重复 | Recurrence / `recurrence` | jsonb | 重复 | `task.recurrence` | 完成时服务端生成下一实例 | 01 §3.2 |
| 指派人 | Assignee / `assigneeId` | `tasks.assignee_id` | 指派给 | `task.assignee` | 唯一负责人 | 01 §3.2 |
| 关注者 | Watcher / `watcher` | `task_watchers` | 关注 | `task.watcher` | 收该任务通知的人 | 01 §3.2 |
| 截止 / 计划 | `dueAt` / `scheduledAt` | timestamptz | 截止 / 计划 | `task.dueAt` `task.scheduledAt` | | 01 §3.2 |
| 周期 | Cycle / `cycle` | `cycles` | 周期 | `cycle.cycle` | 周 / 月 / 季目标与复盘；隐喻「程」 | 01 §3.3 |
| 周期类型 | `cycle.kind` | `week` / `month` / `quarter` | 周 / 月 / 季 | `cycle.kind.<value>` | | 01 §3.3 |
| 目标 | Goal / `goals[]` | jsonb | 目标 | `cycle.goal` | 周期内的目标条目，可挂任务 | 01 §3.3 |
| 复盘 | Review / `review` | `entries.kind = review` | 复盘 | `entry.kind.review` | 周期的复盘正文；隐喻「回望」 | 01 §3.3 |
| 周期状态 | `cycle.status` | `planning` / `active` / `reviewed` | 规划中 / 进行中 / 已复盘 | `cycle.status.<value>` | | 01 §3.3 |
| 记录 | Entry / `entry` | `entries` | 记录 | `entry.entry` | 富文本主体；**不叫笔记 / 文档 / note** | 01 §3.4 |
| 记录类型 | `entry.kind` | `decision` `iteration` `bug` `changelog` `journal` `note` `review` | 决策 / 迭代 / Bug / 变更 / 日志 / 随笔 / 复盘 | `entry.kind.<value>` | `note` 的中文是「随笔」 | 01 §3.4 |
| 元数据字段 | Fields / `fields` | jsonb | 属性 | `entry.fields` | 按 kind 的结构化元数据 | 01 §3.5 |
| 记录可见性 | `entry.visibility` | `private` / `space` / `workspace` | 仅自己 / 空间可见 / 全员可见 | `entry.visibility.<value>` | | 01 §3.4 |
| 正文 | Body / `ydoc` | `entries.ydoc` bytea | 正文 | `entry.body` | Yjs 二进制，唯一真源 | 01 §3.4 |
| 派生列 | Derived columns | `pm_json` `plain` `tsv` `word_count` | — | — | 只由 `onStoreDocument` 生成，可重建 | 01 §3.4 |
| 快照 | Snapshot / `snapshot` | `entry_snapshots` | 版本 | `collab.snapshot` | `Y.encodeSnapshot` 结果 | 03 §5 |
| 标记版本 | Label / `label` | `entry_snapshots.label` | 标记版本 | `collab.label` | 用户手动命名的快照，永久保留 | 03 §5 |
| 模板 | Template | `src/shared/editor/templates.ts` | 模板 | `entry.template` | 按 kind 注入的正文骨架 | 03 §6 |
| 编辑器 schema 版本 | `editorSchemaVersion` | `entries.editor_schema_version` | — | — | 节点结构迁移用 | 03 §3.3 |
| 链接 | Link / `link` | `links` | 链接 | `link.link` | 对象间有向关系 | 01 §3.6 |
| 链接类型 | `link.kind` | `relates` `blocks` `caused_by` `resolves` `mentions` | 相关 / 阻塞 / 起因 / 解决 / 提及 | `link.kind.<value>` | `mentions` 由编辑器 `entryLink` 派生 | 01 §3.6 |
| 反链 | Backlink | `links` 反向查询 | 反向链接 | `link.backlink` | 指向当前对象的链接 | 01 §3.6 |
| 外链卡片 | External card | `links.external_url` | 外部链接 | `link.external` | 简斋 / GitHub 等外部 URL 的卡片 | 01 §3.6 |
| 标签 | Tag / `tag` | `tags` `task_tags` `entry_tags` | 标签 | `tag.tag` | 工作区内唯一名 | 01 §3.7 |
| 附件 | Attachment / `attachment` | `attachments` | 附件 | `attach.attachment` | 上传的文件；**不叫文件** | 01 §3.8 |
| 变体 | Variant / `variants` | jsonb `{thumb, md}` | — | — | sharp 生成的缩图 | 01 §3.8 |
| 评论 | Comment / `comment` | `comments` | 评论 | `comment.comment` | 挂在记录或任务上 | 01 §3.9 |
| 线程 | Thread / `threadId` | `comments.thread_id` | 讨论 | `comment.thread` | 编辑器 `comment` mark 锚定的一组评论 | 01 §3.9 |
| 提及 | Mention / `mention` | `mentions` | @提及 | `comment.mention` | 触发 `mention.created` | 01 §3.9 |
| 解决 | Resolve / `resolvedAt` | `comments.resolved_at` | 标记已解决 | `comment.resolve` | 线程关闭 | 01 §3.9 |
| 事件 | Event / `event` | `events` | — | — | 领域事件，出箱 + 活动流的唯一来源 | 01 §3.10 |
| 出箱 | Outbox | `events.processed_at` | — | — | 同事务写入、pg-boss 接力 | 01 §3.10 |
| 扇出 | Fanout | pg-boss `notify.fanout` | — | — | 事件按偏好分发到各通道 | 01 §4 |
| 通知 | Notification | `notifications` | 通知 | `notif.notification` | 用户可见的一条提醒 | 01 §3.11 |
| 通道 | Channel | `in_app` `sse` `webpush` `email` | 站内 / 实时 / 推送 / 邮件 | `notif.channel.<value>` | | 01 §3.11 |
| 通知偏好 | Preference | `notification_preferences` | 通知设置 | `notif.preference` | 按事件种类选通道 | 01 §3.11 |
| 摘要 | Digest | `digest = daily` | 每日摘要 | `notif.digest` | 08:00 用户时区汇总邮件 | 01 §4 |
| 活动流 | Activity | `events` 经 `can()` 过滤 | 动态 | `notif.activity` | 谁在何时做了什么 | 01 §3.10 |
| 今日 | Today | 路由 `/today` | 今日 | `ui.page.today` | 今天到期 / 计划 + 进行中 | 04 §5 |
| 收件箱 | Inbox | `task.status = inbox` + 路由 `/inbox` | 收件箱 | `ui.page.inbox` | `status=inbox` 且创建者或指派人为我 | 08 §2.4 |
| 看板 | Kanban / board | 路由 `/spaces/$spaceSlug?view=board` | 看板 | `ui.page.board` | 按状态分列；`view=list` 为列表 | 08 §1 |
| 列 | Column | `task.status` | 列 | `task.column` | 看板一列 = 一个状态 | 04 §1 |
| 日历 | Calendar | 路由 `/calendar` | 日历 | `ui.page.calendar` | ~~按 dueAt / scheduledAt 视图（Phase 2）~~ 日 / 周 / 月 / 年视图的日程页，任务为叠加层（ADR-0009） | 08 §1 · 08 §2.17 |
| 我的日历 | Calendar / `calendar` | `calendars` | 我的日历 · 日历 | `calendar.myCalendars` · `calendar.calendar` | 个人的日程分类（颜色 + 显示开关），默认 个人 / 工作 / 学习 / 生活 | 01 §3.15 |
| 日程 | Calendar event / `calendarEvent` · occurrence | `calendar_events` | 日程 | `calendar.newEvent` 等 | 占用时段的个人安排（定时 / 全天 / 跨天），区别于有状态的「任务」；重复日程的每一次叫「发生」（occurrence） | 01 §3.15 · ADR-0009 |
| 重复 | Repeat / `rrule` | `calendar_events.rrule` | 重复 | `calendar.repeat.*` | RFC 5545 RRULE 子集；改删范围：仅此日程 / 将来所有日程 / 所有日程 | ADR-0009 |
| 提醒 | Alarm / `alarms` · 事件 `calendar.reminder` | `calendar_events.alarms` | 提醒 | `calendar.alarm.*` | 开始前 N 分钟通知（全天事件相对当天 00:00） | 01 §4 · ADR-0009 |
| 休 / 班 | Holiday off / make-up workday | 无（`chinese-days`） | 休 · 班 | `calendar.off` · `calendar.work` | 法定节假日放假日 / 调休上班日角标 | ADR-0009 §3 |
| 速览栏 | Glance rail / `GlanceRail` · `WithRail` | 组件 | — | `glance.*` | 宽屏列表页右侧：今天 · 今日日程 · 小月历 · 7 天内到期 | 00 REQ-UI-034 |
| Peek 预览 | Peek / `PeekPanel` | 组件 | 预览 | `ui.peek` | 悬停 600ms 或焦点行按 `p` 打开的只读侧栏（非 modal） | 04 §6 |
| 命令面板 | Command palette / `cmdk` | 组件 | 命令 | `ui.command` | ⌘K；上下文命令优先 | 04 §6 |
| 状态胶囊 | StatusPill | 组件 | — | `ui.statusPill` | Topbar 常驻，Toast 从此形变 | 04 §5 |
| 主题 | Theme | `data-theme = light | dark` | 日场 / 夜场 | `ui.theme.light` `.dark` | 只有两种 | 06 §6 |
| 密度 | Density | `comfortable` / `compact` | 舒适 / 紧凑 | `ui.density.<value>` | 行高 -20% | 04 §4 |
| 玻璃 | Glass | `--xz-glass-thin` `-glass` `-glass-thick` `-glass-opaque` | — | — | 四级半透明材质，只用于 chrome | 06 §3.2 |
| 纸面 | Paper | `--xz-surface-solid` / `@utility paper` | — | — | 不透明内容面 | 06 §2 |
| 底板 | Backdrop | `--xz-bg` + 光晕 | — | — | 最底层实色 | 06 §2 |
| 光晕 | Glow | `--xz-glow-1/2/3` | — | — | 底板固定三处径向渐变 | 06 §3.1 |
| 棱线 | Edge | `--xz-edge` | — | — | 玻璃顶缘 1px 高光 | 06 §3.2 |
| 折射环 | Refract | `--xz-refract` | — | — | L2 玻璃 1.5px 内描边 | 06 §3.2 |
| 软删 | Soft delete / `deletedAt` | `deleted_at` | 删除 | `ui.action.delete` | 30 天可恢复 | 01 §1 |
| 回收站 | Trash | 路由 `/trash` | 回收站 | `ui.page.trash` | 软删对象的恢复入口 | 01 §5 |
| 永久删除 | Permanent delete | `DELETE ?permanent=1` | 永久删除 | `ui.action.deletePermanent` | 仅 owner / admin | 02 §5 |
| 归档 | Archive / `archivedAt` | `archived_at` | 归档 | `ui.action.archive` | 隐藏但不删除；**与删除不同** | 01 §3.1 |
| 乐观锁 | Optimistic lock / `ifUpdatedAt` | PATCH body | — | — | 不匹配 409 `CONFLICT_STALE` | 02 §5 |
| 幂等键 | Idempotency key | `Idempotency-Key` 头 / `idempotency_keys` | — | — | 24h 回放 | 02 §5 |
| API Key | API key / `apiKey` | `api_key`（Better Auth） | API 密钥 | `auth.apiKey` | `xz_` 前缀 Bearer | 02 §2 |
| 作用域 | Scope | `read` / `write` / `admin` | 权限范围 | `auth.scope.<value>` | API Key 权限 | 02 §2 |
| 协同票据 | Collab token | `POST /collab/token { entryId }` | — | — | 5 分钟 HMAC，载荷 `{userId, entryId, jti, exp}`，一票一文档，WebSocket 鉴权 | 02 §9 |
| 审计 | Audit / `auditLog` | `audit_log` | 审计日志 | `ws.audit` | 只增不改 | 01 §3.12 |
| 导出 | Export | `POST /exports` | 导出 | `export.export` | Markdown zip / JSON | 02 §8 |
| 一期 / 二期 | Phase 0–2 / Phase 3 | — | — | — | 见 05 头部 | 05 |
| 色板 | Palette / `PALETTE_COLORS` | `spaces.color` `tags.color` `calendars.color`；token `--xz-palette-<name>-solid/-bg/-fg` | 蓝 / 橙 / 黄 / 红 / 绿 / 紫 / 粉 / 青 / 灰 | `ui.palette.blue` `.orange` `.yellow` `.red` `.green` `.purple` `.pink` `.cyan` `.gray` | 04 §2.1 的鲜艳 9 色（用户可选），代码标识符 `blue orange yellow red green purple pink cyan gray`（ADR-0010，2026-09-25；~~旧 8 色 `moss amber indigo ochre teal plum gray pine`~~） | 04 §2.1 · ADR-0010 |
| 原文已删除（孤立线程） | orphaned / `comments.orphaned` | `comments` | 原文已删除，讨论保留 | `comment.orphaned` | 锚定线程的 comment 标记从正文消失；线程保留在侧栏（注 2026-09-24：锚定 = 根评论 `thread_id ≠ id`） | 01 §3.9 · 03 §3.2 |
| 锚定评论 | anchored thread / `comment(threadId)` 标记 | `comments` | 评论（浮动工具条） | `editor.bubble.comment` | 选中正文发起的评论，正文里以 comment 标记关联线程 | 03 §3.2 |
| 停用 | suspend / `suspended` | Better Auth `user.banned` | 停用 / 恢复 | `settings.members.suspend` `.unsuspend` | 保留成员行但立即登出、不可登录；可恢复 | 07 §4 · REQ-WS-014 |
| 最近访问 | recent / `recent` 参数 | 本机 localStorage `xz:recent` | 最近访问 | `search.recent` | 搜索空查询时列出最近打开的任务与记录 | 08 §2.11 |
| 浮动工具条 | BubbleBar | 组件 | — | `editor.bubble.*` | 选中文字时出现的 glass-thick 工具条 | 03 §11 · 06 §4 |
| 斜杠菜单 | slash menu / `SLASH_ITEMS` | 组件 | 输入 / 唤起命令 | `editor.slash.*` | 编辑器内 `/` 命令列表 | 03 §11.1 |
| 大纲 | outline / `useOutline` | 组件 | 大纲 | `entry.aside.outline` | Aside 中按标题生成的目录，点击跳转 | 04 §4 · 08 §2.9 |
| 快捷键面板 | ShortcutsDialog | 组件 | 快捷键 | `cmd.help` | `?` 打开，列出全局热键与列表按键 | 04 §6 |
| 实时失效 | data.changed → `invalidate` 帧 | EventBus + SSE | — | — | 数据写提交后按空间可读性推送 Query key 失效；不是通知 | 02 §6 注 |
| 记录卡片 | entryCard | PM 节点 | 记录卡片 | `editor.slash.card` | 正文里以卡片形式引用另一篇记录 | 03 §3.2 |
| 未知块 | unknownBlock | PM 节点 | 未识别的内容块 | `editor.unknownBlock` | schema 不认识的节点占位，保留原 JSON | 03 §3.3 |
| 动效档位 | `MotionLevel`：`reduce / standard / rich` | `html[data-motion]` · `xz:motion` | 动效：减弱 / 标准 / 丰富 | `settings.profile.motionLevel.*` | 本机偏好；系统 reduced-motion 优先 | 04 §2.4 · ADR-0005 |
| 拼图滑块 | `SliderCaptcha` · `GET /api/captcha` · 头 `x-captcha` | 组件 · 接口 | 拼图滑块 | `auth.captcha.*` | 登录前服务端出题的拖动拼图，一次性、120 s（ADR-0006） | 08 §2.1 · REQ-AUTH-016 |
| 拼图通行证 | `captchaPass`（`pass:<id>`） | 接口字段 | — | — | 接受邀请后 60 s 一次性免拼图凭据，仅用于紧随其后的自动登录 | ADR-0006 |
| 展开指示 | `Disclosure` | 组件 | — | — | 可折叠区块标题前的圆角小三角，展开转 90° | 04 §2.4 · REQ-UI-030 |

---

## 2. 品牌隐喻

| 隐喻 | 对象 | 允许出现的位置 |
|---|---|---|
| 程 Trip | 周期 Cycle（季度 = 长程） | 周期页头副标「第 N 程」 |
| 回望 Look-back | 周复盘 review | 复盘页空状态、完成态文案、「成巢」里程碑动效 |
| 枝 Twig | 任务 Task | 看板列头进度刻度；空状态「这里还没有衔来的枝」 |
| 巢 Nest | 空间 Space | 仅空状态与引导语；命名保持「空间」 |
| 燕印 Seal | 品牌标识（`Seal` 组件 / `.xz-seal`） | Sidebar 品牌位、登录页、favicon（ADR-0005 §2；配色造型见 ADR-0007） |
| 枝线 Branch line | 顶栏滚动态下沿细线（`.xz-topbar[data-scrolled]`、`--xz-branch-line`） | 仅 Topbar（ADR-0005 §2） |

克制原则（04 §1）：隐喻只出现在**命名、空状态、里程碑动效**三处。（注 2026-09-24：ADR-0005 扩为五处，另加品牌位与顶栏枝线。）数据模型、API、代码标识符一律用英文本名（`cycle` / `review` / `task` / `space`），不用隐喻词。

---

## 3. 禁用词与唯一写法

| 容易混用 | 唯一写法 | 说明 |
|---|---|---|
| 笔记 / 文档 / note / 文章 | **记录 Entry** | `note` 仅指 `entry.kind = note`（随笔） |
| 删除 / 归档 | 两者不同 | 归档 = `archived_at`，可见性隐藏；删除 = `deleted_at`，30 天回收站 |
| 用户 / 成员 | 指工作区内身份时用**成员 Member**；泛指最终使用者（「用户时区」「用户编辑」）可用「用户」 | 代码 `user` 仅指 Better Auth 账号本身 |
| 组织 / 团队 / 租户 | **工作区 Workspace** | 代码里 `organization` 只出现在 Better Auth 表名 |
| 文件 / 图片 | 上传物一律**附件 Attachment**；文件系统与上传体积语境（「单文件上限」「文件名」）可用「文件」 | 图片是 mime 为 image 的附件 |
| 项目 | 避免单独使用 | 「项目」只是空间 kind 之一；容器统一叫空间 |
| 负责人 / 执行人 | **指派人 Assignee** | |
| 订阅者 / 关注者 | **关注者 Watcher** | |
| 版本 / 历史 / 快照 | UI 叫「版本」，代码叫 `snapshot` | 「标记版本」= 带 label 的快照 |
| 评论 / 讨论 / 批注 | **评论 Comment**；一组评论叫**线程** | |
| 消息 / 提醒 / 通知 | **通知 Notification** | 「消息」不使用；「提醒」仅作为 `cycle.review_due` 等具体通知的文案动词，不作名词 |
| 动态 / 活动 / 时间线 | UI 叫「动态」，代码叫 `activity` | |
| 亮色 / 浅色 / 深色 / 暗色 | UI 叫**日场 / 夜场**，代码叫 `light` / `dark` | |
| 毛玻璃 / 磨砂 / 玻璃拟态 | **玻璃 Glass** | |
| 三期 | 不使用 | 一期 = Phase 0–2，二期 = Phase 3 |
| 登录 / 登入 / 签入 | **登录** | |
| 空间管理员 / 管理员 | 必须带前缀区分 | 「管理员」单独出现时指工作区 admin |

---

## 裁定记录（2026-09-23）

- 「日历」页按 Phase 2 收录，路由 `/calendar`；「回收站」路由 `/trash`。两者已进 08 §1 路由表。
- `entry.kind = note` 中文定为「随笔」。
- i18n key 的 area 前缀 = `00-requirements.md` 的 REQ AREA 小写（`auth ws space task cycle entry editor collab link tag attach comment search notif export ui mobile ops`），本表已按此写。
