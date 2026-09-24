# gc.soft_deleted 永远不清除软删的空间

- 日期：2026-09-24
- 影响范围：server（jobs/gc.ts）
- 严重度：low（数据保留超期，违反 07 §3 保留表；功能不受影响）
- 相关：REQ-SPACE-007 · 07 §3 · `src/server/jobs/gc.ts`

## 症状
软删满 30 天、其下有任务或记录的空间，每次 gc 都跳过，永远留在库里。

## 复现
建空间 → 建一条记录 → `DELETE /spaces/:id` → `gcSoftDeleted({ now: +31d })` → 空间与记录仍在。

## 根因
旧逻辑是「空间下仍有任务 / 记录就跳过，等它们先到期」。但软删空间时，子对象不会各自打 `deleted_at`，它们是跟随空间一起不可见的。所以子对象永远不会先到期，空间也就永远不被清除。

## 修复
抽出 `purgeSpace(deps, spaceId)`：先删附件文件，再在一个事务里删评论、记录、任务和空间，快照、标签、关注人等经外键级联清除。到期清理和 `DELETE /spaces/:id?permanent=1` 共用这一个函数。

## 验证
`spaces-crud.test.ts`「REQ-SPACE-007 gc：软删满 30 天的空间连同其记录被清除」，以及永久删除用例（检查行被删、审计 meta 带计数）。
