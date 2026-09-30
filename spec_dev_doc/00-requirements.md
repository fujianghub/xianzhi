# 00 需求规范

> 状态：已采纳 · 版本：v2 · 更新：2026-09-29（ADR-0032：REQ-EDITOR-033 ~ 035；ADR-0029：REQ-READ-007、REQ-EDITOR-024 注）· 2026-09-28（ADR-0028：REQ-EDITOR-032 改；ADR-0027：REQ-READ-009；ADR-0026：REQ-READ-008、REQ-EDITOR-032、REQ-COLLAB-017 · 018，REQ-READ-002 注；ADR-0025：REQ-EDITOR-024 ~ 031、REQ-READ-007，REQ-EDITOR-001 · 002 · 007 · 008、REQ-READ-002 注；ADR-0023：REQ-TPL-006 ~ 010、REQ-TPL-004 改；ADR-0024：REQ-READ-001 ~ 006）· 2026-09-27（ADR-0022：REQ-SPACE-013 ~ 015；ADR-0021：REQ-SPACE-010 ~ 012；ADR-0016：REQ-CAL-012 · 013、REQ-ENTRY-016 ~ 019、REQ-UI-038；ADR-0017：REQ-ENTRY-020、REQ-TAG-007；ADR-0018：REQ-KB-008、REQ-ENTRY-021 ~ 023、REQ-LINK-006；ADR-0019：REQ-KB-009 · 010、REQ-EDITOR-023）· 最后对照代码：2026-09-25（鲜艳色板 / 用户管理 / 个人资料，ADR-0010：REQ-CAL-010、REQ-UI-035、REQ-WS-018 ~ 023、REQ-AUTH-021；注册审批 / 用户名 / 日程 / 宽屏：REQ-AUTH-017 ~ 020、REQ-CAL-001 ~ 009、REQ-UI-034；此前 2026-09-24：REQ-AUTH-016、REQ-TASK-024、REQ-UI-024 ~ 032） · 依据 ADR-0001 §1、§7、§9、ADR-0003。
> 本文是**所有测试与任务的追溯源头**：每条需求有唯一 `REQ-<AREA>-<NNN>` 编号；`05` §5 的测试、`tasks/` 的任务、PR 描述都引用这里的编号。设计如何实现在 01–06；本文只写「做什么、验收什么」。
> 分期：一期 = Phase 0–2（本文编号范围）；二期 = Phase 3（文末只列标题，不编号、不验收）。

---

## 0. 范围与非目标

**定位**（ADR §1）：「记录 + 规划」的个人工作台，任务 / 周期 / 记录三类对象在一条时间轴上交织并互相链接，富文本编辑器是主战场；多用户邀请制、单 Workspace 数十人内。

**非目标**（一期不做，提出即拒）：
- ~~自助注册、~~公开访问、匿名可读页面。（注 2026-09-25，ADR-0008：自助注册改为「开放注册 + 管理员审批」，见 REQ-AUTH-017 ~ 020）
- 多实例部署、Redis、对象存储（触发条件见 ADR §9.4）。
- Markdown 作正文真源；正文经 Markdown 往返。
- SSR / SEO；移动原生 App（只做 PWA + 响应式）。
- 二期功能（MCP、git / `debug/` 导入、AI、pgvector、Web Push 以外的 PWA 打磨）不在本文验收。
- 字体家族 / 字号 / 颜色标记、多列布局、内嵌 iframe（03 §3.1）。（注 2026-09-28，ADR-0024：此处指写进正文的内容标记；读者自己的阅读显示偏好——字体 / 字号 / 行距 / 版心 / 纸张——见 REQ-READ-*，不改正文）

**优先级**：P0 必须（Phase 验收门槛）· P1 应该（该 Phase 内完成，可延一个 Phase）· P2 可以（有余力再做）。
**角色**：工作区 owner / admin / member / guest，未登录 anon；空间 admin / member / viewer（01 §5）。
**验收写法**：Given / When / Then，`<br>` 分行；状态码与错误 `code` 按 02 §3；时限均为本机开发环境、缓存命中。

---

## 1. AUTH —— 登录、邀请、2FA、Passkey、API Key

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-AUTH-001 | P0 | 0 | 当已受邀用户提交正确邮箱 + 密码时，系统应建立会话并下发 `HttpOnly; SameSite=Lax; Secure` Cookie | Given 成员账号 When `POST /api/auth/sign-in/email` Then 200，`Set-Cookie` 含三属性<br>When 密码错 Then 401，响应体不区分「邮箱不存在」与「密码错」 | ADR §4.6 · 02 §2 | api · e2e |
| REQ-AUTH-002 | P0 | 0 | 系统应始终拒绝**绕过审批**的注册：Better Auth `/sign-up/email`、魔法链接与 OAuth 对陌生邮箱的自动建号一律拒绝（注 2026-09-25，ADR-0008：原「无邀请」改为「无邀请且未经审批」；自助注册只走 REQ-AUTH-017） | Given 任意邮箱 When `POST /api/auth/sign-up/email` Then 4xx，`user` 表无新行<br>Given 陌生邮箱 When `POST /api/auth/magic-link` Then 不发邮件或邮件链接打开后不建号，`user` 行数不变 | 01 §2 · ADR §8 决定 6 · 07 §2.1 | api |
| REQ-AUTH-003 | P0 | 0 | 当 owner/admin 创建邀请时，系统应发送含一次性链接的邮件，被邀者设置密码后成为指定角色的成员 | Given admin When `POST /workspace/invitations {email, role}` Then 201，Mailpit 收到邮件<br>When 被邀者打开链接并设密码 Then `member.role` = 指定角色，可登录<br>Given 邀请创建 7 天后 When 打开 Then 提示已过期，不创建账号 | 01 §2 · 02 §9 | api · e2e |
| REQ-AUTH-004 | P0 | 0 | 当已接受的邀请链接被再次打开时，系统应提示「邀请已使用」且不创建第二个账号 | Given 已接受邀请 When 再次 `GET` 链接 Then 页面显示已使用，`user` 行数不变 | 01 §2 | e2e |
| REQ-AUTH-005 | P0 | 0 | 当 member 尝试创建邀请时，系统应返回 403 | Given member When `POST /workspace/invitations` Then 403 `FORBIDDEN` | 01 §5 | api |
| REQ-AUTH-006 | P1 | 0 | 当用户开启 TOTP 2FA 时，系统应要求验证一次 TOTP 并生成 10 个一次性恢复码 | Given 已登录 When 开启 2FA 并输入正确 TOTP Then 启用，返回恢复码<br>When 下次登录 Then 需 TOTP；用恢复码登录后该码失效 | ADR §4.6 | api · e2e |
| REQ-AUTH-007 | P1 | 1 | 当用户注册 Passkey 后，系统应允许无密码登录 | Given 已注册 passkey（Playwright 虚拟认证器）When passkey 登录 Then 200 建立会话 | ADR §4.6 | e2e |
| REQ-AUTH-008 | P1 | 0 | 当用户请求魔法链接 / 重置密码时，系统应发邮件且链接 15 分钟内一次性有效 | When `POST /api/auth/magic-link` Then Mailpit 收到；点击一次登录成功；再点提示失效 | ADR §4.6 · 05 §2 | api · e2e |
| REQ-AUTH-009 | P0 | 0 | 当用户登出或 admin 吊销其会话时，原 Cookie 应立即失效 | Given 会话 A When 登出 Then 用 A 请求 `/me` 401<br>Given admin `POST /workspace/members/U/revoke-sessions` Then U 所有请求 401<br>When 本人 `GET /me/sessions` Then 列出全部会话；`DELETE /me/sessions/:id` Then 该会话 401 | ADR §4.6 · 02 §9 | api |
| REQ-AUTH-010 | P0 | 0 | 当用户创建 API Key 时，系统应只返回一次明文（`xz_` 前缀），支持 scope `read \| write \| admin`、可选 `expiresAt` 与吊销；Key 的权限不超过持有者角色；每 Key 限流 300/min | When `POST /me/keys {name, scope, expiresAt?}` Then 201 含明文，之后 `GET /me/keys` 只显示前缀<br>Given scope=read When `POST /tasks` Then 403 `SCOPE`<br>Given member 持有 scope=admin 的 Key When `PATCH /workspace` Then 403<br>Given 已过期 Key Then 401<br>When 第 301 次请求 Then 429<br>When `DELETE /me/keys/:id` Then 该 Key 请求 401；`audit_log` 有创建与吊销两行 | 02 §2 · 01 §3.12 · 07 §2.7 | api |
| REQ-AUTH-011 | P0 | 0 | 当非 GET 请求缺少同站 `Origin`/`Sec-Fetch-Site` 时，系统应返回 403 `CSRF`；API Key 请求豁免 | Given Cookie 会话 When `POST /tasks` 带跨站 Origin Then 403 `CSRF`<br>Given Bearer API Key 同请求 Then 正常 | 02 §2 | api |
| REQ-AUTH-012 | P0 | 0 | 登录应按 IP 与邮箱双维度限流 10/min；同一账号连续失败 10 次锁定 15 分钟 | When 第 11 次登录 Then 429 `RATE_LIMITED`，`RateLimit-Reset` 存在<br>Given 连续失败 10 次 When 再登录（即使密码正确）Then 403 `ACCOUNT_LOCKED`，`audit_log` 有行 | 02 §2 · 07 §5 | api |
| REQ-AUTH-013 | P0 | 0 | `pnpm xz create-owner` 应创建首个 owner、默认 Workspace 与 owner 的个人空间，且不可重复创建 owner | When 首次运行 Then `user` + `organization` + `member(role=owner)` + `spaces(is_personal)` 各 1 行<br>When 再次运行 Then 退出码非 0，提示已存在 | 05 §3 · 05 §11 · REQ-SPACE-009 | unit |
| REQ-AUTH-014 | P0 | 0 | 当 API Key 或会话属于已被移除的成员时，所有 `/api/v1/*` 请求应返回 401 | Given 成员被移除 When 用其旧 Key 请求 Then 401 | 01 §5 | api |
| REQ-AUTH-015 | P0 | 0 | 一期应禁用 Better Auth admin 插件的模拟登录（impersonation） | When `POST /api/auth/admin/impersonate-user` Then 404；代码中该插件配置不含 impersonation 相关选项 | 07 §2.1 · ADR §4.6 | api |
| REQ-AUTH-016 | P1 | 2 | 邮箱密码登录应先通过服务端拼图滑块：答案只存服务端、一次性、120 s 过期、±6px、≥ 600 ms；失败 400 `CAPTCHA_INVALID` 且不计入账号失败次数；接受邀请后的自动登录用一次性通行证；production 不回显答案；滑块可键盘操作 | When 缺 / 错 / 复用拼图 Then 400；When 12 次错拼图后正确登录 Then 200；When production Then 出题无 `debugX`；When 键盘解开 Then 可登录 | ADR-0006 · 07 §2.1 · 08 §2.1 | api · e2e |
| REQ-AUTH-017 | P0 | 2 | 当访客在 `/register` 提交邮箱、用户名、显示名、密码（≥ 8 位）并通过拼图时，系统应建立待审批账号（无 `member` 行）并通知全部 owner/admin；缺 / 错拼图 400 `CAPTCHA_INVALID`，同 IP 每小时 > 5 次 429，邮箱或用户名已占用 409（字段级），待审批总数 ≥ 200 时 429 | When `POST /workspace/join-requests` + 正确拼图 Then 201 `{status:'pending'}`，`user` 有行、`member` 无行，`events` 有 `member.requested`<br>When 缺拼图 Then 400 且无新 user<br>When 密码 7 位 / 用户名非法 Then 422<br>When 重复邮箱 Then 409 `errors[0].path=email`；重复用户名（大小写不同）Then 409 `path=username`<br>When 同 IP 第 6 次 Then 429 | ADR-0008 · 07 §2.1 · 08 §2.1b | api · e2e |
| REQ-AUTH-018 | P0 | 2 | 待审批账号密码正确登录时，系统应返回 403 `REGISTRATION_PENDING`、不下发 Cookie、不留会话，且不发魔法链接；owner/admin 在成员页「待审批」批准（可选角色）后其成为成员并获个人空间，可正常登录；member 不可查看或审批 | Given 待审批 When 正确密码登录 Then 403 `REGISTRATION_PENDING`，无 `session` 行；错密码 Then 401<br>When 请求魔法链接 Then 不发信<br>When owner 批准 Then `member.role` = 所选角色，发 `member.joined`，再登录 200<br>When 再批准同一申请 Then 409<br>Given member When `GET /workspace/join-requests` Then 403 | ADR-0008 · 01 §3.14 · 08 §2.13 | api · e2e |
| REQ-AUTH-019 | P1 | 2 | owner/admin 驳回注册申请时，系统应删除该申请账号（级联 account / session / join_requests），写审计 `member.rejected`，对方可用同一邮箱重新申请 | When `POST /workspace/join-requests/:id/reject` Then 204，`user` 无该邮箱；再注册同邮箱 Then 201 | ADR-0008 | api |
| REQ-AUTH-020 | P0 | 2 | 用户应能用「邮箱或用户名」+ 密码登录：输入不含 `@` 时走 `/sign-in/username`（大小写不敏感），与邮箱登录同样经过拼图、IP / 账号限流与锁定、待审批判定 | When 用户名大写 + 正确密码 + 拼图 Then 200；缺拼图 Then 400；错密码 Then 401<br>Given 待审批 When 用户名登录 Then 403 `REGISTRATION_PENDING` | ADR-0008 · 02 §2 | api · e2e |
| REQ-AUTH-021 | P1 | 2 | 用户应能在「设置 · 安全」修改自己的密码：须当前密码，新密码 ≥ 8 位且不同于旧密码；成功后退出本人其他设备的会话、当前会话保留；Better Auth 自带 `/change-password` 关闭（ADR-0010） | When 当前密码错 Then 422 `currentPassword`；新旧相同 Then 422<br>When 正确 Then 200 `{ sessions: 其他会话数 }`、当前会话仍可用、另一会话 401、新密码可登录；`audit auth.password_changed` | ADR-0010 · 02 §9 | api |

---

## 2. WS —— 工作区、成员、角色、设置、审计

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-WS-001 | P0 | 0 | 系统应向所有成员返回工作区信息，仅 owner/admin 可修改 | Given member When `GET /workspace` Then 200<br>When `PATCH /workspace` Then 403；Given admin Then 200 | 01 §5 · 02 §9 | api |
| REQ-WS-002 | P0 | 0 | 当 owner/admin 修改成员角色时，系统应写入 `audit_log` 并即时生效 | When `PATCH /workspace/members/:userId {role}` Then 200，`audit_log.action = member.role_changed`<br>Then 被改用户下一次请求按新角色判定 | 01 §3.12 · 01 §5 | api |
| REQ-WS-003 | P0 | 0 | 系统应始终保证至少存在一名 owner；owner 只能由 owner 经 `POST /workspace/owner-transfer` 转让 | Given 唯一 owner When 将其降级、移除或注销 Then 409 `CONFLICT_LAST_OWNER`<br>When 转让 Then 双方角色互换，`events` 有 `workspace.owner_transferred`，双方各收 in_app + 邮件 | 01 §5 · 01 §4 · 07 §4 · 02 §9 | api |
| REQ-WS-004 | P0 | 0 | 当成员被移除时，系统应在同一事务删除其全部会话、禁用其 API Key，并在提交后广播 `user.revoked` 断开其 WS 与 SSE | When `DELETE /workspace/members/:userId` Then 该用户旧 Cookie 与 Key 请求 401；其 WS 1s 内以 4403 断开；SSE 连接关闭；`audit_log.action = member.removed` | 07 §4 · 01 §3.12 | api · collab |
| REQ-WS-005 | P0 | 0 | 系统应向 admin 提供游标分页的审计日志，member 不可见 | Given admin When `GET /workspace/audit-log?limit=50` Then 200 `{items, nextCursor}`<br>Given member Then 403 | 02 §9 · 02 §4 | api |
| REQ-WS-006 | P0 | 0 | 系统应把登录 / 登出 / 登录失败 / 权限变更 / 删除与恢复 / 导出 / API Key 变更 / 设置变更写入 `audit_log`，只增不改 | When 触发上述每类动作 Then 各有一行；`UPDATE/DELETE audit_log` 无 API 入口 | 01 §3.12 | api |
| REQ-WS-007 | P0 | 0 | `can()` 应为纯函数，角色矩阵测试覆盖 01 §5 全部「动作 × 角色」组合 | When 跑 `authz` 单测 Then 每个动作对 owner/admin/member/guest/anon 及空间角色三种均有断言，覆盖率 100% | 01 §5 不变量 2 · 05 §5 | unit |
| REQ-WS-008 | P0 | 0 | 当用户访问不可见资源时系统应返回 404；对存在但无权的动作返回 403 | Given member 对他人 private entry When `GET /entries/:id` Then 404<br>Given member 对归档空间 When `PATCH /spaces/:id` Then 403 | 02 §2 | api |
| REQ-WS-009 | P0 | 0 | guest 应只能看到被显式加入的空间，即使空间 `visibility=workspace` | Given guest 未加入空间 S（visibility=workspace）When `GET /spaces` Then 不含 S；`GET /tasks?spaceId=S` Then 404 | 01 §5 | api |
| REQ-WS-010 | P1 | 1 | 当用户修改个人资料（display / locale / timezone / weekStartsOn）时，系统应校验并即时影响「今日」「周期」的计算 | When `PATCH /me {timezone:'America/New_York'}` Then 200；`GET /tasks?view=today` 边界按新时区 | 01 §2 · 02 §9 | api |
| REQ-WS-011 | P1 | 1 | 列表查询应使用 `visible*Where(user)`，与 `can()` 共享规则表 | When 集成测试对比「列表能列出的对象集合」与「逐个 `can(read)` 为真的集合」Then 两者相等 | 01 §5 不变量 3 | api |
| REQ-WS-012 | P0 | 0 | 成员被移除后，其创建的记录与任务应保留且作者 / 创建者不变，界面显示为「已离开的成员」 | Given 成员 U 被移除 When 他人 `GET /entries/:id`（U 作者）Then 200 且 `author.displayName = 已离开的成员`、`author_id` 不变 | 07 §4 · 01 §5 | api |
| REQ-WS-013 | P0 | 0 | 成员被移除时，其未完成任务的 `assignee_id` 应置空，并向所在空间 admin 发出 `task.unassigned` | When 移除 U（有 2 个未完成任务）Then 两任务 `assignee_id = null`，`events` 有 2 行 `task.unassigned`，空间 admin 收到 in_app；已完成任务不变 | 07 §4 · 01 §4.1 | api |
| REQ-WS-014 | P1 | 1 | admin 应能停用 / 恢复成员：停用等同移除的会话与连接处理，但保留 `member` 行，恢复后需重新登录 | When `POST /workspace/members/:userId/suspend` Then 该用户 401、WS 断开、`audit member.suspended`；`GET /workspace/members` 显示 `suspended=true`<br>When `POST .../unsuspend` Then 可重新登录，`audit member.unsuspended` | 07 §4 · 02 §9 | api · collab |
| REQ-WS-015 | P1 | 2 | 用户应能注销账号（需密码或 TOTP 二次确认）：`user` 行匿名化、会话与 Key 全部删除、内容保留 | When `DELETE /me {password}` Then 204；`user.email/name/avatar` 变为 `deleted-<短id>`；其记录仍在且作者显示「已注销用户」；`audit user.deleted`<br>Given owner When `DELETE /workspace/members/U?purge=1` Then 对 U 同样匿名化<br>Given 唯一 owner Then 409 `CONFLICT_LAST_OWNER` | 07 §4 · 02 §9 | api |
| REQ-WS-016 | P2 | 2 | owner/admin 应能把已离开或已注销成员的内容批量转移给另一成员 | When `POST /workspace/members/:userId/transfer-content {toUserId}` Then 其全部 entries/tasks 的作者 / 创建者改为目标成员，`audit member.content_transferred` 含数量 | 07 §4 · 02 §9 | api |
| REQ-WS-017 | P0 | 0 | `audit_log.action` 的取值应只来自 01 §3.12 的枚举清单 | When 单测遍历代码中所有 `audit()` 调用 Then action 均属枚举；写入非枚举值 Then 抛错 | 01 §3.12 | unit |
| REQ-WS-018 | P1 | 2 | owner 应有「用户管理」页（`/settings/workspace/users`，仅 owner 可见）：列出全部成员的头像、用户名、邮箱、角色、状态、2FA、最近活跃与会话数；可直接创建用户（邮箱 + 用户名 + 显示名 + 初始密码 + 角色），创建即成为成员、无需审批（ADR-0010） | When owner `POST /workspace/users` Then 201，新用户可用初始密码登录、角色正确、`audit user.created`<br>When 邮箱 / 用户名被占用 Then 409 字段级<br>When admin 调 `GET/POST /workspace/users` Then 403；非 owner 打开页面 Then 404 | ADR-0010 · 01 §5 · 08 §2.13 | api · 手工 |
| REQ-WS-019 | P1 | 2 | owner 应能修改他人的显示名 / 用户名 / 邮箱（唯一性同注册；不能对自己用此接口，本人走个人资料） | When `PATCH /workspace/users/U` Then 204 且字段更新（邮箱 / 用户名存小写）、`audit user.updated`；When 目标为本人 Then 403 | ADR-0010 | api |
| REQ-WS-020 | P1 | 2 | owner 应能重置他人密码：新密码立即生效，该用户全部会话删除并广播 `user.revoked`；也可单独「强制下线」（复用 `revoke-sessions`） | When `POST /workspace/users/U/password` Then 200、旧密码 401、新密码 200、U 会话数 0、`audit auth.password_reset(byAdmin)`；密码 < 8 位 Then 422 | ADR-0010 · 07 §4 | api |
| REQ-WS-021 | P1 | 2 | owner 应能删除他人账号（`DELETE /workspace/members/U?purge=1`）：移除成员并吊销、删凭据 / 2FA / Passkey / API Key、`user` 行匿名化（`deleted-<id>`，用户名 / 头像清空），内容保留；邮箱与用户名随即释放；owner 不可删 | When purge Then 204、无 member / account 行、email 为 `deleted-<id>@deleted.invalid`、原邮箱不能登录、可用原邮箱与用户名再建号、`audit user.deleted`<br>When 目标为本人 Then 403 | ADR-0010 · 07 §4 | api |
| REQ-WS-022 | P1 | 2 | 用户应能在个人资料里修改自己的用户名（免密）与邮箱（须当前密码）；`/me` 返回 `username`、`image`；Better Auth 自带 `/update-user`、`/change-email` 与 `/admin/*` 关闭 | When `PATCH /me/account {username}` Then 200 回显；占用 Then 409<br>When 改邮箱不带 / 带错当前密码 Then 422；正确 Then 200 且新邮箱可登录<br>When `POST /api/auth/update-user` 或 `/api/auth/admin/*` Then 404 | ADR-0010 · 02 §9 | api |
| REQ-WS-023 | P1 | 2 | 用户应能上传 / 更换 / 移除自己的头像；头像在顶栏、成员、指派人、评论、提及处显示（无头像回退首字母色块） | When 上传图片 Then `user.image` 指向 md 变体、`avatarAttachmentId` 回写<br>When `DELETE /me/avatar` Then 204 且 `/me.image` 为 null | ADR-0010 · REQ-ATTACH-007 | api · 手工 |

