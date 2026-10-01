# zod 4 不能对带 refine 的对象 `.partial()`；提交时禁用输入框会丢焦点

- 日期：2026-10-01
- 影响范围：shared / client
- 严重度：low
- 相关：ADR-0042 · ADR-0043

## 症状
1. 实现「隐藏的必填字段改为可选」时，`iterationFields.partial({ periodStart: true })` 直接抛错：`.partial() cannot be used on object schemas containing refinements`。
2. 快速添加回车后输入框失焦，无法连续录入（e2e `toBeFocused` 失败）。

## 复现
1. 对 `entryFields.ts` 里带 `.refine` 的 `iterationFields` / `bugFields` / `planFields` 调 `.partial()`。
2. 输入框在提交期间 `disabled={busy}`：浏览器把被禁用元素的焦点移走，恢复可用后不会自动回来。

## 根因
1. zod 4 的 `.partial / .pick / .omit` 拒绝带 `refine` 检查的对象（检查可能依赖被改掉的键）。
2. `disabled` 的元素不能保持焦点。

## 修复
1. `entryFields.ts` 把形状（`bugShape` / `iterationShape` / `planShape`）与跨字段检查（`CROSS_CHECKS`，缺值不查）分开；导出的 schema = 形状 + 检查（行为不变），`entryFieldsSchema(kind, optional)` 在形状上 `.partial(mask)` 后重套检查。
2. 提交期间只用 `busy` 防重复提交，输入框不禁用（`aria-busy`）。

## 验证
`src/shared/__tests__/base-fields.test.ts`（REQ-ENTRY-035：部分可选后跨字段检查仍生效、仍 strict）；`e2e/tasks-page.spec.ts`（回车后 `toBeFocused`）。
