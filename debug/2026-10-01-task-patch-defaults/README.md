# 只改标题的任务 PATCH 把状态改回收件箱、优先级清零

- 日期：2026-10-01
- 影响范围：server（shared schema）
- 严重度：high（静默改数据）
- 相关：ADR-0044 §A.7 · REQ-UI-022

## 症状
在任务详情里只改标题（或描述、截止等任何不含 status / priority 的字段），保存后任务状态变成「收件箱」、优先级变成「无」。实现 ADR-0044「只改清单归类的 PATCH」时发现：请求体只有 `{ listId, ifUpdatedAt }`，服务端解析结果却多出 `status: 'inbox', priority: 0`。

## 复现
```
pnpm exec tsx -e "import { patchTaskSchema } from './src/shared/schemas/tasks.ts'; console.log(patchTaskSchema.parse({ title: 'x', ifUpdatedAt: '2000-01-01T00:00:00.000Z' }))"
# → { status: 'inbox', priority: 0, title: 'x', ifUpdatedAt: … }
```
前端 `useTaskActions().patch` 只发改动的字段（`{ ...change, ifUpdatedAt }`），所以线上路径同样中招。

## 根因
`patchTaskSchema = createTaskSchema.omit({ spaceId }).partial().extend(…)`。`createTaskSchema` 里 `status: z.enum(…).default('inbox')`、`priority: prioritySchema.default(0)`；zod 4 的 `.partial()` 把字段包成 optional，但缺省时仍执行内层 `.default()` 补值。service 见到 `patch.status !== undefined` 就写入。

## 修复
`patchTaskSchema` 在 `.extend()` 里显式覆盖为无默认：`status: z.enum(TASK_STATUSES).optional()`、`priority: prioritySchema.optional()`（`src/shared/schemas/tasks.ts`）。其它由 `.partial()` 派生的 PATCH schema 若源 schema 带 `.default()`，同样要显式覆盖。

## 验证
`src/server/__tests__/tasks-mine.test.ts`「REQ-UI-022 只改标题的 PATCH 不动状态与优先级」：先建 `doing / 3`，只改标题后仍为 `doing / 3`。
