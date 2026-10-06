# spec_dev_doc 变更记录

> 只记规范文件的变更；代码变更看 git log。格式：日期 → 文件 → 一行一条。每个 Phase 结束前的一致性审查结果也记在这里。

## 2026-10-06

**任务行内标签多选修复（REQ-TASK-038）**
- 00 REQ-TASK-038 注（行内标签弹层可多选，关闭前勾选即时显示）+ 验收补一条。
- debug +`2026-10-06-task-row-tags-single-select`（弹层开着时 `value` 固定为原值，每次勾选覆盖前一次）。

## 2026-10-03

**首屏 JS 超标排查（REQ-UI-015）**
- 00 REQ-UI-015 注（首屏口径 = 入口 + 登录路由静态闭包）；05 §5 性能行注（check-budget 按 manifest 走链）。
- debug +`2026-10-03-perf-initial-js-login`（check-budget 只算 index.html 引用漏了登录路由 ~77 KB；主题菜单弹层与 Better Auth 客户端改按需加载，280 → 241 KB）。

## 2026-10-02

**外观偏好随账号保存 · 工作区默认外观（ADR-0049）**
- 新增 ADR-0049（修订 ADR-0047 §1、REQ-UI-001 / 011 / 028 的本机持久化、08 §2.13 注）。迁移 0027（`user_preferences.appearance`）。
- 00：+REQ-UI-051、REQ-WS-024。01 user_preferences +appearance。02 §9 `/me/preferences` ×2、`PATCH /workspace` 行注。glossary +外观偏好、工作区默认外观；玻璃强度注。ADR-0047 加注。
- e2e：外观改走 API（`setAppearancePref` / `resetAppearance`），夜场用 `emulateMedia`；勿再写 localStorage 指定外观。

**侧栏与顶栏的玻璃：去白、背后补色（ADR-0048）**
- 新增 ADR-0048（修订 ADR-0047 §2、06 §3.1 注）。无迁移。00：+REQ-UI-050。glossary +定向光晕。`check-contrast` 预设矩阵 +侧栏 / 顶栏合成底（共 440 项），并修正夜场叠加顺序（按特异度）。

**玻璃强度：默认「流光」，用户可选（ADR-0047）**
- 新增 ADR-0047（修订 06 §3.1 光晕数量与漂移层、§3.2 玻璃透明度与光边、§4 纸面行；08 §2.13 注）。无迁移。
- 00：+REQ-UI-049。glossary +玻璃强度、光边；纸面、光晕注。`scripts/check-contrast.ts` 增预设矩阵（176 项）。

**界面精修：材质层级 · 浮层退出动效 · 图标描边 · 空状态（ADR-0046）**
- 新增 ADR-0046（修订 06 §4 Tooltip / EmptyState 行注、+批量操作栏行，§5.1 注；04 §2.4 注）。无迁移。
- 00：+REQ-UI-045 ~ 048。
- debug +`2026-10-02-a11y-axe-route-timeout`（既有：记录页正文 aria-prohibited-attr；全路由 axe 用例超时，main 基线同值）。
- debug +`2026-10-02-task-image-upload-lost-on-save`（既有竞态：任务描述插图后失焦保存回来冲掉上传占位；保存未排队撞 409）。

## 2026-10-01

**任务行内编辑 · 单个管理菜单 · 页面级批量（ADR-0045）**
- 新增 ADR-0045（修订 08 §2.3 · 2.3b · 2.4 · 2.6「点标题打开详情」、REQ-TASK-020 键盘、REQ-TASK-016 批量 op、REQ-MOBILE-002 长按）。无迁移。
- 00：+REQ-TASK-037 ~ 041；REQ-TASK-016 · 020 · 034、REQ-MOBILE-002 注。02 §9 `/tasks/batch` 行注。08 §2.3b 注。glossary +行内编辑、批量条。
- debug +`2026-10-01-task-undo-lost-when-group-empties`（完成分组最后一条后撤销条随分组消失，今日页同修）。

**任务页 2.0：个人清单 · 更强的添加 · 清爽工具感（ADR-0044）**
- 新增 ADR-0044（修订 ADR-0043 §B · §C、REQ-MOBILE-001 底栏）。迁移 0026（`task_lists` · `task_list_items`，手写 `COLLATE "C"`）。
- 00：+REQ-TASK-029 ~ 036（036 = 拖拽，同日追加）；REQ-TASK-026 · 027、REQ-MOBILE-001 注。01 +§3.7b。02 §9 +`/task-lists` ×4、`/tasks/counts`，`/tasks` 行注（`listId` · `due=tomorrow|next7` · 只改归类的 PATCH 语义 · PATCH 无默认值修正）。07 §5 +清单上限。08 §2.3b 注（三栏布局）。glossary +清单、智能清单、未归类，快速添加注。
- debug +`2026-10-01-task-patch-defaults`（既有缺陷：只改标题的 PATCH 把状态改回 inbox、优先级清零）。

