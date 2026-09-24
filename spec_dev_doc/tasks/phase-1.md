# tasks / Phase 1 —— 可用的工作台

> 状态：已采纳 · 版本：v3 · 更新：2026-09-24 · 最后对照代码：2026-09-24（Phase 1 全部任务，T1-036 审查） · 依据 ADR-0001 §7 §9.5、ADR-0003、00（Phase 1 REQ）、08 §2。
> 目标：空间 / 任务（列表、看板、今日、收件箱）/ 记录（编辑器全功能、模板、可见性、回收站）/ 标签 / 附件 / 评论与提及 / 搜索 / 通知中心与偏好 / 导出 / ⌘K 与 Peek 与主题等 UI / 移动端基础 / 成员生命周期与横切约定。
> 工期：计划值 ≈ 174h（本表脚本求和，见文末）；ADR-0001 §9.5 的「2.5 周」为历史乐观值，工期决定见 ADR-0003。
> 验收：00 中 `Phase = 1` 的 P0 REQ 全部有通过的测试（按本次 CI 实际运行的层计算，05 §5）；P1 完成 ≥ 80%（其余带 REQ 编号进 Phase 2）；性能预算（REQ-TASK-023、REQ-UI-015 · 017、REQ-EDITOR-014）CI 通过；移动视口 e2e 一组通过。

任务 ID `T1-NNN`；依赖含 Phase 0 的 `T0-*`；「完成定义」至少含一个以 REQ ID 开头的测试名（05 §5）。

## 任务表

### A. 空间

| ID | 任务 | 涉及文件 / 目录 | 依赖 | REQ | 估时 | 完成定义 |
|---|---|---|---|---|---|---|
| T1-001 | Spaces service + 路由（CRUD、归档只读、成员、reorder、`deleted=1`、`space.delete` 仅 owner/admin）、`space.invited` 事件、软删级联不可见 | `routes/spaces.ts`、`services/spaces.ts` | T0-009 · T0-024 | REQ-SPACE-001 ~ 008 | 5 | api `REQ-SPACE-003 空间 admin 删除 403`、`REQ-SPACE-004 归档后写操作 403`、`REQ-SPACE-006 空间邀请事件` 绿 + 角色矩阵 |
| T1-002 | 空间列表页 + Sidebar 空间树（拖排序、归档折叠）+ 新建 Dialog（颜色 token / 图标） | `routes/spaces.index.tsx`、`components/domain/SpaceSwitcher.tsx` | T1-001 · T0-020 | REQ-SPACE-005 · 008 · REQ-UI-020 | 4 | e2e `REQ-SPACE-005 拖动只发一条 PATCH 且仅一行 sort_key 变化`；`REQ-UI-020 glow-primary 引用 ≤ 3 处` 静态检查绿 |

### B. 任务

| ID | 任务 | 涉及文件 / 目录 | 依赖 | REQ | 估时 | 完成定义 |
|---|---|---|---|---|---|---|
| T1-003 | Tasks 读路径：CRUD 骨架、筛选（含 `view=today\|inbox`、`due=today\|week\|overdue` 服务端按用户时区、`*Id=me` 别名、不可见 `spaceId` 404）、排序白名单（含 `createdAt`）、游标、`limit` > 200 → 422、列表不返回 `descriptionPm` | `routes/tasks.ts`、`services/tasks.ts` | T1-001 · T0-012 | REQ-TASK-004 · 005 · 006 · 017 · 019 | 4 | api `REQ-TASK-004 游标无重复无遗漏且无 descriptionPm`、`REQ-TASK-005 今日边界按时区`、`REQ-TASK-006 收件箱只含创建者或指派人为我`、`REQ-TASK-019 viewer 写 403` 绿 |
| T1-037 | Tasks 写语义：乐观锁 `ifUpdatedAt` → 409 带 `current`、`Idempotency-Key`、软删 / 恢复 / 永久删（仅 owner/admin）、`deleted=1` 回收站查询 | `services/tasks.ts`、`middleware/idempotency.ts` | T1-003 | REQ-TASK-001 · 012 · 013 | 3 | api `REQ-TASK-001 同 Idempotency-Key 重放同 id`、`REQ-TASK-012 两客户端先后 PATCH 第二个 409 带 current`、`REQ-TASK-013 member 永久删 403` 绿 |
| T1-038 | Tasks 关系与派生：watchers（创建者 / 指派人自动加入）、子任务 2 层、`description_plain/tsv` 同事务派生、`rebuild-derived --tasks` | `services/tasks.ts`、`services/derive.ts` | T1-003 | REQ-TASK-008 · 014 · 015 | 2.5 | api `REQ-TASK-008 第 3 层子任务 422`、`REQ-TASK-014 watcher 增删影响接收者`、`REQ-TASK-015 PATCH descriptionPm 后 tsv 命中` 绿 |
| T1-004 | 任务事件：`task.assigned`（自动 watcher）、`task.completed` / `task.uncompleted`、`task.due_soon` 自循环作业（改期重算，每 task 24h 一条） | `services/tasks.ts`、`jobs/dueSoon.ts` | T1-038 · T0-024 | REQ-TASK-002 · 007 · 010 | 3 | 集成 `REQ-TASK-007 指派后 events 有行且新指派人在 watchers`、`REQ-TASK-002 操作者无通知`、`REQ-TASK-010 改期后再发一次` 绿 |
| T1-005 | 批量端点 `POST /tasks/batch`（事务、≤ 100、逐条结果） | `routes/tasks.ts` | T1-037 | REQ-TASK-016 | 2 | api `REQ-TASK-016 101 条 422、1 条无权整体回滚` 绿 |
| T1-006 | 列表页（虚拟列表、search params → API 参数映射表 08 §2.6、键盘 `j/k/x/e/Enter/Space` 勾选、`p` Peek、多选批量、完成折叠 + 8s 行内撤销） | `routes/spaces.$spaceSlug.tsx`、`components/domain/TaskRow.tsx`、`lib/searchParams.ts` | T1-003 · T1-037 · T1-005 · T0-019 | REQ-TASK-004 · 020 · 021 · REQ-UI-017 · 022 | 8 | e2e `REQ-TASK-020 j 下移且 3px 主色条`、`REQ-TASK-021 勾选 400ms 折叠、8s 撤销回 prevStatus 且发 task.uncompleted`、`REQ-UI-017 1 万行滚动 P95 帧间隔 ≤ 20ms` 绿 |
| T1-007 | 看板（dnd-kit、六列、拖拽三态、一条 batch、409 弹回、列计数滚动数字） | `components/domain/TaskKanbanCard.tsx`、`Board.tsx` | T1-006 | REQ-TASK-003 · 009 · REQ-UI-019 | 6 | e2e `REQ-TASK-003 拖到 done 只发一条 batch、mock 409 卡片回原列`、`REQ-UI-019 放不下弹回并晃动` 绿 |
| T1-008 | 今日 / 收件箱页（三段 / 定义筛选、`done=1` 折叠区、可输入空态、`c` 新任务默认值） | `routes/today.tsx`、`routes/inbox.tsx` | T1-006 | REQ-TASK-005 · 006 · REQ-UI-009 | 4 | e2e `REQ-TASK-005 改 timezone 后今日边界变化`、`REQ-UI-009 空看板显示乐章文案与输入框` 绿 |
| T1-009 | 任务详情 Sheet（就地编辑全部属性、失焦 PATCH、子任务、watchers、`Esc` 回列表恢复焦点） | `routes/spaces.$spaceSlug.tasks.$taskId.tsx`、`TaskDetailSheet.tsx`、`InlineEdit.tsx` | T1-006 · T1-038 | REQ-TASK-012 · 014 · REQ-UI-022 | 5 | e2e `REQ-UI-022 改标题失焦 1 次 PATCH 并显示「已保存 · 刚刚」`、`REQ-TASK-012 并发 409 提示并用 current 覆盖` 绿 |
| T1-010 | liteKit（任务描述 / 评论子集）+ `descriptionPm` 保存 | `src/client/editor/liteKit.ts` | T0-023 | REQ-TASK-015 | 3 | 单测 `REQ-TASK-015 liteKit schema 无 table/mermaid、评论子集无 heading` 绿 |
| T1-011 | 列表性能预算与慢 SQL：SQL ≤ 3 断言、P95 ≤ 100ms 采样进 `debug/perf/`、dev 下 Drizzle logger 打印 > 50ms SQL | `__tests__/perf.tasks.test.ts`、`db/logger.ts` | T1-003 | REQ-TASK-023 · REQ-OPS-010 | 2.5 | `REQ-TASK-023 列表接口查询数 ≤ 3 且 P95 ≤ 100ms`、`REQ-OPS-010 慢查询日志含 SQL 与耗时` 绿 |

