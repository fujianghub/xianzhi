# `<Button asChild>` 整页崩溃：Slot failed to slot onto its children

- 日期：2026-09-28
- 影响范围：client
- 严重度：medium
- 相关：ADR-0023（模板页「新建模板」按钮首次用到 `Button asChild`）

## 症状
打开 `/settings/templates` 整页变成路由错误页：`Something went wrong! Slot failed to slot onto its children. Expected a single React element child or Slottable.`；e2e REQ-TPL-004 / 010 超时。

## 复现
`<Button asChild><Link to="…">新建</Link></Button>` 渲染即崩（全仓此前没有 `Button asChild` 用法，所以一直没暴露）。

## 根因
`src/client/components/ui/button.tsx` 在 `Comp`（asChild 时为 `Slot.Root`）里并排渲染 `{loading ? <spinner/> : null}{children}`：即使 `loading` 为假，子节点也是 `[null, <Link/>]` 两项数组，Radix Slot 要求恰好一个 React 元素。

## 修复
`asChild` 分支单独返回 `<Slot.Root>{children}</Slot.Root>`，不渲染加载圈（被包裹的元素自己决定内容）；模板页改用 `Link` + `buttonVariants`（两种写法现在都可用）。

## 验证
e2e `templates.spec.ts` REQ-TPL-004、`templates-share.spec.ts` REQ-TPL-010 通过；`pnpm exec tsc -p tsconfig.client.json` 通过。
