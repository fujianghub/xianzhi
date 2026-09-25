# ADR-0008 开放注册 + 管理员审批；用户名登录；密码下限 8 位

> 状态：已采纳 · 2026-09-25 · **替代** ADR-0001 §8 决定 6 中「邀请制、不开放注册」一句（「单 Workspace 数十人内」不变，成员上限仍 50）；修订 REQ-AUTH-002，新增 REQ-AUTH-017 ~ 020。ADR-0006 头部「不引入用户名」的裁定同时被本文推翻（2026-09-25 用户裁定）。

## 背景

用户要求「支持用户注册」，并指定一个 root 管理员以「用户名 + 邮箱 + 密码」登录，密码为 9 位。现状：

- 只能经邀请加入：Better Auth `disableSignUp: true`，magicLink 同样禁止建号，会话中间件把无 `member` 行的用户视为未登录。
- 仓库公开、生产在公网：完全开放注册会被批量建号（拼图只挡不看图的脚本，见 ADR-0006）。
- 密码下限 10 位（Better Auth `minPasswordLength` 与 `create-owner` 双重校验），用户指定的密码只有 9 位。

用户在四个选项中选了「开放注册 + 待审批」「全局放宽到 ≥ 8 位」「支持用户名登录」。

## 候选方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 完全开放（注册即 member） | 最顺滑 | 公网刷号直接进工作区，读到 `visibility=workspace` 的空间 |
| **B. 开放注册 + 待审批** | 任何人可申请；只有 owner/admin 批准后才进工作区 | 多一步审批 |
| C. 注册需邀请码 | 无审批负担 | 邀请码外泄等同开放；与现有邮件邀请重复 |
| D. 开关可配（关闭 / 审批 / 开放） | 灵活 | 本轮不需要，徒增状态 |

## 决定

采用 B：

1. **入口**：不打开 Better Auth `/sign-up/email`（`disableSignUp` 保持 true，magicLink 也不建号），新增公开端点 `POST /workspace/join-requests`：`{ email, username, name, password }` + `x-captcha`（ADR-0006 同一拼图）。限流：每 IP 5 次 / 小时；待审批总量 ≥ 200 时 429。
2. **待审批态**：建 `user` + credential `account`（`emailVerified=false`）与 `join_requests(status=pending)`，**不建 `member`**。会话中间件的「无 member 即未登录」（REQ-AUTH-014）天然把它挡在所有 `/api/v1/*` 之外。
3. **登录提示**：`loginGuard` 在 Better Auth 验过密码（200）后检测待审批：删除刚建的会话、丢弃原响应（含 `Set-Cookie`），返回 403 `REGISTRATION_PENDING`。密码错仍是 401，不泄露申请状态。
4. **审批**：owner/admin（新动作 `member.approve`）在成员页「待审批」批准（可选角色，默认 member）→ 同事务写 `member`、个人空间、`status=approved`、审计 `member.approved`、事件 `member.joined`；驳回 → 删除该 user（级联 account / session / join_requests），审计 `member.rejected`，对方可重新申请。
5. **通知**：新事件 `member.requested` → 全部 owner/admin（站内 + SSE + 邮件）。注册者尚非成员且可能被删，审计与事件的 `actor_id` 留空（`audit_log` / `events` 对 `user` 无级联）。
6. **用户名**：启用 Better Auth `username` 插件（`user.username` 唯一、存小写；`display_username` 存原样）。规则 3–30 位 `[a-z0-9_.-]`、字母或数字开头、大小写不敏感。登录框「邮箱或用户名」：含 `@` 走 `/sign-in/email`，否则 `/sign-in/username`；两条路径都挂 `loginGuard`（锁定 / 限流按解析出的邮箱计，不存在的用户名按固定键计数）。
7. **密码下限** 10 → 8（Better Auth、共享 `passwordSchema`、`create-owner`、邀请页同一常量 `PASSWORD_MIN`）。
8. **root 账号**：`pnpm xz create-owner --username <u>` 支持用户名；owner 即最高权限（另把 Better Auth admin 插件角色设为 `admin`）。

## 后果

- 00：REQ-AUTH-002 修订、非目标划掉「自助注册」；新增 REQ-AUTH-017 ~ 020。01 §2 注、§3.14 `join_requests`、§3.12 审计 +3、§4 事件 +1、§5 矩阵 +1。02 §2 / §3 / §9。07 §2.1 威胁表、§5 限额。08 §1 路由 `/register`、§2.1b。glossary 加「注册申请」「用户名」。
- 迁移 `0006_signup_calendar`：`user` 加两列 + 唯一约束；`join_requests` 表；三处 CHECK 约束重建。
- 注册接口的 409 会暴露「某邮箱 / 用户名已注册」，以拼图 + IP 限流抬高批量探测成本后接受（07 §2.1）。
- 8 位密码弱于原 10 位；暴力破解仍受拼图、限流、锁定与可选 2FA 约束。
