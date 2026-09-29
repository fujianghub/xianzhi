# ADR-0033 Bug 跟踪：四态状态 · 优先级 · 统计 · 保存视图 · 查询块

> 状态：已采纳 · 2026-09-29 · 补充 01 §3.5 bug fields、新增 `entry_field_changes` / `entry_views` 两表；02 §9 +7 路由；03 +`entryQuery` 节点；08 §2.8 记录页 `view=stats` 与分组。需求区 00 §6d BUG（REQ-BUG-001 ~ 012）。

## 背景

用户要把一个产品的 Bug 统一记在一处（主题、时间、状态、优先级、详细描述），能过滤、分组、统计。现状（ADR-0012 / 0014 / 0016）已具备：`kind=bug` 记录（`severity` + `status open|fixed|wontfix`）、`fields=` 过滤、Bug 看板、空间概览的严重度计数。缺口：

- 没有**优先级**（严重度 = 影响面，优先级 = 修复顺序，两者不能合一）；没有「发现时间」「解决时间」。
- 状态不贴合用户流程（用户选定：新建 / 待决策 / 已修复 / 不修复）。
- 统计在前端对最多 100 条现数，超过即错；没有趋势、修复时长、账龄。
- 筛选组合不能保存；想「在一个文档里看全部 Bug」只能靠手抄表格（正文里的表格无法筛选统计，也违背不变量 1）。

## 决定

### A. 字段、状态与列表（REQ-BUG-001 ~ 005）

1. **bug fields**（`src/shared/schemas/entryFields.ts`，strict）：

   ```
   status    : 'new' | 'pending' | 'fixed' | 'wontfix'      // 新建 · 待决策 · 已修复 · 不修复（定义顺序 = 看板列顺序）
   priority? : 'p0' | 'p1' | 'p2' | 'p3'                     // P0 紧急 · P1 高 · P2 中 · P3 低；缺省由服务端补 p2（旧客户端 / MCP 不传也不 422）
   severity  : 'low' | 'medium' | 'high' | 'critical'        // 不变
   foundAt?  : isoDate                                       // 发现日期；缺省由服务端补
   resolvedAt?: isoDate                                      // 解决日期；服务端维护
   module?   : string ≤ 40，不含 `, | =`                     // 模块，统计 / 分组用
   commit?, debugDir?                                        // 不变
   ```
   默认 `{ status:'new', priority:'p2', severity:'medium' }`。`resolvedAt ≥ foundAt`。「未关闭」= `new | pending`；「已关闭」= `fixed | wontfix`。

2. **服务端规范化**（`services/bug-fields.ts` `normalizeBugFields(prev, next, { today, createdOn })`，在 `createEntry` / `patchEntry` 的 `resolveKindFields` 之后调用，**之后再按 strict schema 校验一次**；批量 `fields` / `retype` 都经 `patchEntry`）：
   - 「今天」取操作者时区：`EntryCtx.timezone`（路由从会话注入），缺省时按 actor 查 `user.timezone`，再缺省 Asia/Shanghai。
   - `priority` 缺省 p2。`foundAt` 缺省：沿用原值；新建 = 今天；从别的类型改来 = 该记录创建日（与迁移口径一致）。`foundAt` 不得晚于今天（422）。
   - 进入已关闭：给出值 ?? 今天；保持已关闭：给出值 ?? 原值 ?? 今天；未关闭：删除 `resolvedAt`（重开即清，旧页面回传由 `ifUpdatedAt` 挡住）。
   - 另存为模板 / 模板 PATCH 时剔除 `foundAt`、`resolvedAt`（模板不带日期）。
3. **迁移**：`0020_bug_tracking.sql`（drizzle 生成：两张新表）+ `0021_bug_data.sql`（`--custom`，`entry_views.sort_key` 设 `COLLATE "C"` 与数据）：bug 记录 `status open → new`；补 `priority = p2`；补 `foundAt` = 创建日（作者时区）；已关闭的补 `resolvedAt` = 更新日；`entry_templates` 中 kind=bug 的 fields 同步（open → new、补 priority）。内置模板 `builtin:bug-fix` 的 fields 改为新默认。
4. **列表**：
   - 服务端排序白名单 +`priority`（p0 在前）、`foundAt`（`-foundAt` 最近发现在前）：排序键为不含 null 的表达式（`coalesce(case … end, 9)` / `coalesce(fields->>'foundAt','')`），游标按字段类型编码（数字 / 字符串 / 时间）；前端排序下拉加「按优先级」「最近发现」。表格列头排序仍在已加载数据内。
   - 表格列由 fieldSpecs 自动得出（优先级 / 严重度 / 发现 / 解决 / 模块…）；状态为色胶囊；进度列只在该类型有进度属性时出现；提交 / 踩坑目录很少填又长，不进列表（属性栏可改）。
   - **分组**（`group=status|priority|severity|module`，仅单一内置类型的表格）：在已加载的行内分组（组序 = 枚举定义顺序，模块按数量）；组头计数取 `/entries/stats`，已加载不足时显示「已加载 x / 共 n」。
