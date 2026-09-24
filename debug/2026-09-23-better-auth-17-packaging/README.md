# Better Auth 1.7：插件拆包、CLI 停更、类型无法生成 d.ts

- 日期：2026-09-23
- 影响范围：server
- 严重度：medium
- 相关：T0-002 · T0-006 · ADR-0001 §4.6

## 症状
1. `pnpm i` 报 `No matching version found for @better-auth/cli@^1.7.5`（镜像最新 1.4.21）。
2. `better-auth/plugins` 没有 `passkey`、`apiKey` 导出。
3. `tsc -b`（composite）报 `TS7056 The inferred type of this node exceeds the maximum length the compiler will serialize` 与 `TS2742 … @simplewebauthn/server … not portable`。
4. magicLink 配了 `disableSignUp: true`，陌生邮箱请求仍收到邮件（不建号但发信）。
5. `auth.api.listApiKeys` 返回 `{ apiKeys, total }` 而非数组；`apikey` 表用 `reference_id` 而非 `user_id`。

## 复现
better-auth 1.7.5 + drizzle-orm 0.45 + TS 5.9，按 1.4 时代的文档配置。

## 根因
1.5+ 把 passkey / api-key 拆为 `@better-auth/passkey`、`@better-auth/api-key`（版本与主包同步 1.7.5）；`@better-auth/cli` 独立版本线停在 1.4.x（其内置 better-auth 1.4 与 drizzle 0.41，但 `generate` 只读插件对象的 schema，对 1.7 配置仍可用）。`betterAuth()` 返回类型极大，`declaration: true` 时必须序列化 → 失败。magicLink 的 `disableSignUp` 只阻止建号，发信与否由 `sendMagicLink` 回调决定。

## 修复
- 依赖：`@better-auth/passkey`、`@better-auth/api-key`；`auth:generate` 用 `pnpm dlx @better-auth/cli@1.4.21 generate`（不进 devDependencies，避免拖入 better-sqlite3 等 GitHub prebuild 包）。
- tsconfig 去掉 `composite/declaration`，`typecheck` 改为逐项目 `tsc -p … --noEmit`（05 §3 已改）。
- `sendMagicLink` 内先查 `user` 表，不存在则直接 return（07 §2.1「不发信、不建号」）。
- impersonation 禁用：`admin({ impersonationSessionDuration: 0 })` + Hono 层对 `/api/auth/admin/impersonate-user` / `stop-impersonating` 返回 404。
- 测试里 Better Auth 自带的按 IP 限流是进程内单例，用例间要换 `x-forwarded-for`。

## 验证
`src/server/__tests__/auth.test.ts`：REQ-AUTH-002 / 010 / 012 / 013 / 015 全绿；`pnpm typecheck` 退出码 0。回归风险：升 better-auth 次版本时重跑 `auth:generate` 并 `db:generate` 看有无表变更。
