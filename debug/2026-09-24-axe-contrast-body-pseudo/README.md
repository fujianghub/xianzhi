# 光晕移入 body::before 后 axe 报出一批既有的对比度违规

## 症状

ADR-0005 合入后跑全量 e2e，`REQ-UI-013 axe 已登录路由（light / dark）` 失败，`/today` 报 `color-contrast`：

- `.font-brand-en`（侧栏副标 Xianzhi，`fg-faint`）——本次新增
- `.pt-2`（侧栏「我的视图」分组标签，`fg-faint`）——Phase 0 就有
- `today-overdue > h2`（逾期标题，`danger` 文字，仅日场）——Phase 1 就有

用例在第一个失败路由处停止，其余路由没被扫到；逐路由复扫又发现 `/design?page=tokens / components` 的 `fg-faint` 标注（日场）。

## 复现

`pnpm e2e`，或对任一实例逐路由跑 `@axe-core/playwright`（标签 `wcag2a/aa · wcag21a/aa · wcag22aa`，过滤 serious / critical）。

## 根因

改动前光晕写在 `body { background-image: radial-gradient(...) }`。axe 遇到背景图算不出背景色，把这些节点归入 **incomplete（待人工复核）**，不计入 violations，所以一直「通过」。

ADR-0005 把光晕移到 `body::before`（为了只动 transform 做漂移），body 只剩纯色 `--xz-bg`。axe 能算出背景了，既有的低对比度文字随即变成 violations：

- `fg-faint`（日场 `#888E84`）在底板上 3.05:1——06 §3.2 规定它只达 3:1，只用于占位 / 禁用，不能当 12px 正文；
- `danger` `#C0483F` 作文字压底板 4.49:1（< 4.5）。`check-contrast` 只校验了 danger 作图标（≥ 3）与 danger-soft 上的文字，没校验 danger 文字压底板。

## 修复

- 侧栏副标、「我的视图」、`/design` 两处标注、登录页副标：`text-fg-faint` → `text-fg-muted`（5.47:1）。
- `--xz-danger` 日场 `#C0483F` → `#B8433A`（4.88:1）。
- `scripts/check-contrast.ts` 增「danger 文字 / 底板 ≥ 4.5」，共 72 项。

## 验证

- `pnpm lint`：check-contrast 72 项全部达标。
- 对 3011 实例逐路由复扫（anon 3 页 + 已登录 24 路由 × 两主题，共 51 次）：0 serious / critical。
- 教训：axe 的「通过」可能只是 incomplete。`fg-faint` 只给占位 / 禁用态；任何「作文字」的语义色都要进 check-contrast 的「压底板 ≥ 4.5」矩阵。
