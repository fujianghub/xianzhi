# 块级公式渲染后整页崩溃（Chromium Page crashed）

- 日期：2026-09-28
- 影响范围：client
- 严重度：high
- 相关：ADR-0025 §8、REQ-EDITOR-008

## 症状
插入带内容的块级公式（`mathBlock`，KaTeX displayMode）后标签页直接崩溃，Playwright 报 `Protocol error: Page crashed`；没有任何 JS 异常。行内公式、空公式块、Mermaid 都正常。

## 复现
记录页里 `editor.commands.insertContent({ type: 'mathBlock', attrs: { latex: 'x^2' } })`，约 1 秒内崩溃（headless Chromium，Playwright 1.63）。

## 根因
`body` 全局设了 `text-wrap: pretty`（app.css），KaTeX 块级输出（`.katex-display` 里大量 inline-block 支柱 / vlist）继承后，Chromium 的 pretty 断行在这种结构上进入异常路径导致渲染进程崩溃。排除法：换掉 `<button>` 外壳仍崩；只在节点视图外插同样的 HTML（未加载真实 katex.css）不崩；给公式容器改 `text-wrap: wrap` 即不崩。

## 修复
`styles/editor-diagrams.css`：`.xz-math-preview, .katex-display, .katex, .katex * { text-wrap: wrap }`（只收窄公式区域，其余正文仍用 pretty）。只作用在 `.katex` 不够——断行容器是外层 `.katex-display` / 预览容器。

## 验证
e2e `editor-diagrams.spec.ts` REQ-EDITOR-008 通过；复现脚本插入块级公式后 `.katex` 可见、页面存活。
