# 浮动工具条按钮点不中：被固定侧栏盖住、且每次渲染都重新定位

- 日期：2026-09-24
- 影响范围：client（`src/client/editor/BubbleBar.tsx`）
- 严重度：medium（选区靠左时无法点工具条；REQ-EDITOR-015 e2e 超时）
- 相关：REQ-EDITOR-015 · T1-023（工具条加了「评论」按钮后变宽）

## 症状
Playwright 报 `<aside data-testid="sidebar"> subtree intercepts pointer events`，点击「加粗」重试直到 60s 超时。

## 复现
新段落输入几个字，按 Shift+Home 选中，这时工具条左边缘在 x≈211，而侧栏宽 240。

## 根因
1. 工具条以 `placement: top` 居中对齐选区。加了评论按钮后宽度约 284px，选区靠左时越过纸面左缘，落到固定侧栏（`z-(--gi-z-sticky)`）下方。@tiptap/react 的 BubbleMenu 不会把 `className` 传给包裹元素（实测 class 为空），`appendTo` 也没有生效（包裹元素仍在编辑区内）。
2. `options` 与 `shouldShow` 是内联对象 / 函数，BubbleMenu 在它们的引用变化时会派发 `updateOptions` 事务并重新定位；宿主每次渲染都会触发一次。

## 修复
- 在我们自己的内层元素上加 `relative z-(--gi-z-dropdown)`，让它参与外层层叠、盖过侧栏。
- `options` 用 `useMemo`，`shouldShow` 用 `useCallback`，`onComment` 经 ref 调用，保证引用稳定。

## 验证
REQ-EDITOR-015、REQ-COMMENT-002 e2e 绿。
