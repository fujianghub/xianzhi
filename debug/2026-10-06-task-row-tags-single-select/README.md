# 任务行内标签只能单选

- 日期：2026-10-06
- 影响范围：client
- 严重度：medium
- 相关：REQ-TASK-038 · ADR-0045 §A.2

## 症状
任务列表行上点标签胶囊（或 ⋯ → 标签…）打开 TagPicker，勾第一个标签后再勾第二个，第一个的勾消失；关闭后任务只带最后点的那一个，看起来像单选。详情页 / 快速添加 / 记录属性面板不受影响。

## 复现
1. 任务页任一任务行 → ⋯ → 标签…
2. 依次点标签 A、B → Esc
3. 任务只带 B

## 根因
行内的日期 / 标签按 REQ-TASK-038「弹层关闭时一次提交」：`onChange` 只把 ids 写进 `pendingTags` ref，不触发 PATCH，也不改 `task.tags`。而 `value={task.tags}` 一直是打开前的原值，`TagPicker` 的 `toggle` 每次都按这个原值算 `[...selected, id]`，所以每次勾选都覆盖前一次，勾选状态也不刷新。其它调用方是「每次勾选即 PATCH + 乐观更新」（详情页、记录属性面板）或本地 state（快速添加），`value` 会跟着变，所以没问题。

## 修复
`TaskRow.tsx` 抽出 `RowTagPicker`（弹层打开才挂载）：本地 state 保存草稿 ids、按标签缓存映射成 `value` 传回 TagPicker；关闭时仍经 `closePicker` 一次提交，保持 REQ-TASK-038 语义。没有改成每次勾选即 PATCH——那样会打破「关闭时一次提交」，且弹层开着时行会跟着跳。
`TaskRowMenu` 的「标签…」项加 `data-testid="task-menu-tags"` 供 e2e 使用。

## 验证
`e2e/tasks-manage.spec.ts`「REQ-TASK-038 行内标签多选」：⋯ → 标签，勾两个都显示已勾选，Esc 后任务带两个标签且只发 1 次 PATCH。还原旧 `TaskRow.tsx` 时该用例在「已勾选」断言失败，修复后通过；`tasks-manage` + `tasks` 共 17 条通过，`pnpm lint` 全绿。
