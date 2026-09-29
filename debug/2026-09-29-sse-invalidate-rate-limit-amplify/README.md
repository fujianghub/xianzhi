# 连续写入时，开着统计 / 查询块的页面把本人请求放大到限流 429

- 日期：2026-09-29
- 影响范围：client（`useRealtime`）
- 严重度：medium
- 相关：ADR-0033（统计视图、查询块让 `['entries']` 前缀下的活跃查询变多）；通用限流 600/min/用户（02 §2）

## 症状

在 3031 验证实例上用脚本以 owner 身份批量新建 Bug（约 150 条），第二秒起接口返回 429「请求过于频繁」。同一时间 owner 在浏览器里开着记录页 / 统计视图。

## 复现

1. 浏览器以 owner 打开 `/entries?kind=bug&view=stats`（约 7 个 `['entries', …]` 活跃查询）。
2. 同一账号连续写入记录（批量操作或脚本），每条都推送一帧 SSE `invalidate {keys:[['entries'], …]}`。
3. 每帧都让浏览器立即重取全部活跃查询：写 40 条 ≈ 40 × 7 次重取，加上写入本身，一分钟内超过 600 → 写入与页面同时 429。

## 根因

`src/client/hooks/useRealtime.ts` 收到 `invalidate` 帧就逐 key `invalidateQueries`，没有合并。本轮新增的统计视图（`/entries/stats` ×4 + `/entries/bug-stats`）和查询块都挂在 `['entries']` 前缀下，放大倍数随之变大；限流按用户计，浏览器重取与写入共用额度。

## 修复

`useRealtime` 的 invalidate 帧改为按 key 去重后合并失效：安静 300ms 后失效，连续推送时最多每 2s 失效一次（`INVALIDATE_QUIET_MS` / `INVALIDATE_MAX_WAIT_MS`）；卸载时清定时器。帧计数（`track`）仍逐帧进行，`notification` / `reset` 帧不受影响。

## 验证

- 采样 `RateLimit-Remaining`：页面空闲时不消耗额度（无循环请求）。
- 修复后同一脚本（约 250 次请求，owner 浏览器开着页面）一次跑完、无 429。
- `pnpm typecheck` / `pnpm lint` 通过；`e2e/bug.spec.ts` 通过。`realtime.spec.ts` 补发用例在双实例共用 `xz_e2e` 时失败（通知由另一实例的 worker 推送，属已知串扰，见 CLAUDE.md），合并后单实例复跑。