---

## 3. SPACE —— 空间

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-SPACE-001 | P0 | 1 | 当 owner/admin/member 创建空间时系统应返回 201；guest 返回 403；slug 在工作区内唯一 | When `POST /spaces {name, slug, kind}` Then 201，创建者自动为 space admin<br>When 重复 slug Then 409 `CONFLICT_UNIQUE`<br>Given guest Then 403 | 01 §3.1 · 01 §5 | api |
| REQ-SPACE-002 | P0 | 1 | 当空间 `visibility=members` 时，非空间成员应视其为不存在 | Given 非成员 When `GET /spaces/:id` Then 404；`GET /spaces` 不含 | 01 §3.1 | api |
| REQ-SPACE-003 | P0 | 1 | 空间的改名 / 成员 / 归档应限 owner/admin 或该空间 admin；**删除（软删与永久）仅工作区 owner/admin** | Given space member When `PATCH /spaces/:id` Then 403；Given space admin Then 200<br>Given space admin When `DELETE /spaces/:id` Then 403 | 01 §5 · 07 §2.2 | api |
| REQ-SPACE-004 | P1 | 1 | 当空间归档后，系统应在列表默认隐藏它，并拒绝其中任务与记录的写操作 | When `POST /spaces/:id/archive` Then `GET /spaces` 不含（`?archived=1` 含）<br>When `PATCH /tasks/:id`（属该空间）Then 403<br>When `POST /spaces/:id/unarchive` Then 恢复可写 | 01 §3.1 · 02 §9 | api |
| REQ-SPACE-005 | P1 | 1 | 当用户拖动侧栏空间顺序时，系统应只更新被拖项的 `sort_key` | When `PATCH /spaces/reorder {id, after}` Then 仅一行 `sort_key` 变化 | 01 §1 排序 | api · e2e |
| REQ-SPACE-006 | P0 | 1 | 当空间 admin 添加成员时，系统应发出 `space.invited` 事件并通知被邀者 | When `POST /spaces/:id/members {userId, role}` Then `events.kind = space.invited`，被邀者收到 in_app + email | 01 §4 · 02 §9 | api |
| REQ-SPACE-007 | P1 | 1 | 当空间被软删时，其任务与记录应随之对所有人不可见，30 天后硬删，仅 owner/admin 可永久删 | When `DELETE /spaces/:id` Then 204；其下 `GET /tasks` 404<br>When `DELETE /spaces/:id?permanent=1` by member Then 403 | 01 §1 软删 · 02 §5 | api |
| REQ-SPACE-008 | P1 | 1 | 空间颜色与图标应只接受 04 §2.1 色板中的 8 个 token 名与 emoji / Lucide 名 | When `POST /spaces {color:'#ff0000'}` Then 422 `VALIDATION` | 01 §3.1 · 04 §2.1 | api |
| REQ-SPACE-009 | P0 | 0 | 每个成员加入工作区时（含 `create-owner`）系统应自动创建其个人空间（`is_personal=true`），该空间不可删除、不可加人、不可改可见性 | When 接受邀请 Then `GET /spaces` 含 `isPersonal=true` 且 `visibility=members` 的一项<br>When `DELETE` 或 `POST /:id/members` Then 403 | 01 §3.1 | api |
| REQ-SPACE-010 | P1 | 2 | （2026-09-27 新增，ADR-0021）`POST /spaces/batch`（archive / unarchive / move，≤ 100）应逐个鉴权，个人空间与无权空间进 `failed` 而不影响其它；`/spaces`「批量管理」整卡点选、Shift 连选、「全选本组」，底部操作条归档 / 取消归档 / 移到大类，归档可撤销 | When member 批量归档 [自己管理的 2 个, 他人空间, 个人空间] Then `ok` = 前 2 个、其余 `failed` 为 `FORBIDDEN`<br>When 批量 `move {groupId: 不存在}` Then 422<br>When 点第一张卡再 Shift 点第三张 Then 已选 3 个 | ADR-0021 · 02 §9 | api · e2e |
| REQ-SPACE-011 | P1 | 2 | （ADR-0021）批量删除（软删）仅工作区 owner / admin；`dryRun` 只校验并返回可删空间下未删除的记录 / 任务数，不写库；确认弹层写明计数；删除后可撤销（批量 `restore`） | Given 空间下 2 条记录 1 个任务 When `dryRun` Then `counts = {entries:2, tasks:1}` 且空间未删<br>When member 批量删 Then 全部 `FORBIDDEN`<br>When 删除后点「撤销」Then 空间回到列表 | ADR-0021 · REQ-SPACE-003 · 007 | api · e2e |
| REQ-SPACE-012 | P1 | 2 | （ADR-0021）回收站空间 Tab 可多选批量恢复 / 永久删除；批量 `purge` 只接受已在回收站的空间，内容一并清除，逐个写审计 | When 批量 `purge [已删, 未删]` Then `ok=[已删]`、未删的 `failed` 为 `CONFLICT_STALE`<br>When member 批量 `purge` Then `FORBIDDEN`<br>When 回收站勾选 3 个点「永久删除所选」并确认 Then 三行消失 | ADR-0021 · REQ-SPACE-007 | api · e2e |
| REQ-SPACE-013 | P1 | 2 | （2026-09-27 新增，ADR-0022）`POST /spaces/:id/merge {into}` 应把源空间的全部记录与任务（含回收站里的）并入目标，id 与评论 / 附件 / 关联不变、`updated_at` 不变；A 的顶层目录页按原序接在 B 顶层末尾、子页层级不变；任务在各状态列排到 B 原有任务之后；A 的成员并入 B（角色取较高）；A 移入回收站并审计 `space.merged` | Given A 有顶层页 A1、A2（A2 有子页）与任务 T1、T2，B 有顶层页 B1 与任务 BT When 合并 Then B 目录顶层 = [B1, A1, A2]、子页父仍为 A2；todo 列 = [BT, T1, T2]；T1 的评论仍可读<br>Given member 是 A 的 admin、B 的 viewer Then 合并后在 B 为 admin<br>Then A 在 `?deleted=1`，再合并 A → 404 | ADR-0022 · 02 §9 | api |
| REQ-SPACE-014 | P1 | 2 | （ADR-0022）合并仅工作区 owner / admin（对源需 `space.delete`、对目标需 `space.manage`）；同一空间 422、任一方个人空间 403、目标已归档 403（源已归档可以）；`dryRun` 只返回预览（记录 / 任务 / 成员数、`visibilityWidened`），不写库 | Given A 仅成员、B 全员可见 When `dryRun` Then `visibilityWidened=true` 且 A 未删<br>When 工作区 member（两边都是空间管理员）合并 Then 403 | ADR-0022 · REQ-SPACE-003 | api |
| REQ-SPACE-015 | P1 | 2 | （ADR-0022）空间卡片 ⋯「合并到…」（工作区 owner / admin）打开对话框：目标只列本人管理的、未归档的非个人空间；选中即预览计数，可见性扩大时警告；确认后源卡片消失，Toast 可打开目标空间 | When 选目标 Then 预览含「1 条记录、1 个任务」与可见性警告；When 点「合并」Then 源卡片消失、源空间在回收站、记录在目标目录 | ADR-0022 · 08 §2.5 | e2e |

---

## 4. TASK —— 任务、看板、今日、收件箱、重复、子任务、指派

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-TASK-001 | P0 | 1 | 当用户创建任务时，系统应要求 `title` 与 `spaceId`，创建者自动成为 watcher，并支持 `Idempotency-Key` 重放 | When `POST /tasks` Then 201；`task_watchers` 含 creator<br>When 同 `Idempotency-Key` 再发 Then 201 且同一 id，`tasks` 不新增 | 01 §3.2 · 02 §5 | api |
| REQ-TASK-002 | P0 | 1 | 当任务状态进入 `done` 时，系统应写 `completed_at` 并向 watchers（除操作者）发出 `task.completed` | When `POST /tasks/:id/complete` Then `completed_at` 非空，`events.kind = task.completed`，操作者无通知 | 01 §3.2 · 01 §4 | api |
| REQ-TASK-003 | P0 | 1 | 当用户在看板列间拖动卡片时，系统应在 200ms 内更新位置，只发一条 batch 请求；409 时卡片回原列并提示 | When 拖到另一列 Then 界面 ≤ 200ms 更新；网络面板仅 1 个 `POST /tasks/batch`，body 含 `sortKey + status`<br>Given 服务端 409 Then 卡片回原列，Toast 显示 | 02 §5 · 04 §6 · 06 §4 | e2e |
| REQ-TASK-004 | P0 | 1 | 任务列表应游标分页、`limit` 默认 50 最大 200、不返回 `descriptionPm`，支持 01/02 定义的筛选与排序 | When `GET /tasks?spaceId=&status=todo,doing&sort=-updatedAt&limit=201` Then 422<br>When `sort=hacker` Then 422 `VALIDATION`（白名单见 02 §9）<br>When `limit=200` Then 响应无 `descriptionPm`，翻页无重复无遗漏 | 02 §4 · 02 §9 · CLAUDE 不变量 6 | api |
| REQ-TASK-005 | P0 | 1 | 「今日」视图应显示按用户时区计算的今日到期、已过期未完成、今日计划开始的任务；排除 `done / cancelled` | Given 用户时区 `Asia/Shanghai`，任务 `due_at` = 今日 23:30 本地 When `GET /tasks?view=today` Then 含该任务<br>Given `due_at` = 明日 00:30 本地 Then 不含<br>Given 今日到期但 `status=done` Then 不含 | 01 §3.2 · 04 §4 · 02 §9 `view=today` | api |
| REQ-TASK-006 | P0 | 1 | 「收件箱」应显示 `status=inbox` 且（创建者或指派人为我）的任务；`done / cancelled` 天然不在其中 | When `GET /tasks?view=inbox` Then 只含满足条件的任务；`status` 参数与 `view=inbox` 同时出现 Then 422 | 04 §4 · 02 §9 `view=inbox` | api |
| REQ-TASK-007 | P0 | 1 | 当任务被指派给新用户时，系统应发出 `task.assigned`，新指派人自动成为 watcher | When `PATCH /tasks/:id {assigneeId}` Then `events.kind = task.assigned`，`task_watchers` 含新指派人；操作者自指派不产生通知 | 01 §4 | api |
| REQ-TASK-008 | P0 | 1 | 子任务应最多 2 层 | Given 任务 A → B When 创建 `parentId = B` 的 C Then 422 `VALIDATION` | 01 §3.2 | api |
| REQ-TASK-009 | P1 | 1 | 优先级 0–4 应按 04 §2.1 映射到颜色与图标，且不单靠颜色传达 | When 渲染优先级 3 Then 使用 `warning` token 且带图标 | 04 §2.1 · 04 §7 | visual · a11y |
| REQ-TASK-010 | P1 | 1 | 当任务距截止 24h 时，系统应通过 cron 发出一次 `task.due_soon`；改期后重新计算 | Given `due_at` = now + 23h When cron 跑 Then 指派人收到通知一次；再跑不重复<br>When 改期到 +3 天 Then 到期前 24h 再发一次 | 01 §4 | api |
| REQ-TASK-011 | P1 | 2 | 当重复任务完成时，系统应按 `recurrence` 生成下一实例；月末与夏令时按规则处理 | Given `monthly, byMonthday=31`，当前 2026-01-31 When 完成 Then 下一实例 2026-02-28<br>Given `weekly` 跨 DST 时区 Then 本地时刻不变<br>Given `until` 已过 Then 不生成 | 01 §3.2 | unit · api |
| REQ-TASK-012 | P0 | 1 | 当 PATCH 携带的 `ifUpdatedAt` 与当前不符时，系统应返回 409 `CONFLICT_STALE` 并附 `current` | When 两客户端先后 PATCH Then 第二个 409，`current.updatedAt` = 第一个写入后的值<br>前端 Then 用 `current` 覆盖缓存并 Toast | 02 §5 · 02 §11 | api · e2e |
| REQ-TASK-013 | P0 | 1 | 任务应支持软删、恢复、永久删（仅 owner/admin） | When `DELETE` Then 204，列表不含；`POST /:id/restore` Then 回来<br>When `DELETE ?permanent=1` by member Then 403 | 02 §5 | api |
| REQ-TASK-014 | P1 | 1 | 用户应能增删 watchers，watcher 收到完成与评论通知 | When `POST /tasks/:id/watchers {userId}` Then 该用户在 `task.completed` 接收者内 | 01 §3.2 · 02 §9 | api |
| REQ-TASK-015 | P1 | 1 | 任务描述应用 liteKit 保存为 `descriptionPm`，同事务派生 `description_plain / tsv` | When `PATCH /tasks/:id {descriptionPm}` Then `description_plain` 为纯文本，`tsv` 命中描述词 | 01 §3.2 · 03 §7 | api |
| REQ-TASK-016 | P1 | 1 | 批量操作应整体事务、最多 100 条、逐条返回结果 | When `POST /tasks/batch` 101 条 Then 422<br>When 100 条其中 1 条无权 Then 全部回滚，逐条结果标出失败项 | 02 §5 | api |
| REQ-TASK-017 | P0 | 1 | 截止时间应以 `timestamptz` 存储，按用户时区显示；「今日」「逾期」边界按用户时区 | Given 两个不同时区用户看同一任务 Then 显示时刻不同、UTC 相同 | 01 §1 · 04 §7 | api · e2e |
| REQ-TASK-018 | P1 | 2 | 任务应可归属周期，周期页列出其任务并汇总完成数 | When `PATCH /tasks/:id {cycleId}` Then `GET /cycles/:id` 的任务列表含它 | 01 §3.2 · 01 §3.3 | api |
| REQ-TASK-019 | P0 | 1 | 空间 viewer（guest）应可读任务但所有写操作返回 403 | Given guest viewer When `GET /tasks?spaceId` Then 200；`PATCH /tasks/:id` Then 403 | 01 §5 | api |
| REQ-TASK-020 | P1 | 1 | 任务列表与看板应支持键盘：`j/k` 移动、`x` 多选、`e` 编辑、`Space` 勾选完成、`p` Peek、Enter 打开；`c` 只用于全局「新任务」 | When 焦点在列表按 `j` Then 焦点行下移且左侧出现 3px 主色条<br>When 按 `Space` Then 该任务完成（走 REQ-TASK-021 流程）<br>When 按 `c` Then 打开新任务输入而非完成 | 04 §6 · 06 §5.3 | e2e |
| REQ-TASK-021 | P1 | 1 | 当任务在列表中被完成时，行应先变灰 400ms，随后折叠移出，并提供 8s 行内撤销；撤销回到完成前状态并发 `task.uncompleted`（仅活动流） | When 勾选 Then 400ms 后行高折叠；撤销条可见 8s；点击撤销 Then 发 `POST /tasks/:id/uncomplete`，任务回到 `prevStatus` 且行复原，`events` 有 `task.uncompleted`，watchers 无新通知 | 06 §5.3 · 04 §6 · 01 §4.1 · 02 §9 | e2e · api |
| REQ-TASK-022 | P2 | 2 | 当 PWA 离线时创建任务，系统应本地排队并在联网后按 `Idempotency-Key` 重放 | Given 离线 When 创建 Then 列表立即显示「待同步」；联网 Then 1 次 POST 成功，无重复 | 02 §5 · 08 §5 | e2e |
| REQ-TASK-024 | P1 | 2 | `GET /tasks?from&to` 应返回 `dueAt` 或 `scheduledAt` 落在 [from, to) 的任务，跨全部可见空间（`visibleTasksWhere`）；二者须同给、from < to、跨度 ≤ 62 天、不与 `view` / `deleted` 同用，否则 422 | When 区间含截止与计划开始各一 Then 都返回；不可见空间的任务不返回；缺一 / 倒置 / 63 天 / 与 view 同用 Then 422 | 02 §9 · 08 §2.17 | api |
| REQ-TASK-023 | P0 | 1 | 列表页 API P95 应 ≤ 100ms（1 万任务本机），关键列表接口 SQL 查询数 ≤ 3 | When 集成测试统计查询数 Then ≤ 3；Playwright 采样 P95 ≤ 100ms | ADR §3 · 05 §10 | api · e2e |

---

## 5. CYCLE —— 周期（程）

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-CYCLE-001 | P0 | 2 | 当创建周期时，同 `(owner, kind, start_date)` 已存在应返回既有对象（200）而非新建 | When 两次 `POST /cycles {kind:'week', startDate}` Then 第一次 201、第二次 200 且同 id | 02 §9 · 01 §3.3 | api |
| REQ-CYCLE-002 | P0 | 2 | `GET /cycles/current?kind=` 应按用户时区与 `week_starts_on` 计算当前周期；week 为 ISO 周，month / quarter 自然 | Given `week_starts_on=1`，本地周日 23:00 When 请求 Then 返回本周（周一起）<br>Given quarter Then `start_date` 为 1/4/7/10 月 1 日 | 01 §3.3 · 01 §2 | unit · api |
| REQ-CYCLE-003 | P0 | 2 | 周期目标 `goals` 应可增删改，引用的 `taskIds` 必须存在且可读 | When `PATCH /cycles/:id {goals:[{taskIds:['不存在']}]}` Then 422 | 01 §3.3 | api |
| REQ-CYCLE-004 | P0 | 2 | 当周期创建时，系统应同时创建 `kind=review` 的记录并注入复盘模板 | When `POST /cycles` Then `review_entry_id` 非空，该 Entry 正文含「亮点 / 问题 / 教训 / 下期重点 / 数据」五段 | 01 §3.3 · 03 §6 | api · collab |
| REQ-CYCLE-005 | P1 | 2 | 周期状态应按 `planning → active → reviewed` 单向流转；结束当天发出 `cycle.review_due` | When 从 `reviewed` PATCH 回 `active` Then 422<br>Given `end_date` = 今日 When cron Then owner 收到通知 | 01 §3.3 · 01 §4 | api |
| REQ-CYCLE-006 | P0 | 2 | 周期应仅 owner 本人可写；admin 可读；其他人 404 | Given admin When `GET /cycles/:id` Then 200；`PATCH` Then 403<br>Given member 非本人 Then 404 | 01 §5 | api |
| REQ-CYCLE-007 | P1 | 2 | 周期页头应以「第 N 程」命名，N 为年内序号（周 = ISO 周号、月 = 月号、季 = 季号，前缀年份）；`reviewed` 时播放一次里程碑动效 | When 打开 2026-W39 Then 副标「2026 · 第 39 程」；2026-Q3 Then 「2026 · 第 3 长程」；标记 reviewed Then 动效播放一次，reduced-motion 下不播 | 04 §1 · 06 §5.5 | e2e · visual |
| REQ-CYCLE-008 | P1 | 2 | 复盘模板中的「数据」callout 应由服务端填入本周期完成任务数 | Given 周期内完成 5 个任务 When 打开复盘 Then callout 显示 5 | 03 §6 | collab |

---

