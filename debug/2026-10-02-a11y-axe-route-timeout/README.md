# REQ-UI-013 axe 已登录路由用例超时 · 记录页正文 aria-prohibited-attr

## 症状

`e2e/a11y.spec.ts` 的「REQ-UI-013 axe 已登录路由（light / dark）」两条：

1. 先在 `/entries/:id` 断言失败：`aria-prohibited-attr: .tiptap`。
2. 修掉 1 后，跑到 `/search` 左右报 `page.evaluate: Test timeout of 240000ms exceeded`（axe 未跑完）。

## 复现

`pnpm dev:verify` 后 `pnpm exec playwright test e2e/a11y.spec.ts --project=setup --project=desktop --workers=1`。

## 根因

1. 正文编辑器 `editorProps.attributes` 只给了 `aria-label`，没有角色。只读或协同未连上时 `contenteditable=false`，这时它就是一个普通 `div`，axe 判定带 `aria-label` 属于禁用属性。
2. 用例在 32 条路由上逐条跑全规则集（wcag2a / 2aa / 21a / 21aa / 22aa）。dev 模式下每条 axe 约 10 s，加上加载约 2 s，合计约 400 s，超过 240 s 的上限。
   - 逐规则计时：`target-size` 2.7 s，`color-contrast` 1.1 s，其余规则合计 8.7 s，没有单条异常。
   - 在 3051 端口起 main 原版客户端做对照，axe 同为 11.3 s 一页，说明是原有问题。原注释写的「每条约 4 s」已经过时，是路由逐轮增多累积出来的。

## 修复

1. `EntryEditor.tsx` 给正文加 `role="textbox"`、`aria-multiline="true"`、`aria-readonly`。
2. 用例超时改为 600 s，注释写明实测值。

## 验证

单独跑 a11y 用例两主题通过（ADR-0046 那轮，2026-10-02）。
