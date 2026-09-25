# 新增审计 action 只改了 Zod 枚举，插入时 500

- 日期：2026-09-25
- 影响范围：server
- 严重度：medium
- 相关：ADR-0010、迁移 `drizzle/0007_palette_accounts.sql`

## 症状
`POST /api/v1/workspace/users` 返回 500 `INTERNAL`；日志被测试环境 `LOG_LEVEL=silent` 吞掉，直接调 service 才看到：
`DrizzleQueryError: Failed query: insert into "audit_log" … params: …, user.created, …`（违反 `audit_log_action_ck`）。

## 复现
在 `src/shared/schemas/enums.ts` 的 `AUDIT_ACTIONS` 里加一个新值（如 `user.created`），不生成迁移，调用任何写该 action 的 service。

## 根因
`audit_log.action` 除了应用层 Zod 校验（REQ-WS-017），`business.ts` 还用 `check('audit_log_action_ck', inList(t.action, AUDIT_ACTIONS))` 建了 DB 约束。TypeScript 与 Zod 都通过，只有真正插库时失败。`calendars.color`（`PALETTE_COLORS`）同理。

## 修复
改 `AUDIT_ACTIONS` / `PALETTE_COLORS` 等被 `inList()` 引用的枚举后，必须 `pnpm db:generate` 生成重建 check 约束的迁移（本次并入 0007）。数据取值改名（如色板）还要在同一迁移里先 DROP 约束 → UPDATE 旧值 → 再 ADD 约束。

## 验证
`src/server/__tests__/users.test.ts` 全绿（`user.created` / `user.updated` / `auth.password_changed` 均落库）；`pnpm lint:drift` 零差异。
