# ADR-0035 就地管理 · 记录页属性面板 · 元数据配色

> 状态：已采纳 · 2026-09-30 · 修订 ADR-0029（记录页 DOM 顺序：标题 → 文档栏 → 吸顶格式栏 → 正文 → **标题 → 属性面板 → 文档栏 → 吸顶格式栏 → 正文**）、ADR-0033 §B.7「属性栏里的流转，默认收起」（→ 属性面板底部的彩色时间线）；其余为新增。无迁移。需求区 00：REQ-KB-011 ~ 013、REQ-ENTRY-024 ~ 026、REQ-UI-044。

## 背景

用户反馈（2026-09-30）：

1. 空间建好后改不了图标 / 颜色；改名只能进「编辑空间」弹窗；删单个空间要进 `/spaces` 批量模式；侧栏空间行没有 ⋯；目录树 / 表格行不能改名、归档、删除；记录页删除后一律跳 `/entries`；全站没有右键菜单。
2. 记录页的元数据（状态、优先级、日期…）藏在默认收起的属性栏里，是一张灰色表单；表格、看板、卡片里同一个状态各处颜色不一，日期无色。
3. 想在列表里直接改状态 / 日期，不必逐篇打开。

## 决定

### A. 就地管理（REQ-KB-011 ~ 013）

1. **`SpaceMenu`**（新组件，侧栏空间行 ⋯ / 右键、`KbHeader` ⋯、空间卡片 ⋯ 共用）：改名（菜单内输入框，Enter / 失焦保存）· 图标与颜色（从 `CreateSpaceDialog` 抽出 `SpaceIconPicker`）· 移到大类 · 类型与字段（ADR-0036 `SpaceTypesDialog`）· 编辑空间（原 `KbEditDialog`）· 合并到…（ADR-0022）· 归档 / 取消归档 · 删除。
   - 删除 = `POST /spaces/batch {op:'delete', ids:[id], dryRun:true}` 取计数 → 确认框写明记录 / 任务数 → 正式删除 → Toast「撤销」（`restore`）。
   - 菜单项按 `space.manage` / `space.delete` 在前端决定是否显示；以服务端 `can()` 为准（不变量 2），前端判断只为少出无用项。
   - 在该空间的页面里删除 → 跳 `/spaces`（Toast 仍可撤销）；归档 → 留在原页，页头显示归档横幅。
2. **`KbHeader`**：标题 `InlineEdit` 就地改名（`h1` 保留）；点图标弹 `SpaceIconPicker`。只读者不可点。
3. **`/spaces` 大类分区头**加 `GroupMenu`（与侧栏分区 ⋯ 同一组件、同一套动作，ADR-0018）。
4. **`EntryRowMenu`**（目录树节点 ⋯ / 右键、`EntryTable` 行 ⋯ / 右键、空间首页表格行）：改名（就地输入）· 新建子页（仅在目录里的记录）· 置顶 / 取消置顶 · 归档 · 删除（Toast 撤销）；动作复用 `useEntryActions`。表格标题单元格双击或菜单「改名」进入 `InlineEdit`。
5. **记录页删除后**：有父页 → 跳父页；否则 → 所在空间首页（个人空间的记录维持原逻辑跳 `/entries`）。
6. **右键菜单**：只在侧栏空间行、目录树节点、表格行上 `onContextMenu` 打开**同一个**菜单（Popover 以指针位置为锚），不引入 ContextMenu 新依赖；键盘用户用行尾 ⋯（可聚焦）。

### B. 记录页属性面板（REQ-ENTRY-024 · 025；修订 ADR-0029）

7. **DOM 顺序**：面包屑 → 元信息行 → 标题 → **属性面板（常显）** → 文档栏 → 吸顶格式栏 → 正文。REQ-READ-007 的几何 `title.y < docBar.y < toolbar.y` 仍成立（面板插在标题与文档栏之间）。
8. **`EntryProperties`** 取代 `EntryFieldsPanel` 的折叠表单：
   - 两列网格（≥ md 2 列，窄屏 1 列）；每行 = 字段图标 + 属性名 + 值；值为彩色胶囊 / 彩色日期 / 进度条（第 C 节），点击弹 Popover 编辑（`FieldEditor`：选项列表带色点 / 日期输入 / 数字 / 文本），改完即 `PATCH`（沿用 600ms 合并 + `ifUpdatedAt`）。
   - 最后一行「标签」（`TagPicker`，与原属性栏同一组件）。
   - 空值显示淡色「空」占位，可点；必填缺失标红（只提示，不拦）。
   - 只读访客：只显示，不弹编辑。
   - 专注模式隐藏（同现状）；记录类型没有任何字段（随笔、无状态的自定义类型）时不显示面板——ADR-0036 给随笔追加了自定义字段后照常显示。
   - **不懒加载**：面板是小组件，直接进记录路由 chunk（须过 `check-budget`）；首帧按字段数预留高度，避免数据到达时文档栏下跳。
9. **流转时间线**（修订 ADR-0033 §B.7「默认收起的流转」）：面板底部一行「流转 N 次 ▸」，展开为竖向时间线，每条 = 色点 + 「字段：[旧值胶囊] → [新值胶囊]」+ 操作者 · 相对时间（悬停显示绝对时间）；数据仍为 `GET /entries/:id/field-changes`，按时间倒序。新建起点（null → 值）显示为「设为 [值]」。
10. **右栏「属性」页签**只保留 类型 / 可见性 / 空间 / 目录位置 / 作者 / 字数 / 版本；元数据字段与标签不再在右栏重复。
11. 新建对话框仍用 `EntryFieldsForm`（`#field-*` 选择器不变），不改为胶囊交互。