## 6. ENTRY —— 记录

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-ENTRY-001 | P0 | 0 | 当创建记录时，系统应校验 `kind` 属 7 种、`fields` 符合该 kind 的 Zod schema，返回 id，正文经 collab 写入（注 2026-09-27 ADR-0016：kind 增 `custom`，须同给 `typeId`，见 REQ-ENTRY-018） | When `POST /entries {kind:'bug', fields:{severity:'x'}}` Then 422 `errors[].path = fields.severity`<br>When 合法 Then 201 `{id}`，`ydoc` 为空文档 | 01 §3.4–3.5 · 02 §9 | api |
| REQ-ENTRY-002 | P0 | 1 | 记录列表应不返回 `ydoc / pmJson / plain`，附 160 字 `excerpt`，游标分页 | When `GET /entries?spaceId=&kind=` Then 每项无正文列，`excerpt.length ≤ 160` | 02 §4 | api |
| REQ-ENTRY-003 | P0 | 1 | 可见性 `private` 仅作者、`space` 需空间可读、`workspace` 需工作区成员；记录必须属于一个空间，个人随笔落个人空间且 `visibility=private` | Given 他人 private When `GET /entries/:id` Then 404<br>~~When `POST /entries` 无 `spaceId` Then 422 `VALIDATION`~~（注 2026-09-24：与 01 §3.4「无空间语义的记录落作者个人空间」、02 §9 `spaceId?` 及 REQ-ENTRY-001 冲突，以缺省落个人空间为准；个人空间缺省 `private`）<br>When 在个人空间创建 `visibility:'workspace'` 或 `'space'` Then 422 | 01 §3.1 · 01 §3.4 · 01 §5 | api |
| REQ-ENTRY-004 | P0 | 1 | 记录的修改应限作者或空间 admin，删除限作者或 owner/admin | Given 同空间 member 非作者 When `PATCH /entries/:id` Then 403；Given space admin Then 200 | 01 §5 | api |
| REQ-ENTRY-005 | P1 | 2 | 当记录正文首次加载且为空时，系统应按 kind 注入模板（i18n 文案） | Given `kind=decision` When 首次打开 Then 正文含「背景 / 候选方案（表格）/ 决定 / 后果 / 参考」 | 03 §6 | collab |
| REQ-ENTRY-006 | P1 | 1 | 记录应支持固定与归档；固定项列表置顶 | When `PATCH {pinned:true}` Then `GET /entries?pinned=1` 含且排首 | 01 §3.4 · 02 §9 | api |
| REQ-ENTRY-007 | P0 | 1 | 软删记录应对所有人不可读，作者在回收站可见并可恢复，30 天后硬删 | When `DELETE` Then 他人与作者 `GET /entries/:id` 均 404；`GET /entries?deleted=1` 作者可见<br>When `POST /:id/restore` Then 恢复 | 01 §5 · 02 §5 | api |
| REQ-ENTRY-008 | P1 | 1 | `GET /entries/:id/preview` 应返回卡片数据（title、kind、excerpt、author、updatedAt、fields 摘要），受 `can(read)` 约束 | Given 无权 When 请求 Then 404 | 02 §9 · 03 §3.2 | api |
| REQ-ENTRY-009 | P1 | 2 | decision 的 `supersedesId` 应指向另一 decision，被取代者状态变为 `superseded` | When 创建 B `supersedesId=A` Then A `fields.status = superseded` | 01 §3.5 | api |
| REQ-ENTRY-010 | P0 | 0 | `pnpm xz rebuild-derived` 重建后的 `pm_json / plain / tsv / word_count` 应与实时派生逐字节一致 | Given 10 篇记录 When 清空派生列并重建 Then 与备份值相等 | 01 §7 · CLAUDE 不变量 1 | unit |
| REQ-ENTRY-011 | P1 | 1 | 记录应可在空间间移动，移动后可见性按目标空间重新判定 | When `PATCH {spaceId: S2}` Then S1 成员非 S2 成员 `GET` 404 | 04 §6 ⌘K 上下文命令 | api |
| REQ-ENTRY-012 | P1 | 2 | （2026-09-26 新增，ADR-0014）记录列表应可按位置定位：目录子树 `under`、大类 `groupId`（`none` = 未分类）、本人收藏 `favorite=1`、按 id `ids=`（最近打开）；每项带目录 `path` 与 `favorited`；`/entries` 左栏 = 全部 / 最近 / 收藏 / 已归档 / 个人随笔 / 大类 → 空间 → 目录树 | When `GET /entries?under=A` Then 含 A 及其子孙、子页 `path=[A]`；When 收藏后 `favorite=1` Then 只含本人收藏；When 左栏点目录节点 Then 只列该子树 | ADR-0014 · 02 §9 | api · e2e |
| REQ-ENTRY-013 | P1 | 2 | （ADR-0014）批量 `POST /entries/batch`（移动空间 / 加去标签 / 归档 / 取消归档 / 删除，≤ 100）应逐条鉴权，无权条目进 `failed` 而不影响其它条（注 2026-09-27 ADR-0016：op 增 retype / fields / pin / unpin，见 REQ-ENTRY-017） | When member 批量删 [自己的, owner 私人随笔] Then `ok=[自己的]`、`failed=[私人随笔]`；When 多选两篇点「归档」Then 两篇离开列表 | ADR-0014 | api · e2e |
| REQ-ENTRY-014 | P1 | 2 | （ADR-0014）记录 ⋯ 菜单：收藏 · 固定 · 导出 md / html · 归档 / 取消归档 · 删除（确认 + 撤销）；已归档记录只在「已归档」出现 | When 归档 Then 不在默认列表、在 `archived=1`；When 删除后点「撤销」Then 记录回到列表 | ADR-0014 | e2e |
| REQ-ENTRY-015 | P2 | 2 | （ADR-0014）只选一种带 status 的类型时可切看板（拖列 = 改 `fields.status`）；只选迭代 / 变更时可切时间线（按日期倒序、按月分组） | When Bug 看板把卡片拖到「已修复」Then `fields.status = fixed` | ADR-0014 | e2e |
| REQ-ENTRY-016 | P1 | 2 | （2026-09-27 新增，ADR-0016）记录页与空间记录页默认为列表视图（`view=cards` 为卡片，`view=table` 兼容），列含勾选 · 标题（目录路径 + 一行摘要）· 类型 · 状态 · 进度 · 标签 · 空间 · 更新时间；状态为色胶囊 + 文字，进度为进度条 + 百分比 | When 打开 `/entries?spaceId=` Then 渲染 `entry-table`；学习计划 `progress=40` 的行进度列显示 40%，状态列显示「学习中」 | ADR-0016 · 08 §2.8 | e2e |
| REQ-ENTRY-017 | P1 | 2 | （ADR-0016）批量编辑：列表勾选列常驻、表头全选，有选中即出操作条；`POST /entries/batch` 增 `retype {kind, typeId?}`（fields 按目标类型重建，保留仍合法的状态 / 进度；有必填属性的类型逐条失败）、`fields {set:{status?, progress?}}`（按类型校验，不合法进 failed）、`pin` / `unpin`；改状态按类型分组下发 | When 选两篇随笔批量改为 Bug Then 两篇 `fields = {severity:medium, status:open}`；When 改为 iteration Then 进 failed；When `fields {status:'open'}` 于自定义类型记录 Then `VALIDATION` | ADR-0016 · 02 §9 | api · e2e |
| REQ-ENTRY-018 | P1 | 2 | （ADR-0016）自定义记录类型（注 2026-09-30 ADR-0036：另有空间类型、类型可带字段定义，见 REQ-KB-015 · REQ-ENTRY-027 · 029）：`/entry-types` 增删改（名唯一、9 色、有序状态 0–12、状态名不含 `,（注 2026-09-27 ADR-0017：自定义类型归个人——只有本人能用来新建 / 改类型与管理，读者可见名 / 色 / 状态；名字同一人名下唯一） | =`），创建 = 非 guest，改删 = 管理员或创建者；记录 `kind=custom` + `typeId`，status 须在其状态列表内（新建默认第一项）；列表 `typeId=` 筛选，与 `kind` 同给为任一命中；改状态列表时 `renames` 同步记录、被移除的状态改为第一项 | When 建「读书笔记」[想读, 在读, 读完] 并新建该类型记录 Then `fields.status = 想读`；When `renames {在读: 阅读中}` Then 原「在读」的记录变「阅读中」；When member 改 owner 建的类型 Then 403 | ADR-0016 · 01 §3.4c | api · e2e |
| REQ-ENTRY-019 | P1 | 2 | （ADR-0016）删除自定义类型：其下全部记录（含回收站）转为随笔、清空 fields，同事务写审计 `entry_type.deleted`；内置类型不可删，管理员可隐藏（只影响筛选条与新建菜单）（注 2026-09-27 ADR-0017：内置类型「隐藏」改为所有者删除 / 恢复；删除可选 `moveTo`，见 REQ-ENTRY-020） | When 删类型 Then `GET /entries?kind=custom` 为空、审计含该类型名；When member `PUT /entry-types/builtin/review {hidden:true}` Then 403 | ADR-0016 | api · e2e |
| REQ-ENTRY-020 | P1 | 2 | （2026-09-27 新增，ADR-0017）内置类型由所有者统一维护：改名 / 改色（`null` = 恢复默认，与本人自定义类型重名 409）、删除（全员该类型记录含回收站转到另一内置类型 `moveTo`，缺省随笔，删随笔须给出）、恢复；已删除的内置类型不能新建或改成该类型；删自定义类型可选 `moveTo`（内置或本人的其它类型） | When owner 删「优化」`moveTo=plan` Then 其下记录变学习计划、`POST /entries {kind:optimize}` 422；When 恢复 Then 可再建；When member `PATCH /entry-types/builtin/optimize` Then 403；When 删内置类型 `moveTo=<自定义类型>` Then 422 | ADR-0017 · 01 §3.4c | api · e2e |
| REQ-ENTRY-021 | P1 | 2 | （2026-09-27 新增，ADR-0018）新建对话框顶部显示并可改「建在」：空间（可写的空间，含个人空间）› 目录位置（目录顶层 / 不放进目录 / 某页之下）；换空间回到目录顶层；模板推荐按所选空间 | When 在空间概览按 e Then 空间 = 该空间、位置 = 目录顶层；When 改为「不放进目录」再建 Then 新记录不在目录树 | ADR-0018 · 08 §2.8 | e2e |
| REQ-ENTRY-022 | P1 | 2 | （ADR-0018）按 `e` / 新建跟随当前页面：空间概览 / 目录 / 任务页 = 本空间目录顶层；空间记录页签 = 目录顶层或所选节点之下；记录页 = 同级（不在目录 → 不进目录）；按钮传入的一次性默认值只作用一次，不被记住；打开期间默认值冻结 | Given 在子页 C（父 P）When 按 e Then 位置 = P 之下；When 离开空间到 /entries 再按 e Then 位置 = 不放进目录（不沿用旧位置） | ADR-0018 | unit · e2e |
| REQ-ENTRY-023 | P1 | 2 | （ADR-0018）记录 ⋯ 菜单「新建子页面」（仅当本篇在目录里）与「新建关联记录」（同级 + 相关）；父页不在目录时服务端 422 | When 在目录里的 A 上「新建子页面」Then 新记录 parentId = A；When `POST /entries {parentId: 不在目录的记录}` Then 422 | ADR-0018 · REQ-KB-005 | api · e2e |
| REQ-ENTRY-024 | P1 | 2 | （2026-09-30 新增，ADR-0035）记录页标题下常显属性面板（DOM：标题 → 属性面板 → 文档栏 → 吸顶格式栏 → 正文）：两列网格（窄屏一列），每行 = 图标 + 属性名 + 彩色值（REQ-UI-044），空值显示「空」占位；点击值弹出编辑，改完即保存（600ms 合并 + `ifUpdatedAt`）；末行为标签；必填缺失标红但不拦；只读者只显示不弹；专注模式隐藏；类型无任何字段时不显示面板；右栏属性页签不再重复元数据与标签 | Given Bug 记录 When 打开 Then `entry-properties` 位于标题与文档栏之间、状态胶囊为红色「新建」；When 点状态选「已修复」Then 一条 `PATCH` 且胶囊变绿；Given 只读访客 When 点状态 Then 不弹出；Given 随笔（无字段）Then 无 `entry-properties`；When 进入专注 Then 面板隐藏 | ADR-0035 §B · 08 §2.9 | e2e |
| REQ-ENTRY-025 | P1 | 2 | （ADR-0035）属性面板底部「流转 N 次」，展开为竖向彩色时间线（新 → 旧）：每条 = 色点 + 「字段：[旧值胶囊] → [新值胶囊]」+ 操作者 · 相对时间（悬停绝对时间），新建起点显示「设为 [值]」；数据 `GET /entries/:id/field-changes` | Given 新建 Bug 后改为 pending 再改为 fixed When 展开流转 Then 3 条、首条为「待决策 → 已修复」且两胶囊分别为橙 / 绿 | ADR-0035 §B · ADR-0033 | e2e |
| REQ-ENTRY-026 | P1 | 2 | （ADR-0035）列表表格可就地编辑：状态 / 单选 / 日期 / 数字 / 文本单元格点击弹出编辑器，`PATCH /entries/:id` 带该行 `ifUpdatedAt`，乐观更新；409 提示「已被他人修改」并刷新列表；只读空间或无写权限的行不弹；在表格里改的值实时同步到打开中的记录页 | When 在空间首页表格把某 Bug 状态改为「待决策」Then 一条 `PATCH` 带 `ifUpdatedAt`、行内胶囊变橙；Given 该行已被他人改过 Then Toast 提示且列表刷新；Given viewer Then 单元格不可点 | ADR-0035 §D | e2e |
| REQ-ENTRY-027 | P1 | 2 | （2026-09-30 新增，ADR-0036）类型可定义字段（FieldDef）：`key` 系统生成 `^x[A-Z]{6}$`、`label` ≤ 20（同类型不重复）、`type` ∈ text · number · date · select · multiselect · checkbox · url · progress、`options` ≤ 30 且各带 9 色板色、`required` 只做提示；每类型 ≤ 20 个；值存 `entries.fields` 的 x 键；写入时未定义的 x 键静默丢弃、类型或选项不符 422；删字段同事务清掉该类型记录的该值；选项改名 / 删除同步记录值；以上批量改值写审计 `entry_type.fields_changed`、不写流转；类型的状态也可设色（`status_colors`） | When 给类型加 select「环境」[测试, 生产] 并 `PATCH /entries/:id {fields:{xABCDEF:'预发'}}` Then 422 `errors[].path = fields.xABCDEF`；When 带未定义的 `xZZZZZZ` Then 200 且该键不入库；When `optionRenames {xABCDEF:{测试:'测试环境'}}` Then 原值「测试」的记录变「测试环境」、审计含 `entry_type.fields_changed`；When 删该字段 Then 记录 fields 不再含 `xABCDEF`；When 第 21 个字段 Then 422 | ADR-0036 §A · §B · 01 §3.4c | unit · api · e2e |
| REQ-ENTRY-028 | P1 | 2 | （ADR-0036）内置类型保留代码字段，所有者可为其追加自定义字段（`entry_kind_overrides.field_defs`，工作区统一，规则同 REQ-ENTRY-027）；非所有者只读 | When owner `PATCH /entry-types/builtin/bug {fieldDefs:[{label:'版本', type:'text'}]}` Then 200、返回的字段带生成的 x 键，Bug 记录属性面板多出「版本」；When member 同操作 Then 403 | ADR-0036 §C.17 · 01 §3.4c | api · e2e |
| REQ-ENTRY-029 | P1 | 2 | （ADR-0036）类型列表按可见性过滤：空间类型只返回本人可见空间的（回收站里空间的类型隐藏），个人类型沿用 ADR-0017；每项带 `spaceId` `fieldDefs` `statusColors` `usable`。记录可用的类型 = 内置（未删除）+ 本人的个人类型 + 记录所在空间的空间类型；用别的空间的空间类型新建 / 改类型 → 422；修改他人记录的属性仍按该记录的类型校验 | Given 空间 A 有类型「需求」、B 的成员看不到 A When B 成员 `GET /entry-types` Then 不含「需求」；When 在空间 B `POST /entries {kind:'custom', typeId: A 的「需求」}` Then 422；When A 进回收站 Then A 的成员列表里也不含「需求」 | ADR-0036 §C · 02 §9 | api |

---

## 6b. TPL —— 记录模板（2026-09-25 新增，ADR-0011）

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 规范 | 层 |
|---|---|---|---|---|---|---|
| REQ-TPL-001 | P1 | 2 | 系统应提供 6 个内置模板：开发「产品 Bug 修复与迭代」（bug）、「产品优化」（optimize）；学习「学习计划」（plan）、「学习笔记」（note）、「学习周复盘」（journal）、「读书笔记」（note）；`GET /templates` 列出内置 + 本人个人 + 工作区模板，可按 `kind` / `spaceKind` 过滤，列表不含正文 | When `GET /templates` Then 含 6 个 `builtin:*`（dev 2 / learning 4）且无 `body`；`?spaceKind=learning` 不含 `builtin:bug-fix` | ADR-0011 §2 · 02 §9 | api |
| REQ-TPL-002 | P1 | 2 | 新增记录类型 `optimize`（优化）与 `plan`（学习计划），fields 严格校验（01 §3.5）；首次打开的默认骨架取对应内置模板 | When `POST /entries {kind:'optimize', fields:{status:'maybe'}}` Then 422；`plan` 合法 fields Then 201 | ADR-0011 §3 · 01 §3.5 | unit · api |
| REQ-TPL-003 | P1 | 2 | 新建记录可带 `templateId`：模板正文（占位符 `{{date}}` `{{user}}` `{{space}}` 已替换）一次性写成初始 ydoc；`builtin:blank` 为明确空白（不注入 kind 骨架）；不可见 / 不存在的模板 422。新建对话框提供模板选择，按当前空间类型推荐 | When 用 `builtin:bug-fix` 新建 Then 正文含「复现步骤」「迭代跟进」且无 `{{date}}`；When 在「学习」空间按 `e` Then 学习模板带「推荐」 | ADR-0011 §2 · 08 §3.2 | api · e2e |
| REQ-TPL-004 | P1 | 2 | 自定义模板：记录「属性」页「另存为模板」（取当前正文 + kind / fields）；个人模板仅本人可见可用；工作区模板全员可用、仅管理员可建；创建者或管理员可改名 / 改范围 / 删除；内置不可改删；设置 → 模板 页可预览与「用此模板新建」（改于 2026-09-28，ADR-0023：工作区模板改为非 guest 均可共享，见 REQ-TPL-006；验收「member 建 workspace 模板 403」作废） | Given member 另存个人模板 When owner 列表 Then 不含；owner `GET` Then 404；~~When member 建 workspace 模板 Then 403~~；删内置 Then 403 | ADR-0011 §2 · 01 §5 | api · unit · e2e |
| REQ-TPL-006 | P1 | 2 | （2026-09-28 新增，ADR-0023）非 guest 成员可把模板共享到工作区（新建时选或 `PATCH scope`），共享模板全员可见可用、只有作者与管理员可管；guest 不能共享；列表返回 `canShare` 与每行作者 `ownerName` | When member `POST /templates {scope:'workspace'}` Then 201，owner 列表中该行 `ownerName` = member 名、`canManage` = true；guest 同操作 Then 403，列表 `canShare` = false | ADR-0023 · 01 §5 | api · unit |
| REQ-TPL-007 | P1 | 2 | （ADR-0023）可直接改模板正文 / 类型 / fields / 说明，`PATCH` 必带 `ifUpdatedAt`；只改 kind 时 fields 重置为该 kind 默认；fields 按 kind 严格校验（注 2026-09-30 ADR-0036：kind 可为 custom + `typeId`，fields 可含所绑类型的自定义字段，见 REQ-TPL-011） | When 旧 `ifUpdatedAt` Then 409 `CONFLICT_STALE`；缺 `ifUpdatedAt` Then 422；`{kind:'bug'}` Then fields = `{severity:'medium',status:'open'}`；`{fields:{severity:'huge'}}` Then 422 | ADR-0023 · 02 §9 | api |
| REQ-TPL-008 | P1 | 2 | （ADR-0023）「复制到我的」：`POST /templates {fromTemplateId}` 把内置或可见模板复制成本人个人模板；看不到的 404；body / fromEntryId / fromTemplateId 三选一 | When 复制 `builtin:bug-fix` Then 201 个人模板、kind = bug、正文同源；复制他人个人模板 Then 404；同时给 body 与 fromTemplateId Then 422 | ADR-0023 | api |
| REQ-TPL-009 | P1 | 2 | （ADR-0023）共享模板被改回个人或删除时，同事务清掉引用它的空间默认模板；列表给 `spaceDefaults`，界面确认框写明受影响空间数 | Given 空间 A 默认模板 = T When T 改为 personal Then A.`defaultTemplateId` = null；删除同理 | ADR-0023 · ADR-0019 | api |
| REQ-TPL-010 | P1 | 2 | （ADR-0023）设置 → 模板：「新建模板」/「编辑」页（名称、说明、类型、适用空间、共享开关、正文编辑器，`Mod+S` 保存）；共享行显示「由 X 共享」；「复制到我的」「复制链接」（`/settings/templates?preview=<id>` 打开预览，需登录）；另存为模板可填说明与勾选共享 | When member 新建模板写入标题并共享 Then owner 在「工作区共享」组看到作者；owner「复制到我的」Then 「我的模板」出现副本；打开 `?preview=` 链接 Then 预览对话框显示正文 | ADR-0023 · 08 §2.13 | e2e |
| REQ-TPL-011 | P1 | 2 | （2026-09-30 新增，ADR-0036）模板可绑任一类型：`kind` 可为 `custom` + `typeId`（check 两者同在）；workspace 模板只能绑内置或空间类型，personal 模板还可绑本人个人类型；`fields` 可预填自定义字段（按所绑类型校验，规则同 REQ-ENTRY-027）；模板编辑页可就地编辑所绑类型的字段定义（有该类型管理权限时，提示影响全部记录）；所绑类型被删（含彻底删除空间）→ 模板同事务转随笔（`kind='note'`、`typeId=null`） | When 用绑「需求」类型、预填 `xABCDEF='生产'` 的模板新建 Then 记录 `kind=custom`、`fields.xABCDEF='生产'`；When workspace 模板绑本人个人类型 Then 422；When 删「需求」类型 Then 该模板 `kind='note'`、`typeId=null` | ADR-0036 §A.5 · §D.22 · 01 §3.4 | api · e2e |
| REQ-TPL-005 | P2 | 2 | 斜杠 `/模板` 打开模板选择（首项「按类型默认」），在光标处插入所选模板正文，不替换已有内容 | When 在正文输入 `/模板` 选「学习笔记」Then 光标处出现「核心概念」等标题，原有内容仍在 | 03 §11.1 | e2e |