### C. 记录与编辑器

| ID | 任务 | 涉及文件 / 目录 | 依赖 | REQ | 估时 | 完成定义 |
|---|---|---|---|---|---|---|
| T1-012 | Entries 完整路由：列表（excerpt、游标、筛选含 `author=me`）、可见性判定、修改 / 删除权限、固定 / 归档、移动空间、preview、回收站查询 `deleted=1` | `routes/entries.ts`、`services/entries.ts` | T0-013 | REQ-ENTRY-002 · 003 · 004 · 006 · 007 · 008 · 011 | 6 | api `REQ-ENTRY-003 三种可见性 × 五角色矩阵`、`REQ-ENTRY-002 列表无正文列且 excerpt ≤ 160`、`REQ-ENTRY-007 软删后 deleted=1 作者可见` 绿 |
| T1-013 | 记录列表页 + EntryCard + 新建 Dialog（kind + 标题）+ fields 表单（按 kind Zod 生成） | `routes/entries.index.tsx`、`EntryCard.tsx`、`EntryFieldsForm.tsx` | T1-012 · T0-019 | REQ-ENTRY-001 · 002 · 006 | 5 | e2e `REQ-ENTRY-001 新建 decision 的 fields 422 就地显示`、`REQ-ENTRY-006 固定项置顶` 绿 |
| T1-014 | 编辑器扩展全集：table、taskList、codeBlock(lowlight 20 语言 + 按需)、image（`src` 只接受 `xz:attachment/`）、attachment、link 协议白名单、highlight、details、drag-handle、placeholder、`unknownBlock` | `src/client/editor/fullKit.ts`、`extensions/*` | T0-023 | REQ-EDITOR-001 · 003 · 016 · 018 | 8 | 单测 `REQ-EDITOR-001 每节点 serializer 往返`、`REQ-EDITOR-016 未知节点保留 JSON`、`REQ-EDITOR-018 javascript: 链接被剥` 绿；e2e `REQ-EDITOR-003 选 rust 触发一次语言 chunk 请求` 绿 |
| T1-015 | 斜杠菜单（03 §11.1 全清单）+ 快捷键表（03 §11.2）+ IME 守卫 + 浮动工具条（`glass-thick` full） | `extensions/slash.tsx`、`BubbleMenu.tsx` | T1-014 | REQ-EDITOR-002 · 006 · 013 · 015 | 5 | e2e `REQ-EDITOR-002 /表 过滤出表格并插入 3×3`、`REQ-EDITOR-006 CDP IME composition 期间无 inputRule`、`REQ-EDITOR-013 Mod+Shift+2 变 H2 且全局键禁用` 绿 |
| T1-016 | 粘贴规则（Markdown / HTML / 纯文本 / URL，外域图片转存附件）+ 图片粘贴上传流程（占位 → 附件 → 替换，并发 3）+ 10MB 软限提示 / 20MB 硬限只读 | `extensions/paste.ts`、`upload.ts` | T1-014 · T1-020 | REQ-EDITOR-004 · 005 · 017 | 5 | 单测 `REQ-EDITOR-005 粘贴 Markdown 表格 → table 节点、含 font color 的 HTML 无颜色标记`；e2e `REQ-EDITOR-004 粘贴 PNG 后节点 src 为 xz: 协议`、`REQ-EDITOR-017 达 10MB 拒绝新附件` 绿 |
| T1-017 | Aside：大纲（table-of-contents）、属性页（可见性、标记版本、移动空间）、`?aside=outline\|backlinks\|comments\|props\|history` | `components/layout/Aside.tsx` | T1-013 · T0-023 | REQ-COLLAB-007 · REQ-ENTRY-011 | 3 | e2e `REQ-COLLAB-007 标记版本后 snapshots 多一条带 label`、`REQ-ENTRY-011 移动空间后原空间成员 404` 绿 |
| T1-018 | 协同健壮性：重连指数退避、票据过期重取、IndexedDB 不可用降级、多标签页 | `src/client/editor/provider.ts` | T0-023 | REQ-COLLAB-011 · 012 · 013 | 3 | e2e `REQ-COLLAB-011 重启 collab 进程后无丢字`、`REQ-COLLAB-013 两标签页无重复段`、`REQ-COLLAB-012 隐私模式提示且仍可同步` 绿 |
| T1-019 | 回收站页（任务 / 记录 / 空间、恢复、永久删；`member+` 可进，guest 见空列表） | `routes/trash.tsx` | T1-037 · T1-012 · T1-001 | REQ-ENTRY-007 · REQ-TASK-013 · REQ-SPACE-007 | 3 | e2e `REQ-ENTRY-007 删除 → 回收站可见 → 恢复`、`REQ-SPACE-007 member 永久删空间 403` 绿 |