**内置字段覆盖层（ADR-0042）· 任务页与快速添加（ADR-0043）**
- 新增 ADR-0042（修订 ADR-0017 §3、ADR-0036 §A.2、ADR-0033 §A 路由层必填校验）、ADR-0043。迁移 0025（`entry_kind_overrides` +`base_fields` `field_order`）。
- 00：+REQ-ENTRY-034 ~ 037、REQ-TASK-025 ~ 028。01 §3.4c entry_kind_overrides 两列。02 §9 `/entry-types/builtin/:kind` 行注、`GET /tasks` 行注 `view=mine`。03 §7 liteKit 描述贴图。08 §1 +`/tasks`，+§2.3b 任务页，§2.3 注（常驻快速添加），§2.13 注（内置字段编辑）。glossary +内置字段覆盖、任务页、快速添加。
- shared `schemas.test`：路由层 `createEntrySchema` 不再拦必填缺失（由 service 按覆盖层 422，路径不变）。

**查询块的条件支持类型自定义字段与模板属性（ADR-0041）**
- 新增 ADR-0041（修订 ADR-0033 查询块条件只列内置枚举、ADR-0040 §5「查询块本轮不动」→ 采纳）；ADR-0040 §5 加注。无迁移、无接口变化。
- 00：§6d +REQ-BUG-013；REQ-BUG-011 加注。03 §3.2 entryQuery 注。
- debug +`2026-10-01-dev-api-no-watch-stale`（合并后 3010 的 API 未重启，前后端版本不一致致模板页崩溃）；05 §3 `pnpm dev` 行注（常驻 3010 改用 `pnpm dev` 起）。
- CLAUDE.md：命令区 `pnpm dev` 注明 tsx watch、常驻 3010 用它起；规范索引行改为 `0035 ~ 0041` 并加 ADR-0041 摘要（用户要求同步，仍 ≤ 80 行）。

## 2026-09-30

**模板属性并入记录页的筛选与分组（ADR-0040）**
- 新增 ADR-0040（修订 ADR-0039 否决项「模板字段并入记录页筛选 / 分组」→ 采纳；`GET /templates/fields` +`name`）；ADR-0039 该条加注。无迁移。
- 00：§6 +REQ-ENTRY-033；REQ-TPL-019 加注。02 §9 `GET /templates/fields` 行注。08 §2.8 注。
- 补记（同日）：03 §6 注（只有 `POST /entries {templateId}` 设置来源模板，默认骨架与斜杠 `/模板` 不设置）；01 §5 +「模板元数据目录」一行（可见性规则，`name` 仅对可读模板给出）。
- CLAUDE.md：规范索引行改为 `0035 ~ 0040` 并加 ADR-0040 摘要（用户要求同步，仍 ≤ 80 行）。

**模板元数据：模板属性增删改查 · 移除类型属性 · 记录记住来源模板（ADR-0039）**
- 新增 ADR-0039（修订 ADR-0036 §A.5 · §E.29 模板只预填类型字段 → 模板有自己的元数据；ADR-0011 §2 记录不记来源模板 → `entries.template_id`；ADR-0038 §1 覆盖表 +`field_defs` `hidden_fields`）；计划评审 11 条意见已并入（键一律服务端生成、移除只在类型一致时生效、可移除范围收窄、`purgeUser` / `purgeSpace` / 删类型三处适配、与类型字段不重名等）。
- 00：§6b +REQ-TPL-016 ~ 019；§6 +REQ-ENTRY-032。加注：REQ-TPL-004 · 007 · 011。
- 01：§3.4 entries +`template_id`；entry_templates +`field_defs` `hidden_fields`；builtin_template_overrides +`field_defs` `hidden_fields`；§3.12 +`template.fields_changed`。
- 02 §9：+`GET /templates/fields`；`/templates`（GET / POST / PATCH / DELETE / reset）、`POST /entries`、`GET /entries/:id` 行注。
- 08：§2.9 · §2.13 · §3.2 注。glossary +模板属性 · 来源模板 · 移除（类型属性）。
- 迁移 0024（`entries.template_id` + partial index、两表各 +2 列、`audit_log_action_ck` 重建）已落地，`lint:drift` 零差异。
- CLAUDE.md：规范索引行改为 `0035 ~ 0039` 并加 ADR-0039 摘要；测试说明加 `XZ_TEST_DATABASE_URL` 隔离测试库与勿写死库名（用户要求同步，仍 ≤ 80 行）。debug +`2026-09-30-jobs-test-restore-hardcoded-db`。

