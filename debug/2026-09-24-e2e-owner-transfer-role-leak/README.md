# 全量 e2e 里 member 变成了 admin：所有权来回转让后角色没有复原

- 日期：2026-09-24
- 影响范围：e2e（`realtime.spec.ts`、`notify.spec.ts` 的测试数据清理）
- 严重度：low（产品行为正确；测试之间串味）
- 相关：REQ-WS-003 · REQ-WS-005 · `e2e/settings.spec.ts`

## 症状
「REQ-WS-005 … member 访问工作区设置 404」单独运行通过，全量运行失败：member 页面没有出现 404。加诊断后看到 `GET /api/v1/me` 的 `workspaceRole` 为 `admin`。

## 复现
`pnpm e2e`：在 `notify.spec` / `realtime.spec` 之后运行任何依赖 member 角色的用例。

## 根因
两个用例为了触发 `workspace.owner_transferred` 通知，先 owner → member 转让，再 member → owner 转回。按 REQ-WS-003，转让后原所有者变为 admin，所以转回之后 member 的角色停留在 admin，而不是原来的 member。产品行为正确，是测试没有复原数据。G9 之前没有用例依赖 member 的角色，所以一直没暴露。

## 修复
两处转回之后都执行 `PATCH /workspace/members/:memberId {role:'member'}`。
约定：e2e 改了种子账号的角色、时区等共享状态，必须在同一用例内复原（参见 settings.spec 的 REQ-WS-010 用 finally 复原时区）。

## 验证
全量 `pnpm e2e` 79/79 绿。
