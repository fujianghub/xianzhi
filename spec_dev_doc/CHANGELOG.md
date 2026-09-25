# spec_dev_doc 变更记录

> 只记规范文件的变更；代码变更看 git log。格式：日期 → 文件 → 一行一条。每个 Phase 结束前的一致性审查结果也记在这里。

## 2026-09-25

**燕印改为「晨光白燕」（ADR-0007）**
- 新增 ADR-0007：燕印重画（剪刀尾、镰刀翼、褐枝嫩芽），翡翠深渐变 + 右上晨光 + 暖白燕；md / lg 完整版、sm 与 favicon 简化版；配色走两主题同值的 `--xz-seal-*`；对比度闸门加 3 项。
- 品牌副标：侧栏与登录页「Xianzhi」及登录页口号统一为「日衔寸枝，岁成一巢」（`app.tagline`，原 `auth.tagline` 移除）；燕子占比 .82 → .9。06 §5.6 加注。
- ADR-0005 §2 加「注」指向 ADR-0007；00 REQ-UI-024 描述与验收按新燕印更新；04 §9 Logo 行、glossary 燕印行加注。

## 2026-09-24

**测试产物不入库（用户要求根治）**
- `.gitignore` 改为忽略整个 `debug/perf/`，并忽略 `.claude/worktrees/`；`debug/perf/editor-open.json` 移出版本库（此前被跟踪，每跑一次 e2e 就出现修改）。REQ-EDITOR-014 的测量结论仍以本文 Phase 1 条目为准（中位 72.7 ms）。
- 05 §5 注：测试 / 构建产物一律不入库，列出例外（视觉基线、drizzle、routeTree.gen.ts）。

**文档同步（CLAUDE.md · 00 / 02 / 04 / 05 / 06 / 07 / 08 / glossary 头部）**
- CLAUDE.md（用户要求更新）：更名残留修正（标题衔枝、`pnpm xz`、`xz rebuild-derived`、`xz:attachment/`）；坐标加视觉与拼图；命令加 `dev:verify`、`lint:drift`、验证实例拼图回显、视觉基线重拍、worktree 预览、大包安装；不变量 5 加 primary-text / motion / reduced-transparency，不变量 9 加登录拼图；索引加 ADR-0004 ~ 0006；纪律加「合并用 `--no-ff`」。74 行。
- 05 §2 注：npmmirror 大 tarball 问题与代理解法；§5 注：拼图 e2e、`localhost:3011` 限制、视觉基线重拍流程、精确匹配选择器、axe 首错即停。
- 04 §5 注：组件实际位置与新增组件；06 §4 Sidebar 行按改版更新；08 §2.13 注：设置页动效档位。
- 00 / 02 / 04 / 05 / 06 / 07 / 08 / glossary 刷新「更新」与「最后对照代码」。
- 记录偏差：`48d2ce6`、`9d46b62` 两次合并用了 `--ff-only`，与 05 §4「`--no-ff`」不符；历史不改写，此后按 `--no-ff`。

**侧栏改版 · 登录拼图滑块（ADR-0006）· 日历 · 未登录主题选择**
- 新增 ADR-0006（登录拼图滑块，服务端出题、PG 一次性答案、不计入锁定、邀请通行证、production 禁回显）。
- 00：新增 REQ-AUTH-016、REQ-TASK-024、REQ-UI-031（日历）、REQ-UI-032（侧栏改版）；REQ-UI-020 当前项改为翡翠渐变胶囊（无竖条）；REQ-UI-001 加注未登录页主题选择。
- 02：§1 前缀加 `/api/captcha`；§2 登录加 `x-captcha`；§3 错误码加 `CAPTCHA_INVALID`；§9 `/tasks` 加 `from/to`、邀请接受响应加 `captchaPass`。07 §2.1 威胁表加「脚本 / AI 批量登录」。08：§2.1 登录页加注、新增 §2.17 日历、路由表文件名更正为 `_app.calendar.tsx`。glossary：拼图滑块、拼图通行证、动效档位、展开指示。
- tokens：侧栏导航图标色组 `--xz-icon-*`（8 色，日场 amber / lime 加深到 ≥ 3:1）；check-contrast 88 项。
- 用户裁定（2026-09-24）：先要求「默认日场」随即改为「登录页默认跟随系统 + 未登录可切换」，最终保留跟随系统，仅新增未登录页主题选择。

**ADR-0005 · e2e 回归修复（REQ-UI-013）**
- 06 §3.1 相关：光晕移入 `body::before` 后 axe 可算背景，暴露既有对比度违规（debug/2026-09-24-axe-contrast-body-pseudo）。`--xz-danger` 日场 `#C0483F` → `#B8433A`；`check-contrast` 增「danger 文字 / 底板 ≥ 4.5」（72 项）；侧栏与 `/design` 的 `fg-faint` 小字改 `fg-muted`。

**ADR-0005 · P1 动效体系**
- 00：新增 REQ-UI-028（动效档位）、029（路由转场）、030（展开指示），Phase 2、P1；REQ-UI-021 加注（借路由转场实现，Peek 暂未接）。
- 04 §2.4 加注：档位落地位置、路由转场规则、列表重排改用 CSS transform 过渡（不上 Motion `layout`，保 REQ-UI-017）。
- glossary §1：新增「动效档位」「展开指示」。
- 更正：06 §5.3「完成后行高折叠移出」在 Phase 1 已实现（`TaskList` collapsing），此前盘点误记为未做。

