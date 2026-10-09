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
| 空间 | Space / `space` | `spaces` | 空间 | `space.space` | 任务与记录的容器；隐喻「巢」；ADR-0012 起归入大类（大类 → 空间 → 记录），不属于任何大类的显示「未分类」（注 2026-09-26：界面曾改称「知识库」「分类」，ADR-0013 改回「空间」） | 01 §3.1 · ADR-0013 |
| 大类 | Space group / `spaceGroup` | `space_groups` | 大类 | `space.groups.*` | 空间的归组（产品开发 / 技术学习规划 / 生活…） | ADR-0012 · 01 §3.0 |
| 目录 | Tree / `tree` | `entries.parent_id` `tree_order` | 目录 | `kb.tree.*` | 空间内可嵌套的页面树；不在目录的记录叫「其余记录」 | ADR-0012 |
| 概览 | Home / `home` | — | 概览 | `kb.tab.home` | 进入空间的默认页 | ADR-0012 |
| 空间目录 | Space directory / `SpaceDirectory` | — | 空间目录 | `kb.personal.dir` | 个人空间概览里的 大类 → 空间 → 目录树 总览 | ADR-0015 |
| 引导线 | Tree guide / `TreeGuides` | — | —（纯视觉） | — | 目录树每级祖先的竖向细线，标示层级归属 | ADR-0015 |
| 类型图标 | Kind icon / `KindIcon` | — | —（配合类型名） | `entry.kind.*` | 记录类型对应的 Lucide 图标色块 | ADR-0015 |
| 空间管理员 / 成员 / 查看者 | admin / member / viewer | `space_members.role` | 空间管理员 / 空间成员 / 查看者 | `space.role.admin` `.member` `.viewer` | 空间级角色 | 01 §3.1 |
| ~~空间类型~~ 空间种类 | `space.kind` | `project` / `learning` / `work` | 项目 / 学习 / 工作 | `space.kind.project` 等 | 只影响图标、默认视图与启用类型的推导默认（注 2026-09-30 ADR-0036：「空间类型」一词改指空间自有的记录类型，本行改称「空间种类」，标识符不变） | 01 §3.1 |
| 空间可见性 | `space.visibility` | `workspace` / `members` | 全员可见 / 仅成员 | `space.visibility.workspace` `.members` | | 01 §3.1 |
| 任务 | Task / `task` | `tasks` | 任务 | `task.task` | 待办；隐喻「枝」 | 01 §3.2 |
| 任务页 | Tasks page | 路由 `/tasks` | 任务 | `ui.page.tasks` · `tasksPage.*` | 我的全部任务按截止日分组的列表（2026-10-01 ADR-0043）；「待办」是任务状态 `todo` 的称呼，页面不叫「待办」以免撞名 | 08 §2.3b |
| 快速添加 | Quick add / `QuickAddTask` | — | 快速添加任务 | `quickAdd.*` | 一行输入回车建任务，识别日期 / `!优先级` / `#标签` / `~空间`（ADR-0043）（注 ADR-0044：`~` 先匹配清单；框内日期 / 优先级 / 清单 / 标签按钮；展开卡片写备注与子任务；组内就地添加；全局 `c` 同一组件） | 08 §2.3b |
| 行内编辑 | Inline edit / `TaskRow` | — | — | `taskRow.*` · `taskMenu.*` | 任务行上直接改标题与日期 / 优先级 / 清单 / 标签，及「⋯」/ 右键单个管理菜单，不进详情（2026-10-01 ADR-0045） | 08 §2.3b |
| 批量条 | Batch bar / `TaskBatchBar` | — | 已选 N 项 | `taskBatch.*` | 任务页面级多选后底部的一条操作条（完成 / 日期 / 优先级 / 清单 / 空间 / 标签 / 状态 / 删除，可撤销），跨分组唯一一条（ADR-0045） | 08 §2.3b |
| 清单 | Task list / `task_lists` | `task_lists` · `task_list_items` | 清单 | `taskLists.*` | 任务的按人分类（本人私有，可放进文件夹，深度 1）；同一任务各人各归各的（2026-10-01 ADR-0044）；点文件夹 = 聚合其下清单，任务页可「按清单分组」（2026-10-07 ADR-0050）；区别于「空间」（容器、决定权限）与「标签」（多选、横切） | 01 §3.7b |
| 智能清单 | Smart view | search `view=` | 全部 / 今天 / 明天 / 最近 7 天 / 未归类 / 已完成 | `taskLists.smart.*` | 任务页左栏按条件聚合的视图，不存库（ADR-0044） | 08 §2.3b |
| 未归类 | Unlisted / `listId=none` | — | 未归类 | `taskLists.unlisted` | 不在本人任何清单里的任务；不叫「收集箱」以免与「收件箱」（status inbox）撞名（ADR-0044） | 08 §2.3b |
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
| 记录类型 | `entry.kind` | `decision` `iteration` `bug` `changelog` `journal` `note` `review` `optimize` `plan` | 决策 / 迭代 / Bug / 变更 / 日志 / 随笔 / 复盘 / 优化 / 学习计划 | `entry.kind.<value>` | `note` 的中文是「随笔」；`optimize` `plan` 为 ADR-0011 新增 | 01 §3.4 |
| 模板 | Template / `template` | `entry_templates`；内置 `builtin:<key>` | 模板 | `template.*` | 新建记录的正文种子；个人 / 工作区 / 内置三类；**不是**正文真源（注 2026-09-30 ADR-0038：内置 = 代码内置〔可被所有者覆盖〕+ `scope = builtin` 的入库模板，见「内置模板覆盖」） | ADR-0011 §2 · 01 §3.4 |
| 历史版本 | Snapshot / `snapshot` | `entry_snapshots` | 历史 / 版本 | `entry.history.*` | 自动快照 + 标记版本；「恢复」= 以一次修改写回，不覆盖 ydoc | 03 §5 |
| 源码编辑 | Source / `source` | — | Markdown 源码 | `editor.source.*` | 一次性导入，不是 Markdown 往返真源 | ADR-0011 §1 |
| 元数据字段 | Fields / `fields` | jsonb | 属性 | `entry.fields` | 按 kind 的结构化元数据 | 01 §3.5 |
| 记录可见性 | `entry.visibility` | `private` / `space` / `workspace` | 仅自己 / 空间可见 / 全员可见 | `entry.visibility.<value>` | | 01 §3.4 |
| 正文 | Body / `ydoc` | `entries.ydoc` bytea | 正文 | `entry.body` | Yjs 二进制，唯一真源 | 01 §3.4 |
| 派生列 | Derived columns | `pm_json` `plain` `tsv` `word_count` | — | — | 只由 `onStoreDocument` 生成，可重建 | 01 §3.4 |
| 快照 | Snapshot / `snapshot` | `entry_snapshots` | 版本 | `collab.snapshot` | `Y.encodeSnapshot` 结果 | 03 §5 |
| 标记版本 | Label / `label` | `entry_snapshots.label` | 标记版本 · 打标记 | `collab.label` · `entry.history.tag` | 用户手动命名的快照，永久保留（ADR-0026：历史里可给任一版本打标记 / 改 / 清除） | 03 §5 |
| 保存版本 | Save version / `saveVersion` · stateless `save-version` | `entry_snapshots`（`created_by` 非空、无 label） | 保存版本 | `editor.version.*` | Ctrl/⌘+S 生成的手动版本，以本地时间「年月日-时分秒」命名，永久保留 | ADR-0026 §4 |
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
| 详情坞 | Detail dock / `DetailDock` | 组件 | — | `dock.*` | ≥ lg 时任务 / 记录详情在主区右侧常驻展开的栏，主区让位、可拖宽（2026-10-09 ADR-0054 §B） | ADR-0054 |
| 网页卡片 | Link card / `linkCard` | PM 节点 | 网页卡片 | `editor.linkCard.*` · `editor.slash.linkCard` | 外链的块级卡片：站点图标 + 站点名 · 标题 · 描述 · 网址（ADR-0054 §D） | ADR-0054 |
| 链接气泡 | Link bubble / `LinkBubble` | 组件 | 显示为 链接 / 标题 / 卡片 | `editor.linkCard.showAs` | 光标落在链接上时的浮动条：切换显示形式、打开、复制、编辑、移除（ADR-0054 §D） | ADR-0054 |
| 副本 | Duplicate / `duplicateEntry` | — | 创建副本 · 复制到… | `entry.menu.duplicate` · `entry.place.*` | 复制一条记录（正文 / 属性 / 本人标签，附件另存一份；不带评论 / 版本 / 关联）（ADR-0054 §C） | ADR-0054 |
| Peek 预览 | Peek / `PeekPanel` | 组件 | 预览 | `ui.peek` | 悬停 600ms 或焦点行按 `p` 打开的只读侧栏（非 modal） | 04 §6 |
| 命令面板 | Command palette / `cmdk` | 组件 | 命令 | `ui.command` | ⌘K；上下文命令优先 | 04 §6 |
| 状态胶囊 | StatusPill | 组件 | — | `ui.statusPill` | Topbar 常驻，Toast 从此形变 | 04 §5 |
| 主题 | Theme | `data-theme = light | dark` | 日场 / 夜场 | `ui.theme.light` `.dark` | 只有两种 | 06 §6 |
| 密度 | Density | `comfortable` / `compact` | 舒适 / 紧凑 | `ui.density.<value>` | 行高 -20% | 04 §4 |
| 玻璃 | Glass | `--xz-glass-thin` `-glass` `-glass-thick` `-glass-opaque` | — | — | 四级半透明材质，只用于 chrome | 06 §3.2 |
| 外观偏好 | Appearance / `AppearancePrefs` | `user_preferences.appearance` | 主题 · 密度 · 动效 · 玻璃强度 | `settings.profile.*` | 随账号保存；生效值 = 内置 ← 工作区默认 ← 本人（ADR-0049） | 01 §3 |
| 工作区默认外观 | Workspace appearance | `organization.metadata.settings.appearance` | 默认外观 | `settings.workspace.appearance` | owner/admin 设置，成员没单独选过的项跟随（ADR-0049） | 01 §3 |
| 玻璃强度 | Glass level / `GlassLevel` | `html[data-glass] = liquid | vivid | clear`（standard 不写） | 流光 / 晶亮 / 清透 / 标准 | `settings.profile.glassLevel.<value>` | 随账号保存（ADR-0049，本机 `xz:glass` 只作首帧缓存），默认流光；只调透明度、光边、光晕与纸面透明度，不加 blur（ADR-0047） | 06 §3.2 |
| 定向光晕 | Wash | `--xz-wash-side-1/-2` `--xz-wash-top` | — | — | 底板上专供侧栏（上 / 下段）与顶栏去透的三团光晕；只在玻璃预设日场生效（ADR-0048） | 06 §3.1 |
| 光边 | Rim | `--xz-rim-hi` / `--xz-rim-lo` | — | — | 玻璃左上亮、右下暗的方向性内描边（ADR-0047） | 06 §3.2 |
| 纸面 | Paper | `--xz-surface-solid` / `.paper`（`@layer components`） | — | — | 不透明内容面；注 2026-10-02（ADR-0047）：底色走 `--xz-paper-bg`，晶亮 / 流光下半透明（不 blur），记录正文纸面恒实底 | 06 §2 |
| 底板 | Backdrop | `--xz-bg` + 光晕 | — | — | 最底层实色 | 06 §2 |
| 光晕 | Glow | `--xz-glow-1/2/3`（+`-4`，ADR-0047） | — | — | 底板固定三处径向渐变；流光下另有两团缓慢漂移 | 06 §3.1 |
| 棱线 | Edge | `--xz-edge` | — | — | 玻璃顶缘 1px 高光 | 06 §3.2 |
| 折射环 | Refract | `--xz-refract` | — | — | L2 玻璃 1.5px 内描边 | 06 §3.2 |
| 软删 | Soft delete / `deletedAt` | `deleted_at` | 删除 | `ui.action.delete` | 30 天可恢复 | 01 §1 |
| 回收站 | Trash | 路由 `/trash` | 回收站 | `ui.page.trash` | 软删对象的恢复入口 | 01 §5 |
| 永久删除 | Permanent delete | `DELETE ?permanent=1` | 永久删除 | `ui.action.deletePermanent` | 仅 owner / admin | 02 §5 |
| 收藏 | Favorite / `favorited` | `entry_favorites` | 收藏 | `entry.nav.favorite` | 个人对记录的标记，跨设备；与「固定」（全员可见置顶）不同（ADR-0014） | 01 §3.7 |
| 最近打开 | Recent / `recent` | 本机 `localStorage xz:recent` | 最近打开 | `entry.nav.recent` | 本机最近访问的记录，按访问顺序（ADR-0014） | 08 §2.8 |
| 记录位置 | Entries location | URL `spaceId under groupId favorite recent archived` | 记录位置 | `entry.nav.label` | 记录页左栏选中的范围，互斥（ADR-0014） | 08 §2.8 |
| 批量操作 | Batch / `POST /entries/batch` · `POST /spaces/batch` | — | 多选 / 批量操作；空间页入口叫「批量管理」 | `entry.batch.*` · `space.batch.*` | 逐条鉴权，部分失败不回滚（ADR-0014 · 0021）；`dryRun` 只校验与计数 | 02 §9 |
| 内置字段覆盖 | Builtin field overrides / `baseFields` `fieldOrder` | `entry_kind_overrides.base_fields` · `field_order` | 内置字段 | `builtinFields.*` | 内置类型代码字段的工作区覆盖：隐藏 / 显示名 / 选项名与色 / 顺序，键与值不变、隐藏保留数据（2026-10-01 ADR-0042） | 01 §3.4c |
| 自定义类型 | Custom entry type / `typeId` | `entry_types` | 我的自定义类型（管理页称「类型」，ADR-0017） | `settings.types.*` | 个人的记录类型：名 + 色 + 状态列表；只有本人能用、能管，读者可见名 / 色 / 状态；记录 `kind = custom`（ADR-0016 · 0017）（注 2026-09-30 ADR-0036：`kind = custom` 的类型分「个人类型」与「空间类型」两种，均可带字段定义） | 01 §3.4c |
| 删除内置类型 | Deleted builtin kind | `entry_kind_overrides.deleted` | 删除 / 恢复 | `settings.types.delete` · `settings.types.restore` | 所有者操作：全员该类型记录转到另一内置类型后标记已删除，可恢复；取代 ADR-0016 的「隐藏」（ADR-0017） | 01 §3.4c |
| 个人类型 | Personal entry type / `entry_types.space_id = null` | `entry_types` | 我的类型 | `settings.types.*` | 即 ADR-0017 的「自定义类型」：属于创建者，只有本人能用、能管；可放进空间启用清单（他人只见名 / 色）（ADR-0036） | 01 §3.4c |
| 空间类型 | Space entry type / `entry_types.space_id` | `entry_types` | 本空间类型 | `space.types.*` | 空间自有的记录类型：只能用于该空间的记录，空间成员都可用，`space.manage` 管理；记录不能带着它移到别的空间；合并空间时随之改挂（ADR-0036）。勿与「空间种类」（`space.kind`）混淆 | 01 §3.4c |
| 启用类型 | Enabled kinds / `enabledKinds` | `spaces.enabled_kinds` | 启用的类型 | `space.types.enabled` | 空间里可用、并作为首页页签的类型清单（内置 kind 或 `type:<uuid>`，有序）；null = 按空间种类推导默认（ADR-0036） | 01 §3.1 |
| 字段定义 | Field definition / `FieldDef` | `entry_types.field_defs` · `entry_kind_overrides.field_defs` | 属性 / 字段 | `entry.fieldDef.*` | 类型上定义的自定义属性（名、类型、选项与颜色、必填提示）；值存 `entries.fields` 的 `x…` 键；内置类型的代码字段不在此（ADR-0036） | 01 §3.5 |
| 属性面板 | Properties panel / `EntryProperties` | — | 属性 | `entry.props.*` | 记录页标题下常显的元数据区：彩色值点击即改、标签、底部流转时间线；取代默认收起的属性栏（ADR-0035）（注 2026-09-30 ADR-0037：改为紧凑属性列表——属性名淡色无图标、标签并入列表、空属性默认收起；流转改为下方一行「流转摘要」） | 08 §2.9 |
| 流转摘要 | Field-change summary / `entry-flow-summary` | `entry_field_changes` | 流转 N 次 | `entry.flow.*` | 属性列表下一行：流转次数 + 最近一次变化；点击弹出按事件分组（同一人 ≤ 2 秒合为一组）的时间线弹层，不推开正文（ADR-0037） | 08 §2.9 |
| 阅读弹层 | Reading popover / `reading-open` | — | 阅读 | `reading.*` | 文档栏「Aa 阅读」按钮弹出的单个弹层，内分 字体 / 纸张 / 排版 / 目录 四页；取代阅读胶囊的四个图标弹层（ADR-0037） | 08 §2.9 |
| 内置模板覆盖 | Builtin template override | `builtin_template_overrides` | 编辑（内置模板） | `settings.templates.*` | 所有者对代码内置模板（`builtin:<key>`）的工作区修改：名称 / 说明 / 类型 / 适用空间 / 字段预填 / 正文，null = 代码默认；删除为软删（可恢复）。所有者另可新增 `scope = builtin` 的入库内置模板（ADR-0038） | 01 §3.4 |
| 恢复默认（内置模板） | Restore builtin template | `POST /templates/:id/restore` | 恢复默认 / 恢复 | `settings.templates.restore` | 删除该内置模板的覆盖行：修改与「已删除」一并撤销，回到代码版本（ADR-0038） | 02 §9 |
| 模板属性 | Template field / `entry_templates.field_defs` | `entry_templates.field_defs` · `builtin_template_overrides.field_defs` | 模板属性 | `template.meta.*` | 模板自有的字段定义（`FieldDef`，同「字段定义」），只对用该模板建的记录生效；增删改随模板保存，只需模板管理权限；与类型上的「字段定义」（类型属性）相对；合称模板的「元数据」（ADR-0039） | 01 §3.4 |
| 来源模板 | Source template / `templateId` | `entries.template_id` | —（不直接显示） | — | 记录新建时所用的模板（`builtin:<key>` 或 uuid），之后不可改；决定该记录多出哪些模板属性、不显示哪些类型属性（ADR-0039） | 01 §3.4 |
| 移除（类型属性） | Hidden field / `hiddenFields` | `entry_templates.hidden_fields` | 从本模板移除 / 已移除 / 恢复 | `template.meta.remove` | 模板把所绑类型的某个可省字段从自己的元数据里去掉：用它建的记录不显示、不预填该字段，值不动；必填与进流转的字段不可移除（ADR-0039） | 08 §2.13 |
