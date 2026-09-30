# ADR-0036 空间类型 · 启用清单 · 字段定义 · 模板绑类型

> 状态：已采纳 · 2026-09-30 · 修订 ADR-0017 §2（自定义类型只有个人类型 → 另有**空间类型**，个人类型语义不变）、ADR-0019 §3（空间默认类型仅内置 → 可为本空间的空间类型，`default_type_id`）、ADR-0033「候选与否决」中「自定义类型支持任意属性」一项（否决 → 采纳：字段定义挂在类型上）、ADR-0011 §2 / ADR-0023（模板 kind 只能是内置类型 → 可绑任一类型 `type_id`）、ADR-0012 §1 · §3（空间概览形态由 `space.kind` 写死 → 按空间启用的类型分区）。迁移 0022。需求区 00：REQ-KB-014 ~ 017、REQ-ENTRY-027 ~ 029、REQ-TPL-011；REQ-KB-003 被 REQ-KB-016 取代。

## 背景

用户要求（2026-09-30，四项均当场拍板）：

1. 每个空间有自己用得到的类型：产品空间只要 Bug / 迭代 / 变更，学习空间只要计划 / 笔记；还要能在空间里建本空间专用的类型（如「需求」「测试用例」），成员都能用。
2. 类型要能自定义属性（字段）：属性定义在类型上，模板绑到类型；内置类型的代码字段保留，但可以再追加自定义字段。
3. 空间首页不要写死的面板：按空间启用的类型分区，每区一张能直接改的表格。
4. 记录页属性面板与流转时间线（见 ADR-0035）。

现状：自定义类型只有「个人类型」（ADR-0017，只有本人能用）；类型只有 名 / 色 / 状态 三样，fields 固定 `{status?, progress?, dueDate?}`；模板只能绑内置 kind；空间概览按 `space.kind` 写死面板（ADR-0012）。

## 决定

### A. 数据（迁移 0022；01 §3.1 · §3.4 · §3.4c）

1. **空间类型**：`entry_types + space_id uuid?` → `spaces(id)` on delete cascade。`null` = 个人类型（ADR-0017 原语义，只本人可用）；非 null = 空间类型（该空间内的记录可用）。唯一约束由 `(workspace_id, created_by, name)` 改为两个 partial unique index：个人 `(workspace_id, created_by, name) where space_id is null`；空间 `(space_id, name) where space_id is not null`。个人空间不允许有空间类型（service 422）。
2. **字段定义与状态色**：`entry_types + field_defs jsonb default '[]'` + `status_colors jsonb default '{}'`（状态名 → 9 色板色名）；`entry_kind_overrides + field_defs jsonb default '[]'`（内置类型追加字段，工作区统一，仅 owner）。
3. **启用清单**：`spaces + enabled_kinds jsonb?`，元素为内置 kind 名或 `type:<uuid>`，有序（= 首页页签顺序）。`null` = 按 `space.kind` 推导的默认，**不做数据迁移**：
   - `project` / `work`：bug · iteration · changelog · decision · optimize · note；
   - `learning`：plan · note · journal · review；
   - 个人空间：全部未删除的内置类型 + 本人的个人类型（按读者计算）。
   - 读时忽略悬空项（已删类型 / 已删内置类型）；删自定义类型、删内置类型时 service 顺手把它从各空间的 `enabled_kinds` 里去掉。
4. **空间默认类型**：`spaces + default_type_id uuid?` → `entry_types` on delete set null；`default_kind` 仍只能是内置（check 不变）；二者互斥（service 422）。须是本空间的空间类型（个人类型别人用不了）。
5. **模板绑类型**：`entry_templates.kind` check 放开 `custom`；`+ type_id uuid?` → `entry_types` on delete set null；加 check `(kind = 'custom') = (type_id is not null)`。类型被删时 service 在同事务把绑它的模板改为 `kind='note', type_id=null`（on delete set null 只是兜底，check 要求两列同改）。
6. **`FieldDef`**（`src/shared/schemas/fieldDefs.ts`，zod，前后端共用）：
   ```
   key      : /^x[A-Z]{6}$/        // 系统生成，不可改；与内置 camelCase 键不会撞
   label    : string 1–20
   type     : 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox' | 'url' | 'progress'
   options? : [{ name: 1–20 不含 , | =, color: 9 色板色名 }] ≤ 30   // 仅 select / multiselect，名不重复
   required?: boolean                // 只做界面提示，不拦写入
   ```
   每类型 ≤ 20 个；同类型内 `label` 不重复。