**ADR-0005 翡翠重音、燕印枝线与动态氛围（参考简斋的风格迁移 · P0）**
- 新增 ADR-0005：主色改翡翠 `#02B377` / `#2EE79C`，拆出 `primary-text`（文字 / 图标）与深墨 `primary-fg`；`primary-gradient` 改为翡翠 → 亮翡翠；新增 `danger-fg`、`shadow-seal`、`branch-line`、`--xz-code-*` 九色、`--xz-font-display / brand-en`。
- 04 §1 · §2.1 · §2.2 · §9、06 §1 · §3.1 · §3.4 · §4 · §5.6 加注；glossary §2 新增「燕印」「枝线」；隐喻位置由三处扩为五处。
- 00：REQ-UI-020 辉光上限 3 → 6；新增 REQ-UI-024（燕印）、025（字体自托管）、026（代码高亮）、027（顶栏枝线与 Dialog 光晕下压），Phase 2、P1。
- 工具：`check-contrast` 增 `primary-text`、`primary-fg / primary-bright`、`danger-fg`、`code-*` 共 70 项；`check-css` `GLOW_PRIMARY_MAX = 6`。
- 看板列材质仍用实色 `bg-surface-2/60`（未按 06 §4 改 `glass-thin`：看板页已是 6 个 blur，满额）；`@theme` 不映射 z-index / 时长（Tailwind v4 无对应命名空间，沿用 `z-(--xz-z-*)` 写法）。

**品牌更名：生长间奏 → 衔枝（ADR-0004）**
- 全部规范（00–08、glossary、tasks）的品牌名、`gi` 前缀、命令（`pnpm xz`）、库名、容器名、环境变量同步更名；历史条目不回改。
- 04 §1 与 glossary §2：音乐隐喻改为筑巢隐喻（巢 / 枝 / 程 / 回望 / 成巢）；00 REQ-UI-009、REQ-CYCLE-007 与 08 的空态文案随之更新。
- 新增 `pnpm xz migrate-prefix` 数据迁移（`services/rebrand.ts`，幂等，`rebrand.test.ts`）。
- 迁移 0002 / 0005 文本中的对象名与命令同步改名（drizzle 按时间戳判定，不重跑）。

**Phase 1 一致性审查（T1-036）与验收（T1-040 · T1-035）**
- 覆盖：`req-coverage --phase 1` 合并 unit / api / collab / e2e / infra 五层，Phase ≤ 1 共 180 条 REQ，P0 全部有通过用例；P1 警告清零（本次补 REQ-WS-011 列表与 can() 对照、REQ-EDITOR-017 collab 硬限、REQ-TASK-009、REQ-ATTACH-008、REQ-AUTH-007 通行密钥）。
- 00：REQ-ATTACH-010 测试层由 `e2e` 改为 `e2e（infra）`（经 Caddy 的断言只能在生产栈跑）。
- 漂移：schema 21 表 / 197 列、openapi 代码 90 条均零差异；00–08、glossary、tasks/phase-1 刷新「最后对照代码」。
- glossary：补 11 个术语（孤立线程、锚定评论、停用、最近访问、浮动工具条、斜杠菜单、大纲、快捷键面板、实时失效、记录卡片、未知块）。
- 新增 `tasks/phase-2.md`（草案），登记由 Phase 1 顺延的内容（注销 / 内容转移、外部图片转存、正文 @ 与 `[[`、mermaid / KaTeX、反链 / 历史、工作区 Logo、WebPush、周期）。
- T1-040：邀请端点补 Idempotency-Key；`crosscut.test.ts` 覆盖 8 个创建端点回放，并遍历全部 `/api/v1` 路由断言未登录 401 + problem+json（code / status / requestId）。
- T1-035：REQ-UI-016 扩到看板页、Peek、任务 Sheet、⌘K；REQ-EDITOR-014 3000 词挂载→首次同步中位 72.7ms（`debug/perf/editor-open.json`）；`e2e:infra` 用新镜像重跑 5/5 绿，Lighthouse 中位 90（Phase 0 为 93，首屏 JS 131→140 KB，余量已薄）。
- 05 注：`e2e:infra` 会复用同名旧镜像，代码改动后须换 `GI_IMAGE` 标签重建。

**T1-033 · T1-043 · T1-034 设置与移动端**
- 08 §2.13 注：设置布局与各页实现口径；工作区 Logo 顺延（不在 REQ 验收内）。
- 06 §7 注：窄屏触控目标用 `::after` 扩点击区（base 层）；`fg-faint` 不用于纸面上的文字。
- 工具链：`biome.json` 配置 `noLabelWithoutControl.inputComponents = [Input, Checkbox]`（自定义输入组件包在 label 内时的误报）。
- e2e 修正：`realtime.spec` / `notify.spec` 的所有权来回转让后把 member 角色复原为 member（此前遗留为 admin，后续依赖角色的用例会串味，见 debug/2026-09-24-e2e-owner-transfer-role-leak）。

**T1-019 · T1-023 · T1-024 · T1-026 · T1-027 · T1-029 · T1-030 协作前端**
- 02 §6 注：任务 / 记录写提交后经总线 `data.changed` 向可读的在线用户推 `invalidate`（REQ-NOTIF-004）；不是通知，不经出箱。
- 02 §9：`GET / PUT /notifications/preferences` 实现（缺行按默认表返回并标 `isDefault`，PUT 整体覆盖，重复 kind 422）。
- 01 §3.9 注：锚定线程判定与 orphaned 同步规则（派生层 `syncCommentAnchors`，`gi rebuild-derived` 同样修正）。
- 04 §6 注：快捷键实现与命令注册表位置；「移到周期」置灰；Peek 的 Enter 捕获。
- 性能修复（REQ-UI-017）：TaskList 虚拟器选项改为稳定引用、TaskRow memo；REQ-UI-017 测量时关闭 backdrop-filter（验证机无 GPU，见 debug/2026-09-24-virtualizer-unstable-options）。
- 设置页：`/settings/notifications`（偏好）先行上线，二级导航与其余设置页随 T1-043。

