# Hono 中间件替换 `c.res` 会继承旧响应的 Set-Cookie

## 症状

实现「待审批账号登录返回 403 `REGISTRATION_PENDING`」（ADR-0008）时，`loginGuard` 在 `await next()` 之后发现用户待审批，用 `c.res = new Response(403 …)` 改写响应。状态码与正文都对，但响应头里仍带着 Better Auth 刚下发的 `xz.session_token` Cookie——浏览器会拿到一个有效会话。

## 复现

```ts
app.use('/api/auth/sign-in/email', async (c, next) => {
  await next() // Better Auth 返回 200 + Set-Cookie
  c.res = new Response('{}', { status: 403 })
})
// → 403，但 set-cookie 仍在
```

## 根因

Hono `Context` 的 `res` setter（`node_modules/hono/dist/context.js`）在已有 `#res` 时，会把旧响应的所有头（`content-type` 除外，`set-cookie` 逐条 append）拷到新响应上——设计用于「中间件改写响应但保留已设头」。直接抛 `AppError` 走 `onError` 也一样：`c.body()` 会合并已有响应的头。

## 修复

`src/server/middleware/login-guard.ts`：先 `c.res = undefined` 清空（setter 在 `_res` 为假时不合并），再赋新的 problem+json 响应；同时 `DELETE FROM session WHERE user_id = …` 撤销刚建的会话，双保险。

## 验证

`src/server/__tests__/join-requests.test.ts`「REQ-AUTH-018 待审批账号登录：密码对 → 403 REGISTRATION_PENDING，不下发 Cookie、不留会话」断言 `set-cookie` 不含 `session_token=` 且 `session` 表无该用户行；e2e `register.spec.ts` 覆盖界面提示。

## 附：同批次的小坑

- `rrule@2.8` 在 Node ESM（tsx）下 `import { RRule } from 'rrule'` 报「does not provide an export named 'RRule'」（包 `main` 是 CJS、无 `exports`）；服务端改为 `import rrulePkg from 'rrule'; const { RRule } = rrulePkg`（`services/calendar-recur.ts`）。前端不直接用 rrule。
- `chinese-days` 的 `getLunarFestivals` 含大量民俗诞辰（「棉花生日」「天医节」…），月格会很吵；`src/shared/cn-days.ts` 用白名单只显示主要传统节日。
- i18next 对 zh-CN 只有 `other` 复数形式，`key_one` 永远不命中；「每天 / 每 2 天」这类差异要用独立 key（`everyDayOne`）。
