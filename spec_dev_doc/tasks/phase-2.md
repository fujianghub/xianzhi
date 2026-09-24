# Phase 2 任务表（草案）

> 状态：草案 · 版本：v1 · 更新：2026-09-24 · 最后对照代码：未对照 · 依据 ADR-0001 §7、ADR-0003、00（Phase 2 REQ）、tasks/phase-1.md（T1-036 顺延）。
> 二期 = MCP / 导入 / AI / pgvector 与一期未完成项。本表先登记由 Phase 1 顺延的内容；二期正式拆分时再补任务 ID、依赖与估时。

## 由 Phase 1 顺延（T1-036 一致性审查，2026-09-24）

| 来源 | 内容 | REQ | 说明 |
|---|---|---|---|
| T1-039 | 注销账号 `DELETE /me`（匿名化）与成员内容批量转移 `POST /workspace/members/:userId/transfer-content` | REQ-WS-015 · 016 | 测试名已用 `it.todo` 占位 |
| T1-016 | 外域 / `data:` 图片转存为附件；上传失败的「重试 / 删除」按钮与离线上传队列 | REQ-EDITOR-004（扩展） | 03 §11.3 · §11.4 注；一期外部图片 Toast 提示后丢弃 |
| T1-014 · T1-015 | 正文 `@` 提及、`[[` 双链选择器、entryLink 行内 / 标题 / 卡片三形态切换、单个 URL 粘贴转 entryLink | REQ-EDITOR-010 · 011 | 本属 Phase 2；一期斜杠菜单已可插入记录卡片 / 链接 |
| T1-014 | mermaid / KaTeX 渲染、`:::kind` 以外的 callout 细节 | REQ-EDITOR-007 · 008 · 009 | 一期为占位节点（源码显示）；`:::kind ` 快捷转换已实现 |
| T1-017 | Aside 反链、历史（快照浏览 / 恢复）页签 | REQ-COLLAB-008 等 | 一期页签为「后续版本提供」 |
| T1-043 | 工作区 Logo | — | 08 §2.13 注 |
| T1-027 | WebPush 通道（偏好页已置灰） | REQ-MOBILE-005 · REQ-NOTIF（push） | 投递表写 `skipped` |
| T1-029 | ⌘K「移到周期」（周期功能整体属二期） | REQ-CYCLE-* | ⌘K 中为置灰项 |
