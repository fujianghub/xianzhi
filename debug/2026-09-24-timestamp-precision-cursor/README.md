# 按时间列翻页时游标不前进：微秒精度 vs JS 毫秒

- 日期：2026-09-24
- 影响范围：server（所有按 created_at / updated_at / due_at 游标分页的列表：tasks、entries、spaces …）
- 严重度：high（翻页死循环：前端「加载更多」永远拿到同一页，直到撞上 600/分钟限流）
- 相关：REQ-TASK-004 · 02 §4 · `drizzle/0004_timestamptz_ms.sql` · `src/server/__tests__/tasks.test.ts`

## 症状
`GET /tasks?sort=createdAt&limit=200` 翻页：第二页开始反复返回同一批行；测试循环一直请求，最终收到 429 RATE_LIMITED。

## 复现
一条 `INSERT` 批量插入 450 行（`created_at` 默认 `now()`，同一事务同一时刻，带微秒），按 `createdAt` 翻页。

## 根因
PG `timestamptz` 默认精度是微秒，`now()` 会写入 `…:05.123456`。游标里存的是 JS `toISOString()`，只有毫秒（`.123Z`）。下一页条件 `(created_at, id) > ('….123Z', lastId)`：因为 `.123456 > .123`，最后一行及同一毫秒内的所有行都会再次命中。乐观锁 `ifUpdatedAt` 也有同样隐患，只是目前 `updated_at` 都由 JS 写入，碰巧是毫秒。

## 修复
所有业务表的时间列改为 `timestamptz(3)`：`_helpers.ts` 加 `precision: 3`，迁移 0004 由 drizzle-kit 生成。数据库里的值与 JS Date 一一对应，游标往返无损，排序仍能用列上的索引。没有选 `date_trunc` 表达式方案，因为它每条查询都要写，而且用不上索引。Better Auth 的表不在范围内，它们没有游标分页。

## 验证
`tasks.test.ts`「REQ-TASK-004 … 翻页无重复无遗漏（多种排序）」：450 行、7 种排序，每种都完整取回且不重复。测试循环设了 5 页上限，游标不前进时直接失败，不会再撞限流。`check-schema-drift` 把 `timestamp (3) with time zone` 归一为 `timestamptz`（01 §1 注）。
