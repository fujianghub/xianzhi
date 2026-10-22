# ADR-0064 记录 Peek 展开完整正文

> 状态：已采纳 · 2026-10-22 · 修订 ADR-0063 §2.8（记录 Peek 仍是摘要）。无迁移。需求区 00：REQ-UI-007 注。

## 背景

用户（2026-10-22）：「记录预览也改成展开完整正文」。ADR-0063 给任务 Peek 补了关注者与评论，记录 Peek 仍只有类型 · 作者 · 时间、标题与 `plain` 前 200 字摘要。

## 决定

1. 记录 Peek = 类型 · 作者 · 更新时间 → 标题 → **完整正文**（`peek-entry-body` / `peek-entry-doc`）。正文取 `GET /entries/:id?withBody=1` 的 `pmJson`（查询键 `['entry', id, 'body']`，30s 内复用）。
2. 渲染复用 `editor/ReadOnlyDoc`（schemaKit，与编辑页同一套节点视图；未知节点占位），新增 `live` 选项：不挂 `StaticDoc`，查询块照常取实时数据（Peek 看的是当前正文，不是历史）。`ReadOnlyDoc` 在 Peek 里 `lazy()` 加载——编辑器包只在打开记录 Peek 时才下载。
3. `withBody` 时 `pm_json` 还没派生（带模板新建后从没经 collab 存过）→ 服务端从 `ydoc` 现场派生返回，**只读不落库**（不变量 1：ydoc 是唯一真源，派生列仍只由 collab `onStoreDocument` 写）。
4. 正文为空：有摘要显示摘要，否则「还没有正文」。

## 影响

- 不做：Peek 里编辑正文（仍 Enter 升级到详情 / 详情坞）；记录属性 / 关联在 Peek 里展示。
- e2e：`entries.spec.ts` +REQ-UI-007 记录 Peek 完整正文；api：`entries.test.ts` +未派生时 `withBody` 从 ydoc 派生。