### C. 元数据配色（REQ-UI-044）

12. **`lib/field-tones.ts`**（纯函数，从 `EntryTable` 抽出 `STATUS_TONE` 并扩展）返回 04 §2.1 色板色名：
    - 状态：内置状态有语义色（new 红 · pending 橙 · fixed 绿 · wontfix 灰；proposed 蓝 · accepted 绿 · superseded / rejected 灰；planned 青 · doing 橙 · shipped 绿 · dropped 灰；planning 蓝 · active 橙 · paused 黄 · done 绿）；自定义状态 / 自定义单选优先取类型里设定的颜色（ADR-0036 `status_colors` / 选项 `color`），否则按位置轮换（首项灰、末项绿）。
    - 优先级 p0 红 · p1 橙 · p2 蓝 · p3 灰；严重度 critical 红 · high 橙 · medium 黄 · low 灰；心情 1–5 渐变。
    - 日期（`DateChip`：日历图标 + 相对短日期，tooltip 全日期）：截止类（`dueDate` `endDate` `periodEnd`）已完成 = 绿、过期 = 红、3 天内（含今天，按操作者时区）= 橙、更远 = 蓝；起始 / 发现类（`startDate` `periodStart` `foundAt`）= 青；完成类（`resolvedAt` `releasedAt` `decidedAt`）= 绿；其余 = 蓝。
    - 进度（`ProgressBar`）：0–29 橙 · 30–99 蓝 · 100 绿。
    - 文本（模块 / 版本）：中性胶囊（`surface-2`）；URL 带链接图标。
13. **统一组件** `FieldValue`（只读展示）+ `FieldEditor`（Popover 编辑），用在 记录页属性面板、`EntryTable`、`EntryBoard` 卡片、`EntryCard` 元信息、空间首页——全站同一值同一色。
14. 颜色只取 `.xz-tone-*` / 色板 token / 语义 token（不变量 5），不加裸色值；对比度沿用色板 fg / bg（已 ≥ 4.5，`lint` 对比度检查覆盖）；颜色旁总有文字，不单靠颜色传达含义。

### D. 表格就地编辑（REQ-ENTRY-026）

15. `EntryTable` 增 `editable`：状态 / 单选 / 日期 / 数字 / 文本单元格点击弹 `FieldEditor`，`PATCH /entries/:id`（`ifUpdatedAt` = 该行 `updatedAt`）；乐观更新列表缓存；409 → Toast「已被他人修改」并刷新该列表。只读空间 / 无写权限的行不弹。
16. 记录页已按 SSE 失效 `['entry', id]`：在列表 / 空间首页改的值实时同步到打开中的记录页。

## 候选与否决

- **方案 B：属性放右栏常驻**：宽屏好看，窄屏必须折叠，且右栏已承担大纲 / 反链 / 评论——用户选方案 A（标题下常显）。
- **属性面板继续默认收起、只加颜色**：用户明确要「一眼看到状态与日期」——否决。
- **引入 Radix ContextMenu**：只三处用得到，Popover 以指针定位已够；少一个依赖。
- **删除单个空间继续只走 `/spaces` 批量模式**：路径太深——否决，菜单里直接删，仍复用 `/spaces/batch` 的 dryRun 计数与撤销。
- **属性面板懒加载**：组件小，懒加载反而多一次 chunk 请求并导致文档栏跳动——否决。

## 后果

- 00：+REQ-KB-011 ~ 013、REQ-ENTRY-024 ~ 026、REQ-UI-044；REQ-BUG-006「属性栏流转」、REQ-READ-007 加注。08 §2.5 · §2.5b · §2.9 注。glossary +属性面板。
- CLAUDE.md「坐标 · 视觉」行「记录页 = 标题 → 文档栏 → 吸顶格式栏 → 正文」须改为「标题 → 属性面板 → 文档栏 → 吸顶格式栏 → 正文」——**提醒用户更新，不自动改**。
- e2e 需同步：`bug.spec` REQ-BUG-006 依赖原生 `#field-status` 与 `entry-fields-toggle`，改为新交互（`entry-prop-status` → 选项 `role=option`）；`reading-prefs` 的 REQ-READ-007 几何断言保持通过；`spaces.spec` 依赖的 `kb-home` 标题仍是 `h1`。
- 视觉基线：记录页、表格、看板卡片颜色变化，改完先在 `/settings/design?theme=both` 过一遍再更新截图。

## 实施顺序与测试

| 步 | 内容 | 测试 |
|---|---|---|
| P1-a | `field-tones` · `FieldValue` / `DateChip` / `ProgressBar` · 全站替换 | unit `field-tones.test`（REQ-UI-044） |
| P1-b | `EntryProperties` + `FieldEditor` + 流转时间线 + 记录页 DOM 重排 | e2e `bug.spec` 更新（REQ-BUG-006 · REQ-ENTRY-024 · 025）· `reading-prefs` 几何（REQ-READ-007） |
| P1-c | `SpaceMenu` · `SpaceIconPicker` · `KbHeader` 就地 · `/spaces` `GroupMenu` · `EntryRowMenu` · 右键 · 删除后跳转 | e2e `inline-manage.spec`（REQ-KB-011 ~ 013） |
| P1-d | `EntryTable editable` | e2e（REQ-ENTRY-026） |

每步结束跑 `pnpm lint && pnpm typecheck && pnpm test`（相关文件）；全部完成后 `pnpm build`（含 `check-budget`）、相关 e2e、`/settings/design` 视觉过一遍。
