# 新增无层材质类不受 reduced-transparency 覆盖

## 症状

侧栏改版后 `REQ-UI-016` e2e 失败：模拟 `prefers-reduced-transparency: reduce` 后同屏仍有 1 个 `backdrop-filter`（侧栏）。把 `.xz-sidebar` 加进 app.css 已有的覆盖列表 `@media (prefers-reduced-transparency) { .glass, …, .scrim { backdrop-filter: none } }` 后**仍然失败**。

## 复现

`pnpm exec playwright test e2e/ui.spec.ts -g REQ-UI-016`；或 DevTools 渲染面板模拟 reduced transparency，看侧栏 computed `backdrop-filter`。

## 根因

`.glass*` 由 `@utility` 生成，落在 Tailwind 的 **utilities 层**；覆盖规则写在 app.css 的**无层**区域，无层规则天然压过任何层，所以对 `.glass*` 有效。

`.xz-sidebar` 是普通无层类，和覆盖规则同为无层、同特异性（单类），**后出现者胜**。覆盖列表在文件前部，`.xz-sidebar` 定义在后部，于是侧栏的 `backdrop-filter` 赢了。

## 修复

侧栏专用的 reduced-transparency / `data-transparency=reduce` 覆盖紧跟在 `.xz-sidebar` 定义之后（注释说明「须写在之后」），不再塞进前部的共享列表。

## 验证

`REQ-UI-016` 通过；`countBlur` 在 reduced-transparency 下为 0。

教训：新增自带 `backdrop-filter` 的类时，要么用 `@utility` 放进 utilities 层（沿用共享覆盖），要么把覆盖写在定义之后；只加进共享列表不够。