### D. 标签、附件

| ID | 任务 | 涉及文件 / 目录 | 依赖 | REQ | 估时 | 完成定义 |
|---|---|---|---|---|---|---|
| T1-020 | Attachments：上传（MIME 魔数校验、白名单、大小、同 owner sha256 去重、SVG 栅格化为 PNG、限流、配额 5GB、上传即带 target）、**sharp 同步**生成变体 + blurhash（`limitInputPixels: 50e6`，不入队列）、下载（`can`、孤儿仅 owner、Range、ETag）、头像、孤儿清理 `gc.attachments`、`data/` 不直出 | `routes/attachments.ts`、`services/attachments.ts` | T0-009 · T0-026 | REQ-ATTACH-001 ~ 011 · REQ-OPS-008 | 7 | api `REQ-ATTACH-001 伪造 MIME 415、超限 413`、`REQ-ATTACH-005 SVG 存为 PNG 无 script`、`REQ-ATTACH-002 跨用户同 sha256 两条行`、`REQ-ATTACH-003 无权 404、Range 206`、`REQ-ATTACH-011 孤儿附件仅 owner 可读`、`REQ-OPS-008 用量 5GB 上传 413 QUOTA_EXCEEDED` 绿；e2e `REQ-ATTACH-010 /data/... 404` 绿 |
| T1-021 | Tags：CRUD、唯一、8 色 token、`?tag=` 筛选、TagPicker 输入即创建 | `routes/tags.ts`、`TagPicker.tsx` | T1-003 · T1-012 | REQ-TAG-001 · 002 · 003 | 3 | api `REQ-TAG-001 重名 409、非 token 色 422`；e2e `REQ-TAG-003 输入新标签回车创建并附加` 绿 |

### E. 评论与提及

| ID | 任务 | 涉及文件 / 目录 | 依赖 | REQ | 估时 | 完成定义 |
|---|---|---|---|---|---|---|
| T1-022 | Comments service + 路由（线程、解决权限、软删占位、`orphaned` 列）、`task.commented / entry.commented` 事件与合并策略、其他新增事件 kind（`member.joined`、`task.unassigned`）的 fanout 模板 | `routes/comments.ts`、`services/comments.ts`、`jobs/fanout.ts` | T1-003 · T1-012 · T0-024 | REQ-COMMENT-001 · 003 · 005 · 007 · REQ-NOTIF-015 | 4.5 | api `REQ-COMMENT-001 guest viewer 可评论`、`REQ-COMMENT-003 guest 评论作者解决 403`、`REQ-COMMENT-005 目标作者收到、操作者不收`、`REQ-NOTIF-015 01 §4 每种有默认通道的 kind 投递通道集合正确` 绿 |
| T1-023 | CommentThread 组件（liteKit 子集、Enter 提交）+ 任务详情与记录 Aside 接入；编辑器 `comment` 标记与 orphaned | `CommentThread.tsx`、`extensions/comment.ts` | T1-022 · T1-010 · T1-014 | REQ-COMMENT-002 · 004 | 4 | e2e `REQ-COMMENT-002 删除锚定文本后线程 orphaned 仍在侧栏`、`REQ-COMMENT-004 /标题 无候选且 Enter 发送` 绿 |
| T1-024 | 评论 @ 提及：suggestion 候选（空间可见成员）、`mentions` 写入、`mention.created` + `can(read)` 过滤 | `extensions/mention.tsx`、`services/mentions.ts` | T1-022 | REQ-COMMENT-006 | 3 | 集成 `REQ-COMMENT-006 提及无权用户有 mentions 行但无通知` 绿 |

### F. 搜索

| ID | 任务 | 涉及文件 / 目录 | 依赖 | REQ | 估时 | 完成定义 |
|---|---|---|---|---|---|---|
| T1-025 | 搜索服务（02 §4.1：jieba、`ts_rank_cd` 权重、trgm 兜底、`ts_headline`、分组游标、`visible*Where`、限流、`types` 逗号分隔） | `services/search.ts`、`routes/search.ts` | T1-003 · T1-012 | REQ-SEARCH-001 ~ 005 | 5 | api `REQ-SEARCH-002 中文词级命中`、`REQ-SEARCH-003 子串兜底`、`REQ-SEARCH-004 他人 private 不出现`、`REQ-SEARCH-005 第 61 次 429 且 1 万条 P95 ≤ 150ms` 绿 |
| T1-026 | 搜索页 + ⌘K 搜索直达（输入即切换、Enter 开首项、`<mark>` 渲染） | `routes/search.tsx`、`CommandPalette.tsx` | T1-025 · T1-029 | REQ-SEARCH-006 | 3 | e2e `REQ-SEARCH-006 ⌘K 输入「缓存」候选为搜索结果、Enter 打开首项` 绿 |

### G. 通知

| ID | 任务 | 涉及文件 / 目录 | 依赖 | REQ | 估时 | 完成定义 |
|---|---|---|---|---|---|---|
| T1-027 | 通知中心页（全部 / 提及 `?kind=mention.created` / 未读）+ 铃铛面板 + 偏好页（按 kind × 通道 × 摘要档，缺行默认表）+ `invalidate` 事件接 Query + 他人通知 404（`presence` 属 Phase 2） | `routes/notifications.tsx`、`routes/settings.notifications.tsx`、`useRealtime.ts` | T0-025 · T0-019 · T1-022 | REQ-NOTIF-004 · 005 · 006 · 007 · 012 · 015 | 6 | e2e `REQ-NOTIF-005 点击通知跳深链并已读、read-all 后未读 0`、`REQ-NOTIF-004 他人改任务后 ≤ 2s 列表更新`；api `REQ-NOTIF-006 偏好关闭后不再收`、`REQ-NOTIF-007 3 分钟内 3 次评论合并为 1 条` 绿 |

### H. 导出