**记录页编辑区「文档式 · 极简」· 模板编辑器工具栏（ADR-0037）；内置模板由所有者维护（ADR-0038）**
- 新增 ADR-0037（修订 ADR-0029 §1 阅读胶囊四图标 → 单个「阅读」弹层四分页、控件带文字；ADR-0031 格式栏常驻细线 → 仅吸顶时有底线；ADR-0035 §B 两列表单式属性面板 + 面板内流转时间线 → 紧凑属性列表 + 流转摘要弹层、标签并入列表；ADR-0023 §4 模板编辑器只有斜杠 / 气泡 → 加格式工具栏、块手柄、表格工具条）与 ADR-0038（修订 ADR-0011 §2 内置模板为不可改的代码常量、ADR-0023 内置 403 → 所有者覆盖 / 软删 / 恢复 + 新增 `scope = builtin`）。
- 00：§6 +REQ-ENTRY-030 · 031；§6b +REQ-TPL-012 ~ 015；§18c +REQ-READ-010。加注：REQ-ENTRY-024 · 025、REQ-READ-007、REQ-EDITOR-024、REQ-TPL-001 · 002 · 004。
- 01：§3.4 entry_templates `scope` +`builtin`、新表 `builtin_template_overrides`；§5 template.read / create / manage 三行（builtin 仅 owner，admin 不可）。
- 02 §9：`GET /templates`（+`?deleted=1`）、`POST /templates`（scope builtin）、`GET|PATCH|DELETE /templates/:id`（内置不再一律 403）、`POST /entries`（覆盖 / 已删除 422）行注；+`POST /templates/:id/restore`（取消删除、保留修改）· `/reset`（恢复默认；实施时拆为两个接口，ADR-0038 · REQ-TPL-013 同步）；未改过的内置 `ifUpdatedAt` 基准 = 1970-01-01。
- 03 §6 注（默认骨架取覆盖后的正文，已删除回落空文档；模板编辑器工具栏）。04 §4 记录页纵向结构注。06 材质表「编辑器吸顶工具栏」「阅读胶囊」行注。08 §1 模板两行、§2.9 · §2.13 注。glossary +流转摘要 · 阅读弹层 · 内置模板覆盖 · 恢复默认（内置模板），属性面板 · 模板行加注。
- 迁移 0023（`builtin_template_overrides` + `entry_templates_scope_ck` 加 `builtin`）已落地，`lint:drift` 零差异。
- CLAUDE.md：坐标「记录页」行改为 标题 → 紧凑属性列表 → 文档栏（阅读弹层）→ 格式栏（吸顶才有底线）→ 正文；规范索引合并 0002 ~ 0011 行、新增 0035 ~ 0038 行（用户要求同步，仍 ≤ 80 行）。

**就地管理 · 记录页属性面板 · 元数据配色（ADR-0035）；空间类型 · 启用清单 · 字段定义 · 模板绑类型（ADR-0036）**
- 新增 ADR-0035（修订 ADR-0029 记录页纵向顺序为 标题 → 属性面板 → 文档栏 → 吸顶格式栏 → 正文；修订 ADR-0033 默认收起的流转 → 彩色时间线）与 ADR-0036（修订 ADR-0017 §2、ADR-0019 §3、ADR-0033 否决项「自定义类型任意属性」、ADR-0011 §2 / ADR-0023 模板只绑内置、ADR-0012 概览按 `space.kind` 写死）；计划评审 16 条意见已并入。
- 00：§6c +REQ-KB-011 ~ 017；§6 +REQ-ENTRY-024 ~ 029；§6b +REQ-TPL-011；§16 +REQ-UI-044。加注：REQ-KB-003（被 REQ-KB-016 取代，个人空间不受影响）· REQ-KB-010 · REQ-ENTRY-018 · REQ-TPL-007 · REQ-BUG-006 · REQ-READ-007。
- 01：§3.1 spaces +`default_type_id` `enabled_kinds`（null = 按 kind 推导默认，不迁移数据）；§3.4 entry_templates +`type_id`、kind 放开 custom；§3.4c entry_types +`space_id` `field_defs` `status_colors`，唯一约束改两个 partial unique index，entry_kind_overrides +`field_defs`；§3.5 +自定义字段（x 键 `FieldDef`）；§3.12 +`entry_type.fields_changed`；§5 内置类型追加字段 / 空间类型走 `space.manage` 两行。
- 02 §9：无新路由；`/entry-types`（GET / POST / PATCH / builtin PATCH）、`/spaces/:id`（GET / PATCH）、`/spaces/:id/merge`、`/entries`（GET 的 x 键与多选筛选、PATCH、batch）、`/entries/stats`、`/templates`（GET / POST / PATCH）行加注。
- 08：§2.5 `SpaceMenu` / `GroupMenu`；§2.5b 空间首页改为启用类型页签 + 状态概要 + 可编辑表格、`SpaceTypesDialog`；§2.8 统一配色 / 就地编辑 / 类型按空间过滤；§2.9 属性面板与 DOM 顺序；§2.13 `/settings/types` 字段编辑、模板绑类型。glossary：原「空间类型」（`space.kind`）改称「空间种类」，+个人类型 · 空间类型 · 启用类型 · 字段定义 · 属性面板。
- 迁移 0022（待实现）。CLAUDE.md「记录页 = 标题 → 文档栏 → …」坐标行需用户更新（不自动改）。