## 6c. KB —— 空间（2026-09-26 新增，ADR-0012）

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 规范 | 层 |
|---|---|---|---|---|---|---|
| REQ-KB-001 | P1 | 2 | 大类：工作区预置「产品开发 / 技术学习规划 / 生活」；owner / admin 可增 / 改名 / 改色 / 排序 / 删除（同名 409）；删除大类不删空间（注 2026-09-27 ADR-0018：侧栏分区 ⋯ 与「管理大类」入口，见 REQ-KB-008） | When 新工作区 `GET /space-groups` Then 三个预置大类有序；When member `POST /space-groups` Then 403 | ADR-0012 · 01 §3.0 · 02 §9 | api · unit |
| REQ-KB-002 | P1 | 2 | 界面沿用「空间」（注 2026-09-26：曾改称「知识库」「分类」，ADR-0013 改回）；空间可归入大类（新建时选择 / 编辑 / 侧栏拖到另一大类）；侧栏与列表按大类分区（未分类最后、空大类可「在此新建」、分区可折叠）；空间类型可改；个人空间不入大类（注 2026-09-27 ADR-0018：空间卡片 ⋯ 也可移到大类；拖动时「未分类」始终可放） | When 在「生活」分区「在此新建」Then 新空间 `groupId` = 生活，侧栏出现在该分区；When 把空间拖到另一分区头 Then 一条 `PATCH /spaces/reorder {groupId}` | ADR-0012 · 08 §2.5 | api · unit · e2e |
| REQ-KB-003 | P1 | 2 | 进入空间默认为概览：产品型显示未关闭 Bug（按严重度计数）· 最近迭代 · 最新版本 · 决策与优化 · 最近更新；学习型显示学习计划进度 · 最近笔记；快捷新建带好类型与内置模板（注 2026-09-26：个人空间改为个人工作台，见 REQ-KB-007）（注 2026-09-30 ADR-0036：非个人空间首页改为按启用类型分区的页签 + 可编辑表格，本条写死的面板被 REQ-KB-016 取代；个人空间不受影响） | When 空间有 critical 未关闭 Bug 与已修复 Bug Then Bug 面板只列未关闭的、critical 计数 1；点「Bug」快捷 Then 新建对话框预选「产品 Bug 修复与迭代」 | ADR-0012 · 08 §2.5b | e2e |
| REQ-KB-004 | P1 | 2 | 记录列表：类型多选；按 fields 过滤（`fields=`）；卡片 / 表格视图；表格列为所选类型 fields 且可排序；卡片显示关键字段与标签；记录可编辑标签 | When `?kind=bug&view=table` 选严重度 high Then URL 带 `fields=severity=high` 且只剩 high；When `GET /entries?kind=bug,iteration` Then 两类都返回 | ADR-0012 · 02 §9 | api · e2e |
| REQ-KB-005 | P1 | 2 | 目录树：记录可嵌套（同空间）、拖拽 / 按钮移动（上移 / 下移 / 缩进 / 取消缩进 / 移出目录）、防环；不在目录的记录列在「其余记录」可加入；软删父页或移到别的空间时子页上移一级；记录页面包屑显示完整路径 | When A 移到自己的孙页下 Then 422；When 软删父页 Then 子页上移到其父级；When 在目录「新建子页」Then 新记录面包屑含父页 | ADR-0012 · 01 §3.4 · 02 §9 | api · unit · e2e |
| REQ-KB-006 | P1 | 2 | 目录层级表达（ADR-0015，参照简斋）：目录页 / 位置导航 / 个人首页空间目录的每级祖先有 1px 竖向引导线（位于该级展开指示中心，最近一级更深，当前行的最近一级为主色）；侧栏空间行在大类下缩进一级并带分区引导线；字重 L0 600 · L1 500 · 其余 400；折叠且有子项时行尾显示直接子项数；新展开子行淡入（减弱档无动画） | When 目录页展开三层 Then 第 2 级行有 2 条 `.xz-guide`、`data-depth=2`；When 折叠有 2 个子页的节点 Then 行尾计数为 2 | ADR-0015 · 04 §2.4 | unit · 手工 |
| REQ-KB-007 | P1 | 2 | 个人空间概览为个人工作台：主面板「空间目录」= 大类 → 空间 → 目录树（空间展开时才请求目录，状态本机保存），侧列个人记录与各空间最近更新，快捷新建随笔 / 笔记 / 计划；不显示 Bug / 迭代 / 版本面板 | When 打开 `/spaces/me-…/home` Then 出现「产品开发」「技术学习规划」大类及其空间；展开某空间 Then 请求 `GET /spaces/:id/tree` 并显示其目录；页面无 `kb-panel-bugs` | ADR-0015 · 08 §2.5b | e2e |
| REQ-KB-008 | P1 | 2 | （2026-09-27 新增，ADR-0018）大类就地管理：owner / admin 在侧栏「空间」标题旁打开「管理大类」，每个大类分区标题 ⋯ 可改名（Enter 保存）/ 改色（色块）/ 在此新建空间 / 删除；管理弹窗色块选色、Enter 保存；空间卡片 ⋯ 可移到任一大类或未分类；侧栏拖动时「未分类」始终可放 | When 分区 ⋯ 改名并回车 Then `PATCH /space-groups/:id` 且侧栏显示新名；When 卡片 ⋯ 选某大类 Then 该空间出现在该分区；When member Then 看不到「管理大类」与 ⋯ | ADR-0018 | e2e |
| REQ-KB-009 | P1 | 2 | （2026-09-27 新增，ADR-0019）就地「+」：侧栏空间行悬停「+」= 在该空间目录顶层新建；记录页位置导航与个人首页空间目录的节点悬停「+」= 作为该页子页新建；只对可写空间显示，窄屏常显 | When 点侧栏空间行「+」Then 新建对话框空间 = 该空间、位置 = 目录顶层；When 点目录节点「+」Then 位置 = 该节点之下 | ADR-0019 | e2e |
| REQ-KB-010 | P1 | 2 | （ADR-0019）空间默认类型（仅内置；注 2026-09-30 ADR-0036：也可为本空间的空间类型 `defaultTypeId`，见 REQ-KB-017）与默认模板（内置或工作区模板；个人模板 422）；在「编辑空间」设置；新建对话框打开时与切换空间时按目标空间预选，显式传入的类型 / 模板不被覆盖，已删除的内置类型不预选 | When `PATCH /spaces/:id {defaultTemplateId: 个人模板}` Then 422；When 设默认类型「决策」后在该空间按 e Then 类型预选决策 | ADR-0019 · 01 §3.1 | api · e2e |
| REQ-KB-011 | P1 | 2 | （2026-09-30 新增，ADR-0035）空间就地管理：侧栏空间行 ⋯ 与右键、`KbHeader` ⋯、空间卡片 ⋯ 打开同一菜单——改名（菜单内输入，Enter / 失焦保存）· 图标与颜色 · 移到大类 · 类型与字段 · 编辑空间 · 合并到… · 归档 / 取消归档 · 删除（先 `dryRun` 计数，确认框写明记录 / 任务数，Toast 可撤销）；`KbHeader` 标题可就地改名、点图标改图标与颜色；在该空间页内删除后跳 `/spaces`，归档后留在原页并显示归档横幅；菜单项按权限显示，以服务端为准 | When 在侧栏空间行右键选「改名」输入新名回车 Then `PATCH /spaces/:id` 且侧栏与页头同步；When 在 `KbHeader` 选颜色「绿」Then 空间图标块变绿；When 在该空间首页删除并确认 Then 落到 `/spaces`，点 Toast「撤销」Then 空间回到列表；Given member（非空间 admin）Then 菜单无「删除」「合并到…」 | ADR-0035 §A · 08 §2.5 | e2e |
| REQ-KB-012 | P2 | 2 | （ADR-0035）`/spaces` 页的大类分区头也有大类 ⋯ 菜单（与侧栏分区同一组件：改名 / 改色 / 在此新建空间 / 删除），仅 owner / admin | When owner 在 `/spaces` 分区头 ⋯ 改名回车 Then `PATCH /space-groups/:id`，侧栏同步；Given member Then 分区头无 ⋯ | ADR-0035 §A.3 · REQ-KB-008 | e2e |
| REQ-KB-013 | P1 | 2 | （ADR-0035）记录就地管理：目录树节点、表格行（含空间首页）⋯ 与右键打开同一菜单——改名（就地输入；表格标题单元格双击亦可）· 新建子页（仅在目录里的记录）· 置顶 / 取消置顶 · 归档 · 删除（Toast 可撤销）；记录页删除后跳父页，无父页则跳所在空间首页（个人空间的记录仍跳 `/entries`） | When 目录节点右键「改名」输入回车 Then 树与面包屑显示新名；When 表格行 ⋯「删除」Then 行消失，「撤销」后回来；When 在子页 C（父 P）的记录页删除 Then 落到 P；When 删空间 S 中不在目录的记录 Then 落到 S 首页 | ADR-0035 §A.4 ~ 6 | e2e |
| REQ-KB-014 | P1 | 2 | （2026-09-30 新增，ADR-0036）空间有启用类型清单（`enabled_kinds`，有序，元素为内置 kind 或 `type:<uuid>`）；`null` = 按 `space.kind` 推导默认（project / work：Bug · 迭代 · 变更 · 决策 · 优化 · 随笔；learning：学习计划 · 随笔 · 日志 · 复盘），个人空间 = 全部未删除内置类型 + 本人个人类型；读时忽略悬空项，删类型时从清单移除；在空间上下文里新建菜单 / 新建对话框 / 筛选条 / 批量改类型只列启用且本人可用的类型；改清单需空间管理权限 | Given 新 learning 空间 When `GET /spaces/:id` Then `enabledKinds = [plan, note, journal, review]`；When `PATCH {enabledKinds:['bug','note']}` 后在该空间按 e Then 类型下拉只有 Bug 与随笔；When `PATCH {enabledKinds:null}` Then 回到推导默认；Given member（非空间 admin）Then `PATCH enabledKinds` 403 | ADR-0036 §A.3 · 01 §3.1 | api · e2e |
| REQ-KB-015 | P1 | 2 | （ADR-0036）空间类型：`POST /entry-types {spaceId}` 建本空间专用类型，须 `space.manage` + 空间未归档 + 非个人空间（否则 403 / 422）；同空间内名唯一；只能用于本空间的记录；把这类记录移到别的空间（单条或批量）→ 422「先改类型」；合并空间时源空间类型改挂目标（重名加「（合并）」后缀）；彻底删除空间时引用其类型的记录转随笔、绑它的模板转随笔 | When 空间 admin 在 A 建「需求」Then 201 `spaceId = A`；When 在个人空间建 Then 422；When `PATCH /entries/:id {spaceId: B}`（「需求」记录）Then 422；When A 合并进 B Then「需求」`spaceId = B` 且出现在 B 的启用清单 | ADR-0036 §C · 01 §3.4c · §5 | api |
| REQ-KB-016 | P1 | 2 | （ADR-0036）空间首页 = 启用类型页签（按清单顺序，各带计数）+「全部」；选中类型显示状态概要胶囊（按状态计数、彩色，点击 = 按该状态筛选）+ 可编辑表格（列 = 该类型内置 + 自定义字段，REQ-ENTRY-026）+「新建」（预选该类型）；「全部」页签含最近更新；默认页签 = 空间默认类型或清单第一项；页签记在 `?type=`；个人空间首页保留空间目录（REQ-KB-007）；取代 REQ-KB-003 的写死面板 | Given 产品空间有未关闭 Bug 2 条 When 打开首页 Then 页签含「Bug 2」、概要胶囊「新建 2」为红；点该胶囊 Then 表格只剩新建；When 切到「决策」Then URL `?type=decision`，刷新后仍在「决策」；When 打开个人空间首页 Then 仍见「空间目录」 | ADR-0036 §E.28 · 08 §2.5b | e2e |
| REQ-KB-017 | P2 | 2 | （ADR-0036）空间默认类型可为本空间的空间类型（`default_type_id`，与内置 `default_kind` 互斥）；类型删除时置空；「编辑空间」的默认类型下拉合并两者 | When `PATCH /spaces/:id {defaultTypeId: 本空间「需求」}` 后在该空间按 e Then 类型预选「需求」；When 同时给 `defaultKind` 与 `defaultTypeId` Then 422；When 给别的空间的类型或个人类型 Then 422；When 删「需求」Then `defaultTypeId = null` | ADR-0036 §A.4 · REQ-KB-010 | api · e2e |

## 6d. BUG —— Bug 跟踪（2026-09-29 新增，ADR-0033）

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 规范 | 层 |
|---|---|---|---|---|---|---|
| REQ-BUG-001 | P1 | 2 | Bug 属性：状态四态 新建 / 待决策 / 已修复 / 不修复（`new\|pending\|fixed\|wontfix`，定义顺序 = 看板列）、优先级 P0 ~ P3（缺省 p2）、严重度、发现 / 解决日期、模块（≤ 40，不含 `, \| =`）；strict 校验；迁移把旧 `open` 改为 `new` | When `POST /entries {kind:'bug', fields:{status:'open'}}` Then 422 `fields.status`；When 不给 priority Then `fields.priority = p2`；When module 含逗号 Then 422 | ADR-0033 · 01 §3.5 | unit · api |
| REQ-BUG-002 | P1 | 2 | 服务端规范化 Bug 日期：发现日期缺省为操作者时区今天（从别的类型改来取创建日）且不得晚于今天；进入已关闭写解决日期（给出值优先），保持已关闭沿用，回到未关闭清除；解决日期不得早于发现日期；批量改状态 / 优先级同样生效 | When 新建 Then `foundAt` = 今天；When 改为 fixed Then `resolvedAt` = 今天；When 改回 new Then 无 `resolvedAt`；When `foundAt = 2999-01-01` Then 422；When 批量 `fields {set:{priority:'p0'}}` Then 生效 | ADR-0033 | api |
| REQ-BUG-003 | P1 | 2 | 记录列表可按优先级（p0 在前）与发现日期（`-foundAt`）排序，游标翻页不丢行、缺值排最后；只选 Bug 时排序下拉多出这两项 | When 4 条（含一篇随笔）`sort=priority&limit=1` 逐页取 Then 顺序 P0 · P1 · P3 · 随笔 | ADR-0033 · 02 §9 | api |
| REQ-BUG-004 | P1 | 2 | `GET /entries/stats`：与列表同口径条件按 1 ~ 2 个 fields 键分组计数，权限同列表；空间概览的 Bug 面板计数改用它（未关闭 = `status=new\|pending`，不再受前端 100 条限制） | When 按 priority 分组 Then p0 = 2；When member 跨空间统计 Then 不含其不可见空间的记录；When `groupBy=a-b` Then 422 | ADR-0033 · 02 §9 | api |
| REQ-BUG-005 | P1 | 2 | 记录页只选单一内置类型的表格可「分组」（状态 / 优先级 / 严重度 / 模块；在已加载行内分组，组头显示总数或「已加载 x / 共 n」）；新建对话框对 Bug 只显示 优先级 / 严重度 / 模块（模块带已用值候选）；批量条对所选 Bug 可「改优先级」；属性栏的解决日期只在已关闭时出现 | When `/entries?kind=bug&group=priority` Then 表格出现 P0 组头；When 新建对话框选 Bug Then 只有优先级 / 严重度 / 模块三项 | ADR-0033 · 08 §2.8 | e2e |
| REQ-BUG-006 | P1 | 2 | 状态 / 优先级 / 严重度的每次变化（含新建起点）同事务记入 `entry_field_changes`；`GET /entries/:id/field-changes` 受 `can(read)`；记录页属性栏「流转」按时间倒序显示（注 2026-09-30 ADR-0035：改为标题下属性面板底部的彩色时间线，见 REQ-ENTRY-025） | When 新建后改为 pending 再改为 fixed Then 流转含 `status:null→new`、`new→pending`、`pending→fixed`；不可见记录 404 | ADR-0033 · 01 §3.4d | api · e2e |
| REQ-BUG-007 | P1 | 2 | `GET /entries/bug-stats`：按周（遵从 weekStartsOn / 时区）或月分桶的 新增 / 关闭 / 期末未关闭存量、按优先级的修复天数（平均 / 中位）、未关闭账龄、区间内重开次数；桶数 ≤ 104 | Given 固定日期的 4 条 Bug When `from=2026-08-31&to=2026-09-13` Then 两桶 `{created:2,resolved:1,open:2}`、`{1,2,1}`，P0 修复天数平均 3；When 重开一次 Then `reopened = 1`；区间过长 422 | ADR-0033 · 02 §9 | api |
| REQ-BUG-008 | P1 | 2 | 记录页只选 Bug 时可切「统计」（`view=stats`）：概要卡、分布条（点击即按该值筛选并回到列表）、趋势（新增 / 关闭柱 + 存量线，悬停看数，可切表格）、修复时长、账龄；颜色只取 token | When 切到统计 Then 出现 `bug-stats`、趋势桶可聚焦显示提示；When 点优先级分布「P0」Then URL 带 `fields=…priority=p0` 且回到列表 | ADR-0033 · 08 §2.8 | e2e |
| REQ-BUG-009 | P1 | 2 | 保存视图：记录页当前筛选可「保存视图」（个人所有，他人 404；search 经 shared 白名单清洗、清洗后为空 422；空间视图须可读；每人 ≤ 50）；左栏「我的视图」点击即套用，⋯ 可改名 / 用当前筛选覆盖 / 删除 | When 保存「P0 未关闭」后点左栏该视图 Then URL 恢复为保存时的筛选；member 改 owner 的视图 Then 404 | ADR-0033 · 01 §3.4d · 02 §9 | api · e2e |
| REQ-BUG-010 | P1 | 2 | 查询块 `entryQuery` 节点：进全量正文白名单；纯文本 / tsv 只含标题；Markdown 导出 `> [查询：标题](<APP_URL>/entries?…)`、HTML 同链接；Markdown 源码对话框占位保留；query 只认记录页 search 白名单键 | When 导出含查询块的记录 Then Markdown 含指向记录页的绝对链接；When 源码对话框 Then 出现 `⟦xz-keep:n:entryQuery⟧` | ADR-0033 · 03 §3.2 | unit |
| REQ-BUG-011 | P1 | 2 | 斜杠 `/查询`（query / chaxun / bug）插入查询块，默认 = 本空间未关闭 Bug 按优先级的表格；块上可切 表格 / 统计（仅 Bug）/ 计数、打开记录页、设置（标题 · 空间 · 类型 · 枚举属性 · 排序 · 视图 · 条数，保存时一次写属性）；结果按阅读者权限实时查询 | When 在记录正文输入 `/查询` 回车 Then 出现查询块且列出本空间未关闭 Bug；When 设置里把视图改为计数 Then 显示总数 | ADR-0033 · 03 §11.1 | e2e |
| REQ-BUG-012 | P2 | 2 | 历史版本与模板预览里的查询块只显示标题与链接卡，不请求数据；只读访客看记录仍显示实时结果但不能改设置 | When 打开含查询块的历史版本预览 Then 查询块为 `data-static` 占位 | ADR-0033 | e2e |

> 注 2026-09-29（ADR-0033）：REQ-ENTRY-015 · 017、REQ-KB-003、REQ-TPL-007 验收里 Bug 的 `status:'open'` 自此为 `new`（旧数据由迁移 0021 改写）。

---