| ID | 任务 | 涉及文件 / 目录 | 依赖 | REQ | 估时 | 完成定义 |
|---|---|---|---|---|---|---|
| T1-028 | 导出作业：`POST /exports` 202、`GET /jobs/:id`、Markdown serializer（有损明示）、frontmatter、assets、zip、HTML 导出、重试 3 次、`system.export_done`、`gc.exports` 7 天 | `jobs/export.ts`、`shared/editor/serializers/markdown.ts`、`routes/jobs.ts` | T1-012 · T1-020 · T0-024 | REQ-EXPORT-001 · 002 · 003 · 006 · 007 | 6 | 单测 `REQ-EXPORT-002 每自定义节点 Markdown 往返且 frontmatter 字段齐全`、`REQ-EXPORT-007 持续抛错 4 次后 failed 且 audit 有行`；e2e `REQ-EXPORT-001 导出 → 通知 → 下载 zip 结构断言` 绿 |
| T1-041 | 导出权限：内容按发起人 `visible*Where` 过滤，`scope=workspace` 仅 admin | `jobs/export.ts`、`routes/exports.ts` | T1-028 | REQ-EXPORT-008 | 1.5 | api `REQ-EXPORT-008 member 请求 scope=workspace 403、导出 zip 不含他人 private 记录` 绿 |

### I. UI 与交互

| ID | 任务 | 涉及文件 / 目录 | 依赖 | REQ | 估时 | 完成定义 |
|---|---|---|---|---|---|---|
| T1-029 | ⌘K 上下文命令（`CommandContext`、`commands.ts` 注册表、第一组 / 第二组、KeyHint）+ 全局快捷键（react-hotkeys-hook、`?` 面板、编辑器聚焦时禁用；列表内完成用 `Space`、Peek 用 `p`） | `CommandPalette.tsx`、`lib/commands.ts`、`lib/hotkeys.ts` | T1-006 · T1-013 | REQ-UI-005 · 006 | 5 | e2e `REQ-UI-005 焦点在任务上 ⌘K 首组为任务命令`、`REQ-UI-006 g i 跳收件箱、? 打开面板` 绿 |
| T1-030 | Peek 面板（悬停 600ms / `p`、宽 480、不改 URL、Enter 升级、Radix `modal=false` 无 Scrim）+ 任务 / 记录 / 反链 / 搜索接入 | `PeekPanel.tsx` | T1-006 · T1-013 | REQ-UI-007 | 4 | e2e `REQ-UI-007 悬停 700ms 面板可见且 URL 不变、Enter 后 URL 变为详情` 绿 |
| T1-031 | StatusPill + 形变 Toast（Sonner 队列 API + Topbar 内自建容器、Motion `layoutId`、错误红条、reduced-motion 淡入；以 T0-019 原型结论为准） | `StatusPill.tsx`、`toast.tsx` | T0-020 · T0-019 | REQ-UI-008 | 3 | visual `REQ-UI-008 Toast 三态截图`；e2e `REQ-UI-008 导出完成后胶囊展开 4s 后缩回、reduced-motion 下无 layout 动画` 绿 |
| T1-032 | 密度切换、相对时间 / 绝对时间、乐观更新模板 `optimisticPatch` + 409 覆盖、骨架屏 > 400ms 规则、空状态组件 EmptyState（可输入） | `lib/optimistic.ts`、`EmptyState.tsx`、`lib/time.ts` | T0-019 | REQ-UI-009 · 010 · 011 · 018 | 4 | 单测 `REQ-UI-010 optimisticPatch 网络 500 回滚并 Toast`；e2e `REQ-UI-011 compact 行高 −20%`、`REQ-UI-018 5 分钟前显示相对时间且 title 为绝对时间` 绿 |
| T1-033 | 个人设置页（display / locale / timezone / weekStartsOn）+ API Key 页（scope、过期、限流 300/min、权限不超过持有者） | `routes/settings.index.tsx`、`routes/settings.api-keys.tsx` | T0-022 | REQ-WS-010 · REQ-AUTH-010 | 3 | e2e `REQ-WS-010 改 timezone 后今日列表变化`、`REQ-AUTH-010 Key 明文只显示一次、read scope 调 POST 403 SCOPE` 绿 |
| T1-034 | 移动端基础：底部导航接真实页面、任务行左滑完成 / 右滑改期 / 长按多选、编辑器底部工具条随键盘、触控目标 ≥ 40、`< lg` blur 降级 | `components/mobile/*`、`tokens.css` | T1-006 · T1-015 · T0-020 | REQ-MOBILE-001 · 002 · 003 · 006 · 007 | 5 | 移动视口 e2e `REQ-MOBILE-002 左滑 > 40% 完成`、`REQ-MOBILE-003 工具条贴键盘`、`REQ-MOBILE-006 390 视口 --xz-blur-thick ≤ 12px`；a11y `REQ-MOBILE-007 无 < 40px 可点击元素` 绿 |
| T1-035 | 性能预算总验：首屏 ≤ 250KB、Lighthouse ≥ 90、编辑器 chunk ≤ 400KB、3k 词打开 ≤ 800ms、同屏 blur ≤ 6（含 Scrim）、axe 每路由 | `scripts/check-budget.ts`、`e2e/perf.spec.ts`、`e2e/a11y.spec.ts` | T1-007 · T1-009 · T1-016 · T1-027 · T1-030 · T1-031 · T1-034 | REQ-UI-013 · 015 · 016 · REQ-EDITOR-014 | 4 | CI `REQ-UI-015 check-budget ≤ 250KB 且 Lighthouse ≥ 90`、`REQ-UI-016 看板页 backdrop-filter ≤ 6`、`REQ-EDITOR-014 3k 词 ≤ 800ms`、`REQ-UI-013 axe 0 serious` 绿；报告存 `debug/perf/` |
| T1-036 | Phase 1 一致性审查（05 §9）：REQ 覆盖矩阵、schema / openapi 漂移、规范「最后对照代码」更新、未完成 P1 迁入 Phase 2 任务表、CHANGELOG | `spec_dev_doc/` | T1-035 · T1-039 · T1-040 · T1-041 · T1-042 | — | 3 | `req-coverage.json` 中 Phase 1 P0（已运行层）= 100%；drift 零差异；CHANGELOG 有条目 |

### J. 横切与成员生命周期