**T1-013 ~ T1-018 记录与编辑器前端**
- 03 §3.2 注：`entryLink` 沿用 `id / title` 属性，`mermaid` 沿用 `code`，callout 用 `<aside data-callout>`，toc 自绘视图（不引 `table-of-contents` 扩展）。
- 03 §3.3 注：y-tiptap 解析失败会删除 Y 元素，未知节点改为在 `schema.node` 层直接建成 `unknownBlock{raw}`（debug/2026-09-24-ytiptap-unknown-node-delete）。
- 03 §11.3 注：一期外域 / `data:` 图片不转存，Toast 提示后由 schema 丢弃；净化只保留 `language-*` class。
- 03 §11.4 注：上传占位用本地 Decoration；失败直接移除并提示，不做重试按钮与离线队列；e2e 通过 DEV 专用的 `window.__GI_DOC_SOFT_LIMIT__` 调低软限。
- 05 §3 注：`pnpm dev:verify` 的 collab 进程由 `scripts/respawn.sh` 包裹，异常退出自动拉起（REQ-COLLAB-011 e2e）。
- 共享：`src/shared/schemas/pm.ts` 新增 `FULL_NODES / FULL_MARKS`（03 §3.1 清单单源，REQ-EDITOR-001 单测用）。
- 依赖：`@tiptap/extension-code-block-lowlight · highlight · subscript · superscript · text-align · details · drag-handle(-react) · node-range · suggestion · bubble-menu · extensions`、`lowlight`、`highlight.js`、`markdown-it`、`@floating-ui/dom`。

**T1-006 ~ T1-009 任务前端**
- 02 §9 注：`GET /tasks` 增加 `parentId` 筛选（任务详情的子任务列表）。
- 04 §6 / 06 §5.3 实现口径：
  - 任务列表用 `role=grid`（行 `row`、单元 `gridcell`），不用 listbox，因为行内有复选框与标题等可交互元素（axe nested-interactive）。
  - 看板卡片整张即可交互元素：点击 / 回车打开，空格拿起 / 放下（dnd-kit 键盘传感器改为只认空格）。
  - 看板碰撞检测改为「指针所在区优先，否则矩形相交」，拖到列外才会弹回（`closestCorners` 总能找到一列）。
  - 空间列表视图默认不含 done / cancelled，有「显示已完成」开关。
  - 全局 `c` 新任务的默认值由页面登记（空间页 → 该空间 todo，今日 → 截止今天，收件箱 → inbox）。
- 依赖：`@tanstack/react-virtual`（列表窗口虚拟化）。

**T1-031 / T1-032 / T1-010 前端基础件**
- 01 §4：`system.export_done` 默认通道加 `sse`：前端据此弹状态 Toast（REQ-UI-008）；原通道集合不含 sse，导出完成不会形变提示。
- 04 §4：密度为本机偏好（localStorage `gi:density` → `html[data-density]`，token `--gi-row-h` 40 / 32）；服务端用户偏好字段待 T1-033 决定是否需要。
- 04 §7：相对时间文案由 `Intl.RelativeTimeFormat(numeric: 'auto')` 生成（一分钟内为「现在」、日期为「今天 / 明天 / 昨天」），不在代码里写死中文；`check-i18n` 不再扫描 `__tests__`。
- 06 §5：错误 Toast 的红条改用伪元素（`glass-thick-flat` 的 border 简写会盖掉 `border-l-*`，原实现红条不可见）；状态 Toast 默认 4s 后缩回。
- 依赖：`@tiptap/extension-list`（任务列表，liteKit 用；StarterKit 的传递依赖，pnpm 严格模式须显式声明）。

**T1-025 / T1-028 / T1-041 / T1-039 搜索、导出、成员停用（后端）**
- 02 §4.1 注：两字查询也走分词；高亮改为 JS 实现（`ts_headline` 无法高亮连续中文里的词）；tsv 改为标题 A + 正文 D 加权，记录标题此前未进 tsv。迁移 0005 加标题 / 标签的 trgm 索引，升级后需 `gi rebuild-derived`。
- 02 §8 注：导出入队 / 查询 / 下载的权限与形态；作业重试在处理函数内完成（REQ-EXPORT-007 可确定性测试）。
- 实现修正：worker 把单条作业的处理结果交给 pg-boss 存为 `job.output`（此前丢弃），`GET /jobs/:id` 才拿得到产物位置。
- 依赖：`fflate`（纯 JS zip）。

**T1-020 / T1-021 / T1-022 / T1-024 附件、标签、评论、提及（后端）**
- 02 §7 注：附件上传 / 下载实现细节；生产静态托管对 `/data`、`/uploads` 返回 404（REQ-ATTACH-010，另加 infra e2e 经 Caddy 验证）。
- 02 §9 注：标签权限（新增 authz 动作 `tag.create` / `tag.manage`）；`?tag=` 逗号多值；评论线程、编辑、删除占位、按线程解决；评论内提及的扇出过滤。
- 依赖：`sharp` 0.35（npm 平台包）、`blurhash` 2（纯 JS）。
- tasks/phase-1.md：T1-022 完成定义里写的「REQ-NOTIF-015 每种 kind 的投递通道集合」对应的实际是 REQ-NOTIF-012，已按 012 实现测试（015 为「通知只能本人读」，已有覆盖）。

**T1-012 / T1-042 记录完整路由与协同访问广播**
- 00 REQ-ENTRY-003：「无 spaceId → 422」与 01 §3.4、02 §9、REQ-ENTRY-001 冲突，删除线加注，以缺省落个人空间为准。个人空间记录只能 private，缺省 private。
- 02 §9 注：可见性缺省规则、UUID 参数、preview 字段、列表不读正文列。
- 08 §7：种子里个人空间的 journal / review 改为 private，共 4 篇 private（原「1 篇」加删除线）。
- REQ-COLLAB-016：服务层与 collab 共用进程总线，改为「仅自己」和移出空间两个场景均 1s 内 4403 断开（collab 集成测试）。