## 7. EDITOR —— 编辑器交互

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-EDITOR-001 | P0 | 1 | 编辑器应支持 03 §3.1 全部节点与标记，且不提供字体 / 字号 / 颜色标记（注 2026-09-28，ADR-0025：放开 9 色板文字色 / 背景色，见 REQ-EDITOR-031；任意色值、字号、字体仍不提供） | When 遍历斜杠菜单插入每种节点 Then 序列化 JSON 含对应 type；无颜色命令 | 03 §3.1 | unit · e2e |
| REQ-EDITOR-002 | P0 | 1 | 输入 `/` 应打开斜杠菜单，含：标题 1–4、列表、任务列表、代码块、表格、图片、附件、callout×4、mermaid、公式、分割线、目录、记录链接（注 2026-09-28，ADR-0025：空查询按分组给全部，有查询最多 8 条，见 REQ-EDITOR-026） | When 输入 `/表` Then 过滤出「表格」；Enter 插入 3×3 表 | 03 §3.2 · 04 §6 | e2e |
| REQ-EDITOR-003 | P0 | 1 | 代码块应预注册 20 种常用语言，其他语言按需加载 | When 选 `rust` Then 高亮出现且网络面板出现一次语言 chunk 请求 | 03 §9 | e2e |
| REQ-EDITOR-004 | P0 | 1 | 当粘贴或拖入图片时，系统应上传为附件并插入 `src=xz:attachment/<id>`，显示 `md` 变体与 blurhash 占位 | When 粘贴 PNG Then `POST /attachments` 201，节点 `src` 为 `xz:` 协议，渲染请求 `/attachments/:id/md` | 03 §3.2 · 03 §9 · 02 §7 | e2e |
| REQ-EDITOR-005 | P1 | 1 | 粘贴 Markdown 文本应转为节点；粘贴 HTML 只保留 schema 内节点；粘贴纯文本保持段落 | When 粘贴 `## 标题\n- a` Then heading + bulletList<br>When 粘贴含 `<font color>` HTML Then 无颜色标记 | 03 §1.3 · 03 §8 | unit · e2e |
| REQ-EDITOR-006 | P0 | 1 | IME 组合输入期间 inputRule 不得触发 | When CDP `Input.imeSetComposition` 输入「1.」Then 不转为有序列表，直到 commit | 03 §12 | e2e |
| REQ-EDITOR-007 | P1 | 2 | mermaid 节点应显示只读预览，点击进入 CM6 源码编辑；渲染失败显示错误；`securityLevel: 'strict'`；note 列表用 U+2060 规避（注 2026-09-28：ADR-0025 已实现，源码失焦 / 停顿 800ms 写回） | When 源码含错误 Then 显示错误框非空白<br>When note 内 3 条列表 Then 图正常渲染 | 03 §3.2 · 03 §12 | e2e |
| REQ-EDITOR-008 | P1 | 2 | 行内与块级公式应用 KaTeX 渲染，渲染在 idle 回调（注 2026-09-25：`$x$` / `$$ ` 输入规则已实现，KaTeX 渲染未做；注 2026-09-28：ADR-0025 已实现，含点击编辑） | When 输入 `$E=mc^2$` Then 渲染为公式 | 03 §3.1 · 03 §9 | e2e |
| REQ-EDITOR-009 | P1 | 2 | callout 应支持 `info/tip/warn/danger`，`:::warn` 快捷转换 | When 行首输入 `:::warn ` Then 变为 warn callout | 03 §3.2 | e2e |
| REQ-EDITOR-010 | P1 | 2 | 输入 `@` 应弹出当前空间可见成员候选；落库后写 `mentions` 并发 `mention.created` | When 选中成员 Then 节点 `mention(userId)`；2s 落库后 `mentions` 有行、`events` 有 kind | 03 §3.2 · 01 §3.9 | e2e · collab |
| REQ-EDITOR-011 | P1 | 2 | 输入 `[[` 应弹出记录候选，插入 entryLink，支持行内 / 标题 / 卡片三形态切换（注 2026-09-25：`[[` 触发候选已实现，三形态切换未做） | When 选中记录 Then `entryLink(entryId, mode:'inline')`；切卡片 Then `entryCard` 并请求 preview | 03 §3.2 | e2e |
| REQ-EDITOR-012 | P1 | 2 | 目录节点与 Aside 大纲应随标题实时更新，点击跳转 | When 新增 H2 Then 大纲 ≤ 200ms 出现 | 03 §3.2 · 04 §4 | e2e |
| REQ-EDITOR-013 | P0 | 1 | 编辑器快捷键应按 03 §11.2 表生效（Mod+B/I/U/E/K、Mod+Shift+1..4 标题、Mod+Shift+7/8/9 列表、Mod+Alt+C 代码块、Mod+Z 走 Yjs 撤销栈），且编辑器聚焦时全局快捷键禁用 | When 编辑器内按 `c` Then 输入字符 c，不新建任务<br>When Mod+Shift+2 Then 当前块变 H2 | 03 §11.2 · 04 §6 | e2e |
| REQ-EDITOR-014 | P0 | 1 | 编辑器 chunk 应独立懒加载，gzip ≤ 400KB；打开 3k 词记录到可编辑 ≤ 800ms | When `pnpm build` Then `check-budget` 通过；Playwright `performance.measure` ≤ 800ms | 03 §9 · 05 §5 | e2e |
| REQ-EDITOR-015 | P1 | 1 | 选中文本应出现浮动工具条（`glass-thick`、`full` 圆角） | When 选中 Then bubble menu 出现且 `backdrop-filter` 非 none | 06 §4 | e2e · visual |
| REQ-EDITOR-016 | P1 | 1 | 未知节点应渲染为 `unknownBlock` 保留原 JSON，不得静默丢弃 | Given pm_json 含 `type:'future'` When 打开 Then 显示占位块；保存后 JSON 仍含该节点 | 03 §3.3 | unit |
| REQ-EDITOR-017 | P1 | 1 | 单篇 `ydoc` 软限 10MB：提示并拒绝再插入附件节点；硬限 20MB：collab 拒绝 update，编辑器只读 | When 达 10MB Then 顶栏提示「文档过大，建议拆分」，插入图片被拒<br>When 达 20MB Then awareness 收到 `docTooLarge`，编辑器只读 | 03 §11.5 · 07 §5 | collab |
| REQ-EDITOR-018 | P1 | 1 | 链接协议白名单应为 `http https mailto xz:`，其他协议剥离 | When 粘贴 `javascript:alert(1)` 链接 Then 无 link 标记 | 03 §3.1 · 03 §12 | unit |
| REQ-EDITOR-019 | P1 | 2 | 语雀式 Markdown 识别（2026-09-25）：剪贴板 HTML 只是纯文本包装（无结构标签，或 VS Code / CodeMirror 标记）且文本像 Markdown 时，按 Markdown 转换；转换后 Toast「撤销为纯文本」；`Shift+Mod+V` 强制纯文本 | When 粘贴 VS Code 复制的 `### 标题` Then 生成 h3 且 Toast 可撤销；点撤销 Then 正文为原文 | 03 §11.3 · ADR-0011 | unit · e2e |
| REQ-EDITOR-020 | P1 | 2 | Markdown 源码编辑（2026-09-25，ADR-0011 §1）：CodeMirror 编辑正文源码，保存为一次性导入——逐块序列化、LCS 合并（未改块沿用原节点）、表达不了的块以 `⟦xz-keep⟧` 占位；保存前自动存「源码编辑前」标记快照；有其他协作者在线时禁用；正文含 Markdown 不能表达的格式时提示 | When 源码末尾加 `## 标题` 并保存 Then 正文出现 h2，未改段落的下划线仍在，快照多一条「源码编辑前」 | 03 §8 · ADR-0011 | unit · e2e |
| REQ-EDITOR-021 | P1 | 2 | 图片展示（2026-09-25）：选中图片浮出宽度 25/50/75/100% 与左 / 中 / 右对齐；图下可写图注（≤ 200 字，参与检索）；HTML 导出为 `figure` + `figcaption` | When 选中图片点 50% 与靠左并写图注 Then 节点 `displayWidth=50, align=left, caption` 落库 | 03 §3.2 | e2e |
| REQ-EDITOR-022 | P2 | 2 | 拖入 / 粘贴 `.md` 文件时询问「插入内容」或「作为附件」；插入走与粘贴同一 Markdown 管线 | When 粘贴 `note.md` 选「插入内容」Then 正文出现其标题与任务项 | 03 §11.3 | e2e |
| REQ-EDITOR-024 | P1 | 2 | （2026-09-28 新增，ADR-0025；注 2026-09-29，ADR-0029：右侧阅读胶囊 / 专注 / Markdown / 字数移到标题下文档栏，吸顶的只剩格式）记录正文上方应有吸顶工具栏：+ 插入、撤销 / 重做、清除格式（保留评论锚点）、段落格式（正文 / 标题 1–4）、加粗 / 斜体 / 下划线 / 删除线、更多（行内代码 / 上下标）、文字色 / 背景色、三种列表、引用、对齐、链接；右侧阅读胶囊、专注、Markdown 源码、字数；只读者只有右侧 | When 选段落格式「标题 2」Then 当前块变 h2 且按钮显示「标题 2」；When 清除格式 Then 选区无加粗；滚动长文 Then 工具栏仍在视口 | ADR-0025 §1 | e2e |
| REQ-EDITOR-025 | P1 | 2 | （ADR-0025）「+」插入面板：搜索 + 分区；表格为 8×8 尺寸网格；含链接、行内公式、Mermaid 五种预设 | When 选表格 2×4 Then 插入 2 行 4 列（首行表头）；搜「时序」Then 只剩时序图 | ADR-0025 §2 | e2e |
| REQ-EDITOR-026 | P1 | 2 | （ADR-0025）斜杠菜单空查询按分组列出全部命令（分组标题、可滚动、键盘跟随），有查询扁平最多 8 条 | When 输入 `/` Then 首个分组标题「基础」、命令数 > 20；再输入「表」Then ≤ 8 条且无分组标题 | ADR-0025 §2 · 03 §11.1 | unit · e2e |
| REQ-EDITOR-027 | P1 | 2 | （ADR-0025）块手柄单击打开菜单：转换为 / 包裹为 / 复制此块（去评论锚点）/ 删除此块 | When 段落「转为标题 2」Then 变 h2；复制 Then 两个；删除 Then 一个 | ADR-0025 §3 | e2e |
| REQ-EDITOR-028 | P1 | 2 | （ADR-0025）表格：列宽可拖；光标在表格内浮出表格工具条（插入 / 删除行列、合并拆分、表头行、删除表格） | When 表格工具条「下方插入行」Then 行数 +1；「删除表格」Then 无表格 | ADR-0025 §4 | e2e |
| REQ-EDITOR-029 | P1 | 2 | （ADR-0025）代码块头部：语言、行数、复制（HTTP 局域网可用） | When 点复制 Then 按钮显示已复制 | ADR-0025 §5 | e2e |
| REQ-EDITOR-030 | P1 | 2 | （ADR-0025）提示块按 kind 分色 + 图标；编辑态可切换类型、取消提示块 | When 切换为 warn Then `data-callout=warn`；取消 Then 内容回到普通段落 | ADR-0025 §6 | e2e |
| REQ-EDITOR-033 | P1 | 2 | （2026-09-29 新增，ADR-0032）表格工具条可分别开关表头行与表头列，按钮按下状态反映整表；表头列首格为 th（右侧加深竖线） | When 开表头列 Then 除首行外各行首格为 th 且按钮按下；关表头行 Then 首行其余格回到 td | ADR-0032 §1 | e2e |
| REQ-EDITOR-034 | P1 | 2 | （ADR-0032）代码块可折叠（露出前 3 行 +「展开全部 N 行」），只影响本人视图；默认行为为阅读偏好 `codeFold`：默认展开 / 默认折叠 / 超过 15 行自动折叠 | When 点折叠 Then `data-collapsed`；偏好「默认折叠」刷新 Then 初始折叠；「长代码折叠」且 7 行 Then 展开 | ADR-0032 §2 | e2e |
| REQ-EDITOR-035 | P1 | 2 | （ADR-0032）斜杠与「+」面板「时间」分组：今天日期 / 当前时间 / 日期时间，按本地时间插入普通文字 | When `/今天日期` Then 段落文本 `YYYY-MM-DD`；「当前时间」Then `HH:mm`；「日期时间」Then `YYYY-MM-DD HH:mm` | ADR-0032 §3 | unit · e2e |
| REQ-EDITOR-032 | P1 | 2 | （2026-09-28 新增，ADR-0026）吸顶工具栏放不下时换行，任何宽度下按钮都不被裁切（满栏 + 侧栏 + Aside 的 1280 宽也完整可见）（改于 2026-09-28，ADR-0028：改为两行固定——第一行格式始终一行、放不下整组收进「…」且可用，第二行阅读 / 保存；行数与高度不随版心宽度变化） | Given 1280 宽、满栏 Then 对齐 / 链接 / 颜色 / 引用 / 保存版本按钮完全在视口与工具栏内 | ADR-0026 §2 | e2e |
| REQ-EDITOR-031 | P1 | 2 | （ADR-0025）文字色 / 背景色只存 9 色板 key、渲染 `data-*`；非法值不落地；HTML 导出查表；工具栏与气泡条都可设；刷新后保留 | When 设文字色红 Then `[data-text-color=red]` 且无 style；toDOM 传 `hotpink` Then 不输出 | ADR-0025 §7 | unit · e2e |
| REQ-EDITOR-023 | P1 | 2 | （2026-09-27 新增，ADR-0019）`[[` 记录选择器：有输入、结果已到齐且无同名时出现「新建《q》并插入」→ 在当前空间新建随笔（作为当前记录子页；当前记录不在目录则也不进目录）并插入链接；搜索当前空间优先（先查本空间再查全部，合并去重） | When 在目录里的 A 正文输入 `[[新概念` 并选「新建」Then 正文出现该链接、新记录 parentId = A | ADR-0019 | e2e |

---

## 8. COLLAB —— 协同、离线、快照

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-COLLAB-001 | P0 | 0 | 两个客户端同时编辑同一记录应收敛一致 | When 两个 `browserContext` 各输入 200 字 Then 5s 内两端 `pm_json` 相等 | 03 §4 · 05 §11 | e2e |
| REQ-COLLAB-002 | P0 | 0 | WebSocket 连接应凭 `POST /collab/token { entryId }` 签发的 5 分钟票据鉴权（一票一文档，`jti` 不可重放，`Origin` 须为 `APP_URL`）；无票据 / 过期 / 重放 / 文档不匹配 / 无 `entry.read` 拒绝；无 `entry.write` 为只读 | When 无 token / 过期 / 签名错 Then 关闭码 4401<br>When 用 A 的票据连 B 或无 `entry.read` Then 4403<br>When 同一票据第二次连接 Then 4409<br>When 该用户并发连接超过 10 Then 4429<br>Given viewer Then `connection.readOnly = true`，编辑不落库<br>Given 票据过期 Then provider 重取并重连 | 03 §4.2 · 02 §9 · 07 §2.3 | collab |
| REQ-COLLAB-003 | P0 | 0 | 落库应防抖 2s、最长 10s，一并写 `ydoc / ydoc_version+1 / pm_json / plain / tsv / word_count` | When 连续输入 30s Then 落库次数 3–15 次，最终派生列与正文一致 | 03 §4.2 | collab |
| REQ-COLLAB-004 | P0 | 0 | 断网时编辑应保存到 IndexedDB，联网后自动同步，顶栏显示离线状态 | When `setOffline(true)` 输入 Then 状态「本地已保存」；`setOffline(false)` Then 5s 内服务端含该内容 | 03 §4.3 | e2e |
| REQ-COLLAB-005 | P0 | 0 | 打开记录应先从 IndexedDB 渲染再等待 `synced` | Given 本地有缓存 When 打开（网络限速 3G）Then 首次内容出现 ≤ 300ms | 03 §4.3 | e2e |
| REQ-COLLAB-006 | P0 | 0 | Y.Doc 前后端均 `gc: false` | When 单测构造 doc Then `doc.gc === false`；服务端同 | CLAUDE 不变量 7 · 03 §5 | unit |
| REQ-COLLAB-007 | P0 | 0 | 快照应在每 50 次落库、距上次 ≥ 30 分钟或手动标记时生成；保留最近 100 个 + 每日最后一个 90 天，标记的永久 | When 触发 60 次落库 Then `entry_snapshots` 1 行；`POST /entries/:id/snapshots {label}` Then 新行带 label | 03 §5 · 02 §9 | collab · api |
| REQ-COLLAB-008 | P1 | 2 | 历史面板应~~可选两个快照显示 diff~~列出全部快照（按天分组），点开只读预览，可「对比当前」（顶层块 LCS：绿 = 恢复后出现、红删除线 = 恢复后消失）（注 2026-09-25：两快照互比改为「快照 ↔ 当前」，恢复前真正关心的是这一对）；「恢复」为在当前文档应用反向变更（collab 直连在线文档，未变块保留 CRDT 身份；恢复前自动存「恢复前自动保存」标记快照；审计 `entry.restored`；需 `entry.write`） | When 恢复到快照 A Then 内容等于 A 且 `ydoc_version` 递增、快照数不减、在线端实时同步<br>Given viewer When 恢复 Then 403 | 03 §5 · 02 §9 | unit · collab · e2e |
| REQ-COLLAB-009 | P0 | 0 | 派生失败不得阻塞 `ydoc` 落库；失败写 `derived_error` 并入队重试 | Given 派生函数抛错 When 落库 Then `ydoc` 已更新，`derived_error` 非空且 `derived_at` 为空，队列有 `derive.retry` 作业<br>When 重试成功 Then `derived_error` 清空、`derived_at` 更新 | 03 §4.2 · 01 §3.4 | collab |
| REQ-COLLAB-010 | P1 | 0 | 远端光标应显示用户名与颜色，颜色按 userId 哈希取色板（ADR-0010 起 9 色） | When 两端在线 Then 各自看到对方光标 | 03 §4.3 · 04 §2.1 | e2e |
| REQ-COLLAB-011 | P1 | 1 | Hocuspocus 重启期间客户端应指数退避重连，本地编辑不丢，重连后合并 | When 重启 collab 进程时输入 100 字 Then 重连后服务端含全部 | 03 §4 | e2e |
| REQ-COLLAB-012 | P1 | 1 | 当 IndexedDB 不可用或配额满时，系统应降级为仅内存并提示「离线保存不可用」 | Given 隐私模式 When 打开 Then 提示出现，编辑仍可同步 | 03 §4.3 · 08 §4 | e2e |
| REQ-COLLAB-013 | P1 | 1 | 同一浏览器多标签页打开同一记录应共享 IndexedDB 并合并，不出现重复内容 | When 两标签各输入 Then 两标签内容一致且无重复段 | 03 §4.1 | e2e |
| REQ-COLLAB-014 | P0 | 0 | 加载文档时应执行 schema 迁移并 bump `editor_schema_version` | Given 旧版本文档 When `onLoadDocument` Then 列值 = `EDITOR_SCHEMA_VERSION` | 03 §3.3 · 01 §3.4 | collab |
| REQ-COLLAB-015 | P0 | 0 | 落库应发出 `entry.updated`；5 分钟内同 entry 同 actor 已有未处理行时 UPDATE 其 payload 而非新增；仅进活动流不通知 | When 10 分钟内同一人 100 次落库 Then `events(entry.updated)` ≤ 2 行且最新一行 `payload.ydocVersion` 为最终值，`notifications` 0 行 | 03 §4.2 · 01 §4.1 | collab |
| REQ-COLLAB-017 | P1 | 2 | （2026-09-28 新增，ADR-0026）Ctrl/⌘+S 或工具栏「保存版本」：经协同连接请服务端以当前权威文档落库并同事务打快照；版本以本地时间 `YYYYMMDD-HHmmss` 命名、永久保留；与上一手动 / 带标记版本相同则提示没有新改动；5s 节流；只读 / 离线提示；坏请求不影响服务 | When 输入后按 Ctrl+S Then 提示「已保存版本 20260928-143025」且历史出现同名项；再按 Then「没有新改动」；只删字 Then 仍生成；viewer Then 只读 | ADR-0026 §4 · 03 §5 | collab · e2e |
| REQ-COLLAB-018 | P1 | 2 | （ADR-0026）给任一版本打标记 / 改标记 / 清除（`PATCH /entries/:id/snapshots/:sid {label}`，需 entry.write）；带标记显示标记名与时间戳；手动保存与带标记的版本 gc 不删 | When 打标记「发布前」Then 历史显示「发布前」+ 时间戳；清除 Then 回到时间戳名；label 空 / > 80 Then 422 | ADR-0026 §6 · 07 §3 | api · e2e |
| REQ-COLLAB-016 | P0 | 1 | 当记录可见性、空间成员或成员状态变化使某连接失去 `entry.read` 时，collab 应在收到 `entry.access_changed` / `user.revoked` 广播后 1s 内以 4403 断开该连接 | Given U 正在编辑 E When 作者把 E 改为 `private` Then U 的 WS 1s 内以 4403 关闭；U 重取票据 Then `POST /collab/token` 404 | 03 §4.2 · 07 §2.3 | collab |

---

## 9. LINK —— 双向链接

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-LINK-001 | P1 | 2 | 正文中的 entryLink 应在落库时同步为 `links(kind=mentions)`，删除节点则删行（注 2026-09-26 ADR-0012：已实现，同步在 writeEntryDerived，entryCard 同样计入） | When 插入链接到 B 并落库 Then `links` 有 A→B；删除后行消失 | 01 §3.6 · 03 §4.2 | collab |
| REQ-LINK-002 | P1 | 2 | 反链面板应只查 `links` 表且按 `can(read)` 过滤（注 2026-09-26：已实现） | Given C 私有链接到 B When B 作者看反链 Then 不含 C | 01 §3.6 · 02 §9 | api |
| REQ-LINK-003 | P1 | 2 | 手动链接应支持 5 种 kind，重复返回 409（注 2026-09-26：已实现；约定「迭代 / 变更 → Bug」`resolves` = 本期修复） | When `POST /links` 同五元组两次 Then 第二次 409 `CONFLICT_UNIQUE` | 01 §3.6 | api |
| REQ-LINK-004 | P2 | 2 | 外链应仅存 URL 与用户填写标题，一期不抓取远端内容 | When `POST /links {toType:'external', externalUrl}` Then 无出站请求 | 01 §3.6 · ADR §5 · 07 §2.5（抓取属二期） | api |
| REQ-LINK-005 | P1 | 2 | 任务与记录的互链应在 Aside 显示，点击可 Peek（注 2026-09-26：记录侧「关联」页签已实现；任务详情侧未做） | When 任务链接记录 Then 任务详情 Aside 列出记录卡片 | 04 §4 | e2e |
| REQ-LINK-006 | P1 | 2 | （2026-09-27 新增，ADR-0018）新建并关联：`POST /entries {linkFrom: {entryId, kind}}` 同事务建 `links(entryId → 新记录)`；kind ∈ relates / blocks / caused_by / resolves（mentions 422）；源不可读 404、不可写 403 且记录不落库；关联面板「+ 新建并关联」按所选类型打开对话框 | When owner 以 `linkFrom {A, blocks}` 新建 B Then `GET /links?fromId=A` 含 → B（blocks）；When member 对只读的 A 这样做 Then 403 且空间记录数不变 | ADR-0018 · 02 §9 | api · e2e |

---

## 10. TAG —— 标签

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-TAG-001 | P1 | 1 | 标签名在工作区内唯一，颜色为色板 token 名（ADR-0010 起 9 色）（注 2026-09-27 ADR-0017：名字改为同一人名下唯一） | When 重名 Then 409；`color:'#abc'` Then 422 | 01 §3.7 · 04 §2.1 | api |
| REQ-TAG-002 | P1 | 1 | 任务与记录列表应支持 `?tag=` 筛选（多值逗号）（注 2026-09-27 ADR-0017：只按本人的标签筛选） | When `GET /tasks?tag=a,b` Then 只含带 a 或 b 的任务 | 02 §4 | api |
| REQ-TAG-003 | P1 | 1 | TagPicker 应支持输入即创建（注 2026-09-27 ADR-0017：建的是本人的标签；guest 不可） | When 输入不存在的名并 Enter Then `POST /tags` 并选中 | 04 §5 | e2e |
| REQ-TAG-004 | P1 | 2 | （2026-09-26 新增，ADR-0014）标签改名 / 改色 / 删除 / 合并限管理员或创建者（`tag.manage`），列表每项带 `canManage`；`/settings/tags` 可新建选色；TagPicker 新建可选色（注 2026-09-27 ADR-0017：改为只有本人可管，见 REQ-TAG-007） | Given member 建的标签 When 本人 PATCH Then 200；When 改 owner 建的 Then 403 | ADR-0014 · 01 §5 | api · e2e |
| REQ-TAG-005 | P1 | 2 | （ADR-0014）`POST /tags/:id/merge {intoId}` 把源标签的任务 / 记录关联并入目标（去重）后删除源标签 | Given 记录同时带 A、B When A 合并到 B Then 该记录只带 B 一次，A 不存在 | ADR-0014 | api |
| REQ-TAG-006 | P1 | 2 | （ADR-0014）记录页与搜索页应支持标签多选筛选（`tag=a,b` 任一命中；`/search` 的 `tag` 同改为多值）（注 2026-09-27 ADR-0017：只按本人的标签筛选） | When `GET /search?q=x&tag=a,b` Then 只含带 a 或 b 的记录 | ADR-0014 · 02 §4 | api · e2e |
| REQ-TAG-007 | P1 | 2 | （2026-09-27 新增，ADR-0017）标签按人隔离：非 guest 可建自己的标签，只有本人能看到、使用、筛选、搜索、改名 / 改色 / 合并 / 删除（管理员不例外）；同一人名下不重名，不同人可同名；共享记录 / 任务上各打各的，整组替换只动本人的；打别人的标签 422 | Given owner 与 member 在同一篇记录上各打一个标签 When 各自 `GET /entries/:id` Then 只见自己的 `tagIds`；When owner `PATCH {tagIds}` Then member 的标签仍在；When member `PATCH /tags/<owner 的>` Then 404 | ADR-0017 · 01 §3.7 | api · e2e |

