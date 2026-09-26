# 验证库不重建时三条 e2e 失败：头像「文件缺失」、侧栏拖动越出视口、design 基线过期

- 日期：2026-09-26
- 影响范围：server（附件去重）· e2e · scripts/verify-env.sh
- 严重度：medium（头像一条是真实缺陷，另两条是用例依赖累积数据）
- 相关：REQ-ATTACH-004 · REQ-WS-023 · REQ-SPACE-005 · REQ-UI-004

## 症状
对长期运行、未经 `pnpm e2e` 重建的 `xz_e2e` 跑用例（`XZ_E2E_BASE=… playwright test`）：
- `REQ-WS-022 · 023` 上传头像后「移除」按钮出现，但 `profile-account img` 不存在；直接请求 `/api/v1/attachments/<id>/md` → 404「附件文件缺失」。
- `REQ-SPACE-005` 侧栏拖动后 `PATCH /spaces/reorder` 为 200，但首行不是被拖的空间。
- `REQ-UI-004 /design tokens` 与基线差 1%。

## 复现
1. 在 worktree A 里 `pnpm dev:verify`，跑一次 settings 头像用例（上传同一张 1×1 PNG）。
2. 删除 worktree A，从主仓（或 worktree B）再起验证实例，重跑同一用例 → 头像 404。
3. 验证库不重建地累计跑 spaces 用例几十次 → 「未分类」分区 50+ 行，拖动用例失败。

## 根因
- **头像**：`xz_e2e` 是各检出目录共用的库，但 `verify-env.sh` 的 `DATA_DIR=./data/e2e` 是相对路径，文件落在各自启动目录下。上传按「同人同 sha256」去重，命中后直接返回旧行，**不检查磁盘文件**；旧行的文件在已删除的 worktree 里 → 地址 404，Radix `Avatar.Image` 加载失败不渲染 `<img>`。生产上「只恢复了库没恢复文件」、再次上传同一张图也会命中同一问题。
- **侧栏拖动**：用例把新建空间放进「未分类」，把第 N 行拖到第 1 行；分区随每次运行累积，首行滚出视口，拖动落点不在目标上。只在 `pnpm e2e` 刚重建库时成立。
- **design 基线**：基线图仍是 ADR-0010 之前的旧色名（moss / amber …），色板改名后未重拍；另外吸顶顶栏压在画廊上，通知未读数随库数据变化，也会造成差异。

## 修复
- `src/server/services/attachments.ts`：去重命中时 `rematerialize()`——原件或任一变体缺失则用本次字节（sha256 相同即原件）按原 key 重写并重新生成变体，id 与各处引用不变。
- `scripts/verify-env.sh`：`DATA_DIR` 默认改为主仓 `data/e2e` 的绝对路径（`git rev-parse --git-common-dir` 的上一级），所有检出目录共用，与共用库一致。
- `e2e/spaces.spec.ts` REQ-SPACE-005：每次新建专用大类，三个空间放在该分区内拖动。
- `e2e/design.spec.ts`：截图遮罩通知铃铛；重拍 `design-tokens.png`（其余基线在阈值内未变）。

## 验证
- api：`attachments.test.ts`「去重命中但磁盘文件已丢 → 按原 key 补回，同 id 可下载」。
- e2e（不重建库，对 3011）：头像与拖动两条各 `--repeat-each=3` 全过；design / feedback 3 轮 25 条全过。
- `pnpm test` 1704 条、`pnpm lint`、`pnpm typecheck` 通过。
- 残余：design / feedback 有一次单独失败未能定位到具体用例（产物被后续运行覆盖），随后 4 轮全过；若再现，先看 feedback 的 Toast 计时。
