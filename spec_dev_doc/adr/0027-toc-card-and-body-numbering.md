# ADR-0027 目录块卡片 · 正文章节编号默认开

> 状态：已采纳 · 2026-09-28 · 修订 ADR-0024 §2（`headingNumbers` 默认值）；补充 ADR-0026 §3、03 §3.2 目录块。参考简斋 `[TOC]` 行内目录卡片与 `.jz-heading-num`。

## 背景

用户反馈：`/toc` 生成的目录编号重复；正文标题也要有编号；目录块要像简斋一样有专属颜色的卡片。

排查：目录块用 `<ol>` 渲染，继承正文 `.xz-prose ol { list-style: decimal }`，浏览器序号「1.」与章节编号叠成两遍。另发现：斜杠插入目录块后选区是整块选中（NodeSelection），接着打字会把目录替换掉。

## 决定

1. **目录块卡片**（REQ-READ-009）：主色浅底（`primary` 5% 混纸面实底）+ 主色细边 + 左侧主色内阴影条；标题行「目录 · N 个标题」带下分隔线；列表 `list-style: none`，按编号层级缩进 1.2em / 级，编号主色（`primary-text`），悬停主色。色值全部取 token，夜场自动。
2. **正文章节编号默认开**：`headingNumbers` 默认 `true`（ADR-0024 默认关作废）；编号颜色由 muted 改为 `primary-text`（简斋 accent）。仍是显示层装饰，不写正文；目录格式弹层可关。
3. **插入目录块后光标落到其下**：插入后若下一个节点不是文本块则补一个空段落，并把光标放进去（其余原子块——Mermaid / 公式——插入后直接进入源码编辑，不受影响）。

## 后果

- 00：+REQ-READ-009。03 §3.2 目录块注。CHANGELOG。
- 代码：`views.tsx` TocView、`editor-blocks.css`（`.xz-toc-card*`）、`app.css`（编号主色）、`preferences.ts`（默认值）、`slash.tsx`（目录插入后光标）。
- 测试：e2e `reading-prefs.spec.ts` REQ-READ-009（卡片、编号不重复、正文编号、插入后继续打字不丢目录）；REQ-READ-004 按默认开调整。
