# ADR-0038 内置模板由所有者维护：覆盖 + 新增

> 状态：已采纳 · 2026-09-30 · 修订 ADR-0011 §2（内置 6 个为代码常量、不可改删 → **所有者可覆盖 / 删除 / 恢复，并可新增内置模板**）、ADR-0023 §2 · §3（`template.manage` 对内置一律拒绝、`PATCH` / `DELETE` 内置 403 → 所有者可）。迁移 0023。需求区 00：REQ-TPL-013 ~ 015；REQ-TPL-001 · 002 · 004 加注。

## 背景

用户（2026-09-30）：内置的 6 个模板（Bug 修复与迭代、产品优化、学习计划、学习笔记、学习周复盘、读书笔记）措辞与骨架不完全合自己团队的用法，但改不了，只能「复制到我的」再改——结果新建对话框、空间首页快捷按钮、optimize / plan 的首次打开骨架仍然用旧版，个人副本与内置版并存。希望像内置类型（ADR-0017）一样由工作区所有者统一维护，并能增加新的内置模板。

## 决定

用户 2026-09-30 选定方案「覆盖 + 新增」。

### 1. 代码内置模板可覆盖（REQ-TPL-013）

- 6 个代码内置模板仍是代码常量，id `builtin:<key>` **不变**（旧记录、空间默认模板、快捷按钮、链接都不失效）。
- 所有者可改 名称、描述、类型（仅内置 kind）、适用空间（`spaceKinds`）、字段预填、正文。修改存新表 **`builtin_template_overrides(workspace_id, key, name?, description?, kind?, space_kinds?, fields?, body?, deleted, updated_at)`**，PK `(workspace_id, key)`；每列 **null = 用代码默认**。读取时代码默认与覆盖行逐列合并（`resolveBuiltinTemplate(key, override)`），只改名称时正文仍随代码版本更新。
- 改 kind 不给 fields → fields 重置为新 kind 默认（同 REQ-TPL-007）；fields 按「新 kind ?? 原 kind」严格校验。`PATCH` 必带 `ifUpdatedAt`：无覆盖行时为基准时间 `1970-01-01T00:00:00.000Z`（详情 / 列表的 `updatedAt` 即返回此值），有行时为行的 `updated_at`；不匹配 409 `CONFLICT_STALE`。
- **恢复默认**：`POST /templates/:id/reset` 对代码内置 = 删除覆盖行（同时清掉修改与「已删除」）。
- **恢复（取消删除）**：`POST /templates/:id/restore` 只把 `deleted` 置回 false，保留已做的修改——「误删找回」与「放弃修改」是两种意图，分开两个接口（实施时定，2026-09-30）。
- **删除 = 软删除**：`DELETE /templates/builtin:<key>` 写 `deleted = true`（无行则插入）；模板页「已删除的内置模板」分区（仅所有者可见，`GET /templates?deleted=1`）可「恢复」（= restore，保留修改）。
- 不另存历史；覆盖只影响本工作区（单工作区部署下即全站）。

### 2. 所有者可新增内置模板（REQ-TPL-014）

- `entry_templates.scope` 新增值 **`builtin`**：全员（含 guest）可见可用；只有所有者可建、改、删；**删除为硬删**（与 personal / workspace 模板一致，同事务清掉引用它的空间默认模板，REQ-TPL-009）。
- 入口：模板页「新建模板」时所有者多一个范围选项「内置（全员）」；已有的个人 / 共享模板所有者可 `PATCH scope → builtin`（反之亦可，改回 personal / workspace 时 owner_id 保持为所有者）。
- 列表中与代码内置一起归入「内置」分组（代码内置在前、按原顺序；入库的按 `created_at`）；`ownerName` 不显示（内置不署名）。
- 类型绑定规则同 workspace 模板（ADR-0036：内置或空间类型，不能绑个人类型）。

### 3. 权限：不加新动作（沿用 ADR-0017 `entry_kind.manage` 口径）

- `template.create` / `template.manage` 对 `scope = builtin` 的行与代码内置模板（`TemplateRef.scope = 'builtin'`）= **仅 owner**；admin、member、guest 均拒绝（403）。
- `template.read` 对 `builtin` = 全员。
- 其他人对内置模板仍可「复制到我的」（REQ-TPL-008，复制的是覆盖后的版本）。
- 列表每行 `canManage` 由服务端按 `can()` 给出，前端不比较角色（不变量 2）。

### 4. 生效范围与已删除处理（REQ-TPL-015）