7. **值的存放**：写在 `entries.fields` 顶层的 `x…` 键上——`fields=` 筛选、`/entries/stats groupBy`、流转、批量 `fields.set`、导出都复用现有路径。取值：text ≤ 500 · number · date（isoDate）· select（选项名）· multiselect（选项名 `string[]`，去重）· checkbox（bool）· url（≤ 2000，http / https）· progress（0–100 整数）。

### B. 校验（REQ-ENTRY-027 · 028）

8. **两段式**：`entryFieldsIssues` / 内置 strict schema 先**剥离** `^x[A-Z]{6}$` 键再做原有 strict 校验（shared，前后端一致）；再由 service `normalizeExtraFields(defs, fields)` 处理 x 键：
   - 未在该类型（内置类型 = `entry_kind_overrides.field_defs`；自定义类型 = `entry_types.field_defs`）定义的 x 键 → **静默丢弃**（旧页面 / 改类型残留不致 422）；
   - 类型不符、选项不在列表内 → 422 `errors[].path = fields.<key>`；
   - `required` 只做提示（属性面板标红），不拦——避免批量改类型 / 模板 / MCP 被卡死。
   - 前端遇 409 / 422 时失效 `['entry-types']`（字段定义可能刚被别人改过）。
9. **改类型**（`PATCH kind/typeId`、批量 `retype`）：`fieldsForRetype` 保留目标类型里**同 key** 的 x 值，其余丢弃；前端确认框写「将清空 N 个属性」。
10. **流转**不变：`TRACKED_ENTRY_FIELDS` 仍为 status / priority / severity；自定义 select 不进流转（以后再说）。
11. **改字段定义**（`PATCH /entry-types/:id` 或 `/entry-types/builtin/:kind` 的 `fieldDefs`）同事务同步记录：
    - 删字段 → 该类型全部记录（含回收站）`fields - key`；
    - 选项改名（`optionRenames { key: { 旧: 新 } }`）→ 同步值（multiselect 数组内逐项替换）；删选项 → 单选清空、多选去掉该项；
    - 字段 `type` 不可改（要改就删了重建，键随之换新）。
    - 以上批量改值写审计 `entry_type.fields_changed`（`meta` = 增 / 删 / 改名的字段与受影响记录数），**不写流转**（与 ADR-0016 状态改名一致）。
    - 不改正文里 `entryQuery` 的条件与保存视图 `entry_views.search`：被改名 / 删除的选项条件从此匹配为空，由用户自行改查询（写进界面提示）。
12. **`status_colors`**：键须在该类型 `statuses` 内（多余键丢弃）；状态改名时同步键。

### C. 权限（`authz.ts` 唯一入口，不变量 2；REQ-KB-015 · REQ-ENTRY-029）

13. **不新增 action**。管理空间类型（建 / 改 / 删、改其字段、改启用清单、设默认类型）= `can('space.manage', space)`（空间 admin + 工作区 owner / admin）**且** 空间可写（未归档、未删除）**且** 非个人空间——后两条由 service 校验。`GET /entry-types` 对空间类型的 `canManage` 走此分支。
14. **使用**：`loadUsableEntryType(ctx, typeId, spaceId)` = 本人的个人类型，**或** 该记录所在空间的空间类型。`resolveKindFields` / `entry-bulk` 逐条按记录所在空间判定；在空间内有 `entry.create` 即可用本空间的空间类型。
    - 修改他人记录的属性（有写权限时）仍按该记录的类型校验，不要求类型可用（沿用 ADR-0017）。
15. **移动与合并**：
    - 记录（单条 `PATCH spaceId` 或批量 `move`）移到别的空间：若其类型是原空间的空间类型 → 422「先改类型」（批量逐条进 `failed`）；目录子树随父移动时同样逐条校验，任一不可移则整次 422。
    - 合并空间（ADR-0022）：源空间的空间类型整体改挂目标空间（`space_id = into`）；与目标同名时加「（合并）」后缀，截断到 20 字；目标的 `enabled_kinds` 写成「目标已解析的清单 + 源空间类型」（不再为 null）。
    - 彻底删除空间（`jobs/gc.ts purgeSpace`）：同事务、在 `delete spaces` **之前**——别的空间里仍引用本空间类型的记录（理论上不存在，防御）转随笔（复用 `convertEntries`）；绑本空间类型的模板改为 `kind='note', type_id=null`。软删 / 回收站阶段类型保留，恢复空间即恢复。