---

## 11. ATTACH —— 附件

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-ATTACH-001 | P0 | 1 | 上传应按魔数校验 MIME 白名单、按 mime 校验大小上限（图片 20MB / PDF 100MB / 其他 50MB） | When 上传 21MB PNG Then 413 `PAYLOAD_TOO_LARGE`<br>When `.exe` 或扩展名 `.png` 但内容为 HTML Then 415 `UNSUPPORTED_MEDIA`，磁盘无残留 | 02 §7 · 07 §2.4 | api |
| REQ-ATTACH-002 | P0 | 1 | 同一 owner 内相同 sha256 的上传应返回既有记录；跨用户不去重 | When 同人同文件两次 Then 第二次 201 同 id，磁盘 1 份<br>When 两个用户上传同文件 Then 两条 `attachments` 行 | 02 §7 · 07 §2.4 | api |
| REQ-ATTACH-003 | P0 | 1 | 下载应经 `can(attachment.read)`（跟随 target），支持 `Range` 206、`ETag`、`Cache-Control: private` | Given 无权 Then 404；带 `Range: bytes=0-99` Then 206 长度 100 | 02 §7 | api |
| REQ-ATTACH-004 | P0 | 1 | 图片应生成 `thumb(320) / md(1280)` 变体与 `blurhash / width / height` | When 上传 4000px 图 Then 响应含 `variants.md`，`GET /:id/md` 宽 1280 | 01 §3.8 · 03 §9 | api |
| REQ-ATTACH-005 | P0 | 1 | SVG 上传应经 sharp 栅格化为 PNG 存储，原件丢弃 | When 上传含 `<script>` 的 `.svg` Then 201，`mime = image/png`，存储文件无脚本 | 02 §7 · 07 §2.4 | api |
| REQ-ATTACH-006 | P1 | 1 | 无归属附件 7 天后清理；软删对象硬删时删除其附件文件 | Given 7 天前无 target 附件 When 清理 job Then 行与文件消失 | 01 §3.8 · 01 §1 | unit |
| REQ-ATTACH-007 | P1 | 1 | 头像上传应复用附件管线并方形裁切 | When `POST /me/avatar` 3:2 图 Then 产出 1:1 | 02 §7 | api |
| REQ-ATTACH-008 | P1 | 1 | 上传中断后重试应因同 sha256 幂等 | When 模拟中断再上传 Then 无重复行 | 02 §7 | e2e |
| REQ-ATTACH-009 | P1 | 1 | 上传限流 30/min | When 第 31 次 Then 429 | 02 §2 | api |
| REQ-ATTACH-010 | P0 | 1 | `data/` 目录不得被 Caddy 或静态服务直出 | When 请求 `/data/uploads/...` 与 `/uploads/...` Then 404 | 05 §7 | e2e（infra） |
| REQ-ATTACH-011 | P1 | 1 | 无 target 的附件应仅 `owner_id` 本人可读 | Given U1 上传未插入正文的附件 When U2 `GET /attachments/:id` Then 404；U1 Then 200 | 07 §2.2 · 01 §5 | api |
| REQ-ATTACH-012 | P1 | 2 | 附件类型扩展（2026-09-25）：docx / xlsx / pptx 按 zip 内 `[Content_Types].xml` + 主部件识别（改名的普通 zip 仍为 zip）；`.csv` 为 `text/csv`；代码 / 日志等 UTF-8 文本为 `text/plain`；音视频不支持 | When 上传真实 docx Then mime 为 wordprocessingml；When 把 zip 改名 .docx Then `application/zip` | 07 §2.4 · ADR-0011 | unit |
| REQ-ATTACH-013 | P1 | 2 | 附件卡片按类别显示图标；文本 / 代码 / JSON / csv（表格，前 200 行）/ Markdown / docx（mammoth → 白名单净化）可在应用内预览，PDF 在新标签页打开；只读前 1 MB 文本 | When 插入 csv 点预览 Then 表格表头与行数正确 | 03 §3.2 · 07 §2.5 | e2e |

---

## 12. COMMENT —— 评论与提及

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-COMMENT-001 | P1 | 1 | 可读目标的用户（含 guest viewer）应可评论任务与记录 | Given guest 可读 When `POST /comments` Then 201 | 01 §5 · 02 §9 | api |
| REQ-COMMENT-002 | P1 | 1 | 记录内锚定评论应通过 `comment(threadId)` 标记关联；标记被删后线程标 `orphaned` 仍在侧栏 | When 删除被标记文本并落库 Then 线程 `orphaned=true`，侧栏仍列出 | 03 §3.2 · 01 §3.9 | collab · e2e |
| REQ-COMMENT-003 | P1 | 1 | 解决 / 取消解决应限目标作者、评论作者（guest 除外）或 owner/admin | Given 无关 member When `POST /comments/:id/resolve` Then 403；Given guest 评论作者 Then 403 | 01 §5 | api |
| REQ-COMMENT-004 | P1 | 1 | 评论输入用 liteKit 子集（无 heading / callout / image），Enter 提交、Shift+Enter 换行 | When 输入 `/标题` Then 无候选；Enter Then 发送 | 03 §7 | e2e |
| REQ-COMMENT-005 | P1 | 1 | 新评论应向目标作者与线程参与者（除操作者）发 `task.commented / entry.commented` | When A 评论 B 的任务 Then B 收到；A 不收 | 01 §4 | api |
| REQ-COMMENT-006 | P1 | 1 | 评论中 @ 提及应写 `mentions` 并发 `mention.created`，扇出前经 `can(read)` 过滤 | When 提及无权读该记录的 U Then `mentions` 有行但 U 无通知 | 01 §3.9 · 01 §4 | api |
| REQ-COMMENT-007 | P1 | 1 | 软删评论应显示「已删除」占位，保留线程结构 | When `DELETE /comments/:id`（有回复）Then 列表含占位项与其回复 | 01 §3.9 | api · e2e |

---

## 13. SEARCH —— 检索

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-SEARCH-001 | P0 | 1 | `GET /search?q=&types=&spaceId=&limit=` 应返回分组结果并带 `ts_headline` 高亮片段 | When 搜「缓存」Then `groups.entries[0].highlight` 含 `<mark>缓存</mark>` | 02 §4 | api |
| REQ-SEARCH-002 | P0 | 1 | 中文应经 jieba 分词写入 `tsv`，词级命中 | Given 正文「关于缓存策略的决定」When 搜「缓存 决定」Then 命中 | ADR §4.3 · 01 §3.4 | api |
| REQ-SEARCH-003 | P0 | 1 | 标题与标签应有 `pg_trgm` 子串兜底 | When 搜「存策」Then 标题含「缓存策略」的记录命中 | ADR §4.3 | api |
| REQ-SEARCH-004 | P0 | 1 | 搜索结果应经 `visible*Where` 过滤 | Given 他人 private 含关键词 When 搜 Then 不出现 | 01 §5 不变量 3 | api |
| REQ-SEARCH-005 | P1 | 1 | 搜索限流 60/min；1 万条数据 P95 ≤ 150ms | When 第 61 次 Then 429；基准测试 P95 ≤ 150ms | 02 §2 · 02 §4.1 | api |
| REQ-SEARCH-006 | P1 | 1 | ⌘K 输入文字即切换为搜索直达，Enter 打开首项 | When ⌘K 输入「缓存」Then 候选为搜索结果 | 04 §6 | e2e |

---

## 14. NOTIF —— 事件、通知、SSE、邮件

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-NOTIF-001 | P0 | 0 | 事件应与业务写入同事务写入 `events`；`outbox.drain` 每 5s 拉取并标 `processed_at` | When 业务事务回滚 Then 无事件行<br>When 写入后 Then ≤ 6s `processed_at` 非空 | 01 §3.10 · CLAUDE 不变量 3 | api · unit |
| REQ-NOTIF-002 | P0 | 0 | in_app 通知应创建 `notifications` 行并更新未读数；SSE 在 2s 内推送 `notification` 事件 | When 指派任务 Then 指派人 SSE 收到 `notification` ≤ 2s，`GET /notifications?unread=1` 含 | 01 §3.11 · 02 §6 | api · e2e |
| REQ-NOTIF-003 | P0 | 0 | SSE 每用户最多 3 条连接（超出关最旧）、25s 心跳、每帧带单调递增 `id`（每用户 seq）、`Last-Event-ID` 补发 5 分钟内全部类型事件、断线指数退避重连 | When 断开 10s 重连带 `Last-Event-ID` Then 收到期间的 `notification` 与 `invalidate` 帧且 `id` 连续<br>When 打开第 4 个标签页 Then 第 1 条连接被服务端关闭 | 02 §6 · 07 §5 | api · e2e |
| REQ-NOTIF-004 | P0 | 1 | `invalidate` 事件的 `keys` 应与前端 Query key 同构，收到后对应列表重取 | When 他人改任务 Then 本端 ≤ 2s 列表更新，无整页刷新 | 02 §6 · 02 §11 | e2e |
| REQ-NOTIF-005 | P0 | 1 | 通知中心应分「全部 / 提及 / 未读」，点击跳转并标已读，支持全部已读与归档 | When 点击通知 Then 跳转 url 且 `read_at` 非空；`POST /notifications/read-all` Then 未读 0<br>When `GET /notifications?kind=mention.created` Then 只含提及 | 04 §6 · 02 §9 | e2e · api |
| REQ-NOTIF-006 | P0 | 1 | 偏好页应按事件种类设置通道与摘要档；缺行用 01 §4 默认表 | When `PUT /notifications/preferences {task.completed: {channels:[]}}` Then 不再收到该类 | 01 §3.11 · 01 §4 | api |
| REQ-NOTIF-007 | P1 | 1 | 同一 `(user, target, kind)` 5 分钟内应合并为一条通知；操作者不收自己触发的通知 | When 同人 3 分钟内评论 3 次 Then 目标作者 1 条通知，`body` 更新 | 01 §4 | api |
| REQ-NOTIF-008 | P1 | 2 | Web Push 应用 VAPID；端点 410 时删除订阅 | When `POST /notifications/push-subscriptions` Then 后续通知调用推送；模拟 410 Then 行删除 | 01 §3.11 · ADR §9.2 | api |
| REQ-NOTIF-009 | P1 | 0 | 邮件通道应经 SMTP（dev Mailpit）发送 react-email 模板；邀请邮件为 Phase 0 验收 | When 创建邀请 Then Mailpit 收到含链接的邮件 | ADR §9.2 · 05 §11 | e2e |
| REQ-NOTIF-010 | P1 | 2 | `digest=daily` 的通道应在用户时区 08:00 汇总一封 | Given 3 条待摘要 When cron Then 1 封邮件含 3 条 | 01 §4 | unit |
| REQ-NOTIF-011 | P0 | 1 | 扇出前应对每个接收者做 `can(read)`，无权者跳过 | Given 提及无权用户 Then 无 notification 行 | 01 §4 | api |
| REQ-NOTIF-012 | P1 | 1 | 01 §4 表中每种有默认通道的事件，其默认接收者与通道应逐一成立 | When 对 01 §4 中有默认通道的每种 kind 各触发一次 Then `notification_deliveries` 的 channel 集合等于表中默认通道（`sse` 不落投递行） | 01 §4 | api |
| REQ-NOTIF-013 | P2 | 2 | 空间在线成员变化时应推送 `presence`；「在线」= SSE 连接带 `?spaceId=` 注册且 60s 内有心跳 | When 第二人打开空间 Then 第一人 SSE 收到 `presence` 含两人；断开 60s 后 Then 移除 | 02 §6 | e2e |
| REQ-NOTIF-014 | P0 | 0 | 路由层与前端不得直接创建通知 | When 静态扫描 `src/server/routes` 与 `src/client` Then 无 `notifications` 表写入与邮件发送调用 | CLAUDE 不变量 3 | unit |
| REQ-NOTIF-015 | P0 | 1 | 通知只能由本人读取与标记 | Given U1 的通知 N When U2 `POST /notifications/N/read` 或 `GET /notifications` Then 404 / 列表不含 N | 01 §5 | api |
| REQ-NOTIF-016 | P0 | 0 | 扇出应幂等：同一 `(user_id, event_id)` 至多一条 notification | When `notify.fanout` 对同一事件重跑 3 次 Then `notifications` 行数不变，`notification_deliveries` 不重复发送 | 01 §3.11 · 07 §2.8 | api |
| REQ-NOTIF-017 | P1 | 2 | 通知正文中的时间与大小应以人类可读格式呈现：时间 `M/D HH:mm`（Asia/Shanghai），大小 `B / KB / MB / GB`；不直出 ISO 字符串与字节数 | When 渲染 `system.export_done { sizeBytes: 382827, expiresAt: ISO }` Then 正文为「374 KB · 10/1 19:47 前可下载」；非法值原样返回 | 01 §4.1 | unit |

---

## 15. EXPORT —— 导出、导入、备份出口

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-EXPORT-001 | P0 | 1 | `POST /exports` 应返回 202 `{jobId}`；`GET /jobs/:id` 可查进度；完成发 `system.export_done` | When 请求 Then 202；轮询到 `completed` 有 `resultUrl`（= `GET /jobs/:id/download`，仅发起人 200，他人 404）；发起人收到通知 | 02 §8 · 02 §9 | api |
| REQ-EXPORT-002 | P0 | 1 | 全量导出应为 Markdown + YAML frontmatter（id/kind/fields/tags/links）+ `assets/`，任务与周期为 JSON，打成 zip，Obsidian 可开 | When 解压 Then 目录 `<space>/<kind>/<date>-<slug>.md`，frontmatter 字段齐全，图片链接指向 `assets/` | 03 §8 | unit · api |
| REQ-EXPORT-003 | P1 | 1 | 单篇 Markdown 导出应明示有损（评论标记丢弃、callout→`:::`、mermaid→fence） | When 导出含评论标记记录 Then 对话框提示有损；输出无评论痕迹 | 03 §8 | unit · e2e |
| REQ-EXPORT-004 | P2 | 3 | Markdown zip 导入应一次性转为新记录，不建立同步关系（二期，不验收） | When `POST /imports/markdown` Then 每个 md 一篇 Entry，`ydoc` 由 `prosemirrorJSONToYDoc` 生成 | 03 §8 · 02 §9 | api |
| REQ-EXPORT-005 | P0 | 0 | `pnpm xz backup` 应产出 age 加密的 `pg_dump`，每日 03:00 cron 执行，失败发 `system.backup_failed` | When 运行 Then `data/backups/xz-YYYYMMDD.dump.age` 存在且可用私钥解密恢复<br>When 模拟失败 Then admin 收到通知 | 05 §8 · 01 §4 | unit |
| REQ-EXPORT-006 | P1 | 1 | HTML 导出应内联 04 排版 CSS，用于邮件与打印 | When `format=html` Then 单文件、无外链 CSS | 03 §8 | unit |
| REQ-EXPORT-007 | P1 | 1 | 作业失败应重试 3 次指数退避，最终 `failed` 写 `audit_log` | Given 处理函数持续抛错 Then 4 次尝试后 `status=failed`，audit 有行 | 02 §8 | unit |
| REQ-EXPORT-008 | P0 | 1 | 导出内容应按发起人 `visible*Where()` 过滤；`scope=workspace` 仅 owner/admin | Given member 发起 `scope=space` When 导出 Then zip 不含他人 private 记录<br>Given member When `POST /exports {scope:'workspace'}` Then 403 | 07 §2.4 · 02 §8 | api |

---

