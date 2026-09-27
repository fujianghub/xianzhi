# 空间超过 200 个时，排在后面的空间在侧栏 / 列表 / 个人工作台里静默消失

- 日期：2026-09-27
- 影响范围：client（顺带 e2e）
- 严重度：medium
- 相关：ADR-0021（空间批量管理轮次顺带发现）；`debug/2026-09-26-e2e-shared-db-data-drift`；新建空间对话框被大类撑出视口、两套验证实例共用库（见下文）

## 症状

e2e `REQ-KB-007 · 006` 在共用库 `xz_e2e` 上失败：个人空间概览的「空间目录」里找不到刚建的空间，`space-dir-toggle` 点击超时。main 实例上同样失败。

## 复现

1. 让当前用户可见、未归档的空间超过 200 个（`xz_e2e` 里 owner 可见 207 个）。
2. 新建一个空间（`sort_key` 排在最后）。
3. 打开 `/spaces`、侧栏或 `/spaces/<个人>/home`：新空间不出现；`GET /api/v1/spaces?limit=200&withTotal=1` → `items 200 · total 207 · nextCursor 有值`。

## 根因

`src/client/lib/space-queries.ts` 的 `spacesQuery` 只请求第一页（`limit: '200'`，服务端上限也是 200），不看 `nextCursor`。侧栏、空间列表、个人工作台、各种空间选择器、批量管理都吃这一份缓存，所以第 201 个起全部不可见，也没有任何提示。回收站空间 Tab 同样只取第一页。

测试侧只是放大器：共用库里历次运行累积的空间把数量推过了 200。真实用户空间多起来一样会碰到（ADR-0021 正是因为空间多了才做批量管理）。

## 修复

新增 `fetchAllSpaces(query)`：按 `nextCursor` 逐页取完再返回；`spacesQuery` 与回收站空间 Tab 都改用它。没有改成前端无限滚动：这些消费者（侧栏分区、拖动排序、选择器、Shift 连选）都需要完整集合，空间数量级（百级）一次取完的代价可以接受。

新建空间对话框：共用库里大类只增不减（`spaces-batch.spec` 每次建 2 个），大类选项把对话框撑出视口，「创建」点不到（`REQ-KB-001`、`REQ-SPACE-008`）。`DialogContent` 加 `max-h-[calc(100dvh-2rem)] overflow-y-auto`（所有对话框内容过长时内部滚动），大类选项限高滚动；批量用例收尾删掉自己的大类。

同轮另一条共用库失败 `REQ-NOTIF-005`：用例只造一条通知，点开即已读，之后「全部已读」按钮因无未读而禁用（行为正确）；新库里有别的用例留下的未读才碰巧能点。改为用例自己在两个任务上各造一条通知。

### 附：两套验证实例同时连 `xz_e2e` 会串（全量 e2e 时发现）

worktree 按 CLAUDE.md 另起一套验证实例（3031/8032/8033）时，3011 仍在运行，两套共用 `xz_e2e`：

- **SSE 丢帧**：实时推送走进程内 EventBus（`src/server/lib/event-bus.ts`「单实例够用」），pg-boss 扇出任务被哪套 worker 抢到，帧就推给那套进程的连接。`REQ-NOTIF-003` 在 3031 上补发断言失败。
- **历史恢复执行两次**：两个 collab 进程都消费同一条恢复事件，各存一份「恢复前自动保存」（快照 id 相差约 16ms），`REQ-COLLAB-008` 严格模式匹配到 2 条。停掉 3031 后在 3011 上 `--repeat-each=5` 全过。
- **连带失败**：`REQ-NOTIF-003` 做了 owner 转让，复原 member 角色的代码写在断言之后，断言失败就没执行，member 留在 admin（owner 转让不写 `member.role_changed` 审计，审计里查不到），后续 `REQ-WS-005` 失败。已改为 `try / finally` 复原。
- `REQ-COLLAB-011` 写死杀 8013 的 collab，只适用于 3011 实例。

结论：跑涉及实时 / 协同 / 历史的 e2e 时，同一时间只让一套验证实例连 `xz_e2e`。

## 验证

- `XZ_E2E_BASE=http://localhost:3031 pnpm exec playwright test e2e/knowledge.spec.ts -g REQ-KB-007 --project=setup --project=desktop`：修前失败、修后通过（库里仍是 207+ 个空间）。
- `REQ-NOTIF-005` 在已无其它未读的共用库上 `--repeat-each=2` 两次通过。
- 回归风险：空间列表请求数 = ⌈空间数 / 200⌉，百级以内仍是 1 次。
