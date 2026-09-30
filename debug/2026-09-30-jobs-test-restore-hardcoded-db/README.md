# 换测试库名跑全量用例：备份恢复用例把数据真的恢复进了 xz_test

- 日期：2026-09-30
- 影响范围：server（测试）
- 严重度：low
- 相关：ADR-0039 这一轮；`src/server/__tests__/jobs.test.ts` REQ-EXPORT-005

## 症状

worktree 里为了不碰主仓正在用的 `xz_test`，用 `XZ_TEST_DATABASE_URL=postgres://…/xz_test_tplmeta pnpm test` 跑全量：

```
FAIL src/server/__tests__/jobs.test.ts > jobs > REQ-EXPORT-005 …
AssertionError: promise resolved "{ counts: {…}, targetUrl: 'postgres://xz:xz@localhost:5433/xz_test' }" instead of rejecting
```

其余 1902 条通过。副作用：`xz_test` 被整库恢复成了 worktree 的库结构（多了迁移 0024 的列，`drizzle.__drizzle_migrations` 25 行）。

## 复现

```
XZ_TEST_DATABASE_URL=postgres://xz:xz@localhost:5433/xz_test_other pnpm exec vitest run src/server/__tests__/jobs.test.ts
```

## 根因

用例最后一步验证「拒绝恢复到源库自己」，目标库名写死成 `'xz_test'`：

```ts
runRestore({ file: r.file, identity, sourceUrl: URL_, targetDb: 'xz_test' })
```

源库换了名字以后，`xz_test` 不再是源库——`runRestore` 没理由拒绝，于是真的执行了恢复。

## 修复

目标库名取源库 URL 的库名：`targetDb: new URL(URL_).pathname.slice(1)`。用例的意图（恢复到源库自己要被拒绝）不变，不再依赖库名。

被连带恢复的 `xz_test` 没有另行处理：结构是 0023 的超集（只多了可空 / 带默认值的列与一个索引），旧代码照常能跑；每个测试文件开头都会 `truncateAll()`。

## 验证

- `XZ_TEST_DATABASE_URL=…/xz_test_tplmeta pnpm exec vitest run src/server/__tests__/jobs.test.ts` → 4/4。
- 默认库 `pnpm exec vitest run src/server/__tests__/jobs.test.ts` → 4/4。
- 教训：worktree 要隔离测试库时用 `XZ_TEST_DATABASE_URL`；用例里凡是「同库」语义的地方从 `DATABASE_URL` 取名，不写死。