| ID | 任务 | 涉及文件 / 目录 | 依赖 | REQ | 估时 | 完成定义 |
|---|---|---|---|---|---|---|
| T1-039 | 成员停用 / 恢复（Better Auth admin `ban-user` 包装为 `POST /workspace/members/:userId/suspend\|unsuspend`，同事务吊销 + `user.revoked` 广播 + 审计）与成员页；注销 `DELETE /me`（匿名化）与批量转移作者 `POST /workspace/members/:userId/transfer-content` 标 **Phase 2 顺延** | `routes/workspace.ts`、`services/members.ts`、`routes/settings.workspace.members.tsx` | T0-011 · T0-022 | REQ-WS-014 · 015 · 016 | 5 | api `REQ-WS-014 停用后会话 0、WS 1s 内断开、audit member.suspended、恢复后需重新登录` 绿；015 / 016 的测试名占位，Phase 2 实现 |
| T1-040 | 横切约定验收：`Idempotency-Key` 覆盖全部创建端点（spaces / tasks / entries / comments / tags / links / attachments / exports）+ Problem Details 信封（`Content-Type`、`code`、`requestId`、422 `errors[].path`）全端点断言 | `middleware/idempotency.ts`、`__tests__/crosscut.test.ts` | T1-037 · T1-001 · T1-012 · T1-022 · T1-021 · T1-020 · T1-028 | REQ-OPS-013 · 014 | 3 | api `REQ-OPS-013 每个创建端点同 Idempotency-Key 重放同资源`、`REQ-OPS-014 每个路由错误响应为 problem+json 且带 requestId` 绿 |
| T1-042 | collab 访问变更广播：空间成员变更 / 记录可见性变更 / 移动空间时 `entry.access_changed(entryIds)`，collab 重新 `can()`、降级只读或断开；替代定时复核 | `services/spaces.ts`、`services/entries.ts`、`src/collab/server.ts` | T0-014 · T1-001 · T1-012 | REQ-COLLAB-016 | 2 | 集成 `REQ-COLLAB-016 移出空间后 1s 内该成员连接转只读或断开` 绿 |
| T1-043 | 设置页四页：`/settings/api-keys`（列表 / 新建一次性显示 / 撤销，scope 选择）、`/settings/workspace`（名称 / slug / Logo）、`/settings/workspace/members`（成员列表、邀请、改角色、移除；停用 / 恢复按钮由 T1-039 接入）、`/settings/workspace/audit`（游标分页、按动作 / 操作人筛选）；admin+ 门禁（member 访问工作区页 404） | `routes/settings.api-keys.tsx`、`routes/settings.workspace.*.tsx` | T0-010 · T0-011 · T0-022 | REQ-AUTH-010 · REQ-WS-001 · 002 · 004 · 005 | 5 | e2e `REQ-AUTH-010 新建 Key 只显示一次、撤销后 401`、`REQ-WS-005 admin 审计页翻页、member 访问 404` 绿；axe 0 serious |

**估时合计：179h**（脚本按第 6 列求和；2026-09-24 并入 T1-043 +5h）。裁剪建议：T1-018、T1-024、T1-030、T1-034 的手势部分（保留底部导航）、T1-032 的密度切换、T1-039 的 015/016 可顺延至 Phase 2 首周，核心 P0 路径约 125h；取舍见 ADR-0003。

## 里程碑

| # | 节点 | 包含任务 | 可演示什么 |
|---|---|---|---|
| M1.1 任务闭环 | T1-001 ~ T1-011 · T1-037 · T1-038 · T1-043 | 建空间 → 列表 / 看板 / 今日 / 收件箱 → 拖拽 → 详情就地编辑 → 撤销 |
| M1.2 记录闭环 | T1-012 ~ T1-021 | 新建各 kind 记录 → 全功能编辑器 → 图片粘贴 → 标签 → 回收站 |
| M1.3 协作闭环 | T1-022 ~ T1-029 · T1-041 · T1-042 | 评论 / 提及 → 通知中心与偏好 → ⌘K 上下文 → 搜索直达 → 导出 zip |
| M1.4 打磨与验收 | T1-030 ~ T1-036 · T1-039 · T1-040 | Peek、形变 Toast、移动端、成员停用、横切验收、预算与 a11y 全绿 |

## 裁定记录（2026-09-23）

1. **工期**：计划值取本表脚本求和；ADR-0001 §9.5 的「2.5 周」为历史乐观值，正式取代见 **ADR-0003**；是否砍 P1 由 ADR-0003 决定。
2. `view=today|inbox` 与 `due=today|week|overdue` 由服务端实现（02 §9），T1-008 估时不变。
3. 配额 5 GB、SVG 栅格化、正文 10/20 MB、sharp 同步生成变体按 00 §21 裁定。
4. T1-003 拆为 T1-003 / T1-037 / T1-038；T1-026 依赖改为 T1-025 · T1-029。

## 裁定记录（2026-09-24）

5. 08 §1 标为 Phase 0 的四个设置页（api-keys / workspace / members / audit）在 Phase 0 无任务，用户裁定并入 Phase 1：新增 **T1-043**（5h），归入 M1.1 首周；成员页的停用 / 恢复仍属 T1-039。

## 进度记录

### 2026-09-24

