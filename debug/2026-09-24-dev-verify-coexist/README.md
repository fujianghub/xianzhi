# 手工验收：主 dev 与验证实例并存（REQ-OPS-012 / T0-031）

- 日期：2026-09-24
- 影响范围：infra（dev）
- 严重度：low（验收记录）
- 相关：T0-031 · REQ-OPS-012 · CLAUDE.md「勿共享 .vite 缓存」

## 症状
（验收项，非缺陷）需要证明主 dev 运行时再起验证实例不冲突。过程中发现两个遗留的 tsx 进程占着 8010 / 8011（本会话早期冒烟测试未清理），主 dev 的 api / collab 报 `EADDRINUSE`。

## 复现
```
pnpm dev            # 3010 / 8010 / 8011，库 gi
pnpm dev:verify     # 3011 / 8012 / 8013，库 gi_e2e，cacheDir node_modules/.vite-verify
```

## 根因
遗留进程是会话内手工启动后 `pkill -f` 模式误伤自身 shell 导致未清理；与实现无关。

## 修复
按端口定位并结束遗留进程；之后清理一律按端口取 pid 再 kill。

## 验证
- 六个端口分属两套进程：3010/8010/8011 与 3011/8012/8013，日志无 EADDRINUSE。
- `node_modules/.vite` 与 `node_modules/.vite-verify` 两个缓存目录并存。
- 主 dev 运行期间在验证实例上跑 `playwright test e2e/collab.spec.ts e2e/ui.spec.ts`：8 例全绿；结束后主 dev `/api/health` 仍 200。