16. **个人类型**沿用 ADR-0017：只本人使用；本人可把自己的个人类型放进某空间的启用清单（其他成员看得到名 / 色，但新建菜单里不出现）。
17. **内置类型追加字段**：`entry_kind.manage`（仅 owner）。
18. **可见性**：`listEntryTypes` 的空间类型按 `visibleSpacesWhere(actor)` 过滤（回收站里的空间的类型隐藏）；个人类型沿用 ADR-0017（全部返回供显示，`mine` 标本人的）。前端保留单一全局查询键 `['entry-types']`，每项带 `spaceId`，按上下文在前端过滤。

### D. API（02 §9，无新路由）

19. `GET /entry-types?spaceId=`：`items[]` 增 `spaceId`、`fieldDefs`、`statusColors`、`usable`（本人能否用它在 `spaceId`（缺省 = 任意可写空间）新建）；`builtin[]` 增 `fieldDefs`（追加字段）。
20. `POST /entry-types { name, color, statuses?, spaceId?, fieldDefs?, statusColors? }`；`PATCH /entry-types/:id { …, fieldDefs?, optionRenames?, statusColors? }`；`PATCH /entry-types/builtin/:kind { name?, color?, fieldDefs? }`（`fieldDefs` 中新字段的 `key` 可省略，由服务端生成；已有字段须带原 `key`）。
21. `PATCH /spaces/:id { enabledKinds?: string[] | null, defaultTypeId?: uuid | null }`；`GET /spaces/:id` 返回 `enabledKinds`（已解析：null → 推导默认、去掉悬空项）与 `enabledKindsRaw`（原值，编辑对话框用）。
22. 模板：`POST / PATCH /templates` 的 `kind` 可为 `custom` + `typeId`；`fields` 预填可含 x 键（按所绑类型校验）；`GET /templates?kind=&typeId=`。workspace 模板只能绑 内置 / 空间类型；personal 模板还可绑本人个人类型（422 否则）。
23. 列表：`fields=` 支持 x 键；multiselect 语义为「包含任一」：`(fields->>k in (…) or (jsonb_typeof(fields->k) = 'array' and fields->k ?| array[…]))`。`/entries/stats groupBy` 与 `ENTRY_GROUP_VALUES` 接受 `/^x[A-Z]{6}$/`，但拒绝 multiselect 键（422）；前端只对单选提供分组。服务端排序白名单暂不加 x 键（列头排序仍在已加载数据内，02 §4 现约定）。
24. 导出：frontmatter 里 x 键映射为字段名（`label`），无定义的 x 键原样输出。

### E. 前端（08）

25. **`SpaceTypesDialog`**（入口：`SpaceMenu`「类型与字段」、`KbHeader`、空间首页「管理类型」）：左列 = 启用清单（勾选 + 拖动排序；分组 内置类型 / 本空间类型 / 我的个人类型），右侧 = 选中类型的编辑：名、色、状态列表（带颜色）、`FieldDefsEditor`（增删改、类型、选项 + 颜色、必填、排序）。内置类型：名 / 色 / 追加字段仅 owner 可改，否则只读展示代码字段。无 `space.manage` 时整个对话框只读。
26. `/settings/types` 保留（个人类型 + 内置类型），也用 `FieldDefsEditor`。
27. **新建菜单 / 筛选条 / 批量改类型 / 新建对话框**：在空间上下文里只列该空间启用、且本人可用的类型；全局 `/entries` 列 内置 + 本人个人类型 + 本人可写空间的空间类型（按空间分组显示）。
28. **空间首页**（取代 project / learning 写死的面板；REQ-KB-016）：顶部类型页签（启用顺序，每个带计数）+「全部」；选中类型 → 状态概要条（按状态计数的彩色胶囊，点击 = 筛选）+ 可编辑表格（`EntryTable editable`，列 = 该类型的内置 + 自定义字段）+「新建」；默认页签 = 空间默认类型或第一项；原「最近更新」挪进「全部」页签；页签存 search param `?type=`。个人空间首页保留「空间目录」（ADR-0015，REQ-KB-007）。
29. **模板**：`TemplateForm` 类型选择 = 内置 + 本人可用的空间 / 个人类型（workspace 模板不列个人类型）；下方「字段」区：预填值（与 `EntryProperties` 同款编辑器）+「编辑该类型的字段」（有权限时内嵌 `FieldDefsEditor`，改的是类型本身，提示「会影响该类型的全部记录」）。
30. `fieldSpecs(kind, typeMeta)` 合并内置 zod 字段 + `fieldDefs`；表格列、看板、筛选下拉、查询块、属性面板自动吃到。

## 候选与否决