| ID | 状态 | 备注 |
|---|---|---|
| T1-001 | 完成 | `services/spaces.ts` 全量 CRUD / 归档 / 软删 / 恢复 / 永久删 / 成员增删改 / reorder，`routes/spaces.ts` 14 条路由（`:id` 兼收 slug）；`spaces-crud.test.ts` 10 例覆盖 REQ-SPACE-001 ~ 008 + 端点 × 角色矩阵。顺带修复：`sort_key` 按库默认排序规则比较导致拖到最前失效（迁移 0003 改 `COLLATE "C"`，debug/2026-09-24-sort-key-collation）；gc 永不清除软删空间（debug/2026-09-24-gc-soft-deleted-space）。REQ-SPACE-004 · 007 中「任务 403 / 404」以记录接口验证同一 authz 规则，任务接口（T1-003 / T1-037）就绪后补同名断言 |
| T1-002 | 完成 | `routes/_app.spaces.index.tsx`（我的 / 其他可见 / 归档折叠 `?archived=1`、骨架 6 卡、空态、错误重试）、`components/domain/SpaceSwitcher.tsx`（dnd-kit 拖手柄排序，一次放下一条 PATCH，乐观更新失败回滚；键盘可拖、中文读屏播报；归档折叠懒加载）、`CreateSpaceDialog.tsx`（名称 / slug / 类型 / 可见性 / 8 色 token / 精选 Lucide 图标，字段级错误）、`SpaceCard.tsx`（归档 / 取消归档）；`/spaces/$spaceSlug` 先落页头 + 归档横幅，视图由 T1-006 / 007 补。`check-css` 加 glow-primary ≤ 3 门槛（REQ-UI-020 单测）。e2e `spaces.spec.ts` 4 例（REQ-SPACE-005 · 008 · 004 · 002），a11y 扫描加三条空间路由。首屏 126 → 127.5 KB：路由 loader 只引无 React 依赖的 `lib/space-queries.ts`，否则 useMutation 进首屏（+6 KB） |
| T1-003 | 完成 | `services/tasks.ts` + `routes/tasks.ts`：列表（全部筛选、`view=today\|inbox`、`due=today\|week\|overdue` 按用户时区、`*Id=me`、不可见 `spaceId` 404、6 字段排序白名单 + 游标、`limit` ≤ 200、不返回 `descriptionPm`）、详情、创建（缺省个人空间、列底 sortKey、派生列同事务）、修改（乐观锁、换列 / 换空间、指派人可见性校验）、软删。`tasks.test.ts` 7 例覆盖 REQ-TASK-004 · 005 · 006 · 017 · 019；`tz.test.ts` 4 例。顺带修复：时间列微秒精度导致游标翻页死循环（迁移 0004 改毫秒，debug/2026-09-24-timestamp-precision-cursor），影响 entries / spaces 列表同样修正。恢复 / 永久删 / 幂等留给 T1-037，watchers / 子任务层级留给 T1-038，事件留给 T1-004 |
| T1-037 | 完成 | `middleware/idempotency.ts`（占位防并发 → 409 `CONFLICT_IN_FLIGHT`、只记 2xx、失败可重试、24h 过期、他人 key 不回放），挂在 `POST /tasks · /spaces · /entries`；任务恢复 / 永久删（owner/admin，审计）/ 回收站范围（创建者或 owner/admin）；创建者 / 指派人自动 watcher。`tasks.test.ts` +5 例覆盖 REQ-TASK-001 · 012 · 013。前端「409 用 current 覆盖缓存并 Toast」（REQ-TASK-012 e2e 部分）随 T1-009 详情 Sheet |
| T1-038 | 完成 | watchers 三个端点（GET / POST / DELETE），权限见 02 §9 注；子任务 2 层与父子同空间校验；描述派生同事务（T1-003 已接入 `taskDerivedSet`，`xz rebuild-derived --tasks` 复用同一函数）；`task.commented` 接收者加 watchers。`tasks.test.ts` +3 例覆盖 REQ-TASK-008 · 014 · 015 |
| T1-004 | 完成 | 指派 / 完成 / 撤销完成事件在 service 同事务 emit（新建、PATCH、batch、complete / uncomplete 全覆盖）；`POST /tasks/:id/complete · uncomplete`；`jobs/dueSoon.ts`（每 15 分钟，按（任务，截止时刻）去重）；扇出对 `task.uncompleted` 原地改写完成通知。`tasks-events.test.ts` 覆盖 REQ-TASK-002 · 007 · 010 · 021（api 部分）。recurrence 下一实例属 Phase 2 |
| T1-005 | 完成 | `POST /tasks/batch`：每条在各自的保存点里执行，任一失败整体回滚，返回首个失败状态码 + 逐条 `results`；REQ-TASK-016 绿 |
| T1-011 | 完成 | 列表 / 详情改为 ≤ 3 条查询（空间校验 1 + 主查询 join slug 与指派人 1 + 标签 1）；`perf.tasks.test.ts` 1 万任务 5 种查询 P95 均 ≤ 100ms，报告写 `debug/perf/tasks-list.json`；`db/index.ts` 的 `instrumentPool` 覆盖事务连接（REQ-TASK-023 · REQ-OPS-010） |
| T1-012 | 完成 | preview 端点；个人空间只允许 private（缺省 private）；UUID 参数（原先非法 id 会 500）；列表不读正文列；`entries-p1.test.ts` 7 例覆盖 REQ-ENTRY-002 · 003（三可见性 × 五角色矩阵）· 004 · 006 · 007 · 008 · 011。「无 spaceId → 422」与既有规范冲突，已加注保留缺省落个人空间 |
| T1-042 | 完成 | 空间成员增删改、可见性变更、移动空间、归档 / 软删都会发 `entry.access_changed`（T1-001 / T1-012 已接入）；collab 集成测试补两条 REQ-COLLAB-016（改 private、移出空间），测试总线改为与服务层同一单例。collab 对带 `spaceId` 的广播复核全部连接，规模小时足够，暂不优化 |
| T1-021 | 部分（后端完成） | tags CRUD + `usage` 计数、`?tag=a,b` 多值；authz `tag.create / tag.manage`；`tags.test.ts` 覆盖 REQ-TAG-001 · 002。TagPicker 与 REQ-TAG-003 e2e 随任务详情前端（T1-009） |
| T1-020 | 完成 | `lib/sniff.ts` 魔数识别；`services/attachments.ts` 上传（415 / 413 / 配额 / 去重 / SVG 栅格化 / webp 变体 + blurhash / 目标权限）与下载（Range / ETag / 304 / download）；`POST /me/avatar` 方形裁切并写 `user.image`；生产静态托管 `/data`、`/uploads` 404。`attachments.test.ts` 12 例覆盖 REQ-ATTACH-001 ~ 007 · 009 · 010 · 011、REQ-OPS-008；REQ-ATTACH-010 另有 infra e2e（经 Caddy）。REQ-ATTACH-008（中断重试幂等）靠 sha256 去重实现，e2e 随编辑器图片上传（T1-016） |
| T1-022 | 完成 | `services/comments.ts` + `routes/comments.ts`：线程、回复、编辑（乐观锁）、软删占位、按线程解决 / 取消解决；`task.commented / entry.commented` 同事务 emit；`services/refs.ts` 统一加载授权引用。`comments.test.ts` 覆盖 REQ-COMMENT-001 · 003 · 005 · 007 与 REQ-NOTIF-012（14 种有默认通道的 kind 投递通道矩阵；完成定义里误写为 015） |
| T1-024 | 部分（后端完成） | 评论提及写 `mentions` 并发 `mention.created`，编辑时只对新增提及发；扇出按评论所在目标过滤（REQ-COMMENT-006 绿）。suggestion 候选与编辑器扩展随 T1-023 |
| T1-025 | 完成 | `services/search.ts` + `routes/search.ts`：分组游标、visible*Where、归档 / 软删排除、加权排序、JS 高亮、`recent` 空查询、60/min 限流；迁移 0005 trgm 索引；tsv 改为标题 A + 正文 D。`search.test.ts` 5 例覆盖 REQ-SEARCH-001 ~ 005（1 万任务 P95 ≤ 150ms）。两处规范偏差见 02 §4.1 注 |
| T1-028 | 完成 | `shared/editor/serializers/markdown.ts · html.ts`（直接遍历 PM JSON）、`jobs/export.ts`（zip / 单文件、frontmatter、assets、tasks.json、cycles.json、README，内置重试）、`lib/job-queue.ts`（pg-boss / inline）、`routes/exports.ts`（exports、jobs、单篇导出）。`exports.test.ts` 覆盖 REQ-EXPORT-002 · 003 · 006 · 007；e2e `export.spec.ts` 覆盖 REQ-EXPORT-001（真实 worker） |
| T1-041 | 完成 | 导出内容按发起人 visible*Where 过滤，owner 的全量导出同样看不到他人 private；`scope=workspace` 仅 owner/admin（REQ-EXPORT-008 绿） |
| T1-039 | 部分（后端完成） | 停用 / 恢复在 T0-011 已实现并有 api 测试；本次补 collab 集成「停用后 WS 1s 内 4403、恢复后可重新取票」；REQ-WS-015 · 016 测试名以 `it.todo` 占位（Phase 2）。成员页 UI 并入 T1-043 |
| T1-031 | 完成 | 状态胶囊形变 Toast（T0-019 原型）接 SSE：`system.export_done` 到达即弹，4s 缩回；错误红条改伪元素实现（原 border 被盖掉）。e2e `feedback.spec.ts` 3 例：导出完成展开 / 缩回、reduced-motion 无 transform、三态截图基线（REQ-UI-008） |
| T1-032 | 部分 | 已完成：`lib/time.ts` + `RelativeTime`（REQ-UI-018 单测）、`lib/optimistic.ts`（REQ-UI-010 / REQ-TASK-012 单测：500 回滚、409 用 current 覆盖）、`useDelayedFlag`（> 400ms 骨架）、`EmptyState`（可输入）、密度 store + `--xz-row-h` token。页面级 e2e（REQ-UI-009 · 010 · 011 · 018）随 T1-006 ~ T1-009 |
| T1-010 | 完成 | `editor/liteKit.ts`（描述 / 评论两个变体，与服务端 LITE_NODES / COMMENT_NODES 一致）；`liteKit.test.ts` 用 getSchema 在 node 环境断言（REQ-TASK-015 · REQ-COMMENT-004）。LiteEditor 组件随 T1-009 |
| T1-006 | 完成 | `TaskRow` / `TaskList`（窗口虚拟化、grid 语义、j / k / x / Space / Enter / e / p / Esc、完成变灰 → 400ms 折叠 → 8s 撤销、多选批量条）、空间页 list 视图与筛选（URL 参数与 API 同名）。e2e：REQ-TASK-020 · 021、REQ-UI-017（1 万行 rAF P95 ≤ 20ms，连跑稳定）、REQ-UI-010 · 011 |
| T1-007 | 完成 | `Board`：六列独立查询 + 列级重试、done / cancelled 默认折叠、拾起倾斜放大 / 目标列高亮 / 弹簧放下（时长与缓动运行时取 token）/ 列外松手晃动弹回、一条 batch、409 回原列 + 提示、列头滚动计数、全空时乐章文案。e2e：REQ-TASK-003、REQ-UI-019、REQ-UI-009 |
| T1-008 | 完成 | 今日（三段 + 今天完成的折叠区 + 空态输入默认截止今天）、收件箱（就地改空间 / 状态）；侧栏与底部导航接入收件箱。e2e：REQ-TASK-005（改时区后今日边界变化）|
| T1-009 | 完成 | 任务详情 Sheet（子路由）：InlineEdit 标题、属性网格（状态 / 优先级 / 指派候选按空间可见性 / 截止 / 计划 / TagPicker / 预估）、LiteEditor 描述（失焦保存）、子任务、关注 / 取消关注、「已保存 · 刚刚」、409 覆盖提示。e2e：REQ-UI-022、REQ-TASK-012、REQ-UI-018、REQ-TAG-003。评论线程随 T1-023 |
| T1-021 | 完成 | TagPicker（输入即创建，回车语义：方向键选中 > 精确命中 > 新建）接入任务详情；REQ-TAG-003 e2e 绿 |
| T1-032 | 完成 | 页面级 e2e 补齐：REQ-UI-009（空看板 / 空列表可输入）、REQ-UI-010（500 回滚）、REQ-UI-011（compact 行高 0.8）、REQ-UI-018（5 分钟前 + 绝对时间 title） |
| T1-014 | 完成 | `editor/kit.ts` 重写：`schemaKit`（03 §3.1 全部节点 / 标记，无颜色 / 字体）+ `fullKit`（协同、上传占位、粘贴、斜杠）；节点视图 `views.tsx`（代码语言选择 + 按需语言、图片 blurhash 占位、附件卡、记录卡片、目录、未知块）；链接白名单；拖拽手柄；`UnknownGuard`。单测：REQ-EDITOR-001（schema 全集 + 每节点 fromJSON / toJSON / 导出往返）、016、018；e2e REQ-EDITOR-003 |
| T1-015 | 完成 | 斜杠菜单 `slash.tsx`（03 §11.1 全清单、中文触发词走 i18n、≤ 8 条、Esc 保留 `/`、glass-thick 弹层）、`GiKeymap`（Mod+Shift+1..4 / 0、Mod+S、Mod+K、Mod+Alt+↑↓、`:::kind ` 转 callout）、浮动工具条 `BubbleBar.tsx`（glass-thick 全圆角，链接走白名单）、记录选择器 `EntryPicker.tsx`。e2e：REQ-EDITOR-002 · 006 · 013 · 015 |
| T1-016 | 完成 | `paste.ts`（Markdown 启发式 + markdown-it、HTML 净化、外部图片提示、2MB 截断）、`upload.ts`（Decoration 占位、并发 3、大小上限、10MB 软限与 200 张图片上限）。单测 REQ-EDITOR-005；e2e REQ-EDITOR-004 · 005 · 017。修复：上传回调闭包拿到重建前的编辑器（debug/2026-09-24-editor-stale-closure） |
| T1-013 | 完成 | `/entries` 与 `/spaces/$slug/entries`（`EntriesPage`：kind / 只看我的 / 标题 / 排序筛选进 URL，固定项置顶，骨架 6 卡，按 kind 空态）、`EntryCard`、`NewEntryDialog`（`e` 全局快捷键，懒加载；fields 表单由 Zod shape 生成，422 就地显示）、记录页标题就地编辑 / 固定 / fields 自动保存。e2e：REQ-ENTRY-001 · 006 |
| T1-017 | 完成 | `EntryAside`：`?aside=` 五页签；大纲实时（`useOutline`，点击跳转）；属性页（可见性、移动空间、标记版本 + 已标记列表、作者 / 时间 / 字数 / 版本号）。反链、历史为 Phase 2，评论随 T1-023。e2e：REQ-COLLAB-007、REQ-ENTRY-011 |
| T1-018 | 完成 | IndexedDB 可用性探测，不可用时仅内存运行并提示；Provider 显式指数退避（1s ×2 封顶 30s 抖动）；票据每次重连重取；多标签页共享 IndexedDB。e2e：REQ-COLLAB-011（杀 collab 进程后由 respawn 拉起）· 012 · 013 |
| T1-019 | 完成 | `/trash`：任务 / 记录 / 空间三个 Tab、剩余天数、恢复；永久删除仅 owner/admin，需确认弹层。e2e：REQ-ENTRY-007（删除 → 回收站 → 恢复）、REQ-SPACE-007（member 永久删 403 且无按钮） |
| T1-023 | 完成 | `Comments.tsx`（线程分组、liteKit 评论子集、Enter 发送 / Shift+Enter 换行、解决 / 取消解决、删除占位、orphaned 标识）接入任务详情与记录 Aside；浮动工具条「评论」给选区套 comment 标记后写首条，取消则移除标记；派生层 `syncCommentAnchors` 同步 orphaned（`comments-anchor.test.ts`）。e2e：REQ-COMMENT-002 · 004 |
| T1-024 | 完成 | 评论 @ 提及候选（`editor/mention.tsx`，候选为空间可读成员 `useSpaceCandidates`；候选打开时 Enter 选择而非发送）；服务端写入与过滤在 G3 已完成（REQ-COMMENT-006 绿） |
| T1-026 | 完成 | `/search`（两组各自游标、`<mark>` 渲染组件 `Highlight` 不走 innerHTML、最近访问、429 提示、Enter 开首项、行悬停 Peek）；⌘K 输入即搜索、Enter 打开首项。e2e：REQ-SEARCH-006 |
| T1-027 | 完成 | `/notifications`（全部 / 提及 / 未读、点击跳深链并已读、全部已读、归档）、铃铛面板改为可点击 + 查看全部；`/settings/notifications` 偏好（站内 = in_app + sse、邮件、WebPush 二期置灰、摘要档）；后端补 preferences GET / PUT 与 `data.changed` 实时失效。api：REQ-NOTIF-006 · 007（`notif-prefs.test.ts`）、REQ-NOTIF-004（`realtime.test.ts`）；e2e：REQ-NOTIF-004 · 005 |
| T1-029 | 完成 | `hooks/useCommands.ts` 注册表 + `CommandPalette.tsx`（上下文首组：任务改状态 / 指派 / 设截止 / 移到周期（置灰）/ 打开 / 预览；记录标记版本 / 导出 / 移动 / 固定；空间新建任务 / 记录 / 邀请；二级页）+ `ShortcutsDialog.tsx`；`useHotkeys` 支持序列键；上下文由 TaskList 焦点 / 看板卡片 / 详情 / 空间页 / 记录页登记。e2e：REQ-UI-005 · 006 |
| T1-030 | 完成 | `PeekPanel.tsx`（非 modal Sheet、宽 480、无 Scrim、不抢焦点、Esc 关闭、Enter 升级改 URL）；任务行 / 看板卡片 / 记录卡片 / 搜索结果悬停 600ms 或 `p` 打开。e2e：REQ-UI-007 |
| T1-033 | 完成 | `/settings` 个人页（显示名、时区、周起始；主题 / 密度为本机偏好；改动即保存「已保存 · 刚刚」，改时区后失效任务列表）、`/settings/api-keys`（新建一次性明文 + 复制、scope 不超过角色、过期、撤销确认）。e2e：REQ-WS-010（设置页改时区后今日列表变化）、REQ-AUTH-010（明文只显示一次、read scope POST 403 SCOPE、撤销后 401） |
| T1-043 | 完成 | 设置布局 `_app.settings.tsx`（二级导航，admin 分组）；`/settings/workspace`（名称可改、slug 只读）、`/settings/workspace/members`（成员 / 邀请 Tab、改角色、停用 / 恢复、移除、所有权转让、邀请与撤销）、`/settings/workspace/audit`（动作 / 操作人筛选、游标加载更多）；非 admin 404。e2e：REQ-WS-005（翻页 + member 404）、REQ-WS-002（改角色即时生效）；axe 覆盖全部设置页 |
| T1-039 | 完成 | 成员页停用 / 恢复按钮接入（后端与 collab 断连在 G4 已完成） |
| T1-034 | 完成 | 底部导航五项接真实页面（今日 / 收件箱 / 搜索 / 通知 / 我）；任务行触摸手势 `useSwipeRow`（左滑 > 40% 完成、右滑改期到明天、长按多选）；编辑器 `MobileToolbar`（< lg 聚焦时固定底部，按 visualViewport 贴键盘）；窄屏触控目标 ≥ 40（`::after` 点击区）；blur 窄屏降到 12px（T0-020 已有）。e2e（390 视口）：REQ-MOBILE-002 · 003 · 006 · 007 |
| T1-040 | 完成 | 邀请端点补 `idempotency`；`crosscut.test.ts`：8 个创建端点（空间 / 任务 / 记录 / 评论 / 标签 / 附件 / 邀请 / 导出）同 key 回放同资源、行只增 1；非 UUID key 422；遍历全部 `/api/v1` 路由：未登录 401、所有错误响应 problem+json 含 code / status / requestId。`/links`、`/cycles` 属 Phase 2 |
| T1-035 | 完成 | check-budget 首屏 140.2 / 250 KB、编辑器 296 / 400 KB；Lighthouse（生产栈经 Caddy，新镜像）中位 90；REQ-UI-016 覆盖看板 / Peek / Sheet / ⌘K / reduced-transparency；REQ-EDITOR-014 中位 72.7ms；axe 覆盖全部已登录路由（两主题）。报告：`debug/perf/budget.json · lighthouse.json · editor-open.json` |
| T1-036 | 完成 | 覆盖 180 条 REQ（Phase ≤ 1）P0 全绿、P1 无警告；drift 零差异；规范头部「最后对照代码」刷新；glossary 补 11 词；`tasks/phase-2.md` 登记顺延项；CHANGELOG 审查条目 |
