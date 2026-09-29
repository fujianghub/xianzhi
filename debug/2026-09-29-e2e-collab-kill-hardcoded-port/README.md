# worktree 验证实例跑全量 e2e：REQ-COLLAB-011 杀掉的是常驻 3011 实例的 collab

- 日期：2026-09-29
- 影响范围：e2e（测试侧，不影响产品代码）
- 严重度：low
- 相关：ADR-0033（Bug 跟踪轮次全量 e2e 时发现）；`debug/2026-09-27-spaces-list-truncated-200`（两套实例共用 `xz_e2e`）

## 症状

在 worktree 里用 `CLIENT_PORT=3031 API_PORT=8032 COLLAB_PORT=8033 pnpm dev:verify` 另起实例，`XZ_E2E_BASE=http://localhost:3031` 跑全量 e2e：

- `REQ-COLLAB-011 重启 collab 进程期间输入 100 字` 失败：`status-pill` 一直是 `synced`（断线从未发生）。
- `REQ-COLLAB-008 历史 … 恢复后正文回到该版本` 稳定失败：「恢复前自动保存」版本不出现在列表里。

其余 172 条通过。

## 复现

1. 常驻 3011 实例（8012 / 8013）运行中，另起 worktree 实例 3031 / 8032 / 8033，两者同连 `xz_e2e`。
2. `XZ_E2E_BASE=http://localhost:3031 pnpm exec playwright test e2e/editor.spec.ts --project=setup --project=desktop`。

## 根因

- `e2e/editor.spec.ts` 的 REQ-COLLAB-011 用 `ss -ltnpH 'sport = :8013'` 找 collab 进程并 `SIGKILL`，端口写死 8013，不随 `XZ_E2E_BASE` 变化：杀掉的是 3011 实例的 collab（由 `scripts/respawn.sh` 拉起，无害），被测的 8033 始终在线。
- REQ-COLLAB-008：恢复走 PG 事件总线 `entry.restore`，两套实例的 collab 都收到并各自执行一次（CLAUDE.md 已记的「恢复执行两次」），与被测代码无关。

## 修复

未改代码（本轮不在范围内）。建议：REQ-COLLAB-011 从环境变量（如 `XZ_E2E_COLLAB_PORT`，缺省 8013）取端口；实时 / 协同 / 历史类用例仍按 CLAUDE.md 只留一套实例跑。

## 验证

- 3011 实例的 collab 被 respawn 拉起（8013 换了新 pid，仍在监听），常驻实例未受损。
- 两条用例涉及的快照 / 恢复代码本轮未改；`vitest` 中协同与快照相关用例全部通过（75 文件 1810 条）。