**认证页「衔枝小院」：双栏插画 + 会反应的小燕（ADR-0034）**
- 新增 ADR-0034（兑现 ADR-0007 预留的柳枝构图 D）。00 §16：+REQ-UI-041 ~ 043。06 §5.6 注（认证四页改双栏，窄屏探头小燕）。08 §2.1 注（情绪 / 成功延迟跳转）。glossary §2 +衔枝小院 · 小燕。tokens +`--xz-bird-*` `--xz-scene-*` `--xz-willow*` `--xz-branch`（两主题）。评审跟进：去掉燕巢 / 雏燕（不聚焦）；造型两版正面被否后改 3/4 侧身，三方向候选中用户选定 A「豆豆燕」；再出三种渲染质感，选定 T1「绒光」（无描边 · 右上主光 · 釉光 / 反光 / 柔影 · 栗红下巴 + 藏蓝胸带）。跟随与去机械感重做（喙指向指针 · 指针在背后转身 · 眼先头后身尾跟随链 · 微顿挫 / 错相呼吸 / 换重心 · 嘴只画一个喙）；定稿「幼燕 + A 墨青」（头宽约为躯干长 45% · 蛋形躯干 · 大眼偏低 · 嘴角笑线 · 叉尾白斑 · 低饱和墨青 / 陶土红 / 暖奶油，`--xz-bird-gape`，柳叶改鼠尾草绿）；此前比例曾改为真家燕 N2「自然」（修长身 · 长刀翅 · 深叉尾 · 捂眼改扭头躲开，`--xz-bird-band`）；动作按真鸟规律重做（头身拆开、扫视 + 头部稳定、眼先头后身、歪头打量、燕子停栖小动作清单、开发用 `?birdlab` 实验台）。tokens 相应改为 `--xz-bird-back-hi/-lo` `wing-hi/-lo` `belly-lo` `throat-lo` `eye-hi` `reflect` `gloss` `rim` `shadow` 与 `--xz-branch-lo/-light`。debug 记一条（减弱档 CSS 被情绪规则特异性压过 / 0ms 过渡带 delay 仍生成 transition）。

**Bug 跟踪：四态 · 优先级 · 统计 · 保存视图 · 查询块（ADR-0033）**
- 新增 ADR-0033（计划评审意见已并入）。00：+§6d BUG（REQ-BUG-001 ~ 012）及 open → new 注。01：§3.4d +`entry_field_changes` `entry_views`；§3.5 bug fields 改四态 + 优先级 / 发现 / 解决日期 / 模块。02 §9：+`/entries/stats` `/entries/bug-stats` `/entries/:id/field-changes` `/entry-views`×4，batch `fields.set` +priority。03 §3.2 +entryQuery。07 §5 +保存视图 / Bug 统计限额。08 §2.8 注（统计视图、分组、我的视图、快速提 Bug、流转）。glossary +优先级、待决策、流转、保存视图、查询块。迁移 0020（两表）· 0021（数据：open → new、补 priority / foundAt / resolvedAt、模板剔日期）。
- 验收跟进：SSE invalidate 帧合并失效（安静 300ms / 最长 2s），避免连续写入时统计页把本人请求放大到 429；debug 记两条（失效放大、e2e collab 端口写死）。