**T1-004 / T1-005 / T1-011 任务事件、批量、列表性能**
- 01 §4：`task.completed` 载荷加可选 `prevStatus`；`task.due_soon` 按（任务，截止时刻）去重（原文冲突，注中说明）；`task.uncompleted` 把 5 分钟内同任务未合并的完成通知原地改为「撤销了完成」。
- 02 §9 注：complete / uncomplete 请求体与语义；batch 成功与失败的响应形态。
- 05 §10 实现：慢查询在 pg 层计时，覆盖事务借出的连接；日志只带 SQL 不带参数值（参数可能含正文 / 令牌）。列表接口合并为 ≤ 3 条查询，1 万任务的 P95 采样写入 `debug/perf/tasks-list.json`。

**T1-038 任务关系与派生**
- 01 §4：`task.commented` 接收者加 watchers（00 REQ-TASK-014 与 01 §4 原表不一致，以需求层为准）。
- 01 §3.2 / 02 §9 注：子任务层级与换空间规则；watcher 增删权限（自己可读即可，替别人需写权限且对方可见空间）。

**T1-037 任务写语义**
- 02 §5 注：幂等实现（占位防并发、只记 2xx、失败可重试、他人 key 不回放、回放头）；新增错误码 409 `CONFLICT_IN_FLIGHT`（02 §3 错误表、前端 i18n）；01 §3.13 两列加注。
- 02 §5 回收站：任务的「本人可恢复」= 创建者（owner/admin 全部）；恢复需活着时的 `task.write`；永久删先判 owner/admin（member 一律 403），未软删也可直接永久删，记审计。
- 01 §3.2：创建者与指派人自动成为 watcher 已实现（增删接口仍在 T1-038）。
- gc：抽出 `purgeTasks`，软删到期清理与永久删共用（任务评论上的附件也一并清除，原逻辑漏删）。

**T1-003 任务读路径**
- 02 §9 注：`view=today` 人员范围（指派给我，或未指派且由我创建）；`view` 与 `deleted`、`view=inbox` 与 `status` 互斥 422；`:id` 非 UUID 422；`dueAt` 排序空值最后；列表项字段；指派人须可读空间。
- 01 §1：业务表时间列统一 `timestamptz(3)`（迁移 0004），修复按时间列翻页游标不前进（debug/2026-09-24-timestamp-precision-cursor）；`check-schema-drift` 归一该类型。
- authz 新增动作 `task.create`（规则同 `entry.create`）；REQ-WS-007 覆盖测试改为逐个核对「每个动作至少一张矩阵」，不再写死动作数量。
- 新增 `src/shared/tz.ts`（Intl 实现日 / 周边界，含 DST 单测），前后端共用。

**T1-002 空间列表 / 侧栏空间树**
- 08 §2.5 实现注：slug 留空时按名称的 ASCII 部分生成（纯中文名为 `s-<6 位随机>`）；`/spaces/$spaceSlug` 先只有页头与归档横幅（08 §2.6 视图在 T1-006 / 007）。
- 06 §5 SpaceSwitcher：拖动只经手柄（行本身是链接），仅 `myRole=admin` 的空间可拖；「其他可见空间」只读；归档区折叠、展开时才请求。
- 05 §5 / 00 REQ-UI-020：`check-css` 统计 `glow-primary` 引用点，> 3 失败。
- 依赖：`@dnd-kit/core` 6 · `sortable` 10 · `utilities` 3（纯 JS；T1-007 看板沿用）。

**Phase 1 开工（T1-001 空间）**
- tasks/phase-1.md（v3）：用户裁定 08 §1 的四个设置页并入 Phase 1，新增 T1-043（5h，归 M1.1），估时合计 174 → 179h；加「进度记录」节。
- 08 §1：`/settings/api-keys`、`/settings/workspace`、`/settings/workspace/members`、`/settings/workspace/audit` 的 Phase 由 ~~0~~ 改为 1。
- 02 §9 注：`/spaces/:id` 兼收 slug；`GET /spaces` 不列他人个人空间；`deleted=1` 只对 owner/admin 有内容；视图字段 `myRole / isMember / memberCount / daysLeft`；reorder 需 `space.manage`；个人空间不可归档、不可改成员；guest 空间角色封顶 viewer；永久删除级联清除并审计。
- 01 §1 / §3.1 / §3.2：`sort_key` 列级 `COLLATE "C"`（迁移 0003），debug/2026-09-24-sort-key-collation。
- 07 §3 实现修正：gc 对到期软删空间整体清除（原实现永不清除），debug/2026-09-24-gc-soft-deleted-space。

**Phase 0 一致性审查（T0-032）**
- 漂移：`check-schema-drift` 对 01 §3 零差异（21 表 / 197 列）；`check-openapi-drift` 对 02 §9 零差异（代码 44 条；另 61 条属 Phase ≥ 1，按行内 REQ 的 Phase 过滤）。
- 追溯：~~`pnpm e2e` 的 `--layers e2e` 通过（e2e 23 例），P1 无警告~~（更正：该行写于 e2e 门槛实跑之前；首跑时 REQ-NOTIF-003、REQ-UI-015、REQ-OPS-002、REQ-OPS-005 四条 P0 无通过用例，REQ-AUTH-008 有 P1 警告）。补测试后：`pnpm test`（988 例，`--layers unit,api,collab` 校验 51 条 REQ）、`pnpm e2e`（26 例，`--layers e2e` 校验 18 条）、`pnpm e2e:infra`（4 例，`--layers infra` 校验 2 条）均通过，P1 无警告。
- 验收清单（05 §11）：除「首次提交」（留给用户）与「季度恢复演练」（持续项）外全部勾选。
- **遗留 / 待裁定**：
  1. 08 §1 把 `/settings/api-keys`、`/settings/workspace`、`/settings/workspace/members`、`/settings/workspace/audit` 标为 Phase 0，但 tasks/phase-0.md 没有对应任务，本期未做页面（接口已全部就绪：`/me/keys`、`/workspace`、`/workspace/members*`、`/workspace/audit-log`）。建议并入 Phase 1 首周，或补 T0-033。
  2. REQ-WS-009 的验收写 `GET /spaces`、`GET /tasks?spaceId=`，这两个端点属 Phase 1；本期以 authz 矩阵 + `/entries?spaceId=` 的 404 覆盖同一规则。
  3. T0-029 的 CI 工作流为草稿（`infra/ci/ci.yml`），需用户确认后移入 `.github/workflows/`；`pnpm audit` 在 npmmirror 不可用，本机未执行。
  4. ADR-0001 写 Drizzle 1.0，实际 0.45 稳定版（1.0 仍 beta）——是否新开 ADR 待用户决定。

