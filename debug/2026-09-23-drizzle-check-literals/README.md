# Drizzle CHECK 约束里的枚举值被序列化成 `$1`，迁移报 42P02

- 日期：2026-09-23
- 影响范围：server（drizzle 迁移）
- 严重度：high（迁移一条都跑不了）
- 相关：T0-005 · 01 §1「枚举用 text + CHECK」

## 症状
`drizzle-kit migrate` 静默退出码 1；自写 `migrateDatabase()` 后看到 PG 错误 `42P02 there is no parameter $1`，position 指向第一条 `CHECK (… in ($1, $2, …))`。

## 复现
```ts
check('x_ck', sql`${t.kind} in (${sql.join(values.map(v => sql`${v}`), sql`, `)})`)
```
`drizzle-kit generate` 生成的 SQL 保留了绑定占位符。

## 根因
`sql\`${v}\`` 的字符串是**参数**，drizzle-kit 序列化 DDL 时不带参数值，占位符原样进 SQL；DDL 不允许参数。

## 修复
`src/server/db/schema/_helpers.ts` 的 `inList()` 改用 `sql.raw()` 内联单引号字面量（转义 `'`）。同时 `db:migrate` 改为 `tsx src/server/db/migrate.ts`（drizzle-orm migrator），错误可见，且生产启动（`start.ts`）与测试建库复用同一函数。

## 验证
`pnpm db:migrate` 输出 `[migrate] ok`；`pg_constraint` 中 24 条 `*_ck`；`scripts/check-schema-drift.ts` 零差异。回归风险：新增 CHECK 一律走 `inList()` 或 `sql.raw`。
