# ADR-0021 空间批量管理

> 状态：已采纳 · 2026-09-27 · 补充 08 §2.5 空间列表与 §2.14 回收站；单个空间的归档 / 删除 / 恢复 / 永久删除规则（REQ-SPACE-003 · 004 · 007 · 009）不变。

## 背景

大类 → 空间两级（ADR-0012）用起来之后，空间数量涨得快，但空间只能一个个在卡片 ⋯ 里归档、移动大类，删除要进编辑，回收站里的空间也只能逐个恢复或永久删除。整理一个大类要点几十次。记录已经有 `POST /entries/batch`（ADR-0014），空间没有对应能力。

## 决定

1. **接口**（REQ-SPACE-010 ~ 012）：`POST /spaces/batch { op, ids ≤ 100, groupId?, dryRun? }`，op = `archive` · `unarchive` · `move`（`groupId` null = 未分类）· `delete`（软删）· `restore` · `purge`。
   - 逐个走与单个接口相同的校验函数（`checkArchive` / `checkSoftDelete` / `checkRestore` / `checkPurge`，都经 `can()`）；单个失败进 `failed[{id, code, message}]`，不影响其它。个人空间、无权的空间都作为失败项返回。
   - `purge` 只接受已在回收站的空间（未删除的进 `failed`，`CONFLICT_STALE`）。单个 `DELETE ?permanent=1` 仍可直接永久删，批量入口不开这个口子，防止在批量里把正常空间彻底删掉。
   - `dryRun: true` 只跑校验并返回 `counts { entries, tasks }`（可操作空间下未删除的记录 / 任务数），不写库。前端删除 / 永久删除的确认弹层用它写明影响面。
   - 审计沿用单个接口：删除逐个写 `space.deleted`、永久删除逐个写 `space.permanently_deleted`。不新增审计枚举。
2. **`/spaces` 批量管理**（REQ-SPACE-010 · 011）：页头「批量管理」进入多选模式（有可选空间时才显示）。整张卡片可点选，Shift 连选按页面顺序；每个大类分区有「全选本组」；底部吸附操作条：已选数 · 全选 · 归档 / 取消归档（所选全部已归档时才是取消归档）· 移到大类 · 删除（仅工作区 owner / admin）· 取消选择。可选范围：本人为空间管理员、且不是个人空间；不可选的卡片变淡。归档与删除后 Toast 带「撤销」（对刚成功的空间发 `unarchive` / `restore`）。Esc 或「完成」退出。
3. **回收站 · 空间 Tab**（REQ-SPACE-012）：owner / admin 每行有勾选框，表头全选，「恢复所选」「永久删除所选」。永久删除先 dryRun，弹层写明记录 / 任务数。任务 / 记录两个 Tab 本轮不加多选。

## 候选与否决

- **删除确认只写空间数，不写影响面**：删空间会连带里面所有记录与任务一起不可见，只说「删除 5 个空间」低估了后果——否决，用 dryRun 取计数。
- **单独的 `GET /spaces/stats?ids=` 计数接口**：要重复一遍鉴权逻辑才能只统计可删的空间；dryRun 复用同一套校验，计数与实际执行的范围一致——否决。
- **批量里允许直接永久删除未进回收站的空间**：一次误操作不可恢复——否决，必须先软删。
- **合并空间（把 A 的记录并入 B）**：比批量删除更有价值，但牵涉目录树、关联与附件，另行立项。

## 后果

- 00：+REQ-SPACE-010 ~ 012。02 §9 路由清单 +`POST /spaces/batch`。08 §2.5 · §2.14 注。
- 代码：`src/shared/schemas/spaces.ts` `batchSpacesSchema`；`services/spaces.ts` 抽出 `check*` 并新增 `batchSpaces`；前端 `SpaceBatchBar`、`SpaceCard` 选择态、`/trash` 空间多选。
- 测试：`src/server/__tests__/spaces-batch.test.ts`、`e2e/spaces-batch.spec.ts`。