**门槛补测试带出的修正（T0-032）**
- 02 §6：新增 `hello` 帧（首连给补发基线）、`reset` 另覆盖 `Last-Event-ID` > seq（进程重启）、`evicted` 帧（被挤掉的标签页停止自动重连，回前台再连）。debug/2026-09-24-sse-replay-baseline。
- 05 §3 / §5：新增 `pnpm e2e:infra` 与 infra 层（`req-coverage.infra.json`）；00 的「e2e（infra）」映射到 infra 层，不再并入 e2e。
- 05 §7 · `infra/Caddyfile.snippet`：`/collab` 匹配改为 `@collab path /collab /collab/*`（原 `/collab/*` 不匹配前端实际连接的 `/collab`，上线会 404）；`/assets/*` 缓存头改 `?Cache-Control` 防重复。debug/2026-09-24-caddy-collab-matcher。
- REQ-UI-015：Lighthouse 以「经 Caddy 的生产栈 `/login`、默认移动端节流、3 次中位数」为口径，实测 93；首屏 gzip 175 → 126 KB（路由 `validateSearch` 去 zod、`TooltipProvider` 移到 `_app`）。debug/2026-09-24-lighthouse-first-paint。

**T0-016 ~ T0-023 前端**
- 06 §3（v4）：`check-contrast` 按 §7 最坏合成底实测，`fg-faint` 两主题、日场 `accent`、日场 `danger-soft` 四个原值不达标，按「刚好达标」最小修正（06 §3 注、04 §2.1 注）。
- 06 §5.1：secondary 按钮保留 glass-thick 外观但不加 backdrop-filter（按钮成排出现时同屏 blur 超 §8 预算）。
- 04 §2.1 / glossary：8 色板 token 名 `--gi-palette-<name>-bg/-fg`。
- 派生 token（`color-mix(var(--gi-fg) …)`）改为在 `:root, [data-theme]` 上声明：只在 `:root` 声明时会在根上算死，嵌套主题容器（画廊深浅并排）取不到本主题值。
- React Compiler 在 plugin-react v6 下经 `oxc-transform-react`（Rust，npm 平台包）；Vite 8 分包键 `codeSplitting`，编辑器组需 `includeDependenciesRecursively: false`，否则 React 被吸进编辑器 chunk、首屏预加载整包编辑器。预算：首屏 175 KB / 250、编辑器 179 KB / 400（gzip）。
- 08 §1：`/login/2fa` 文件名须为 `login_.2fa.tsx`（扁平命名嵌套陷阱，debug/2026-09-24-tanstack-flat-route-nesting）。
- 02：邀请 410 的 problem 增加 `reason: used | canceled | expired`，前端据此选文案（不再解析中文 detail）。
- 01 §4 实现：每条 in_app 通知都给接收者推 SSE `invalidate ['notifications']`（缓存失效，不受 `sse` 通道开关影响），铃铛因此实时；`notification` 帧仍只对含 `sse` 通道的种类推送。

**T0-024 补充与 T0-028 / T0-029 / T0-031 基础设施**
- 01 §3.10：出箱提交后即时接力以触发器实现（`drizzle/0002_outbox_notify.sql`）；邮件拆为独立作业 `notify.email`；Mailpit 关反向 DNS、`SMTP_HOST=127.0.0.1`（debug/2026-09-24-mailpit-smtp-latency）。
- 03 §4.2：派生失败不改 `derived_at`（只记成功），collab 入队 `derive.retry`。
- 05（v4）：命令表（`e2e`、`dev:verify`、`gi job`、`gi restore --identity`、`test` 含覆盖门槛）、§5 分层口径注、§6 CI 草稿位置与 audit 源、§11 验收勾选。
- 生产：Dockerfile 镜像内限 4 并发拉包（debug/2026-09-24-docker-pnpm-concurrency）；备份文件名按 Asia/Shanghai 取日期。
- 新增 debug 条目：playwright-system-chrome、tsx-jsx-classic-runtime、tanstack-flat-route-nesting、mailpit-smtp-latency、docker-pnpm-concurrency、dev-verify-coexist。

## 2026-09-23

**T0-015 / 024 / 025 / 026 / 027 / 030 后端收尾**
- 03 §5 快照触发补充基准：首个快照以版本 0 / 记录创建时间为基准（否则首次落库即满足「距上次 ≥ 30 分钟」，与 REQ-COLLAB-007「60 次 1 行」矛盾）。
- 07 §3 `gc.events` 与 01 §3.11 冲突：`notifications.event_id` 级联删除，180 天删事件会带走「永久保留」的未读通知。裁定：跳过仍被通知引用的事件行，通知按 `gc.notifications`（已读 90 天归档、归档 1 年删）先走。
- 05 §8 备份加密实现为 npm `age-encryption`（BSD，纯 JS，流式），不依赖系统 `age` 二进制；`pg_dump` 本机无则回落 `docker exec gi-dev-pg`（dev），生产镜像装 PG16 客户端；`gi restore` 需 `--identity <私钥文件>`（或 `AGE_IDENTITY_FILE`）。
- 01 §4 扇出：webpush 通道本期落 `notification_deliveries(status=skipped)`，Phase 2 接 VAPID；邮件为纯文本（标题 + ≤ 100 字摘要 + 不带 token 的深链 + 偏好链接），react-email 模板随 Phase 1 偏好页补。
- 02 §9 `/notifications` 的 `GET` / `read` / `read-all` / `archive` 提前在 Phase 0 实现（铃铛未读数需要），列表响应多一个 `unreadCount` 字段。
- 08 §7 未写 member / guest 密码，定为 `demo-member` / `demo-guest`。

