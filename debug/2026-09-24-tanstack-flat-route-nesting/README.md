# /login/2fa 显示的仍是登录表单

- 日期：2026-09-24
- 影响范围：client（路由）
- 严重度：high（开启 2FA 的用户无法登录）
- 相关：T0-022 · REQ-AUTH-006

## 症状
e2e 2FA 用例卡在 `getByLabel('验证码')`；页面快照是登录表单，URL 已是 `/login/2fa`。

## 复现
文件式路由 `routes/login.tsx` + `routes/login.2fa.tsx`，访问 `/login/2fa`。

## 根因
TanStack Router 扁平命名里 `login.2fa.tsx` 是 `login.tsx` 的**子路由**；父组件没有 `<Outlet/>`，子页面从不渲染。另有次要问题：登录后 twoFactorClient 的 `onTwoFactorRedirect` 与页面自身的 `nav()` 双重导航。

## 修复
改名 `login_.2fa.tsx`（路由 id `/login_/2fa`，下划线后缀表示不嵌套）；登录页删除自身的 2FA 跳转，交给插件回调。

## 验证
e2e REQ-AUTH-006「开启 2FA 后登录需 TOTP；恢复码一次性」绿。
