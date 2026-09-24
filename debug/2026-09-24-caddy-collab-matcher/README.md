# Caddy `handle /collab/*` 不匹配 `/collab`，生产协同 WebSocket 会落到 gi-app 404

- 日期：2026-09-24
- 影响范围：infra
- 严重度：high（上线后协同编辑整体不可用；本机 compose 直连端口时发现不了）
- 相关：REQ-OPS-005 · `infra/Caddyfile.snippet` · `e2e/infra.spec.ts`

## 症状
`pnpm e2e:infra` 新增「经 Caddy」用例：`curl -H 'Upgrade: websocket' http://127.0.0.1:18180/collab` 返回 `HTTP/1.1 404 Not Found`；直连 gi-collab 端口则是 101。

## 复现
用 `infra/Caddyfile.snippet`（域名换成 `:18180`、端口换成测试端口）起 `caddy:2-alpine`（`--network host`），对 `/collab` 发 WebSocket 握手。

## 根因
前端连的是 `wss://<host>/collab`（`src/client/editor/EntryEditor.tsx`，路径就是 `/collab` 本身）。Caddy 的路径匹配 `/collab/*` 只匹配带斜杠后缀的子路径，`/collab` 不命中，于是走到兜底的 `handle { reverse_proxy gi-app }`，gi-app 对 `/collab` 返回 404。之前的 T0-028 验收只直连了 18011 端口，没经过 Caddy。

## 修复
命名匹配器 `@collab path /collab /collab/*` + `handle @collab`。票据接口在 `/api/v1/collab/token`，不受影响。顺带把 `/assets/*` 的 `header Cache-Control` 改为 `?Cache-Control`（gi-app 已设同值，原写法会出现两个 Cache-Control 头）。

## 验证
`e2e/infra.spec.ts` 的「REQ-OPS-005 Caddy 片段」用例：经 Caddy 握手 101、`/assets/*` 恰好一个 immutable 头且带 `content-encoding`。Caddy 配置由片段文本替换生成，片段再改错会直接失败。