5. **统计接口** `GET /entries/stats`（字面路由注册在 `/:id` 之前）：参数 = 列表筛选参数（无游标 / 排序）+ `groupBy`（1 ~ 2 个 fields 键）→ `{ total, groups:[{ values:{status:'new'}, n }] }`；缺值为 `null`。与列表同一套条件构造（抽出 `entryListConds`），权限走 `visibleEntriesWhere`。空间概览的 Bug 面板改用它（未关闭 = `status=new|pending`）。
6. **快速提 Bug**：新建对话框的属性区对 bug 只显示 优先级 / 严重度 / 模块（状态默认新建、发现日期服务端补；其余在属性栏补）；「模块」输入带本人可见 Bug 已用模块的候选（`stats groupBy=module`）。属性栏里 `resolvedAt` 只在已关闭时显示。

### B. 流转记录、统计视图、保存视图（REQ-BUG-006 ~ 009）

7. **`entry_field_changes`**：`(id, workspace_id, entry_id → entries cascade, actor_id, field, from_value?, to_value?, created_at)`。所有 kind 的 `status / priority / severity` 变化（含新建时 null → 值、改类型）由 entries service 同事务写入。`GET /entries/:id/field-changes`（受 `entry.read`）；属性栏显示「流转」时间线。
8. **Bug 统计** `GET /entries/bug-stats`：参数 = 列表筛选（kind 强制 bug）+ `from` / `to`（isoDate，缺省近 12 周）+ `bucket=week|month`：
   - `trend[]`：每桶新增（按 foundAt）、关闭（按 resolvedAt）、期末未关闭存量；
   - `mttr[]`：按优先级的已修复（fixed）平均 / 中位修复天数（resolvedAt − foundAt）；
   - `aging[]`：未关闭按账龄 0–7 / 8–30 / 31–90 / 90+ 天；
   - `reopened`：区间内 已关闭 → 未关闭 的次数（来自 `entry_field_changes`，只算当前仍为 bug 的记录）。
   - 周桶按操作者 `weekStartsOn` 与时区对齐；桶数 ≤ 104（超出 422）。存量按当前 foundAt / resolvedAt 倒推：重开会清 resolvedAt、删除 / 归档的记录不计，历史数字会随之变化（近似值，界面注明）。
9. **统计视图**：记录页只选 Bug 时视图切换多一个「统计」（`view=stats`）：概要卡（总数 / 未关闭 / P0 未关闭 / 本期关闭）、分布（状态 / 优先级 / 严重度 / 模块，条形列表，点击即筛选）、趋势（新增 vs 关闭柱 + 存量折线）、修复时长、账龄。图表为自绘 SVG / CSS，颜色只取 token（不引图表库、不进首包预算）。
10. **保存视图 `entry_views`**：`(id, workspace_id, owner_id, space_id?, name ≤ 40, search jsonb, sort_key, created_at, updated_at)`，个人所有（同标签，ADR-0017），他人不可见（404）。路由 `GET/POST /entry-views`、`PATCH/DELETE /entry-views/:id`。`search` 为记录页 search params 的白名单子集，定义在 `src/shared/entry-search.ts`（纯 TS、不依赖 zod，路由配置在主 chunk；服务端校验 `search`、查询块 `query`、客户端路由三处共用；`view` 含 `stats`，`sort` 含 `priority` / `-foundAt`）。每人最多 50 个视图；空间硬删时级联删除其视图。记录页筛选行「保存视图」；左栏「我的视图」列出，点击 = 套用（带 `spaceId` 的在该空间记录页打开），⋯ 改名 / 覆盖为当前筛选 / 删除。

### C. 查询块（REQ-BUG-010 ~ 012）

11. **`entryQuery` 节点**（块级 atom，新增节点向后兼容，不 bump schema 版本）：`attrs { title: string, query: string, view: 'table'|'stats'|'count', limit: number(1–50, 默认 20) }`（看板不进查询块：节点视图内拖拽与 ProseMirror 拖放冲突）。`query` 为 URLSearchParams 串，只认白名单键（同第 10 条，另含 `spaceId`）。
   - 节点视图：标题栏（标题 · 视图切换 · 「在记录页打开」· 设置）+ 实时数据：表格（只读精简列）、统计（第 9 条组件，仅 kind=bug）、计数。数据以**读者自己的权限**请求，不会越权；读者看不到的记录不出现。历史版本 / 模板预览（`ReadOnlyDoc` 挂 `StaticDoc` 标记）只显示标题 + 链接卡，不请求数据；只读访客看记录仍走编辑器，照常显示实时结果、不能改设置。
   - 插入：斜杠 `/查询`（terms: query, chaxun, bug, shitu, tongji）直接插入默认查询 = 本篇所在空间 · 未关闭 Bug · 按优先级 · 表格；块上「设置」对话框改 标题 · 空间（可选「全部」）· 类型 · 该类型的枚举属性 · 排序 · 视图 · 条数，保存时一次 `updateAttributes`（不逐键写，不变量 7）。
   - `pm.ts` `FULL_NODES` 与 `pmToPlain` 加该节点（纯文本 / tsv 只含标题）；Markdown 导出：`> [查询：标题](<APP_URL>/entries?query)`（有损）；HTML：同链接；Markdown 源码对话框：加入 `SOURCE_KEEP_TYPES` 保留占位。评论（liteKit / PmView）不含该节点。collab 派生不依赖 schema，无需注册；旧客户端显示为 unknownBlock（保留原数据）。

