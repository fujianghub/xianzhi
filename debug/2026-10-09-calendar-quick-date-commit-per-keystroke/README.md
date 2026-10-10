# 日历快速编辑：任务日期框按一下 ↓ 就改期，任务从视图消失

- 日期：2026-10-09
- 影响范围：client · server
- 严重度：high
- 相关：ADR-0056 §C；REQ-CAL-014（修订 REQ-CAL-012）；同类见 `debug/2026-10-09-date-field-commit-per-keystroke`

## 症状

日历（周 / 月视图）点任务弹出快速编辑气泡，点「截止」日期框想改日子：一按方向键或开始键入，任务立即改期，从当前视图消失，气泡失去锚点。逐段键入年份时可能写进 `0002-…` 之类的年份。时间框改小时、改分钟各写一次库。

## 复现

1. 周视图里一个今天 15:00 截止的任务 → 点它 → 气泡。
2. 点日期框（光标落在月份段）按 ↓ → 立即 PATCH `dueAt=2026-09-09T06:00Z`，任务挪到上个月。

## 根因

`QuickEdit.tsx` `TaskQuick` 的日期 / 时间是原生 `<input type="date|time">`，`onChange` 直接 `setWhen()` → `patch()`。Chrome 的日期 / 时间框按段编辑、每改一段都 change 且值完整合法，于是逐段写库。`dueAt` 用 `isoDateTime`（只校验格式），上一轮给 `isoDate` 加的年份范围管不到它。

## 修复

- 日期：按钮 + 嵌套弹层里的 `DateFieldPicker`，点日期才保存；嵌套弹层 `onKeyDown` 拦冒泡（气泡把非输入框里的 Backspace / Delete 当「删除任务」）。
- 时间：草稿，失焦 / 回车 / 关闭气泡（`commitRef`）时保存。
- `isoDateTime` 年份限 1900 ~ 2999。

## 验证

- unit `src/shared/__tests__/schemas.test.ts` REQ-CAL-014：`0002-…` / 1899 / 3000 年被拒。
- e2e `e2e/calendar.spec.ts` REQ-CAL-014：日期弹层里 ↓、键入 `2025`、日期格上 Backspace → 无 PATCH、气泡仍在；点周四 → 一次 PATCH；时间填写不写库、回车后才写。REQ-CAL-012 用例改为时间回车保存，通过。