**文档对照代码（ADR-0023 ~ 0032 收尾）**
- 04：头部版本行；§2.2 +`--xz-font-song` `--xz-font-system`、阅读偏好说明、KaTeX `text-wrap` 注；§4 版心注 + 记录页纵向结构（文档栏 / 格式栏）；§6 新快捷键（专注 / 保存版本 / useHotkeys Shift）。
- 05：头部版本行；§3 验证实例 api / collab 不带 watch 须重启、IP 同源、mermaid / katex 懒加载与字体不内联；§5 偏好类 e2e 复位约定。
- 06：头部版本行；§3 +阅读纸张 token 与对比度覆盖注。CLAUDE.md 规范索引补 ADR-0022 ~ 0032，命令与坑位补验证实例重启、偏好复位、mermaid / katex、KaTeX text-wrap、onStateless。

**表头行 / 表头列 · 代码块折叠 · 插入时间（ADR-0032）**
- 新增 ADR-0032。00：+REQ-EDITOR-033 ~ 035。01 `user_preferences.reading` 键列表补 `tocNumbers` `codeFold`。

**格式工具栏去卡片（ADR-0031）**
- 新增 ADR-0031（修订 ADR-0030 §1）。06 材质表工具栏行注更新。

**记录页编辑外框美化（ADR-0030）**
- 新增 ADR-0030。06 材质表「编辑器吸顶工具栏」「阅读胶囊」两行注（卡片化、胶囊中性色、正文去焦点框）。

**文档栏：阅读 / 保存 / 字数移到标题下（ADR-0029）**
- 新增 ADR-0029。00：REQ-READ-007「改于」、REQ-EDITOR-024 注。08 §2.9 注。

## 2026-09-28

**工具栏两行固定 · 正文焦点描边调淡（ADR-0028）**
- 新增 ADR-0028。00：REQ-EDITOR-032 加「改于」注（两行固定 + 「…」收纳）。06 材质表工具栏行注。

**目录块卡片 · 正文章节编号默认开（ADR-0027）**
- 新增 ADR-0027。00：+REQ-READ-009。03 §3.2 目录块注（卡片、不叠浏览器序号、插入后光标落其下）。

**版心满栏 · 目录自动编号 · Ctrl+S 保存版本（ADR-0026）**
- 新增 ADR-0026。00：REQ-READ-002 注；+REQ-READ-008、REQ-EDITOR-032、REQ-COLLAB-017 · 018。02 §9 +`PATCH /entries/:id/snapshots/:sid`。03 §5 · §11.2 注。07 §3 +手动保存版本永久。08 §2.9 注。glossary +保存版本，标记版本加注。

**编辑器对齐简斋（ADR-0025）**
- 新增 ADR-0025。00：REQ-EDITOR-001 · 002 · 007 · 008、REQ-READ-002 加注；+REQ-EDITOR-024 ~ 031、REQ-READ-007。03 §3.1（色板颜色标记）· §11.1（斜杠分组）注。06 材质表 +吸顶工具栏 / 阅读胶囊 / 表格工具条与块菜单。08 §2.9 注。glossary +吸顶工具栏、阅读胶囊、插入面板、块手柄菜单、表格工具条、文字色 / 背景色。

**模板编辑与工作区共享（ADR-0023）**
- 新增 ADR-0023；ADR-0011 §2 加注（工作区模板非 guest 可共享）。00：REQ-TPL-004 加「改于」注；+REQ-TPL-006 ~ 010。01 §3.4b scope 说明与注、§5 template.create 行。02 §9 `/templates` 四行。08 §1 路由表 +新建 / 编辑模板页、§2.13 注。glossary +共享模板。

**阅读与写作偏好（ADR-0024）**
- 新增 ADR-0024。00：§0 非目标加注；+§18c READ（REQ-READ-001 ~ 006）。01 §3.11 +`user_preferences`（迁移 0019）。02 §9 +`GET / PATCH /me/preferences`。07 §4 注销行含阅读偏好。08 §1 路由表 +`/settings/reading`、§2.9 · §2.13 注。glossary +阅读偏好、版心、纸张、章节编号、专注写作。

## 2026-09-27

**合并空间（ADR-0022）**
- 新增 ADR-0022。00：+REQ-SPACE-013 ~ 015。01 §3.12 审计动作 +`space.merged`（迁移 0018）。02 §9 +`POST /spaces/:id/merge`。08 §2.5 注。glossary +合并空间。