**T0-014 Hocuspocus 协同服务**
- 03（v3）§4.2 加注：Hocuspocus 4 多路复用导致关闭码只能经 `reason` 传达，统一编码 `"<码>:<原因>"`。
- 02 §6 加注：app ↔ collab 是两个进程，`user.revoked` / `entry.access_changed` 一期即经 PG `NOTIFY gi_bus` 桥接（原文「进程内 EventBus」在两容器部署下送不到 collab）。
- 03 §6 模板落地为 `src/shared/editor/templates.ts`（i18n key + zh-CN 字典），服务端用无 schema 的 PM JSON → Y.XmlFragment 转换注入，仅在 `ydoc_version = 0` 且 fragment 为空时。
- 延后项写入 tasks 进度表：`derive.retry` 入队、快照、正文 mentions / links 同步。

**T0-013 entries CRUD + rebuild-derived**
- 01 §5 矩阵新增动作 `entry.create`（SpaceRef，规则同 task.write：space member+ 且空间未归档）——原表只有 entry.write/delete，创建无处落。
- 派生列单一实现 `src/collab/derive.ts`：`deriveFromYdoc`（yDocToProsemirrorJSON，fragment `default`）/ `deriveFromPm`；`services/derived.ts:writeEntryDerived` 供 onStoreDocument（T0-014）与 CLI 共用，REQ-ENTRY-010 逐字节一致由此保证。tsv 在 SQL 层 `to_tsvector('simple', $1)`。
- `tokenize()`：jieba 精确模式 + 小写 + 停用词 / 标点过滤（02 §4.1）；字数 = CJK 每字 1 + 其余按空白分词。
- 新建记录写空 Y.Doc（gc:false）；模板注入按 03 §6 留在 onLoadDocument。
- 依赖：yjs 13.6、y-prosemirror 1.3、@node-rs/jieba 2.0（npm 平台包）、prosemirror-model/state/view。

**T0-012 shared schema**
- `src/shared/schemas/`：全部一期实体 Zod（spaces / tasks 含 recurrence / cycles 含 goals / entries / links / tags / attachments / comments / notifications / search / exports / collab）+ `entryFields.ts`（01 §3.5，strict）+ `pm.ts`（03 §7 liteKit 文档结构、`pmToPlain` / `pmMentionUserIds`）+ `query.ts`（02 §4 游标 / sort 白名单 / 逗号多值 / `me` 别名）。
- glossary / 04 §2.1：8 色板定英文标识符 `moss amber indigo ochre teal plum gray pine`（原文只有中文名）。
- 01 §3.2 recurrence 补约束：weekly 必带 byWeekday、monthly 必带 byMonthday（规范未写明，按语义定）。

**T0-011 成员管理与审计**
- 新增 `src/server/lib/event-bus.ts`（02 §6 / 07 §4 的进程内 EventBus：`user.revoked`、`entry.access_changed`、`notify`）；成员移除 / 停用 / 吊销会话提交后广播，collab（T0-014）与 SSE（T0-025）订阅。
- 07 §4 停用改为直接写 `user.banned`（不经 Better Auth `admin.banUser`：该端点要求 Better Auth 自身 `role=admin`，与工作区角色体系两套），效果一致：同事务删 session、禁用 Key、指派置空。
- `GET /workspace/members` 对全部成员开放（设置页与 @ 提及要用），写操作仍 `workspace.manage`；`/me/keys` 与 `/me/sessions` 只接受 Cookie 会话（API Key 请求 403 `SCOPE`）。
- 02 §9 未改：`DELETE /workspace/members/:userId?purge=1` 返回 422 占位（REQ-WS-015 Phase 2）；`transfer-content` 未挂（REQ-WS-016 Phase 2）。

**T0-010 邀请流程（服务端）**
- 02（v3）§9：新增两个公开端点 `GET /workspace/invitations/:id`、`POST /workspace/invitations/:id/accept`。原因：Better Auth `accept-invitation` 要求已登录会话，而受邀者尚无账号且注册已关闭，官方路径走不通；邀请行仍存 Better Auth `invitation` 表，`sendInvitationEmail` 钩子与 service 共用同一模板模块。
- 07（v3）§4：接受一行改指向自建端点，旧写法删除线保留。
- 01 §3.1：个人空间 slug 改为 `me-<userId 末 8 位>`——原「前 8 位」在 UUID v7 下是毫秒时间戳，测试中 owner 与受邀者同分钟加入即撞 `spaces_workspace_slug_uq`（debug/2026-09-23-personal-slug-uuidv7）。
- 01 §4.1 的 `member.joined` 事件已由 accept 同事务 `emit()`；`src/shared/schemas/events.ts` 判别联合（T0-012 的事件部分）随本任务落地。
- tasks/phase-0.md：T0-010 服务端完成；`/invite/$token` 页面与 e2e `REQ-AUTH-003 邀请→设密码→登录` 依赖 T0-016 前端脚手架，顺延到 T0-022 一并做。