## 16. UI —— 界面、交互、主题、可访问性

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-UI-001 | P0 | 0 | 主题应默认跟随系统（注 2026-09-24：登录 / 双因素 / 邀请等未登录页右上角可选「跟随系统 / 日场 / 夜场」），手动选择持久化到 `localStorage: xz:theme`；切换用 View Transitions 圆形揭幕（有坐标）或整页溶解；reduced-motion 瞬切 | When 系统 dark Then `data-theme=dark`；选 light 刷新后仍 light<br>When reduced-motion Then 无 `::view-transition` 动画 | 06 §6 · 04 §3 | e2e · visual |
| REQ-UI-002 | P0 | 0 | 颜色与动效 token 只在 `tokens.css` 定义；组件文件无裸色值、`!important`、嵌套 `glass*` | When `pnpm lint` Then `check-css` 零违规 | CLAUDE 不变量 5 · 06 §9 | unit |
| REQ-UI-003 | P0 | 0 | 对比度矩阵应在两主题最坏合成底上通过：正文 ≥ 7:1、次要 ≥ 4.5:1、图标边框 ≥ 3:1 | When `check-contrast` Then 全部通过 | 06 §7 · 04 §2.1 | unit |
| REQ-UI-004 | P0 | 0 | `/design` 画廊应仅 admin 可见，含 token 页与材质 / 深度 / 切换三页，深浅色并排，截图回归阈值 0.1% | Given member When 访问 Then 404；Given admin Then 四页可见；Playwright 截图与基线差 ≤ 0.1%（注 2026-09-27，ADR-0020：路由改为 `/settings/design`，旧 `/design` 跳转，见 REQ-UI-039） | 04 §8 · 06 §10 | e2e · visual |
| REQ-UI-005 | P0 | 1 | ⌘K 第一组命令应由焦点对象决定（任务 / 记录 / 周期 / 空间），第二组为全局；候选带 KeyHint | Given 焦点在任务 When ⌘K Then 首组含「改状态 / 指派 / 设截止 / 移到周期」<br>Given 无焦点 Then 首组为跳转与创建 | 04 §6 | e2e |
| REQ-UI-006 | P0 | 1 | 全局快捷键（`g t` `g i` `g s` `c` `e` `n` `[` `]` `?`）应生效；`?` 打开面板 | When 按 `g` 后 `t` Then 路由为「今日」 | 04 §6 | e2e |
| REQ-UI-007 | P1 | 1 | 悬停 600ms 或焦点行按 `p` 应打开 Peek 面板（宽 480、不改 URL、`modal=false` 无 Scrim）；Esc 关闭；Enter 升级为详情并改 URL | When 悬停 700ms 或按 `p` Then 面板可见且 URL 不变；Enter Then URL 变为详情；Peek 打开时列表仍可滚动 | 04 §6 · 06 §4（任务 Peek 复用 `GET /tasks/:id`） | e2e |
| REQ-UI-008 | P1 | 1 | 状态 Toast 应从 Topbar 状态胶囊形变生长并缩回；错误 Toast 带红条；reduced-motion 下淡入 | When 导出完成 Then 胶囊展开为 Toast，4s 后缩回 | 04 §6 · 06 §4 | e2e · visual |
| REQ-UI-009 | P0 | 1 | 每个列表页空状态应含插画、一句话与可直接输入的主操作 | Given 空看板 Then 显示「这里还没有衔来的枝」与输入框 | 04 §6 · 06 §5.5 | e2e |
| REQ-UI-010 | P0 | 1 | 写操作应乐观更新；失败 Toast 并回滚；> 400ms 请求显示骨架屏 | Given 网络 500 When 改标题 Then 立即显示新值，随后回滚并 Toast | 04 §6 · 02 §11 | e2e |
| REQ-UI-011 | P1 | 1 | 密度 `comfortable / compact` 可切换，compact 行高 −20% | When 切 compact Then `TaskRow` 高度减少 20% | 04 §4 | visual |
| REQ-UI-012 | P0 | 0 | 所有界面字符串应经 i18next key；`zh-CN` 为一期唯一资源；源码无硬编码中文 | When lint 扫描 `src/client` Then 组件 JSX 文本节点无中文字面量（`i18n/` 除外） | 04 §7 · ADR §9.3 | unit |
| REQ-UI-013 | P0 | 0 | 每个路由通过 axe 无 serious 以上问题；焦点环用 `outline` 永不隐藏；列表可键盘操作 | When `@axe-core/playwright` 跑全部路由 Then 0 serious | 04 §7 · 06 §7 | a11y |
| REQ-UI-014 | P0 | 0 | 布局骨架：Topbar 56 / Sidebar 240 / Aside 320 可折；< lg 侧栏抽屉、Aside 底部 sheet | When 视口 1280 Then 三栏；1024 以下 Then 抽屉 | 04 §4 | visual |
| REQ-UI-015 | P0 | 0 | 首屏主 chunk gzip ≤ 250KB；Lighthouse Performance ≥ 90 | When `pnpm build` Then `check-budget` 通过；Lighthouse 报告 ≥ 90 | ADR §3 · 05 §5 | e2e |
| REQ-UI-016 | P0 | 0 | 同屏 `backdrop-filter` ≤ 6；虚拟列表内无 blur；`prefers-reduced-transparency` 下玻璃变实色 | When 看板页统计 Then ≤ 6；模拟 reduced-transparency Then 玻璃元素 `backdrop-filter: none` | 06 §8 · 06 §3.2 | e2e |
| REQ-UI-017 | P1 | 1 | 1 万行任务列表滚动应不掉帧（≥ 50fps） | When Playwright 采 `requestAnimationFrame` 间隔 Then P95 ≤ 20ms | ADR §3 · 04 §5 | e2e |
| REQ-UI-018 | P1 | 1 | 24h 内显示相对时间，悬停显示绝对时间；日期数字按 locale/timezone | When `updated_at` = 5 分钟前 Then 显示「5 分钟前」，title 为绝对时间 | 04 §7 | unit · e2e |
| REQ-UI-019 | P1 | 1 | 拖拽应有拾起（倾斜 1.5° 放大）、经过（目标列变亮）、放下（弹簧归位）三态；放不下弹回并晃动 | When 拖到不可放置区域松手 Then 卡片回原位 | 06 §4 · 06 §5 | e2e · visual |
| REQ-UI-020 | P1 | 1 | 侧栏当前项为~~主色胶囊 + 左侧 3px 主色条~~翡翠渐变胶囊 + 1px inset 描边 + 柔光（注 2026-09-24 侧栏改版，见 REQ-UI-032）；主色辉光只出现在~~焦点、~~主按钮 hover、燕印、侧栏当前项、登录聚焦、成巢、里程碑（ADR-0005 §4） | When 审计样式 Then `glow-primary` 引用点 ~~≤ 3~~ ≤ 6 处 | 06 §1 · 06 §4 · ADR-0005 | visual · unit |
| REQ-UI-021 | P1 | 2 | 卡片 → 详情 / Peek 应用共享元素过渡（320ms），只给被点击的一张卡片赋 `view-transition-name`，结束即清（注 2026-09-24：借 REQ-UI-029 路由转场实现，来源 / 目标用 `data-shared-*` 标记、仅 `route` 类型期间赋名；Peek 不经路由，暂未做） | When 点击卡片 Then DOM 中同时带该 name 的元素 ≤ 1，过渡结束后为 0 | 04 §2.4 | e2e |
| REQ-UI-022 | P1 | 1 | 详情页不设保存按钮；标题 / 日期 / 优先级 / 指派人就地编辑，失焦即保存并显示「已保存 · 刚刚」 | When 改标题失焦 Then 1 次 PATCH，提示出现 | 04 §6 · 04 §5 InlineEdit | e2e |
| REQ-UI-023 | P0 | 0 | 所有浮层（Popover / Dialog / ⌘K / Toast / Tooltip）应 portal 到 body，不在 `backdrop-filter` 元素内 fixed 定位 | When 在 Sidebar 内打开 Popover Then 其父为 body | 06 §2 · 06 §9 | unit |
| REQ-UI-024 | P1 | 2 | 品牌标识应为燕印（~~翡翠渐变方印 + 深墨衔枝燕~~ 注 2026-09-25 ADR-0007：翡翠深渐变方印 + 暖白春燕衔嫩芽；md / lg 完整版三片嫩叶，sm 与 favicon 为一片大叶的简化版；侧栏与登录页副标为「日衔寸枝，岁成一巢」）：Sidebar 品牌位 ~~28~~ 42（注 2026-09-24 侧栏改版）、登录页 56、favicon 同形；宿主 hover 印章轻转，减弱档静止 | When 打开 `/today` Then Sidebar 含 `.xz-seal.xz-seal-md`，内含 `.xz-seal-bird` 且嫩叶 3 片、燕子填色 = `--xz-seal-bird`；打开 `/login` Then 含 `.xz-seal-lg`；`/favicon.svg` 标题为 `Xianzhi` | ADR-0005 §2 · ADR-0007 · 04 §9 | e2e |
| REQ-UI-025 | P1 | 2 | UI / 展示 / 代码 / 英文品牌字应自托管（npm 包、`unicode-range` 分片、`font-display: swap`），不请求任何外部字体 CDN | When 加载 `/login` Then `document.fonts` 含 `MiSans` 与 `LXGW WenKai Screen`，且无跨域字体请求 | ADR-0005 §5 · 04 §2.2 | e2e |
| REQ-UI-026 | P1 | 2 | 编辑器代码块应按 One Dark 变体高亮，两主题同一深底；每个高亮色在代码底上 ≥ 4.5:1 | When 插入 `ts` 代码块 Then 关键字元素颜色 = `--xz-code-keyword`；`check-contrast` 含 `code-*` 项并通过 | ADR-0005 · 06 §4 | e2e · unit |
| REQ-UI-028 | P1 | 2 | 动效档位 `reduce / standard / rich` 应可在设置页选择，写 `html[data-motion]`（standard 不写）并持久化 `xz:motion`；首帧前生效；系统 reduced-motion 优先；Motion 组件随档位关闭动画 | When 选「减弱」Then `data-motion=reduce`，刷新仍在；选「标准」Then 属性移除、存储清空 | 04 §2.4 · ADR-0005 §3 | e2e |
| REQ-UI-029 | P1 | 2 | 路径变化的导航应以 View Transition 淡出 / 淡入（旧页 `dur-fast`、新页 `dur-base`），转场带 `route` 类型以区别主题切换；首次加载、仅 search 变化、减弱档不转场；浏览器不支持 view-transition types 时关闭 | When 侧栏点「收件箱」Then 一次 `startViewTransition` 且 types = `['route']`<br>Given 减弱档 Then 无调用 | 04 §2.4 · ADR-0005 §3 | e2e |
| REQ-UI-030 | P1 | 2 | 展开 / 收起统一用圆角实心三角「展开指示」，展开时弹簧转 90°；纯方向仍用 Chevron | When 点击「今天完成的」Then 指示带 `data-open` 且旋转 90° | 04 §2.4 · 04 §5 | e2e |
| REQ-UI-031 | P1 | 2 | 日历 `/calendar`（Apple 风格）：月视图 6×7（按 weekStartsOn）与周视图（全天行 + 24 小时时间轴 + 当前时间线）；（注 2026-09-25，ADR-0009：另有日 / 年视图与独立「日程」，见 REQ-CAL-*；任务改为可关闭的叠加层）事件 = 任务（dueAt 优先，本地 23:59 / 00:00 视为全天），色取空间色板，点击打开 Peek；`t` 今天、← / → 翻页、`m` / `w` 切换；侧栏与 ⌘K `g c` 可达（注 2026-09-27 ADR-0016：点任务 / 日程改为弹快速编辑气泡，见 REQ-CAL-012；不再打开 Peek） | When 区间内有任务 Then 月视图对应日期出现事件；点击 Then Peek；按 `w` Then 周视图且今天列有当前时间线 | 08 §2.17 · ADR-0005 | unit · e2e |
| REQ-UI-032 | P1 | 2 | 侧栏（2026-09-24 改版，参照简斋后台）：整高实玻璃板 + 右侧 1px 分隔与柔阴影；品牌区燕印 42 + 文楷；导航项 42px、图标带专属色（`--xz-icon-*` ≥ 3:1）；当前项为翡翠渐变胶囊 + inset 描边，无左侧竖条；导航与空间树共用样式；内容区内衬圆角淡翡翠面板 | When 视口 1280 Then 侧栏高 = 视口、右边框 1px；当前项 `data-active` + `aria-current=page`、背景为渐变、无 `::before` 竖条 | 06 §4 · REQ-UI-020 | e2e · unit |
| REQ-UI-033 | P1 | 2 | 一级页页头统一（`PageHeader`：2xl 标题 + 可选文楷题记 / 说明 / 右侧动作）；今日页题记为本地日期与星期、说明为各段计数；记录类型用 04 §2.1 色板分色（决策 blue · 迭代 cyan · Bug red · 变更 orange · 日志 green · 随笔 yellow · 复盘 purple；ADR-0010 前为 indigo / teal / ochre / amber / pine / moss / plum），文字仍为类型名；跨空间列表以「空间色点 + 空间名」标注空间（取不到时回退 slug）；记录 / 空间卡片悬停抬升 2px + 翡翠边线，网格入场错峰 ≤ 8 格，时长走 token（减弱档无动画） | When 打开 `/today` Then 标题上方有日期题记；When 记录卡片类型为决策 Then 徽章为 blue 色板类；When 减弱档 Then `.xz-rise` 无动画 | 04 §2.1 · 04 §2.4 · 06 §5.2 | unit · 手工 |
| REQ-UI-034 | P1 | 2 | 宽屏不留大片空白（2026-09-25）：今日 / 收件箱 / 通知在 ≥ xl 为「主列 + 20rem 右侧速览栏」（今天：日期 / 农历 / 节假日 · 今日日程 · 小月历 · 7 天内到期），主列最宽 96rem；今日页顶部四枚计数卡（逾期 / 今日到期 / 今日开始 / 今日日程）；回收站 / 搜索加宽到 5xl；空间卡片 2xl 四列；设置子页统一左对齐 | When 视口 1728 打开 `/today` Then `glance-rail` 可见、`today-stats` 4 格；When 视口 1280 Then 无速览栏 | 04 §4 · 08 §2.3 | e2e · 手工 |
| REQ-UI-035 | P1 | 2 | 色板改为鲜艳 9 色（ADR-0010）：蓝 / 橙 / 黄 / 红 / 绿 / 紫 / 粉 / 青 / 灰，每色 `-solid`（色条 / 圆点）· `-bg`（浅底）· `-fg`（字，对 `-bg` ≥ 4.5，两主题）；空间 / 标签 / 日历共用；日历色块为「浅底 + 同色深字 + 3px 鲜艳左色条」；旧色名经迁移 0007 映射（moss / pine→green、amber→orange、indigo→blue、ochre→red、teal→cyan、plum→purple） | When `check-contrast` Then 9 色两主题全部达标<br>When 日历新建颜色为 `teal` Then 422 | ADR-0010 · 04 §2.1 | unit · api · 手工 |
| REQ-UI-036 | P0 | 2 | 非安全上下文（按局域网 IP 走 HTTP）下所有写操作应可用（2026-09-25）：客户端 id / `Idempotency-Key` 只经 `lib/uuid.ts` 的 `newId()` 生成，禁止 `crypto.randomUUID`；复制走 `lib/clipboard.ts` 降级；创建失败且非 `ApiError` 时 `console.error` 留痕 | Given `crypto.randomUUID` 不存在 When 新建记录 / 任务 Then 创建成功<br>When `pnpm lint` Then `check-css` 对 `src/client` 中 `crypto.randomUUID` 报违规 | debug/2026-09-25-randomuuid-insecure-context | e2e · unit |
| REQ-UI-037 | P1 | 2 | 记录类型图标与色块质感（ADR-0015）：9 种类型各有不同 Lucide 图标，色取 REQ-UI-033 色板；`KindIcon` 色块 = 浅底 → 实色渐变 + 顶部高光 + 同色细描边，所在行悬停弹簧放大；类型徽章全站改为「图标 + 类型名」胶囊；位置导航快捷项用 `--xz-icon-*` 专属色，大类用大类色色块；未设颜色的空间图标按类型给默认色，不回退灰色；只引用 token | When 记录卡片类型为 Bug Then 徽章含 Bug 图标且为 red 色板；When `check-contrast` Then 两主题达标；When 减弱档 Then 色块无变换 | ADR-0015 · 04 §2.1 · 06 §5 | unit · 手工 |
| REQ-UI-038 | P1 | 2 | （2026-09-27 新增，ADR-0016）可点的侧栏分区标题须与纯标签区分：「空间」→ `/spaces` 用正文色 + 半粗 + 右箭头，悬停浅底 + `primary-text` + 箭头右移；「我的视图」保持 muted | When 渲染侧栏 Then 「空间」标题计算色 ≠「我的视图」，且带箭头图标；点击 Then `/spaces` | ADR-0016 · 04 §5 | e2e |
| REQ-UI-039 | P1 | 2 | （2026-09-27 新增，ADR-0020）画廊应在设置内：路由 `/settings/design`，设置二级导航「工作区」组内「设计画廊」项（仅 admin）；主侧栏不再有画廊入口；旧 `/design` 带原 search params 跳转到新地址 | Given admin When 打开设置 Then 导航有「设计画廊」、主侧栏无；When 访问 `/design?page=depth` Then 落到 `/settings/design?page=depth` 且设置导航可见；Given member Then 设置导航无此项、访问 404 | ADR-0020 · 08 §2.16 | e2e |
| REQ-UI-040 | P1 | 2 | （2026-09-27 新增，ADR-0020）画廊自带用法：顶部一句说明 + 每页一句「看什么」+ 截图基线命令；工具栏可切 主题（当前 / 日场 / 夜场 / 并排）与 动效档位（减弱 / 标准 / 丰富）、可勾「降低透明度」，三者都写进 search params（`theme` `motion` `transparency`），离开画廊恢复本机偏好；Token 页对比度表（运行时按当前主题 token 计算，标门槛与达标）；组件页含类型色块 / 类型胶囊 / 9 色板 / 燕印 / 目录引导线 | When 点「并排」Then URL `theme=both` 且渲染两栏；When `?motion=reduce` Then `html[data-motion=reduce]`，离开画廊后恢复；When `?transparency=reduce` Then 玻璃无 blur；Token 页对比度行 `fg / 底板` ≥ 7 标达标 | ADR-0020 · 04 §8 · 06 §10 | e2e |
| REQ-UI-041 | P1 | 2 | （2026-09-29 新增，ADR-0034）登录 / 注册 / 2FA / 邀请共用认证外壳：≥ 900px 为宽 `glass-thick` 双栏卡（左「衔枝小院」插画 + 小燕气泡，右表单），< 900px 只挂表单卡 + 顶沿探头小燕（不挂整幅插画）；插画整张 `aria-hidden`，不加 blur；燕印 `lg`、`sr-only` 标签与原 testid 不变 | When 1280px 打开 `/login` Then `.xz-auth-art svg` 可见、`.xz-seal-lg` 可见、同屏 blur ≤ 6；When 390px Then `.xz-auth-peek` 可见且无 `.xz-auth-art`；`/register` `/login/2fa` 同样有插画 | ADR-0034 · 06 §5.6 · 08 §2.1 | e2e |
| REQ-UI-042 | P1 | 2 | （2026-09-29 新增，ADR-0034）小燕情绪由表单信号推导，优先级 success > error > cover > peek > captcha > scout > idle：文本框聚焦探看（回显名字 ≤ 8 字）、密码密文聚焦捂眼、明文有值偷看、滑块聚焦盯手柄、提交失败垂头摇头 2.4s 后平复、成功衔枝欢跳约 0.9s 后再跳转；待机小动作 / 20s 入睡 / 点一下害羞、连点冒心 | When 聚焦密码框 Then 外壳 `data-mood=cover`；When 显示密码且有值 Then `peek`；When 登录 401 Then `error` 且 alert 照旧；When 成功 Then `success`、枝可见，≥ 800ms 后才跳 `/today` | ADR-0034 | unit · e2e |
| REQ-UI-043 | P1 | 2 | （2026-09-29 新增，ADR-0034）小燕随动效档位：减弱档（含系统 reduced-motion）不起 rAF、无关键帧，情绪姿态一步到位、含义符号静态显示；标准档含全部角色戏；丰富档加柳叶飘落；色值只取 `--xz-bird-*` 等 token，无 will-change / backdrop-filter；引擎与样式随认证路由拆包 | Given 系统减弱动效 Then 头部无引擎 transform、插画 `getAnimations()` 为 0，聚焦密码框翅膀仍转到捂眼位；标准档移动指针 Then 瞳孔 transform 随之变化；`html[data-motion=rich]` Then `.xz-falling` 显示 | ADR-0034 · 04 §2.4 · 06 §8 | unit · e2e |
| REQ-UI-044 | P1 | 2 | （2026-09-30 新增，ADR-0035）元数据统一配色（`lib/field-tones.ts` 纯函数，只取色板 / `.xz-tone-*` token，旁边总有文字）：状态按语义色（new 红 · pending 橙 · fixed 绿 · wontfix 灰 等；自定义状态 / 选项取类型设定色，否则按位置轮换）；优先级 p0 红 · p1 橙 · p2 蓝 · p3 灰；严重度 critical 红 · high 橙 · medium 黄 · low 灰；日期——截止类（dueDate / endDate / periodEnd）已完成绿、过期红、3 天内（按操作者时区）橙、更远蓝，起始 / 发现类青，完成类（resolvedAt / releasedAt / decidedAt）绿；进度 0–29 橙 · 30–99 蓝 · 100 绿；记录页属性面板、表格、看板卡片、卡片元信息、空间首页同值同色 | Given today = 2026-10-01 When `dateTone('dueDate','2026-09-30')` Then red；`'2026-10-03'` Then orange；`'2026-10-10'` Then blue；已完成 Then green；`dateTone('foundAt', …)` Then cyan；When `progressTone(29/30/100)` Then orange / blue / green；When `valueTone('priority','p0')` Then red；自定义状态设了 `status_colors` Then 取该色 | ADR-0035 §C · 04 §2.1 | unit · e2e |
| REQ-UI-027 | P1 | 2 | Topbar 滚动 > 8px 后应显示 `shadow-soft` 与翡翠枝线，回到顶部即消失；Dialog 打开时底板光晕下移 4px 并减弱，关闭复原 | When 页面滚动 100px Then topbar 带 `data-scrolled`；When 打开 Dialog Then `html[data-dialog-open]` 且 `body::before` transform 非 none | 06 §4 · ADR-0005 §2 | e2e |

---

## 17. MOBILE —— 响应式、手势、PWA

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-MOBILE-001 | P0 | 1 | < lg 应显示底部导航（今日 / 收件箱 / 搜索 / 通知 / 我），含安全区内边距 | When 视口 390×844 Then 底部导航 5 项，`padding-bottom` 含 `env(safe-area-inset-bottom)` | 04 §4 · 06 §4 | e2e · visual |
| REQ-MOBILE-002 | P1 | 1 | 任务行左滑完成、右滑改期、长按多选 | When 左滑 > 40% 宽 Then 任务完成 | 04 §6 | e2e |
| REQ-MOBILE-003 | P1 | 1 | 编辑器工具条固定底部并随软键盘上移 | When 聚焦编辑器（模拟 `visualViewport` 缩小）Then 工具条 bottom 贴键盘 | 04 §6 | e2e |
| REQ-MOBILE-004 | P1 | 2 | PWA 应可安装，壳与静态资源预缓存；正文离线靠 IndexedDB；列表离线显示最近一次缓存并标「离线」 | When 离线打开已访问记录 Then 可编辑；打开列表 Then 显示缓存与离线标记 | ADR §3 · 03 §4.3 · 08 §5 | e2e |
| REQ-MOBILE-005 | P1 | 2 | iOS 上 Web Push 需安装到主屏（16.4+），系统应在订阅前引导 | Given iOS Safari 未安装 When 开启推送 Then 显示安装引导而非直接失败 | 01 §3.11 | e2e |
| REQ-MOBILE-006 | P0 | 1 | 移动视口 e2e 一组主流程通过；< lg 下 blur 半径降到 12px 以内 | When 视口 390 Then `--xz-blur-thick` 计算值 ≤ 12px | 05 §5 · 06 §8 | e2e |
| REQ-MOBILE-007 | P1 | 1 | 触控目标 ≥ 40×40 | When axe + 自定义检查 Then 无小于 40px 的可点击元素 | 06 §7 | a11y |

---

## 18. OPS —— 健康、备份、迁移、日志、限流

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-OPS-001 | P0 | 0 | `/api/health` 公开只回 `{ok, version}`；`/api/health/details` 需 admin 或 API Key scope admin | Given anon When `GET /api/health` Then 200 无敏感字段；`/details` Then 401 | 02 §1 · 05 §10 | api |
| REQ-OPS-002 | P0 | 0 | 容器启动应先执行迁移；迁移失败容器退出且旧容器不被替换 | When 注入失败迁移 `compose up` Then 新容器退出码非 0，旧容器仍 healthy | 05 §7 · 01 §7 | e2e（infra） |
| REQ-OPS-003 | P0 | 0 | 日志应为 pino JSON，含 `reqId / userId / 耗时`；500 错误带 stack 但响应不带 | When 触发 500 Then 响应只含 `requestId`；日志有 stack | 05 §10 · 02 §3 | api |
| REQ-OPS-004 | P0 | 0 | 默认限流 600/min，返回 `RateLimit-Limit / Remaining / Reset`，超限 429 | When 第 601 次 Then 429 | 02 §2 | api |
| REQ-OPS-005 | P0 | 0 | 生产 Compose 三服务本机可起；Caddy 片段 `/collab/*` WebSocket 直通、`/assets/*` immutable | When `compose -f prod up` Then `/api/health` 200，wss `/collab` 握手成功 | 05 §7 · 05 §11 | e2e（infra） |
| REQ-OPS-006 | P0 | 0 | CI 应按 lint → typecheck → drift → test → build（含预算）→ audit → e2e 顺序，任一失败阻断 | When PR 引入裸色值 Then CI 在 lint 阶段失败<br>When 01 §3 多写一列 Then `drift` 阶段失败 | 05 §6 | 手工 |
| REQ-OPS-007 | P0 | 0 | 软删 30 天硬删、幂等键 24h、孤儿附件 7 天、未标记快照按策略，均由 pg-boss cron 执行 | When 构造过期数据跑 job Then 对应行与文件删除 | 01 §1 · 01 §3.13 · 03 §5 | unit |
| REQ-OPS-008 | P1 | 1 | 每用户存储配额 5GB，超限上传返回 413 `QUOTA_EXCEEDED`；设置页显示用量 | Given 用量 5GB When 上传 Then 413 `QUOTA_EXCEEDED` | 07 §5 | api |
| REQ-OPS-009 | P0 | 0 | 安全头按 02 §2 CSP 输出；Tiptap / KaTeX 内联样式可用；无 inline script | When `GET /` Then `Content-Security-Policy` 含 `script-src 'self' 'wasm-unsafe-eval'` | 02 §2 | api |
| REQ-OPS-010 | P1 | 1 | dev 下 Drizzle logger 打印 > 50ms 的 SQL | When 构造慢查询 Then 日志含 SQL 与耗时 | 05 §10 | unit |
| REQ-OPS-011 | P1 | 0 | 每季度在验证实例演练备份恢复并记入 `debug/` | When 恢复 dump 到 `xz_verify` Then 数据行数与源一致 | 05 §8 | 手工 |
| REQ-OPS-012 | P0 | 0 | `pnpm e2e` 与验证实例使用独立端口 3011/8012/8013、独立 `cacheDir` 与 `xz_e2e` 库 | When 主 dev 运行时 `pnpm e2e` Then 两者互不影响 | 05 §3 · CLAUDE | 手工 |
| REQ-OPS-013 | P0 | 1 | 02 §5 列出的全部创建端点（spaces / tasks / entries / comments / tags / links / attachments / invitations / cycles / exports）应接受 `Idempotency-Key` 并 24h 内原样回放 | When 对每个创建端点用同一 `Idempotency-Key` 连发两次 Then 第二次响应体与状态码相同、表行数不增<br>When 24h 后再发 Then 视为新请求 | 02 §5 · 01 §3.13 | api |
| REQ-OPS-014 | P0 | 0 | 所有错误响应应为 RFC 9457 Problem Details：`Content-Type: application/problem+json`，含 `code`、`status`、`requestId`；422 含 `errors[].path` | When 触发 401 / 403 / 404 / 409 / 422 / 429 各一次 Then 头与字段齐全；422 的 `errors[0].path` 指向出错字段<br>When 500 Then 只含 `requestId` 无 `stack` | 02 §3 | api |