**空间批量管理（ADR-0021）**
- 新增 ADR-0021。00：+REQ-SPACE-010 ~ 012。02 §9 +`POST /spaces/batch`。08 §2.5 · §2.14 注。

**验证实例端口可覆盖**
- 05 §3 `pnpm dev:verify` 行加注：`CLIENT_PORT` / `API_PORT` / `COLLAB_PORT` 可覆盖，`APP_URL` 默认随 `CLIENT_PORT`。

**设计画廊挪进设置并自带用法（ADR-0020）**
- 新增 ADR-0020。00：+REQ-UI-039 · 040；REQ-UI-004 加注（路由改 `/settings/design`）。08 §1 路由表、§2.16 注。04 §8、06 §10 注。

**`[[` 找不到就新建、侧栏 / 目录「+」、空间默认类型与模板（ADR-0019）**
- 新增 ADR-0019。00：+REQ-EDITOR-023、REQ-KB-009 · 010。01 §3.1 spaces +`default_kind` `default_template_id`（迁移 0017）。02 §9 `PATCH /spaces/:id` 两字段。08 §2.5b · §2.9 注。

**大类就地管理、在空间里就地新建、新建并关联（ADR-0018）**
- 新增 ADR-0018。00：+REQ-KB-008、REQ-ENTRY-021 ~ 023、REQ-LINK-006；REQ-KB-001 · 002 加注。
- 02 §9：`POST /entries` +`linkFrom`。08：§2.5 补大类（原文缺失）；§2.8 位置行与 `e` 规则；§2.9 新建子页面 / 新建并关联。glossary：+新建上下文、新建并关联。

**标签与自定义类型按人隔离、内置类型由所有者维护、改称「类型」（ADR-0017）**
- 新增 ADR-0017。00：+REQ-ENTRY-020、REQ-TAG-007；REQ-TAG-001 ~ 004 · 006、REQ-ENTRY-018 · 019 加注。
- 01：§3.7 tags 唯一约束改 `(workspace_id, created_by, name)`、读写按本人过滤；§3.4c `hidden_entry_kinds` → `entry_kind_overrides`，entry_types 唯一约束按人（迁移 0014 · 0015 · 0016）；§5 `tag.*` / `entry_type.*` 改为本人、+`entry_kind.manage`（仅 owner）。
- 02 §9：`/entry-types` 去掉 `PUT builtin/:kind`，+`PATCH / DELETE builtin/:kind`、`POST builtin/:kind/restore`，删除支持 `moveTo`，列表每项带 `mine`；`GET /tags` 只返回本人的、附 `canCreate`。08 §1 `/settings/types` 改称「类型」、`/settings/tags` 行注。glossary：自定义类型、删除内置类型。

**日历就地编辑、自定义记录类型、记录默认列表与批量编辑、侧栏「空间」可点（ADR-0016）**
- 新增 ADR-0016。00：+REQ-CAL-012 · 013、REQ-ENTRY-016 ~ 019、REQ-UI-038；REQ-UI-031、REQ-ENTRY-001 · 013 加注。
- 01：§3.4 entries +`type_id`、kind 增 `custom`；新 §3.4c `entry_types` / `hidden_entry_kinds`；§3.12 审计 +`entry_type.deleted`；§5 +`entry_type.create` / `entry_type.manage`。
- 02 §9：+`/entry-types` 5 条；`POST /entries/batch` op 增 retype / fields / pin / unpin；`GET /entries` +`typeId`；`PATCH /entries/:id` 可改 `kind` + `typeId`。
- 08：§1 +`/settings/types`；§2.8 默认视图改为列表、search params +`typeId`、`view` 增 `cards`；§2.17 注快速编辑气泡与任务拖动。glossary：+自定义类型、隐藏内置类型、快速编辑气泡。

**日历周视图重叠日程折叠「+N」**
- 00：+REQ-CAL-011（每簇最多并排 2 列，余下收成「+N」，保证可点目标 ≥ 24px）。08 §2.17 周视图描述加注。

## 2026-09-26

**目录层级表达、个人空间工作台、记录类型图标（ADR-0015）**
- 新增 ADR-0015。00：+REQ-KB-006 · 007、REQ-UI-037；REQ-KB-003 加注（个人空间见 REQ-KB-007）。
- 08：补 §2.5b 空间概览与目录（原被 REQ-KB-003 引用但缺失）；§1 `/spaces/$slug/home` 行注个人工作台。04：图标行加注（类型图标、色块、专属色、引导线）。glossary：+空间目录、引导线、类型图标。

