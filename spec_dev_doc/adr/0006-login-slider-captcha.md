# ADR-0006 登录拼图滑块（服务端出题）

> 状态：已采纳 · 2026-09-24 · 补充 REQ-AUTH-001 / 012 与 `08` §2.1 登录页；不改变「邮箱 + 密码」的登录凭据（不引入用户名，2026-09-24 用户裁定）。

## 背景

用户要求登录页参照简斋：输入框带图标，并增加滑块验证，防止 AI / 脚本自动登录。简斋的实现（Django + Pillow + Redis）有四个已知缺陷：取值与删除非原子、原地点一下即算解开、没有键盘操作、390px 窄屏溢出。衔枝没有 Redis，前端也有 axe 与 i18n 闸门。

## 候选方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 第三方（Turnstile / hCaptcha，Better Auth `captcha` 插件） | 强度高、零维护 | 外部依赖与请求，CSP 放行外域；内网 / 离线部署不可用；隐私 |
| **B. 自建服务端拼图（sharp 光栅化 SVG，答案存 PG）** | 无外部依赖；与简斋体验一致；可测 | 只能挡「不看图的脚本」，视觉模型可解；需自己维护 |
| C. 只做前端滑块 | 最简单 | 无防护价值 |

## 决定

采用 B：

1. **出题** `GET /api/captcha`（匿名，按 IP 30/min，`Cache-Control: no-store`）：随机山脊 / 枝条 / 散点场景，拼块带凸凹口，缺口只由像素表达；返回 `{ id, background, piece, y, pieceSize, width: 320, height: 160 }`，**不含 x**。
2. **答案** 存 Better Auth `verification` 表（`identifier = captcha:<id>`，`value = {x, t}`，120 s 过期）；校验用一条 `DELETE … RETURNING` 取出即删，对错都消费。
3. **判定** `|x − target| ≤ 6` 且出题到提交 ≥ 600 ms。
4. **接入** `loginGuard`（`/api/auth/sign-in/email`）：锁定 → 限流 → **拼图** → Better Auth 验密码。头部 `x-captcha: <id>:<x>`。失败 400 `CAPTCHA_INVALID`，**不计入账号失败次数**（没有拼图就刷不动别人的锁定）。
5. **邀请通行证**：`POST /workspace/invitations/:id/accept` 返回 `captchaPass`（`pass:<id>`，60 s 一次性），供紧随其后的自动登录免拼图。
6. **不加拼图的入口**：Passkey（需持有设备）、魔法链接（不含密码，仍受 10/min 限流）、API Key（Bearer，不经登录）。
7. **测试**：非生产可设 `XZ_CAPTCHA_DEBUG=1`，出题响应附 `debugX`，API 测试与 e2e 走真实流程；`NODE_ENV=production` 时 `createApp` 强制关闭（单测锁定）。
8. **前端** `SliderCaptcha`：图片随容器等比缩放、行程按比例换算；拖拽与键盘（`role=slider`）；位移为 0 不算解开；pointercancel 回位；110 s 自动换题；失败抖动 + 换题；颜色动效全取 token。

## 后果

- 新增 REQ-AUTH-016；02 §1 / §2 / §3 增 `/api/captcha`、`x-captcha`、`CAPTCHA_INVALID`，邀请接受响应加 `captchaPass`；07 §2.1 威胁表加一行；08 §2.1 更新；glossary 加「拼图滑块」「拼图通行证」。
- 25 个服务端测试文件经 `signIn()` 辅助自动取题，无需逐个改；e2e `login()` 用 `solveCaptcha()` 真实拖拽。
- 强度有限：缺口压暗 + 白棱线，边缘检测可解；它的作用是抬高批量脚本成本，真正的防线仍是限流、锁定与 2FA。
