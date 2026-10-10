# 窄屏任务详情里 @ 候选点不中（模态 Sheet 下点击穿透）

- 日期：2026-10-09
- 影响范围：client
- 严重度：medium
- 相关：ADR-0056 §D；REQ-MOBILE-008；同类见 `debug/2026-10-09-link-bubble-clipped-in-dock`

## 症状

< lg（手机 / 窄窗口）打开任务详情（底部 / 侧边 Sheet），在评论框输入 `@`，候选框出现，但手指 / 鼠标点候选没反应（点到了下面的编辑器），只能用 ↑↓ + 回车选。

## 复现

1. 390×844 视口，打开共享空间里一个任务的详情（`/tasks?task=<id>`，模态 Sheet）。
2. 评论框输入 `@` → 候选框出现。
3. 检查：`getComputedStyle(document.body).pointerEvents === 'none'`；候选框中心 `elementFromPoint` 命中的是 `.ProseMirror` 而不是候选框。

## 根因

`mention.tsx` / `slash.tsx` 的候选框宿主 `fixed` 挂在 `document.body` 下。Radix 模态 Dialog（Sheet）打开时给 body 设 `pointer-events: none`，只有弹窗内容恢复 `auto`；body 下的候选框宿主继承 `none`，命中测试直接穿透。键盘不受影响，所以用键盘的人察觉不到。

## 修复

`src/client/editor/floating.ts` `suggestionPopup`：编辑器在 `[role=dialog]` 里时宿主挂到弹窗内，否则 body；flip / shift 边界 = 所在纸面 / 坞 / 弹窗；floating-ui `autoUpdate` 随内部容器滚动 / 尺寸变化跟随。斜杠与 @ 共用。

## 验证

- e2e `e2e/mobile.spec.ts` REQ-MOBILE-008：390 视口任务详情评论框 `@` → 候选框在 `[role=dialog]` 内，点第一个候选 → 插入 mention、候选框关闭、Sheet 仍开着。
- 回归：editor / collab-ui / tasks 相关 e2e。