**代码对照（M0.1，T0-001 ~ T0-009 落地）**
- 01：`最后对照代码` 刷新——`scripts/check-schema-drift.ts` 对 §3 21 张表 / 197 列零差异。认证表由 Better Auth 生成（`timestamp` 不带 tz、`apikey.reference_id`），按 §2 不入契约。
- 05（v3）：§2 `gi_test` 隔离改为「每文件 TRUNCATE + 串行」（Better Auth 持独立连接，事务回滚不可行）；§3 `db:migrate` 改走 drizzle-orm migrator（`src/server/db/migrate.ts`，与 `start.ts` / 测试建库共用）、`auth:generate` 改 `pnpm dlx @better-auth/cli@1.4.21`、`typecheck` 改逐项目 `tsc -p`（Better Auth 类型不能 declaration emit）、`build` 同步；§5 API 集成层同上。
- tasks/phase-0.md：新增「进度记录」表（T0-001 ~ T0-009 状态与偏差）；版本裁定：drizzle-orm 0.45（1.0 仍 beta）、TS 5.9、better-auth 1.7.5 + `@better-auth/passkey` / `@better-auth/api-key`。
- debug：新增 `2026-09-23-pnpm11-ignored-builds`、`2026-09-23-better-auth-17-packaging`、`2026-09-23-drizzle-check-literals`。
- 待用户裁定：ADR-0001 §0 写「Drizzle 1.0」，实际用 0.45 稳定版——若视为选型变更需新开 ADR；`tsc -b` → `tsc -p` 与 CLAUDE.md 命令段无冲突，无需改 CLAUDE.md。


**adr/0001-tech-stack.md**
- 采纳（v1 → v3 演进，§8 八项决定全部按建议）。
- 新增 §10 技术栈清单：每项技术的介绍 / 作用 / 语言。
- §9.3「避免复制简斋玻璃态」标注被 ADR-0002 部分取代；§0 内容存储措辞修正；§7 加注释（现行工时、一期 / 二期术语）。

**adr/0002-visual-style-apple-glass.md**
- 新建：视觉改为 Apple 玻璃，日场 / 夜场两主题，玻璃只用于 chrome。后按 05 §9 模板重写（候选方案表、后果、参考）。

**06-visual-style.md**
- 新建：层模型、四级玻璃 token、阴影、主色派生、组件材质表、控件细节、主题切换、a11y、性能预算、简斋陷阱、`/design` 三页、实施顺序。
- review 修复：补 `--gi-surface / -2` 别名与 `--gi-blur-*` token；焦点环统一为 `--gi-focus-outline`；品牌位改 `--gi-font-serif`；Stylelint 改为 `scripts/check-css.ts`；阴影命名声明取代 04 §2.3。
- UI 建议写入：折射环 `--gi-refract` 与左上高光 `--gi-sheen`、`glass-cursor-sheen`、状态胶囊 Toast、PeekPanel、Dialog 压底板。

**04-design-system.md**
- §1 / §2.1 / §3 三处指向 06；§2.1 四个基础 token 值改为「→ 06」；§2.3 阴影命名指向 06；§2.4 新增 `--gi-ease-spring`，共享元素过渡提到标准档。
- §5 新增 PeekPanel、StatusPill；§6 ⌘K 改上下文优先、新增 Peek 预览与状态胶囊 Toast、撤销改行内进度线。

**01-domain-model.md**
- review 修复：`editor_schema_version` 列；`space_id / visibility` CHECK；tasks 派生列由 service 同事务写入；outbox → pg-boss 接力（`outbox.drain` 每 5 秒）；`entry.updated` 入事件表；扇出前逐接收者 `can(read)`；`rebuild-derived` 支持 `--tasks / --comments`；三期 → 二期。
- SDD 补全：新增 §4.1 事件 payload 与通知模板。

**02-api-conventions.md**
- review 修复：`/api/health` 拆公开 / `details`；CSP `connect-src` 收紧；新增 `POST /collab/token`；三期 → 二期。
- SDD 补全：新增 §4.1 搜索规则，搜索响应加 `cursors`。

**03-editor-kernel.md**
- review 修复：attachment 解析为 `/api/v1/attachments/<id>/md`；schema 版本改列；collab 鉴权改票据；mermaid `securityLevel: 'strict'`；测试库 `gi_test`。
- SDD 补全：新增 §11 编辑器交互规格（斜杠菜单、快捷键、粘贴、图片上传、大小上限、移动端工具条），原 §11 陷阱改为 §12。

**05-dev-workflow.md**
- review 修复：Mailpit 统一；`BETTER_AUTH_URL` 改 3010；新增 `COLLAB_TOKEN_SECRET`；`pnpm start` / `start:collab` 拆分；`pnpm lint` 纳入 check-css / check-contrast；`scripts/` 与 `pnpm gi` 职责划分；Caddy 段删 `/uploads`；health 拆分；Phase 0 清单加 `git init` 与 `/design` 三页；分期术语定义；测试库 `gi_test`。
- SDD 补全：§4 完成定义（DoD）；§5 追溯约定与 `req-coverage.json`；§6 漂移检查两脚本；§9 规范文件头约定；头部状态行加版本 / 更新 / 最后对照代码。

**00-requirements.md · 07-security-and-data.md · 08-pages-and-flows.md · glossary.md · tasks/phase-0.md · tasks/phase-1.md · CHANGELOG.md**
- 新建（SDD 补全）。

**debug/README.md**
- 新建：踩坑条目五段模板。

**CLAUDE.md**
- 规范索引加 ADR §10、06、debug/README.md；坐标加 collab 票据与分期术语；命令加 `start / start:collab`。
- SDD 补全时：索引加 00 / 07 / 08 / glossary / tasks / CHANGELOG 六行；会话纪律加「动手前先找 REQ」与「术语以 glossary 为准」。
- 第三轮：不变量 1 更新、新增不变量 9 安全收口、`gi seed / restore`、票据按文档签发、索引加 ADR-0002/0003。