---

## 18b. CAL —— 日历与日程（2026-09-25 新增，ADR-0009）

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-CAL-001 | P1 | 2 | 每个用户应有自己的日历列表（颜色分类）：首次访问自动建「个人 / 工作 / 学习 / 生活」4 个，可新建（≤ 30）、改名、改色（9 色鲜艳色板，ADR-0010）、隐藏 / 显示、删除（至少留 1 个，连同其日程） | When 首次 `GET /calendars` Then 4 个且恰一个 `isDefault`；再取仍 4 个<br>When 新建 / 改名 / 隐藏 / 删除 Then 201 / 200 / 200 / 204；颜色非法 422 | 01 §3.15 · 08 §2.17 | api |
| REQ-CAL-002 | P1 | 2 | 用户应能新建定时 / 全天 / 跨天日程（标题、日历、地点、链接、备注、提醒），并按区间读取；结束须晚于开始，区间跨度 ≤ 400 天 | When `POST /calendar-events` Then 201，区间内 `GET` 可见、区间外不可见<br>When 结束早于开始 / 区间 401 天 Then 422<br>When 周视图点击空白 10:05 Then 编辑器开始时间 10:00，保存后出现 10:00–11:00 的日程 | 01 §3.15 · 02 §9 | api · e2e |
| REQ-CAL-003 | P1 | 2 | 用户应能拖动日程改期（周 / 日视图可跨日，月视图拖到别的日期）、拖底边改时长；写入带 `ifUpdatedAt`，过期 409 | When 周视图把 10:00 日程向下拖 1 小时 Then 变 11:00–12:00<br>When 旧 `ifUpdatedAt` PATCH Then 409 `CONFLICT_STALE` | 02 §5 · 08 §2.17 | api · e2e |
| REQ-CAL-004 | P1 | 2 | 日程应支持重复（每天 / 工作日 / 每周选星期 / 每两周 / 每月 / 每年 / 自定义间隔；结束于永不 / 某日 / N 次），按日程时区的本地时刻展开（跨 DST 不漂移） | When 每周一三重复 Then 两周区间返回 4 次<br>When `FREQ=HOURLY` Then 422<br>When 纽约每天 09:00 跨 3/8 Then UTC 由 14:00 变 13:00 | 01 §3.15 · ADR-0009 | api |
| REQ-CAL-005 | P1 | 2 | 修改 / 删除重复日程时应询问范围：仅此日程 · 将来所有日程 · 所有日程 | When 改「仅此」Then 只有该次变化，其余不变<br>When 删「将来」Then 系列截断<br>When 删「全部」Then 系列与改写行都消失<br>When 周视图删某次选「仅此日程」Then 5 次剩 4 次 | 01 §3.15 | api · e2e |
| REQ-CAL-006 | P0 | 2 | 日历与日程个人私有：仅 owner 本人可读写（admin 也不可见），他人按不存在处理 | Given 他人 When 读 / 改 / 在他人日历下新建 Then 列表无、404 | 01 §5 | api |
| REQ-CAL-007 | P1 | 2 | 日历应标注中国法定节假日「休」、调休上班「班」，并显示农历日期、主要传统节日与二十四节气（可在侧栏关闭） | When 月视图 2026-10 Then 10/1 有「休」、10/10 有「班」，格内有农历小字 | ADR-0009 §3 | e2e |
| REQ-CAL-008 | P1 | 2 | 日程提醒：到「开始 − 提前量」时刻给 owner 发 `calendar.reminder`（站内 + SSE + WebPush），每（日程, 发生时刻, 提前量）只发一次，停机错过 5 分钟窗口不补发 | When 作业在触发后 1 分钟运行 Then emit 1 条；再跑 Then 0；触发前运行 Then 0 | 01 §4 · ADR-0009 | api |
| REQ-CAL-009 | P1 | 2 | 日历页应提供日 / 周 / 月 / 年四种视图与左栏（小月历、我的日历、叠加项、接下来 7 天）；快捷键 t / ← / → / d / w / m / y / n；日视图宽屏带当日详情栏 | When 按 y Then 年视图 12 个月；点日期 Then 日视图 | 08 §2.17 | e2e · 手工 |
| REQ-CAL-010 | P1 | 2 | 月视图与周 / 日视图的全天行应支持鼠标按住拖选日期范围：拖过的日期高亮，松开即以 [起, 止] 打开新建全天日程（如 9/9 → 9/11）；反向拖同样有效；单击仍为单日；按在日程条 / 日期号上不起选；Esc 取消；触屏不拖选（留给滚动） | When 月视图从 9/9 按住拖到 9/11 松开 Then 编辑器为全天、起 9/9、止 9/11；When 单击 9/9 Then 单日 | ADR-0010 · 08 §2.17 | e2e · 手工 |
| REQ-CAL-011 | P1 | 2 | 周视图（多列时间轴）同一重叠簇最多并排 2 列：超过时保留第 1 列，其余收进占第 2 列的「+N」按钮（高 ≥ 24px，读屏文本「同一时段还有 N 项，查看当天」，悬停列出标题），点击进入当天日视图；日视图列宽足够，不收起。保证每个可点目标 ≥ 24px（axe target-size） | When 12/7 15:00 有 3 个重叠日程、周视图 Then 该列 1 个日程 + 「+2」、宽高均 ≥ 24px；点「+2」Then `view=day&date=2026-12-07` 且 3 个都可见 | 08 §2.17 · REQ-UI-013 | unit · e2e |
| REQ-CAL-012 | P1 | 2 | （2026-09-27 新增，ADR-0016）点日程 / 任务在其旁弹快速编辑气泡，不离开日历：日程可改标题 / 全天 / 起止 / 日历 / 地点 / 备注（关闭即保存，重复日程先问范围）、删除、「更多选项」进完整编辑器；任务可勾完成、改标题 / 日期时间 / 优先级、删除（Toast 撤销）、「详情」在页内开抽屉；焦点不在输入框时 Delete 删除 | When 周视图点日程、改结束 11:30 点「保存」Then 块显示 10:00–11:30；When 再点开按 Delete Then 消失；When 任务改时刻 16:00 Then 块移到 16:00；When 删任务后点「撤销」Then 回来 | ADR-0016 · 08 §2.17 | e2e |
| REQ-CAL-013 | P1 | 2 | （ADR-0016）任务可拖动改期：月视图拖到别的日期、周 / 日视图拖动改时刻（15 分钟吸附），平移其定位字段（截止优先，否则计划开始）并保留时刻；定时任务不落到 00:00 / 23:59（会被当全天），夹到 00:15 / 23:45；不能拖底边改时长 | When 周视图把 16:00 的任务向下拖 1 小时 Then `dueAt` 本地 17:00 | ADR-0016 | e2e |

---

## 18c. READ —— 阅读与写作偏好（2026-09-28 新增，ADR-0024）

| ID | P | Phase | 需求（EARS） | 验收（GWT） | 依据 | 测试层 |
|---|---|---|---|---|---|---|
| REQ-READ-001 | P1 | 2 | 阅读偏好按人存服务端：`GET /me/preferences` 返回补齐默认值的 `{reading}`；`PATCH` 按键合并、非法值 / 未知键 / 空补丁 422、需 write scope；读取逐键校验坏值回落默认；删号时删除 | When 先后 PATCH `{font}` `{paper,tocDepth}` Then 三键都在；`{font:'comic'}` Then 422；read Key PATCH Then 403；他人 GET Then 默认值；purge 后 `user_preferences` 无该行 | ADR-0024 · 02 §9 | api · unit |
| REQ-READ-002 | P1 | 2 | 记录页「Aa」弹层（注 2026-09-28，ADR-0026：版心默认改为满栏，验收中「回到 MiSans / 760」改为「回到 MiSans / 满栏」；ADR-0025：改为吸顶工具栏里的阅读胶囊四个弹层，见 REQ-READ-007）可改字体（MiSans / 文楷 / 宋体 / 系统 / 等宽）、字号、行距、段距、版心（窄 / 标准 / 宽 / 满栏）、首行缩进、两端对齐，即时生效并跨刷新保留；`?wide=1` 仍强制宽版心；默认值与改版前外观一致 | When 选「文楷」「宽」Then 正文计算字体含 LXGW WenKai、纸面宽 1080；刷新后仍是；When「恢复默认」Then 回到 MiSans / 760 | ADR-0024 · 08 §2.9 | e2e |
| REQ-READ-003 | P1 | 2 | 纸张 6 种（素纸 / 宣纸 / 方格 / 横线 / 点阵 / 牛皮纸）按人生效；色值只在 tokens.css，日场 / 夜场各一套；宣纸 / 牛皮纸上文字对比度达标（check-contrast） | When 选「方格」Then 纸面 `data-paper=grid` 且有背景纹；`pnpm lint` 的 check-contrast 含宣纸 / 牛皮纸行且全部达标 | ADR-0024 · 06 §3 | e2e |
| REQ-READ-004 | P1 | 2 | 章节编号（显示层，不写正文）：正文、Aside 大纲、目录块同一跳级压缩算法；目录深度 2 / 3 / 4 按编号层级过滤大纲与目录块 | Given 标题 h2 背景 / h3 细节 When 开编号 Then 正文与大纲分别显示「1」「1.1」；When 目录深度 = 2… Then h3 仍显示（第 2 层）；h2 h4 h3 编为 1 / 1.1 / 1.2 | ADR-0024 §5 | unit · e2e |
| REQ-READ-005 | P1 | 2 | 专注写作：记录页「专注」按钮或 `mod+shift+enter`、⌘K「进入专注写作」进入；隐藏侧栏 / 顶栏 / Aside / 底部导航与面包屑 / 元信息；右上角「退出专注」或 Esc 退出；离开记录页自动退出 | When 点「专注」Then 顶栏与侧栏不可见、`focus-exit` 可见；按 Esc Then 顶栏可见 | ADR-0024 §6 | e2e |
| REQ-READ-009 | P1 | 2 | （2026-09-28 新增，ADR-0027）`/toc` 目录块渲染为主色卡片（标题行「目录 · N 个标题」、层级缩进、主色编号），编号只出现一次（不叠浏览器列表序号）；插入后光标落到其下、继续打字不会替换目录；正文章节编号默认开且用主色 | Given h2 背景 / h3 细节 When 插入 /toc Then 卡片编号 1 / 1.1、`ol` 的 list-style 为 none、条目文本「1背景」；继续打字 Then 目录仍在；正文 h2 `data-num=1` 且显示编号 | ADR-0027 | e2e |
| REQ-READ-008 | P1 | 2 | （2026-09-28 新增，ADR-0026）右侧目录默认自动编号（`tocNumbers`，与正文编号分开，可关）；按编号层级缩进 + 引导线；滚动时高亮当前标题（滚到页底取最后一个），高亮项滚进可视区；跳转不被吸顶工具栏遮住 | Given h2 背景 / h3 细节 / h2 结论 Then 目录显示 1 / 1.1 / 2；滚到文末 Then 「结论」高亮；关闭自动编号 Then 无编号 | ADR-0026 §3 | e2e |
| REQ-READ-007 | P1 | 2 | （2026-09-28 新增，ADR-0025；改于 2026-09-29，ADR-0029：胶囊移到标题下的文档栏，不吸顶，与专注 / 保存 / Markdown / 字数同一行；注 2026-09-30 ADR-0035：标题与文档栏之间插入属性面板，几何仍为 标题 < 文档栏 < 格式栏）阅读设置以「阅读胶囊」放在正文上方吸顶工具栏：字体 / 纸张 / 排版（字号、行距、段距、版心、缩进、对齐、恢复默认）/ 目录（章节编号、目录深度）各一个弹层；只读者也可用 | When 依次打开四个弹层 Then 各显示对应面板；长文滚动后胶囊仍在视口 | ADR-0025 §1 | e2e |
| REQ-READ-006 | P1 | 2 | 设置 → 阅读与写作（`/settings/reading`）：同一面板 + 示例文段实时预览；⌘K「阅读与写作设置」可达 | When 在设置页选「横线」Then 预览纸面 `data-paper=lines`；打开记录页 Then 同样生效 | ADR-0024 · 08 §2.13 | e2e |

## 19. 二期范围（Phase 3，不在本文验收，不编号）

MCP Server（stdio + Streamable HTTP，工具清单见 02 §10）· git 日志导入生成迭代记录草稿 · `debug/` 目录导入 · AI 周复盘摘要与「零散日志 → ADR」· pgvector 语义检索与 embedding · Meilisearch（仅当检索体验不足）· 简斋 API 卡片抓取 · 后台用户管理页 · 活动流页面 · 对象存储 COS · 多实例与 Redis（触发条件 ADR §9.4）。

---

## 20. 追溯约定

- 测试用例名以 REQ ID 开头：`it('REQ-TASK-003 拖拽只发一条 batch 且 409 回滚')`；一个用例可覆盖多个 ID，用空格分隔。
- PR 描述必须列出「覆盖 / 影响」的 REQ ID；无对应 REQ 的功能 PR 先补本文。
- Vitest 与 Playwright 各用自定义 reporter 输出 `req-coverage.{unit,api,collab,e2e}.json`（`{id, layer, passed}`），CI 合并为 `debug/perf/req-coverage.json`；**门槛按本次 CI 实际运行的层计算**：P0 且 Phase ≤ 当前 Phase 的 REQ，凡其测试层包含本次已运行的层，就必须在该层至少有一个通过的用例；e2e 层只在 e2e 阶段（main 与带 `e2e` 标签的 PR）校验；测试层为「手工」的 REQ 不进门槛，由 Phase 验收清单人工勾选（05 §5 引用）。
- 本文改动走普通 PR；改变已验收 REQ 的行为需在该行末尾追加「改于 YYYY-MM-DD，原因」，不删旧编号（编号只增不复用）。
- 01–06 与本文冲突时：行为以本文为准、实现方式以 01–06 为准；冲突本身记入 `spec_dev_doc/CHANGELOG.md`。

---

## 21. 裁定记录（2026-09-23 按建议值定，可推翻；推翻即改对应 REQ 并记 CHANGELOG）

| # | 问题 | 裁定 | 落点 |
|---|---|---|---|
| 1 | 邀请链接有效期 | 7 天、一次性、绑定邀请邮箱 | REQ-AUTH-003 · 07 §5 |
| 2 | 已接受邀请再打开 | 410 `INVITATION_EXPIRED`，不建号 | REQ-AUTH-004 · 02 §3 |
| 3 | 最后一名 owner | 409 `CONFLICT_LAST_OWNER`；转让走 `POST /workspace/owner-transfer` | REQ-WS-003 · 02 §9 |
| 4 | 成员移除后内容与指派 | 内容保留、作者显示「已离开的成员」；未完成任务指派置空并通知空间 admin | REQ-WS-004 · 07 §4 |
| 5 | 归档空间 | 只读，写操作 403 | REQ-SPACE-004 · 01 §3.1 |
| 6 | 收件箱定义 | `status=inbox` 且（创建者或指派人为我），服务端 `view=inbox` | REQ-TASK-006 · 02 §9 |
| 7 | `task.due_soon` 改期 | 重新计算并再发一次 | REQ-TASK-010 · 01 §4.1 |
| 8 | 离线创建任务 | P2 Phase 2 | REQ-TASK-022 · 08 §5 |
| 9 | IndexedDB 不可用 | 仅内存 + 提示 | REQ-COLLAB-012 |
| 10 | SVG | 栅格化为 PNG，原件丢弃 | REQ-ATTACH-005 · 02 §7 · 07 §2.4 |
| 11 | 单篇正文上限 | 软限 10 MB 提示，硬限 20 MB 只读 | REQ-EDITOR-017 · 03 §11.5 · 07 §5 |
| 12 | 每用户配额 | 5 GB，413 `QUOTA_EXCEEDED` | REQ-OPS-008 · 07 §5 |
| 13 | 离线列表 | 显示最近缓存并标「离线」 | REQ-MOBILE-004 · 08 §5 |
| 14 | 外链卡片 | 一期只存 URL + 手填标题；抓取属二期，规则在 07 §2.5 | REQ-LINK-004 |
| 15 | 任务 Peek 端点 | 复用 `GET /tasks/:id` | REQ-UI-007 |
| 16 | guest 解决评论 | 不可（按矩阵） | REQ-COMMENT-003 |
| 17 | member 兼空间 viewer | 取较高者 = member，是本意；viewer 只对 guest 有意义 | 01 §5 |
| 18 | presence | P2 Phase 2；在线 = SSE 带 `spaceId` 注册且 60s 内有心跳 | REQ-NOTIF-013 · 02 §6 |
| 19 | 第 N 程 | 年内序号，前缀年份；季度叫「长程」 | REQ-CYCLE-007 |
| 20 | 今日 / 收件箱 API | 服务端 `GET /tasks?view=today\|inbox`，时区在服务端算 | REQ-TASK-005/006 · 02 §9 |
| 21 | 空间删除权限 | 仅工作区 owner/admin；空间 admin 只能归档 | REQ-SPACE-003 · 01 §5 |
| 22 | collab 票据 | 绑 `entryId` + `jti`，一票一文档 | REQ-COLLAB-002 · 02 §9 · 03 §4.2 |
| 23 | 登录锁定 | 连续失败 10 次锁 15 分钟，403 `ACCOUNT_LOCKED` | REQ-AUTH-012 · 07 §5 |
| 24 | 注销 | 匿名化保留 user 行 | 07 §4 |
| 25 | events 保留 | 已处理 180 天后直接删除，不建归档表 | 07 §3 |
| 26 | 回收站参数 | 统一 `?deleted=1` | REQ-ENTRY-007 · 02 §5 |
| 27 | 无空间记录 | 取消 `space_id` 可空；一律落个人空间且 `private` | REQ-ENTRY-003 · 01 §3.4 |
| 28 | WS 关闭码 | 4401 未鉴权 / 4403 无权或文档不匹配 / 4409 重放 / 4429 连接超限 | REQ-COLLAB-002 · 016 · 03 §4.2 |
| 29 | 派生失败列 | `derived_error` + `derived_at`，重试作业 `derive.retry` | REQ-COLLAB-009 · 01 §3.4 |
| 30 | 列表快捷键 | `Space` 勾选完成、`p` Peek、`c` 只做新建 | REQ-TASK-020 · REQ-UI-007 · 04 §6 |
| 31 | 今日 / 收件箱 | 排除 `done / cancelled` | REQ-TASK-005/006 · 02 §9 |
| 32 | `limit` / `sort` 超范围 | 422（不钳制） | REQ-TASK-004 · 02 §4 · 07 §5 |
| 33 | Markdown 导入 | 二期（Phase 3），保留编号不验收 | REQ-EXPORT-004 |
| 34 | SSE 连接 | 每用户 3 条，超出关最旧；每帧带 seq `id` | REQ-NOTIF-003 · 02 §6 |
| 35 | 成员移除 | 拆为吊销 / 内容归属 / 指派三条；置空指派发 `task.unassigned` | REQ-WS-004 · 012 · 013 · 01 §4 |
| 36 | 停用 / 注销 / 转移内容 | 各自端点与 REQ；注销匿名化、需二次确认 | REQ-WS-014 · 015 · 016 · 02 §9 |
| 37 | 审计 action | 只能取 01 §3.12 枚举 | REQ-WS-017 |
| 38 | 魔法链接 | 对陌生邮箱不建号 | REQ-AUTH-002 · 07 §2.1 |
| 39 | API Key | 300/min/Key、不超过持有者角色、可过期 | REQ-AUTH-010 · 02 §2 |
| 40 | impersonation | 一期禁用 | REQ-AUTH-015 |
| 41 | 横切需求 | 幂等键全覆盖、Problem Details 信封、他人通知 404、导出权限、孤儿附件、扇出幂等、访问变更断连 | REQ-OPS-013/014 · NOTIF-015/016 · EXPORT-008 · ATTACH-011 · COLLAB-016 |
| 42 | CI 门槛 | 按本次实际运行的层计算；「手工」层不进门槛 | §20 · 05 §5 |
| 43 | 测试层「—」 | 全部改为「手工」 | REQ-OPS-006 · 011 · 012 |
