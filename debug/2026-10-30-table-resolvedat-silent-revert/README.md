# 记录表格：未关闭 Bug 的「解决日期」可点可选，保存后又变回 `—`；部分 `—` 不可编辑

- 日期：2026-10-30
- 影响范围：client `EntryTable`（记录页 / 空间首页表格）
- 严重度：low（静默不生效，无数据损坏）
- 相关：REQ-ENTRY-026 · REQ-ENTRY-032 · REQ-BUG-002、ADR-0033 · 0039

## 症状

用户：「前端 list 清单，当前显示为 `—` 的为什么不支持编辑（bug 和 ideas 的每一列都需要全部验证一下）」。

## 复现

验证实例上建 Bug（带模板 / 不带模板 / 已修复）与产品优化（带模板 / 不带模板），逐格点 `—` 并尝试保存，再 `GET /entries/:id` 核对：

- 未关闭 Bug 的 `resolvedAt`：编辑器打开、`PATCH` 200，落库值 `undefined`，单元格乐观显示日期后回到 `—`；
- 不是用模板 T 建的行，T 的模板属性列：`—` 不可点；
- 模板移除的类型属性（`hiddenFields`）：`—` 不可点；
- 其余列（状态 / 优先级 / 严重程度 / 发现日期 / 模块 / 衡量指标 / 目标值 / 标签、自己模板的属性）空值可点、落库正确。

## 根因

1. `normalizeBugFields` 对未关闭状态 `delete out.resolvedAt`（REQ-BUG-002，设计如此）；属性栏已按此隐藏该字段，表格的 `cell()` 没有同样处理，照常包了 `FieldEditor`。
2. 后两种是 ADR-0039 的设计：记录的有效字段 = 类型字段 − 来源模板移除的 + 来源模板的属性；未定义的 `x` 键服务端静默丢弃。UI 只显示 `—`、没有说明，看起来像 bug。

## 修复

- `EntryTable.tsx`：Bug 且未关闭时 `resolvedAt` 只读，`title` =「关闭时自动记为当天，关闭后可改」；无规格的 `—` 加 `title` 说明「这条记录没有该属性」（`data-testid="cell-absent"` / `cell-resolved-auto`）。
- 数据（本机库 xz）：用户要所有 Bug 都有「日期」→ 把模板「Bug Tracker」的自有属性 `{key: xHOMEVU, 日期}` 挪到 `entry_kind_overrides(kind='bug').field_defs`，模板 `field_defs` 清空。直接改元数据、沿用原键：走 API 会生成新键，而删模板属性会经 `applyFieldDefChanges` 清掉用它建的记录上的值。

## 验证

- e2e「REQ-ENTRY-026 表格里空值 `—` 可点就地填写；没有该属性的行、未关闭 Bug 的解决日期只读并说明原因」（knowledge.spec.ts）；knowledge / template-fields / bug / builtin-fields 19/19 通过。
- 验证实例上给 Bug 类型加日期属性后，不带模板的 Bug 在表格里可填、落库（临时探针，用后还原）。