**全量 review（四视角 100 条：高 22 · 中 52 · 低 26）与修复（第三轮）**
- 修复核对：100 条中 87 已修、9 部分、1 未修、1 修法引入新问题；核对发现的 19 条残留全部修复（02 §9 三端点 REQ 归属、`due` 归服务端、`uncomplete` 端点三处统一、seed id 统一、07 审计枚举改引用 01、验证实例改用 `gi_e2e`、CI 顺序含 `audit` 三处统一、ADR-0001 §7 注标注被 ADR-0003 取代、ADR-0003 数字更新、`gi restore` 进 CLAUDE.md 与 T0-027、02 §7 标题改「附件」、02 §4 不可见筛选 404、08 提及 Tab 数据源、`/history` 裁定去重）。
- 闸门可实现化：01 §3 全部改统一三列表（21 张，机器契约）；02 §9 改 Method | Path 逐行表（101 端点）；CI 顺序 `lint → typecheck → drift → test → build → audit → e2e`；`req-coverage` 分层 reporter，门槛只算本次运行的层，「手工」层豁免。
- 不可实现项改正：`outbox.drain` 改自循环作业（非 cron）；sharp 同步在请求内、`limitInputPixels`；SSE 每用户 3 条、帧带 `eventSeq`。
- 01 补列与事件：`derived_error / derived_at`、`comments.orphaned`、`recurrence.byMonthday`、`notifications (user_id, event_id)` 唯一、`audit_log.action` 枚举 29 项；事件 kind 新增 `workspace.owner_transferred / member.joined / system.outbox_stalled / task.unassigned`；`entries.space_id NOT NULL`（个人随笔落个人空间）；附件上传即带 target。
- 02 补端点与规则：`suspend / unsuspend / revoke-sessions / transfer-content / DELETE /me`、`?deleted=1`、`view=today|inbox`、`due=today|week|overdue`、sort 白名单、`?kind=`、幂等端点清单、API Key 三规则、`magicLink disableSignUp`、impersonation 禁用、`limit>200 → 422`、导出权限。
- 03：WebSocket 关闭码表；`entry.access_changed` 广播；`entry.updated` 合并机制。
- 07：删每小时 60 条与定时复核；impersonation / magicLink 两行；§4 加端点列；限额与错误码对齐。05：四个数据库、`AGE_RECIPIENT`、`typecheck / dev:verify / gi seed / gi restore`、`USER node`、日志轮转、pino redact、ADR 头部豁免、Phase 0 验收改 backup。
- 00：v2 已采纳；新增 14 条 REQ（AUTH-015、WS-012~017、ATTACH-011、COLLAB-016、NOTIF-015/016、EXPORT-008、OPS-013/014），共 217；REQ-WS-004 拆三；`trash=1 → deleted=1`；测试层「—」→「手工」；EXPORT-004 标二期。
- 04/06/08/glossary：`--gi-fg*` 归 06；z-index 加 peek/scrim/sheet；`--gi-dur-theme`；快捷键一键一义（`c` 新任务、`Space` 勾选、`p` Peek）；06 §4 补 9 行组件材质、Scrim 计入预算、Toast 自建容器、PeekPanel 非 modal；08 search params 与 API 同名、逗号串、`done=1` 语义、`/trash` member+、seed id 合法化；glossary 放宽「用户」「文件」。
- tasks：Phase 0 32 任务 106.5h，Phase 1 42 任务 174h（脚本求和）；T1-003 拆三；T1-026 依赖修正；每任务至少一个 REQ 测试名；新增 T1-039~042。
- ADR：新建 ADR-0003（工期基线 = 任务级估时）；ADR-0001 §0 恢复原句并在表下加注（不变量 8 允许的标注方式）。CLAUDE.md：不变量 1 更新、新增不变量 9 安全收口、`gi seed`、票据按文档签发、索引加 ADR-0002/0003。

**SDD 补全后的一致性审查（第二轮）**
- 修 12 处跨文件不一致：SVG 策略统一为栅格化 PNG；正文上限统一为软限 10 MB / 硬限 20 MB；搜索 P95 统一 150 ms；空间删除仅工作区 owner/admin（01 §5 拆出 `space.delete`）；最后 owner 409 `CONFLICT_LAST_OWNER`；成员移除时指派置空并通知空间 admin；collab 票据绑 `entryId` + `jti`；编辑器快捷键以 03 §11.2 为准；`.exe` / 伪造 MIME 统一 415；附件去重限同 owner；`presence` 降为 P2 Phase 2；撤销完成新增 `task.uncompleted`（仅活动流）。
- 02 §3 新增错误码：`ACCOUNT_LOCKED`、`CONFLICT_LAST_OWNER`、`INVITATION_EXPIRED` / `LINK_EXPIRED`、`QUOTA_EXCEEDED`、`UNSUPPORTED_MEDIA`；02 §9 新增 `view=today|inbox`、`?deleted=1`、`POST /workspace/owner-transfer`；`/collab/token` 载荷改 `{userId, entryId, jti, exp}`。
- 01 §3.1 新增 `is_personal` 个人空间（00 REQ-SPACE-009）；01 §4.1 新增工作区邀请走 Better Auth 钩子说明。
- 03 §3.2 `image.src` 只接受 `gi:attachment/`；§4.2 `onAuthenticate` 加 `Origin` 与 `entryId` 校验；§11.5 上限对齐 07。
- 00 §21、07、08、glossary、tasks 的「待确认」全部改为「裁定记录」（共 25 + 10 + 8 + 3 + 5 条），默认值可推翻。
- 工期：tasks 估时 Phase 0 ≈ 110h、Phase 1 ≈ 168h，ADR §9.5 的 5 天 / 2.5 周记为乐观值（旧文不改）；是否裁剪待用户决定。
- 校验脚本：203 条 REQ 无重复；所有 REQ 引用有效；Phase 0/1 的 P0 REQ 全部落在任务表；文件头统一为 05 §9 格式。

**全面 review（27 条）**
- 跨文档矛盾 10 条、缺口 10 条、小修 7 条全部修复；四个默认决策：一期 = Phase 0–2 / 二期 = Phase 3、`start` 与 `start:collab` 分开、collab 走 5 分钟 HMAC 票据、outbox 由 pg-boss 每 5 秒扫表接力。
