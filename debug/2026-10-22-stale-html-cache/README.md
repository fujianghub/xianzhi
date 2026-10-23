# 部署后线上仍跑旧版本：修好的「任务详情 reading 'create'」在浏览器里复现、「线上功能不全」

- 日期：2026-10-22
- 影响范围：server 生产静态托管（`src/server/app.ts`）、client 懒加载
- 严重度：high（每次部署后都可能让用户继续跑旧代码，或旧页面打不开懒加载的功能）
- 相关：`debug/2026-10-22-editor-chunk-cycle`（被它掩盖：修复已上线，用户浏览器仍执行旧 chunk）、REQ-OPS-015 · 016

## 症状

1. 用户：「线上生产服务器有些功能没有齐全，线下的 dev 环境的部分功能没有部署到线上吗」。
2. 部署 `xianzhi:20261022-2` 后，用户在线上打开任务详情仍是 `Cannot read properties of undefined (reading 'create')`——这正是已修复的 editor chunk 循环导入错误。

服务端核对：线上 751 个 chunk 与本地同提交构建逐个哈希一致，首页引用新入口 `index-CmfdSnSr.js`；按「先加载 editor」顺序动态 import 线上编辑器相关 chunk 全部正常（旧镜像上同一脚本 5 个全报 `create`）。代码、迁移（29）、主题、附件、配置表两边一致，排除漏部署——是浏览器在跑旧版本。

## 复现

```
curl -sI https://www.xianzhi.host/                       # 200 text/html，只有 last-modified，没有 Cache-Control
curl -sD- -o /dev/null https://www.xianzhi.host/assets/editor-fR0penOB.js   # 已删除的旧 chunk
# HTTP/2 200 · content-type: text/html · cache-control: public, max-age=31536000, immutable
```

## 根因

两处缓存缺陷叠加：

1. **HTML 无 `Cache-Control`**：`/` 由 `serveStatic` 发出（带 `Last-Modified` = 构建时间），浏览器按启发式缓存（约为「距上次修改时长」的 10%）。镜像构建 6 天后缓存的 index.html 可再用约 14 小时；期间部署新版，浏览器仍加载旧 index → 旧入口 chunk → 旧懒加载 chunk（都以 immutable 存在缓存里），于是修好的 bug 照样出现、新功能「没有」。`theme-init.js` 同理。dev 走 Vite dev server，每次都协商，不会出现。
2. **`/assets/*` 缺失回退 index.html**：SPA 兜底 `app.get('*')` 把不存在的 `/assets/xxx.js` 回成 index.html，状态 200，又被 `/assets/*` 中间件按 200 加上 `immutable`。旧页面懒加载已删除的旧 chunk 时拿到 HTML → 模块加载失败；这份 HTML 还被浏览器按「一年不可变」记在那个 URL 下。

## 修复

1. `app.ts`：`/assets/*` 非 200 → `Cache-Control: no-store`，缺失由 `app.all('/assets/*', notFound)` 返回 404（problem+json），不进 SPA 兜底；非 `/api/`、非 `/assets/` 且未设缓存头的响应（index.html、SPA 兜底、`theme-init.js`、favicon）→ `no-cache`。Caddy `?Cache-Control` 只在缺省时补，不会覆盖。
2. `lib/stale-reload.ts`（`main.tsx` 安装）：`vite:preloadError` → 记 `xz:stale-reload` 后 500 ms 整页刷新一次；10 秒内再失败不刷（交错误边界），会话存储不可用不刷。不吞错误、刷新推迟：路由 chunk 由 TanStack Router `lazyRouteComponent` 先刷新并记 `tanstack_router_reload:*`——立刻刷新时实测共刷两次（预加载阶段就卸载了页面，TanStack 没拿到模块错误、没记标记，新页面又刷一次）。

已缓存住旧 index.html 的浏览器，修复上线后仍需手动强制刷新一次（旧页面不知道新规则）；此后每次部署都会立即生效。

## 验证

- api：`attachments.test.ts` REQ-OPS-015（asset immutable、缺失 404 + no-store 非 HTML、`/` `/tasks` `/theme-init.js` no-cache、API 缓存头不变）。unit：`stale-reload.test.ts` REQ-OPS-016。
- 本地生产模式（`NODE_ENV=production node dist/server/start.js`，Hono 托管 dist）：curl 四种路径缓存头符合；Playwright 打开 `/login` 后删掉注册页 chunk 再点「注册」：chunk 404 → 刷新一次（两个防循环标记都已写入）→ 再点不再刷新、显示错误边界。