- **类型只按人私有 + 启用清单**（不做空间类型）：团队空间里每人各建一套「需求」类型，别人的记录用不了——用户否决。
- **自定义类型全工作区共享**（回到 ADR-0016）：类型清单会被所有空间的需要撑爆，且谁都能改别人依赖的类型——用户否决。
- **模板即类型（1:1）**：一个类型常需要多个模板（Bug 修复 / 线上事故），且模板改名不应改类型——用户否决，改为「模板绑类型、类型带字段」。
- **x 值存独立表 `entry_field_values`**：筛选 / 统计 / 流转 / 导出都要另写一套；放 `fields` jsonb 可全部复用——否决。
- **未定义的 x 键 422**：旧页面、改类型残留、字段刚被删都会让保存失败——改为静默丢弃，只对类型 / 选项不符报错。
- **必填硬拦**：批量改类型、模板、MCP 会被卡死——只做提示。
- **新增 `entry_type.space_manage` action**：与 `space.manage` 规则完全相同，多一个名字只增加矩阵测试——否决，复用 `space.manage` + service 状态校验。
- **启用清单用迁移把现有空间写实**：`null` = 推导默认已能表达，且以后改默认规则不用再迁移——否决。

## 后果

- 迁移 `0022`：`entry_types` +3 列与两个 partial unique index（替换旧唯一约束）；`entry_kind_overrides` +`field_defs`；`spaces` +`enabled_kinds` `default_type_id`；`entry_templates` +`type_id`、`kind` check 放开 custom、+`entry_templates_type_ck`；`audit_log_action_ck` +`entry_type.fields_changed`（改 `AUDIT_ACTIONS` 后 `pnpm db:generate` 重建 check）。
- 00：+REQ-KB-014 ~ 017、REQ-ENTRY-027 ~ 029、REQ-TPL-011；REQ-KB-003 · REQ-KB-010 · REQ-ENTRY-018 · REQ-TPL-007 加注。01 §3.1 · §3.4 · §3.4c · §3.5 · §3.12 · §5。02 §9 `/entry-types` `/spaces/:id` `/templates` `/entries` 行注。08 §2.5b · §2.13 · 新建对话框。glossary +空间类型 · 个人类型 · 启用类型 · 字段定义；原「空间类型」（`space.kind`）一行改称「空间种类」以免撞名。
- 旧 URL `?kind=` 仍有效；`fields=` 里被删字段 / 选项的条件匹配为空。
- 正文里 `entryQuery` 与保存视图不随字段改名 / 删除迁移（第 11 条）。
- e2e 需同步：`knowledge.spec` REQ-KB-003（空间首页 Bug 面板 → 类型页签）与个人首页（空间目录保留）、`in-space-create.spec`（`kb-edit-default-kind` 下拉合并默认类型）、`entries-plus.spec`（`/settings/types` 加字段区）、`spaces.spec`（`kb-home` 标题仍为 `h1`）。

## 实施顺序与测试

| 步 | 内容 | 测试 |
|---|---|---|
| P2-a1 | 迁移 0022 · shared `FieldDef` · x 键剥离 + `normalizeExtraFields` · 个人类型 `field_defs` / `status_colors` · 改字段同步值 · 审计 `entry_type.fields_changed` | unit `fieldDefs.test` · api `entry-types.test`（REQ-ENTRY-027） |
| P2-a2 | `space_id` 空间类型 · `loadUsableEntryType` · `listEntryTypes` 可见性 · `enabled_kinds` / `default_type_id` · 移动 422 · 合并改挂 · purge 清理 | api `space-types.test`（REQ-KB-014 · 015 · 017 · REQ-ENTRY-029） |
| P2-a3 | 内置类型追加字段 `entry_kind_overrides.field_defs` | api（REQ-ENTRY-028） |
| P2-b | 模板绑任一类型 + 预填 x 字段 · 类型删除 → 模板转随笔 | api `templates.test`（REQ-TPL-011） |
| P2-c | `SpaceTypesDialog` · `FieldDefsEditor` · 新建菜单 / 筛选 / 批量按空间过滤 · `fieldSpecs` 合并 · 列表 multiselect 筛选 | e2e `space-types.spec`（REQ-KB-014 · REQ-ENTRY-027） |
| P2-d | 空间首页重做 | e2e `space-home.spec`（REQ-KB-016） |
| 收尾 | `lint` · `typecheck` · `test` · `lint:drift` · `build` · 相关 e2e · `/settings/design` 视觉过一遍 · debug 记录 | |

每步结束跑 `pnpm lint && pnpm typecheck && pnpm test`（相关文件）。