**我的记录：位置导航、标签自定义、收藏 / 最近、批量、看板与时间线（ADR-0014）**
- 新增 ADR-0014。00：+REQ-ENTRY-012 ~ 015、REQ-TAG-004 ~ 006。
- 01：§3.7 tags +`created_by`，新表 `entry_favorites`；§5 +`tag.manage` 行（管理员或创建者）。
- 02 §9：+`POST /entries/batch`、`PUT/DELETE /entries/:id/favorite`、`POST /tags/:id/merge`；`GET /entries` 注 `under / groupId / favorite / ids`、每项 `path / favorited`；标签权限注；`/search` `tag` 改多值。
- 08：§1 +`/settings/tags`；§2.8 · §2.11 search params 注。glossary：+收藏、最近打开、记录位置、批量操作、看板（记录）、时间线、合并标签。

**界面称呼改回「空间」（ADR-0013）**
- 新增 ADR-0013；ADR-0012 头部与 §2 加注。00 REQ-KB-002、glossary「空间」行加注（合并重复行）；01 / 02 / 08 与代码注释中的「分类」改为「空间」；不属于大类的显示「未分类」。

**分类：大类、概览与类型视图、目录树、关联（ADR-0012）**
- 新增 ADR-0012。00：新增 §6c KB（REQ-KB-001 ~ 005）；REQ-LINK-001 · 002 · 003 · 005 加注已实现。
- 01：§3.0 `space_groups`；spaces +`group_id`；entries +`parent_id` `tree_order`；§5 +`group.manage`。
- 02 §9：+`/space-groups` 5 条、`GET /spaces/:id/tree`、`PATCH /entries/:id/move`；`PATCH /spaces/reorder` +`groupId`；`GET /entries` 注 `kind` 多值 / `fields` / `inTree` / `tagIds`。
- 08 §1：+`/spaces/$slug/home`、`/spaces/$slug/tree`。glossary：+分类、大类、目录、概览。tasks/phase-2：反链 / 链接划线加注。

## 2026-09-25

**历史版本恢复、Markdown 源码编辑与识别、附件类型、记录模板（ADR-0011）**
- 新增 ADR-0011。
- 00：REQ-COLLAB-008 改写（「两快照互比」→「快照 ↔ 当前」，恢复细节）；新增 REQ-UI-036（非安全上下文）、REQ-EDITOR-019 ~ 022（语雀式识别 / 源码对话框 / 图片展示 / .md 文件）、REQ-ATTACH-012 · 013（Office / csv / 代码文件、应用内预览）、§6b TPL（REQ-TPL-001 ~ 005）；REQ-EDITOR-008 · 011 加注。
- 01：entries.kind +`optimize` `plan`；§3.5 fields +2；新表 `entry_templates`；entry_snapshots 注；§3.12 审计 +`entry.restored`；§5 +`template.read / create / manage`。
- 02 §9：+`GET …/snapshots/:sid/content`、`POST …/snapshots/:sid/restore`、`/templates` 5 条；`POST /entries` +`templateId`。
- 03：§5 恢复实现注；§6 模板注；§8 源码对话框注；§11.3 识别 / `.md` 文件 / 图片属性注。07 §2.4 +Office / 预览注入行。08 §1 +`/settings/templates`；§3.2 注。glossary：记录类型 +2，+模板、历史版本、源码编辑。tasks/phase-2：T1-017 历史页签、`[[` 选择器划线加注。
- debug：+2026-09-25-randomuuid-insecure-context、+2026-09-26-jsonb-key-order-diff。

**鲜艳 9 色板、日历拖选、owner 用户管理与个人资料（ADR-0010）**
- 新增 ADR-0010。
- 00：新增 REQ-CAL-010（拖选新建）、REQ-UI-035（鲜艳 9 色板）、REQ-WS-018 ~ 023（用户管理 / 改资料 / 重置密码 / 删号 / 本人改用户名邮箱 / 头像）、REQ-AUTH-021（改密）；REQ-CAL-001 · TAG-001 · COLLAB-010 · UI-033 色板描述加注。
- 01：§3.12 审计 +`auth.password_changed` / `user.created` / `user.updated`；§5 +`user.manage`；色列说明与默认日历色改新色名。
- 02：§2 注「改资料 / 改密只走 /api/v1」（Better Auth `/update-user` `/change-password` `/change-email` `/admin/*` 404）；§9 +`GET/POST /workspace/users`、`PATCH /workspace/users/:userId`、`POST /workspace/users/:userId/password`、`PATCH /me/account`、`POST /me/password`、`DELETE /me/avatar`，`?purge=1` 行改为 REQ-WS-021 已实现。
- 04 §2.1 色板改写（`-solid / -bg / -fg`、色块样式、旧名映射）；07 §4 生命周期 +直建 / 改资料 / 改密重置三行与注；08 §1 +`/settings/workspace/users`、§2.13 / §2.17 注；glossary 色板行。

