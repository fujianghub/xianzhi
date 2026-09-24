# 登录页 Lighthouse 69 → 93：直连无压缩 + 路由配置把 zod / Radix Tooltip 拉进首屏

- 日期：2026-09-24
- 影响范围：client / infra
- 严重度：medium（REQ-UI-015 Lighthouse ≥ 90 未达标）
- 相关：REQ-UI-015 · `e2e/infra.spec.ts` · `e2e/perf.spec.ts` · `debug/perf/lighthouse.json`

## 症状
Lighthouse 12（默认移动端节流）对生产栈 `/login`：直连 gi-app 得 69（FCP 4.8s）；经 Caddy 得 89（FCP 2.7s / LCP 3.1s）。

## 复现
`pnpm e2e:infra`，或手工起 prod compose + Caddy 后 `pnpm dlx lighthouse@12 http://127.0.0.1:18180/login --only-categories=performance`。

## 根因
1. gi-app 静态文件不压缩（429 KiB 可省）；生产由 Caddy `encode zstd gzip` 负责，直连测量不代表线上。
2. SPA 首屏须等 JS 执行完才有内容。首屏 JS 里有两块登录页用不到的：
   - `login.tsx` / `login_.2fa.tsx` / `_app.design.tsx` 的 `validateSearch` 用 zod——路由配置在主 chunk（自动分包只拆组件），zod 整包（~78 KB 原始）成了 modulepreload。
   - `main.tsx` 全局包 `TooltipProvider`，Radix Tooltip + floating-ui 进首屏。

## 修复
- 测量改为经 Caddy（`e2e/infra.spec.ts` 起 Caddy 容器，配置取自 `infra/Caddyfile.snippet`）。
- `lib/search.ts` 加 `optString` / `optOneOf` 轻量校验器替换路由配置里的 zod（非法值丢弃为 undefined）。
- `TooltipProvider` 挪到 `_app.tsx`（只有已登录布局用 Tooltip）。
- 首屏 gzip：175 KB → 126 KB（check-budget）。

## 验证
`e2e/infra.spec.ts`「REQ-UI-015 … Lighthouse ≥ 90（3 次中位数）」：93 / 93 / 93（FCP 2.4s、LCP 2.8s、TBT 5ms、CLS 0）；`e2e/perf.spec.ts` 从 `dist/client` 直接提供文件测首屏 JS gzip ≤ 250 KB 与 LCP。回归风险：以后在路由配置（`createFileRoute({...})` 非组件部分）引入重依赖会再次进首屏——check-budget 兜底。

补（2026-09-24，T1-002）：同类回归又出现一次。`/spaces/$spaceSlug` 的 loader 从 `hooks/useSpaces.ts` 引 `spaceQuery`，把 useQuery / useMutation 带进首屏，首屏多了 6 KB。修法是把查询定义拆进无 React 依赖的 `lib/space-queries.ts`。**约定：路由配置（loader / beforeLoad / validateSearch）只能引用 `lib/*-queries.ts` 这类纯模块。**
