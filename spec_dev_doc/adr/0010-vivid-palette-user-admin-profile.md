# ADR-0010 鲜艳 9 色板、日历拖选、owner 用户管理与个人资料

> 状态：已采纳 · 2026-09-25 · 修订 04 §2.1 色板（原 8 色 苔 / 琥珀 / 靛 / 赭 / 青 / 梅 / 灰 / 松）；新增 REQ-CAL-010、REQ-UI-035、REQ-WS-018 ~ 023、REQ-AUTH-021；迁移 0007（色名映射 + `audit_log_action_ck`）。

## 背景

用户反馈（2026-09-25）：
1. 日历要能「鼠标按住滑动选取周期」（如 9/9 → 9/11）直接新建；
2. 日历颜色「太暗黑」，想要蓝 / 橙 / 黄 / 红等鲜艳色；
3. root（owner，`fengfujiang`）要有用户管理；
4. 个人资料要能改头像、用户名、邮箱、密码。

现状：月视图只能单击某日建全天日程；色板是 04 §2.1 的 8 个低饱和自然色（空间 / 标签 / 日历共用，DB 对 `calendars.color` 有 check 约束）；成员页（owner + admin）已有改角色 / 停用 / 移除 / 审批 / 邀请，但不能直建用户、改他人资料、重置密码、删号；个人页只能改显示名 / 时区 / 周起始，`POST /me/avatar` 有后端无前端，`/me` 不返回头像与用户名。

## 决定

经提问，用户裁定：

1. **色板整体换新（不是只给日历另开一套）**：`PALETTE_COLORS = blue orange yellow red green purple pink cyan gray`（9 色，基于 Apple 系统色）。每色三枚 token：`-solid`（鲜艳实色，色条 / 圆点）、`-bg`（浅底）、`-fg`（字；对 `-bg` 日场 ≥ 4.7、夜场 ≥ 6.2，`check-contrast` 遍历 `PALETTE_COLORS`）。旧色名经迁移 0007 映射：moss / pine → green、amber → orange、indigo → blue、ochre → red、teal → cyan、plum → purple（spaces / tags / calendars 三表），`calendars_color_ck` 同步。
2. **日历色块样式 = 浅底 + 鲜艳左色条**（Apple 日历式）：`-bg` 底 + `-fg` 字 + 3px `-solid` 左边框；定时日程与侧栏的圆点用 `-solid`。不用整块实色填充（整月铺满太吵，黄底白字不达标）。
3. **拖选新建**：月格与周 / 日视图全天行，鼠标按住拖过多日 → 松开以 [起, 止] 打开全天新建；反向拖有效；按在按钮上不起选；Esc 取消；触屏不拖（留给滚动）。实现为共用 hook `useRangeSelect`（window 级 pointermove + `elementFromPoint` 找 `data-range-key`，拖完吞掉随后那次 click）。
4. **用户管理仅 owner**：新动作 `user.manage`（`null` = 列表 / 直建；UserRef = 对他人操作，不含本人）。新页 `/settings/workspace/users`：直建用户（立即成为成员，跳过审批）、改他人显示名 / 用户名 / 邮箱、重置密码（删其全部会话 + `user.revoked`）、强制下线（复用 `revoke-sessions`）、删号（`DELETE /workspace/members/:userId?purge=1`，按 07 §4 匿名化，原邮箱 / 用户名释放）。角色 / 停用 / 审批 / 邀请仍留在成员页（owner + admin），两页按「工作区角色」与「账号本身」分工。
5. **个人资料**：头像上传 / 更换 / 移除（`DELETE /me/avatar`；上传回写 `avatarAttachmentId`）；用户名免密改；**改邮箱须当前密码**（不走验证邮件：不依赖生产 SMTP，且单人工作台场景够用）；改密须当前密码，删除本人**其他**会话、保留当前会话且不广播 `user.revoked`（否则当前页的 SSE / 协作连接也被踢）。`/me` 与成员列表返回 `image` / `username`；`Avatar` 未给 `src` 时从成员缓存按 id 取头像，指派人 / 评论 / 提及处自动显示。
6. **收口 Better Auth 自带端点**：`/api/auth/update-user`、`/change-password`、`/change-email` 与 admin 插件 `/api/auth/admin/*` 路由层 404。前者绕过审计与唯一性校验、且 `image` 可写外链（追踪像素）；后者对 Better Auth `role=admin`（即 root）开放 set-password / remove-user 等，绕过 `can()`。
7. **审计**：+`auth.password_changed`、`user.created`、`user.updated`；重置他人密码记 `auth.password_reset(byAdmin)`，删号记 `user.deleted(byAdmin)`。

## 候选与否决

- **日历单独一套色板、空间 / 标签不动**：改动小，但同一个「颜色」概念出现两套名字与 token，选择器与文档分叉——用户否决。
- **保留旧色名只调色值**：无迁移，但 `moss` 显示成绿、`ochre` 显示成红，名实不符是长期债——否决。
- **整块实色填充（Google 日历式）**：最鲜艳，但一屏几十条色块过吵，且黄色需换深字，风格与玻璃材质冲突——用户选色条式。
- **改邮箱发验证链接（Better Auth changeEmail）**：更安全，但依赖生产邮件可达；当前场景以「当前密码」确认即可——用户选密码确认。后续若开放更多外部用户可改为验证链接。
- **用户管理并进成员页**：少一页，但 admin 能看到却不能用的按钮多、权限分支复杂——否决，按 owner / admin 边界分页。
- **直接用 Better Auth admin 插件的 createUser / setUserPassword**：省代码，但不写业务审计、不建 member 与个人空间、不过 `can()`——否决，并顺手关闭这些端点。

## 后果

- 00 +9 条 REQ（CAL-010、UI-035、WS-018 ~ 023、AUTH-021），REQ-CAL-001 / TAG-001 / COLLAB-010 / UI-033 的色板描述加注；01 §3.12 审计 +3、§5 +`user.manage`、日历默认色；02 §2 注 + §9 +7 条路由（`?purge=1` 改为已实现）；04 §2.1 色板改写；07 §4 生命周期表 +3 行与注；08 §1 路由 +1、§2.13 / §2.17 加注；glossary 色板行。
- 迁移 0007：色名 UPDATE 三表 + 两个 check 约束重建；**不可自动回滚**（旧 moss / pine 都并到 green）。
- 视觉基线（`e2e/design.spec.ts` / `feedback.spec.ts`）因色板改变需在用户确认新视觉后重拍。
- 协作光标色随之变为 9 色哈希（取 `-fg`）；头像首字母底色同。