- **覆盖后的版本**用于：`GET /templates` 列表与 `GET /templates/:id` 详情；新建记录 `POST /entries {templateId}`；空间默认模板（`spaces.default_template_id`）；空间首页快捷按钮；斜杠 `/模板` 插入；「复制到我的」；首次打开的默认骨架（optimize → `builtin:product-optimize`、plan → `builtin:learning-plan` 取覆盖后的**正文**，03 §6）。
- **已删除的内置模板**：不出现在列表（除 `?deleted=1`）与新建对话框 / 斜杠选择；`POST /entries {templateId}` 用它 → 422；`GET /templates/:id` 对非所有者 404、对所有者返回并带 `deleted: true`（供预览与恢复）；作为空间默认模板时**视为未设置**（不清空 `default_template_id`，恢复后自动重新生效）；空间首页快捷按钮在模板不可用时**不带模板**（按 kind 默认新建）；首次打开骨架回落为 kind 的空文档 + placeholder（同 journal / note）。
- 已建记录不受任何覆盖 / 删除影响（模板正文只在创建时写入，不变量 1）。

## 候选与否决

- **全部入库**（迁移时把 6 个代码模板写成 `entry_templates` 行，代码常量只作种子）：最统一，但 id 要变或要特判、代码改进骨架无法自动下发、恢复默认需要保存原始副本——用户否决。
- **管理员也可改**：内置模板影响全员的新建默认，与内置类型（ADR-0017 仅所有者）同级——否。
- **删除 = 硬删 / 不可恢复**：代码常量删不掉，只能标记；且误删后空间默认模板会悬空——代码内置用软删，入库的内置沿用硬删。
- **新增 `template.builtin.manage` 动作**：与 `entry_kind.manage` 的做法不一致且多一个权限维度；由 `can('template.manage', {scope:'builtin'})` 判定即可。
- **删除时清空引用它的空间默认模板**：恢复后需要逐个空间重设——改为「视为未设置」，恢复即生效。

## 后果

- **迁移 0023**：新表 `builtin_template_overrides`（`kind` check = 内置 kind 或 null）；`TEMPLATE_SCOPES` 加 `builtin` → `entry_templates_scope_ck` 须 `pnpm db:generate` 重建 check 约束（被 `inList()` 引用的枚举，CLAUDE.md；否则插库 500）。可前滚；回滚需先删 `scope = 'builtin'` 的行与覆盖表。
- 00：+REQ-TPL-013 ~ 015；REQ-TPL-001（列表含覆盖 / 已删除）、REQ-TPL-002（骨架取覆盖）、REQ-TPL-004（「内置不可改删」「删内置 403」改为仅所有者可）加注。01 §3.4 entry_templates scope 说明 + 新表 `builtin_template_overrides`、§5 template.* 三行。02 §9 `/templates` 行注 + `POST /templates/:id/restore` · `/reset`。03 §6 注。08 §1 · §2.13 注。glossary +内置模板覆盖 · 恢复默认。
- `lint:drift`：代码落地前 `check-schema-drift` 报「少表 builtin_template_overrides」；`check-openapi-drift` 对 `POST /templates/:id/restore` 只提示（Phase 2 > 默认 0）。
- 审计：不新增动作（模板操作本就不审计）。
- 已知限制：覆盖正文里的图片仍受 ADR-0023 限制（模板编辑器不能插图片，ADR-0037 §D）。

## 实施与测试

| 步 | 内容 | 测试 |
|---|---|---|
| a | 迁移 0023 · `TEMPLATE_SCOPES` +builtin · `authz` template.* 对 builtin 仅 owner | unit `authz.test` 矩阵（REQ-TPL-013 · 014） |
| b | `resolveBuiltinTemplate` · 覆盖读写 · 软删 / restore · `GET ?deleted=1` · `ifUpdatedAt` | api `templates.test`（REQ-TPL-013） |
| c | scope=builtin 新建 / 改 / 硬删 · 列表「内置」分组 | api `templates.test`（REQ-TPL-014） |
| d | 生效范围：`POST /entries {templateId}` · 空间默认模板视为未设置 · 首次打开骨架 · 快捷按钮 | api `templates.test` / `entries.test`、collab 单测（REQ-TPL-015） |
| e | 模板页：所有者在内置行「编辑 / 删除 / 恢复默认」、「已删除的内置模板」分区、新建时「内置（全员）」范围 | e2e `templates-builtin.spec`（REQ-TPL-013 ~ 015） |

每步结束跑 `pnpm lint && pnpm typecheck && pnpm test`（相关文件）；全部完成后 `pnpm lint:drift` 应零差异、`pnpm build`、相关 e2e。