12. **批量改属性**：`POST /entries/batch` 的 `fields.set` 增 `priority`；批量条对 Bug 多一个「改优先级」。

## 候选与否决

- **一个文档里用表格存多条 Bug**：Yjs 正文无法 SQL 筛选 / 统计 / 单条评论与关联，且元数据进正文违背不变量 1 —— 否决，改为「一条 Bug 一条记录 + 查询块聚合」。
- **自定义类型支持任意属性**（通用方案）：要属性编辑器、动态校验、动态列，工作量数倍；先把内置 Bug 做厚，出现第二个同类需求再做。
- **负责人字段**：目前单人使用为主，暂不做（任务已有指派）。
- **`fixedIn` / `foundIn` 版本字段**：迭代「本期修复的 Bug」已由 `resolves` 关联提供，不重复。
- **`resolvedAt` 只从流转表推导**：列表 / 排序 / 过滤要直接可用，放进 fields 并由服务端维护；流转表只用于重开次数与时间线。
- **引入图表库（recharts 等）**：体积与性能预算不划算；所需图形（条形 / 柱 / 折线）自绘即可。
- **查询块把结果快照进正文**：数据会过期、会把他人不可见记录的标题写进文档 —— 否决，始终按读者实时查询。

## 后果

- 00：+§6d BUG REQ-BUG-001 ~ 012；REQ-ENTRY-015 / REQ-KB-003 / REQ-ENTRY-017 / REQ-TPL-007 验收里的 `open` 加注改为 `new`。01 §3.5 bug 行；+§3.4d `entry_field_changes` · `entry_views`。07 §5 限额。02 §9 +7 路由。03 §3.2 +entryQuery。08 §2.8 `view=stats`、`group=`、我的视图。glossary +优先级、待决策、流转、保存视图、查询块。
- 迁移 `0020_bug_tracking.sql`（新表）+ `0021_bug_data.sql`（数据）。
- 旧数据 `status=open` 的链接 / 过滤 URL 失效（筛选下拉回到「全部」），可接受。
- 07：`entry_views` 每人 ≤ 50；`entry_field_changes` 随记录硬删级联，不单独清理。
- 实时失效合并（验收时发现，见 `debug/2026-09-29-sse-invalidate-rate-limit-amplify`）：统计视图 / 查询块让 `['entries']` 下活跃查询变多，逐帧失效会在连续写入时把本人请求放大到限流；`useRealtime` 的 invalidate 帧改为按 key 去重、安静 300ms / 最长 2s 合并失效。
- 评审（2026-09-29）：校验时序、时区来源、路由顺序、只读预览、null 安全游标、分组口径、模板剔日期、迁移拆分、周桶对齐、白名单共享等意见已并入上文。

## 实施顺序与测试

| 步 | 内容 | 测试 |
|---|---|---|
| A1 | fields schema · 默认值 · normalizeBugFields · 迁移 0020 / 0021 · 内置模板 / seed · i18n · 状态色 · 同步改旧测试的 open | unit `entryFields.test` · api `bug.test`（REQ-BUG-001 ~ 002） |
| A2 | 排序 priority / foundAt · `entryListConds` 抽取 · `/entries/stats` | api（REQ-BUG-003 · 004） |
| A3 | 表格分组 · 新建对话框精简属性 · 模块候选 · 空间概览改用 stats · 修旧测试的 open | e2e `bug.spec`（REQ-BUG-005） |
| B1 | `entry_field_changes` 写入 · `/field-changes` · 属性栏流转 | api（REQ-BUG-006） |
| B2 | `/entries/bug-stats` · 统计视图（自绘图） | api · e2e（REQ-BUG-007 · 008） |
| B3 | `entry_views` CRUD · 左栏「我的视图」· 保存 / 套用 | api · e2e（REQ-BUG-009） |
| C1 | `entryQuery` 节点（shared 白名单 · 派生 · md / html 序列化 · 源码对话框占位） | unit（REQ-BUG-010） |
| C2 | 节点视图 · 斜杠 · 设置对话框 · 只读占位 | e2e（REQ-BUG-011 · 012） |

每步结束跑 `pnpm lint && pnpm typecheck && pnpm test`（相关文件）；全部完成后 `pnpm lint:drift`、`pnpm build`、相关 e2e。
