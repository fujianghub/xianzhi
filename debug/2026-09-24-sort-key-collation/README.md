# sort_key 按库默认排序规则比较，拖到最前的项实际落到末尾

- 日期：2026-09-24
- 影响范围：server（spaces / tasks 手动排序）
- 严重度：medium（REQ-SPACE-005 / 看板拖拽顺序错乱，数据不丢）
- 相关：REQ-SPACE-005 · `drizzle/0003_sort_key_collate_c.sql` · `src/server/__tests__/spaces-crud.test.ts`

## 症状
`PATCH /spaces/reorder { id: B, after: null }` 返回 200，B 的新键是 `Zz`（比最小键 `a0` 小），但 `GET /spaces` 里 B 排在最后。

## 复现
库排序规则为 `en_US.utf8`（`select datcollate from pg_database`）时：`select k from (values ('a0'),('Zz'),('r1')) t(k) order by k` → `a0, r1, Zz`。

## 根因
`fractional-indexing` 生成的键按 ASCII 字节序比较，大写字母小于小写字母（`'Zz' < 'a0'`）。`sort_key` 是普通 `text`，`ORDER BY` 和 `>` / `<` 都用库默认的 ICU / glibc 语言排序规则，先按字母忽略大小写，于是 `Zz` 排到了 `r…` 之后。只要某次插入落到最小键之前，就会生成大写前缀的键，所以这个问题一定会出现。

## 修复
迁移 0003 把 `spaces.sort_key` 与 `tasks.sort_key` 改为列级 `COLLATE "C"`，`tasks_space_status_sort_idx` 随列类型变更自动重建。选列级而不是在每条查询里写 `COLLATE`，是因为漏写一处就会复发。

## 验证
`spaces-crud.test.ts`「REQ-SPACE-005」：拖到最前后列表第一项是被拖项，且只有一行 `sort_key` 变化。任务排序（T1-007 看板）直接继承列级排序规则。
