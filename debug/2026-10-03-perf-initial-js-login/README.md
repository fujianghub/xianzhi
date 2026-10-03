# REQ-UI-015 首屏 JS 超标：check-budget 报 203 KB，真实浏览器打开 /login 下载 280 KB

## 症状

`e2e/perf.spec.ts`「生产构建首屏 JS gzip ≤ 250 KB」持续失败，实测 279 ~ 280 KB；同一份构建上，`pnpm build` 的 `check-budget` 却报「首屏 203 KB / 250 KB」通过。main 原版（ADR-0046 之前）同样是 279 KB，问题早已存在，只是没被发现。

## 复现

`pnpm build` 后跑 `pnpm exec playwright test e2e/perf.spec.ts --project=desktop --no-deps`。

## 根因

1. **两边口径不同**：`check-budget` 只统计 `index.html` 直接引用的 JS（入口加 modulepreload）。perf 用例在真实浏览器里打开 `/login`，统计实际下载的全部 JS，包括路由懒加载的 chunk。中间差的约 77 KB，就是登录路由组件及其依赖。
2. **登录页过早加载了用不上的东西**（按 sourcemap 拆到包级别）：
   - 右上角主题菜单的 Popover：Radix popper、floating-ui、dismissable-layer、focus-scope、remove-scroll 等，约 22 KB，打开菜单前根本用不到；
   - Better Auth 客户端（含 `@simplewebauthn` 通行密钥）：约 16 KB，只有点「登录 / 通行密钥 / 魔法链接」时才用到。
3. 其余部分（入口 139 KB：react-dom、TanStack、i18next 与中文文案；zod 25 KB；幼燕插画 13 KB；tailwind-merge 8.5 KB）此次未动。

## 修复

1. `ThemeMenu`：首屏只渲染按钮，悬停 / 聚焦时预取弹层；点击后挂载 `ThemeMenuPopover` 并直接展开。外观和 `data-testid` 不变。
2. `lib/auth-client-lazy.ts`：登录 / 2FA / 邀请三个认证页改为交互时 `import()` Better Auth 客户端，并缓存同一个 Promise；已登录应用仍静态引用。
3. `check-budget` 改为按 Vite manifest 走静态 import 链，计「入口 + 登录路由组件」的闭包，与 perf 用例同口径（差 `theme-init.js` 0.6 KB）；`vite build.manifest: true`。产物 `/.vite/manifest.json` 在生产静态托管里返回 404。

## 验证

- 登录页真实下载：280.2 KB → 240.7 KB；`check-budget` 报 240.2 KB；perf 用例通过。
- 用旧算法核对，改前代码会报约 279 KB 而失败，以后同类问题能在构建阶段拦下。
- 认证类 e2e（login / auth / register / auth-bird / brand / a11y）通过；auth.spec 内 2FA、通行密钥走按需加载的客户端，通过。

## 后续可做（未做）

zod 整库 25 KB 在所有页面首屏：路由 `validateSearch` 用的是共享 zod schema。改用 `zod/mini` 或手写解析能省下大部分，但牵涉全部路由的参数校验，需单独评估。