**开放注册 + 审批、用户名登录、密码 8 位（ADR-0008）**
- 新增 ADR-0008；ADR-0001 §4.6 注册策略与 §8 决定 6 加注 / 删除线；ADR-0006 头部加注（用户名裁定被推翻）。
- 00：非目标划掉「自助注册」；REQ-AUTH-002 修订为「拒绝绕过审批的注册」；新增 REQ-AUTH-017（注册）· 018（待审批不能登录 / 审批）· 019（驳回删号）· 020（用户名登录）。
- 01：§2 注；§3.14 `join_requests`；§3.12 审计 +`member.registered / approved / rejected`；§4 / §4.1 +`member.requested`，`member.joined` 触发加「注册被批准」；§5 +`member.approve`。
- 02：§2 注册与用户名登录；§3 +403 `REGISTRATION_PENDING`；§9 +4 条 `/workspace/join-requests*`。07 §2.1 威胁表改写「自助注册滥用」、加「注册探测」；§5 注册限额。08 §1 `/register`、§2.1b 注册与审批。glossary +注册申请、用户名，「邀请」定义改写。

**日历改版：日程、重复、提醒、中国节假日（ADR-0009）**
- 新增 ADR-0009。00：新增 §18b CAL（REQ-CAL-001 ~ 009），REQ-UI-031 加注。01：§3.15 `calendars` / `calendar_events`（原 §3.14 二期预留顺延为 §3.16）、§3.10 target_type +`calendar_event`、§4 / §4.1 +`calendar.reminder`、§5 +`calendar.read / write`。02 §9 +8 条路由。07 §5 日历限额。08 §1、§2.17 改版（原文保留在下方）。glossary +我的日历、日程、重复、提醒、休 / 班。
- 05 §6 漂移脚本类型表加 `timestamptz[]` / `int[]`。

**文档头同步**
- 01 / 02 / 04 / 07 / 08 / glossary 刷新「更新」与「最后对照代码」（2026-09-25）；04 §4 注速览栏与日历组件位置；07 头部「邀请制」改为「邀请或注册 + 审批」。

**宽屏布局（REQ-UI-034）**
- 00 新增 REQ-UI-034；08 §2.3 注：今日 / 收件箱 / 通知「主列 + 速览栏」，今日计数卡；glossary +速览栏。


**燕印改为「晨光白燕」（ADR-0007）**
- 新增 ADR-0007：燕印重画（剪刀尾、镰刀翼、褐枝嫩芽），翡翠深渐变 + 右上晨光 + 暖白燕；md / lg 完整版、sm 与 favicon 简化版；配色走两主题同值的 `--xz-seal-*`；对比度闸门加 3 项。
- 品牌副标：侧栏与登录页「Xianzhi」及登录页口号统一为「日衔寸枝，岁成一巢」（`app.tagline`，原 `auth.tagline` 移除）；燕子占比 .82 → .9。06 §5.6 加注。
- ADR-0005 §2 加「注」指向 ADR-0007；00 REQ-UI-024 描述与验收按新燕印更新；04 §9 Logo 行、glossary 燕印行加注。

**前端 UI 打磨（页头 / 配色 / 交互 / 动效）**
- 00：新增 REQ-NOTIF-017（通知正文时间 / 大小可读化，unit）、REQ-UI-033（统一页头、记录类型分色、跨空间「色点 + 空间名」标注、卡片悬停抬升与网格入场错峰）。
- 01 §4.1 模板占位符不变，渲染时 `{dueAt}` / `{expiresAt}` / `{oldestCreatedAt}` 格式化为 `M/D HH:mm`（Asia/Shanghai），`{sizeBytes}` 格式化为 `KB / MB`；旧通知行不回写。
- 04 §5 组件：新增 `ui/page-header.tsx`、`domain/SpaceTag.tsx`；`SpaceIcon.tsx` 导出 `PALETTE_DOT`（日历与空间标注共用）。
- app.css：原生 `select` 统一外观（token 渐变画箭头，规则不进层以压过组件 `px-*`）、日期控件图标随主题；`.xz-eyebrow` 页头题记、`.xz-lift` 卡片悬停、`.xz-rise` 入场错峰（减弱档无动画）。

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
