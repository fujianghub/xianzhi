# 07 安全与数据

> 状态：已采纳 · 版本：v3 · 更新：2026-09-23 · 最后对照代码：2026-09-24（Phase 1：§3 作业、§4 生命周期、§5 限额） · 依据 ADR-0001 §4.6 §9.4、01 §1 §3.8 §3.12 §4、02 §2 §7 §9、05 §8。多用户邀请制下的威胁模型、数据保留、账号生命周期、限额。散在各规范的安全与保留规则以本文集中表为准；本文与其他规范冲突时，先改本文再改代码。需求编号见 `00-requirements.md` 的 REQ-AUTH-* / REQ-WS-* / REQ-ATTACH-* / REQ-OPS-*。

---

## 1. 信任边界与资产

```
浏览器 ──HTTPS/WSS──▶ Caddy ──▶ xz-app(8010) ──▶ PG(5432, 容器网络)
                              └▶ xz-collab(8011) ─┘
MCP / 脚本 ──Bearer API Key──▶ xz-app
pg-boss worker（xz-app 进程内）──▶ SMTP(腾讯云 SES) / WebPush 端点 / 外部 URL（外链卡片）
```

信任边界：Caddy 之外全部不可信；容器网络内 PG 只接受两个服务；`.env` 只在容器内存在。

| 资产 | 存放 | 谁能读写 | 泄露后果 |
|---|---|---|---|
| 会话 Cookie | 浏览器（HttpOnly/Secure/Lax）、`session` 表 | 浏览器自动携带；服务端 Better Auth | 冒充用户，直到会话吊销（默认 7 天） |
| collab 票据 | 内存（前端 provider）、5 分钟 | 前端 JS 可读（设计如此） | 5 分钟内只能开该 `entryId` 的连接（一票一文档，`jti` 一次性），读写权仍按 `can()` |
| API Key（`xz_` 前缀） | `api_key` 表存哈希；明文只在创建时返回一次 | 持有者 | 按 scope 越权，直到吊销；写入 `audit_log` |
| `BETTER_AUTH_SECRET` | `.env` | 容器进程 | 伪造会话 / 签名，全站沦陷；轮换 = 全员下线 |
| `COLLAB_TOKEN_SECRET` | `.env` | xz-app 签、xz-collab 验 | 伪造任意用户 WS 连接 |
| VAPID 私钥 | `.env` | worker | 冒充本站向订阅者推送 |
| SMTP 凭据 | `.env` | worker | 冒名发信、配额被耗 |
| age 备份私钥 | **离站**（不在服务器） | 运维本人 | 备份可解密 |
| `entries.ydoc` 正文 | PG | 经 `can()` | 私有记录泄露 |
| 附件文件 | `data/uploads/`（卷 `xz_data`） | 经 `/api/v1/attachments` 鉴权 | 图片 / PDF 泄露 |
| 备份 dump | `data/backups/`（age 加密）+ 备份盘 | 运维 | 加密前提下无后果；密钥同泄则全量泄露 |
| 审计日志 | `audit_log` | admin 只读 | 行为画像泄露；被篡改则失去追责 |
| 通知 / 邮件内容 | `notifications`、SMTP 传输 | 接收者 | 标题级信息泄露（扇出前 `can()` 已限） |

---

## 2. 威胁模型

状态列：**已覆盖** = 现有规范已有缓解；**需新增** = 本文新增要求，实现时必须落地。

### 2.1 认证与会话

| 威胁 | 场景 | 缓解 | 状态 |
|---|---|---|---|
| 自助注册滥用 | 攻击者批量建号 | `disableSignUp`，只经邀请（01 §2） | 已覆盖 |
| 邀请链接重放 | 链接被转发、被多人使用 | 邀请**一次性**、7 天过期、接受时绑定邀请邮箱（邮箱不匹配 → 拒绝）；接受后 `invitation.status = accepted` 不可再用 | 需新增 |
| 暴力破解登录 | 密码字典 | 登录限流 10/min（02 §2）；连续失败 10 次锁定 15 分钟并写 `audit_log`；2FA 可开 | 需新增（锁定） |
| 会话固定 / 劫持 | XSS 或网络窃取 Cookie | HttpOnly/Secure/SameSite=Lax；CSP 无 `unsafe-inline` 脚本（02 §2）；登录成功后轮换会话 id（Better Auth 默认） | 已覆盖 |
| 会话吊销不彻底 | 改密 / 被移除 / 被封禁后旧会话与 WS 仍活 | 改密、封禁、移除成员、吊销 API Key 时：同事务删除该用户全部 `session` 行，提交后经进程内 `EventBus` 广播 `user.revoked(userId)`，collab 断开其所有连接（关闭码 4403）、SSE 关闭其连接。空间成员或记录可见性变更时广播 `entry.access_changed(entryId)`，collab 对该文档所有连接重跑 `can()`，无权者断开。不做定时复核（03 §4.2） | 需新增 |
| 管理员模拟登录（impersonation） | Better Auth `admin` 插件的 impersonate 等于持有任意用户会话 | **一期禁用**：`admin` 插件不暴露 impersonate 能力（不注册路由）。若二期开启：每次写 `audit_log(action=admin.impersonated, target=userId)`，禁止对 owner 使用，会话 1 小时过期 | 需新增 |
| 魔法链接绕过邀请 | `magicLink` 插件默认对陌生邮箱自动建号，全局 `disableSignUp` 不覆盖插件 | `magicLink({ disableSignUp: true })`；陌生邮箱请求魔法链接返回与已注册相同的 200（不泄露存在性），但不发信、不建号 | 需新增 |
| 2FA 设备丢失 | 无法出示 TOTP | 启用 2FA 时生成 10 个一次性恢复码（Better Auth `twoFactor` 内置），提示用户离线保存；全部用完则须 admin 后台重置 2FA 并写审计 | 需新增（流程） |
| passkey 混淆 | 多设备 | Better Auth `passkey` 插件；仅作为第二因子或无密码登录，不替代邀请 | 已覆盖 |
| 密码重置链接泄露 | 邮件被转发 | 重置 token 一次性、15 分钟；重置成功即吊销所有会话 | 需新增 |

### 2.2 授权

| 威胁 | 场景 | 缓解 | 状态 |
|---|---|---|---|
| 越权读写 | 直接猜 id 访问他人记录 | `can()` 唯一入口（01 §5）；不可见资源统一 404（02 §2）；UUID v7 不可猜但**不依赖此** | 已覆盖 |
| 列表泄露 | 列表接口未过滤 | `visible*Where()` 与 `can()` 共用规则表（01 §5 不变量 3） | 已覆盖 |
| 角色提升 | member 改自己角色 | `PATCH /workspace/members/:userId` 仅 admin；owner 只能由 owner 转让；最后一个 owner 不可降级 | 需新增（最后一个 owner） |
| 空间成员越权 | 空间 admin 删空间 | 空间删除仅工作区 owner/admin（01 §5 `space.delete`）；空间 admin 只能归档 | 已覆盖 |
| 附件裸访问 | 猜附件 id 下载 | `attachment.read` 跟随 target 的 read（01 §5）；无 target 的孤儿附件只有 owner 可读 | 需新增（孤儿附件规则） |
| 通知泄露 | @ 无权者 | 扇出前 `can(read)`（01 §4） | 已覆盖 |
| 搜索泄露 | 搜索绕过可见性 | `/search` 走 `visible*Where()`；`ts_headline` 只在可见行上生成 | 需新增（写进 02 §4） |

### 2.3 WebSocket 协同

| 威胁 | 场景 | 缓解 | 状态 |
|---|---|---|---|
| 票据重放 | 抓到票据在 5 分钟内另开连接 | 票据载荷 `{ userId, entryId, jti, exp }`，一票一文档（02 §9）；服务端拒绝 `jti` 二次使用（内存 LRU，5 分钟）；`onAuthenticate` 校验 `entryId` 等于文档名 | 已覆盖 |
| 票据伪造 | 猜 HMAC | `COLLAB_TOKEN_SECRET` ≥ 32 字节随机；HMAC-SHA256 | 已覆盖 |
| 跨站 WS | 恶意站点发起 WS | 不用 Cookie 鉴权（03 §4.2）；`onAuthenticate` 校验 `Origin` 为 `APP_URL` | 需新增（Origin） |
| 只读连接写入 | readOnly 连接推 update | Hocuspocus `connection.readOnly` 丢弃 update（03 §4.2） | 已覆盖 |
| 文档名猜测 | 连接 `entry:<uuid>` | 每次连接 `can(entry.read)`；不存在与无权同样拒绝 | 已覆盖 |
| 连接耗尽 | 一个用户开几百连接 | 每用户并发 WS ≤ 10（§5），超限拒绝新连接，关闭码 4429 | 需新增 |
| 大 update 洪水 | 单条 update 数十 MB | 单条 update ≤ 2 MB，文档 ≤ 20 MB（§5）；超限断开并写日志 | 需新增 |
| 权限变更后连接残留 | 被移出空间后仍连着 | 见 2.1「会话吊销」：`space_members` 或 `entries.visibility / space_id` 变更 → 广播 `entry.access_changed(entryId)` → collab 重跑 `can()`，无权者 4403 断开；无定时复核 | 需新增 |

### 2.4 文件上传与下载

| 威胁 | 场景 | 缓解 | 状态 |
|---|---|---|---|
| SVG 脚本注入 | 上传含 `<script>` / `onload` 的 SVG，被 `<img>` 或直接打开 | **SVG 一律经 sharp 栅格化为 PNG 存储**（原 SVG 丢弃）；若必须保留矢量（二期），则 `Content-Disposition: attachment` + 响应头 `Content-Security-Policy: sandbox` | 需新增 |
| MIME 伪造 | `.png` 实为 HTML | 按**魔数**（`file-type` 包）判定 mime，与扩展名不符则拒 415；白名单外拒；响应 `X-Content-Type-Options: nosniff`（`secure-headers` 已含） | 需新增（魔数） |
| 路径穿越 | `filename=../../.env` | `storage_key` 完全由服务端生成（01 §3.8），原始 `filename` 只存列、只用于 `Content-Disposition`（RFC 5987 编码） | 已覆盖 |
| 解压炸弹 / 超大文件 | 100 MB PDF ×N | 按 mime 上限（02 §7）+ 每用户配额（§5）；流式写盘，超限即中断返回 413 | 已覆盖 |
| 图片处理 DoS | 恶意像素尺寸（decompression bomb） | sharp `limitInputPixels: 50e6`，超限 422 `VALIDATION`（`errors[].path = file`）；变体与 blurhash 在上传请求内**同步**生成（响应含 `width/height/blurhash/variants`，02 §7、03 §11.4），单张处理超 10 s 视为失败 422；上传限流 30/min 与配额是并发保护，不引入异步作业 | 需新增 |
| 下载被缓存到公共代理 | `Cache-Control` 错误 | `private, max-age=86400`（02 §7）；Caddy 不暴露 `data/`（05 §7） | 已覆盖 |
| 通过附件跨用户去重探测 | sha256 命中返回既有记录 → 探测他人是否上传过某文件 | 去重只在**同一 workspace + 同一 owner** 范围内命中；跨用户不去重 | 需新增 |
| 导出包含他人内容 | `POST /exports scope=workspace` | 导出内容按发起人 `visible*Where()` 过滤；`scope=workspace` 仅 admin | 需新增 |

### 2.5 外部内容抓取（外链卡片、语雀 / 简斋等）

| 威胁 | 场景 | 缓解 | 状态 |
|---|---|---|---|
| SSRF | `external_url=http://169.254.169.254/` 或 `http://xz-pg:5432` | 抓取只对**域名白名单**（简斋域名、`github.com`）开放；解析后 IP 拒绝私网 / 环回 / 链路本地 / 云元数据段；不跟随跨域重定向；超时 5 s；响应 ≤ 1 MB；只取 `<title>` / `og:*`；在 pg-boss 作业中执行，不在请求线程 | 需新增 |
| 内容注入 | 抓回的 title 含 HTML | 存纯文本，渲染经 React 转义 | 已覆盖 |
| 远程图片防盗链 / 追踪 | 正文引用外域图片 | 编辑器**不允许外域图片 URL**（`image.src` 只接受 `xz:attachment/`），粘贴外图时下载为附件（走 2.4 校验）；导入时同理 | 需新增 |

### 2.6 通知与邮件

| 威胁 | 场景 | 缓解 | 状态 |
|---|---|---|---|
| 邮件深链被转发利用 | 收件人转发邮件 | 深链**不带 token**，点击后走正常登录 + `can()` | 需新增（写明） |
| 邮件内容泄露 | 摘要邮件含正文片段 | 邮件只含标题 + 一行摘要（≤ 100 字，来自 `payload`），不含正文；私有记录事件不进摘要 | 需新增 |
| WebPush 端点滥用 | 订阅被劫持 | 推送 payload 只含 `notificationId` + 标题；点击后由应用拉取；410 即删（01 §3.11） | 已覆盖 |
| 通知轰炸 | 脚本频繁 @ | 5 分钟合并（01 §4）+ 通用限流 600/min（02 §2）；数十人规模不设每小时上限 | 已覆盖 |
| 退订失效 | 用户无法关邮件 | 偏好页一期必做（ADR §9.2）；每封邮件带偏好页链接 | 已覆盖 |

### 2.7 API Key 与 MCP

| 威胁 | 场景 | 缓解 | 状态 |
|---|---|---|---|
| Key 泄露 | 写进 Claude Code 配置被同步 | scope 最小化（`read` 默认）；可设过期；创建 / 使用 / 吊销写 `audit_log`；泄露后吊销即失效；Key 的权限**不超过持有者角色** | 已覆盖（02 §2） |
| Key 越 scope | `read` key 调写端点 | `403 SCOPE`（02 §3） | 已覆盖 |
| MCP 工具滥用 | 二期 `log_bug` 被循环调用 | API Key 单独限流 300/min/Key；工具写操作与人类操作同走事件与审计（02 §10） | 已覆盖（02 §2） |
| Key 明文落日志 | 请求日志记 `Authorization` | pino 序列化器脱敏 `authorization` / `cookie` 头 | 需新增 |

### 2.8 队列与作业

| 威胁 | 场景 | 缓解 | 状态 |
|---|---|---|---|
| 毒消息反复重试 | 某事件 payload 让 worker 崩溃 | pg-boss 重试 3 次指数退避（02 §8）后进 `failed`；`failed` 写 `audit_log` + `system.backup_failed` 类系统事件通知 admin | 已覆盖 |
| 重复扇出 | `outbox.drain` 自循环与手动 `send` 并发；fanout 重试 | `outbox.drain` 是**自循环作业**（完成后 `send` 自身 `startAfter: 5`，pg-boss `singletonKey: 'outbox.drain'` 保证同时只有一个），不是 cron；取行用 `FOR UPDATE SKIP LOCKED`，入队 `notify.fanout` 与标 `processed_at` 在同一事务；`notify.fanout` 以 `event_id` 为 `singletonKey`；`notifications` 有 `(user_id, event_id)` 唯一约束，写入 `ON CONFLICT DO NOTHING`，重试天然幂等 | 已覆盖（01 §3.10 / §3.11） |
| 作业读到已删数据 | 软删后作业才跑 | 作业开始时重新 `can()` 与存在性检查，不信任 payload 里的权限结论 | 需新增 |
| 备份作业把密钥写进 dump | `pg_dump` 含 `api_key` 哈希、`session` | dump 加密（05 §8）；恢复演练时排除 `session` 表 | 已覆盖 |

### 2.9 基础设施与备份

| 威胁 | 场景 | 缓解 | 状态 |
|---|---|---|---|
| `.env` 入库 | 误 commit | `.gitignore` + `.env.example`；红线操作需确认（CLAUDE.md） | 已覆盖 |
| 备份盘被拿走 | 明文 dump | age 加密、私钥离站（05 §8） | 已覆盖 |
| 日志含敏感数据 | 正文、密码、token 进 stdout | pino `redact: ['req.headers.authorization','req.headers.cookie','*.password','*.token','*.ydoc','*.pmJson']`；请求日志不记 body | 需新增 |
| 依赖供应链 | 恶意包、GitHub prebuild | 原生依赖白名单（CLAUDE.md）；`pnpm-lock.yaml` 入库；CI 跑 `pnpm audit --audit-level high` 失败即阻断；`minimumReleaseAge` 7 天（pnpm 10+） | 需新增 |
| 容器以 root 运行 | 逃逸风险 | Dockerfile `USER node`；`data/` 卷属 node | 需新增 |
| 健康端点泄露 | `/api/health/details` 公开 | 已拆分（02 §1、05 §10） | 已覆盖 |
| 限流被绕过 | 多 IP | 登录按邮箱 + IP 双维度限流 | 需新增 |

---

## 3. 数据生命周期（保留 / 清理统一表）

| 数据 | 保留 | 清理动作 | 执行者（pg-boss） | 出处 |
|---|---|---|---|---|
| 软删对象（space / task / entry / comment） | 30 天 | 硬删行 + 关联附件文件 | `gc.soft-deleted` 每日 03:30 | 01 §1 |
| 未标记快照 | 最近 100 个 + 每天最后一个保留 90 天 | 删多余行 | `gc.snapshots` 每日 | 03 §5 |
| 标记快照 | 永久 | — | — | 03 §5 |
| 幂等键 | 24 h | 删行 | `gc.idempotency` 每小时 | 01 §3.13 |
| 孤儿附件（无 target） | 7 天 | 删行 + 文件 | `gc.attachments` 每日 | 01 §3.8 |
| SSE 补发缓冲 | 5 分钟 | 内存环形覆盖 | 进程内 | 02 §6 |
| 通知（已读） | 90 天后归档（`archived_at`），归档 1 年后删 | 更新 / 删行 | `gc.notifications` 每日 | 本文 |
| 通知（未读） | 永久，直到已读 | — | — | 本文 |
| 通知投递记录（仅 in_app / webpush / email；sse 不落行） | 30 天 | 删行 | `gc.deliveries` 每日 | 本文、01 §3.11 |
| 审计日志 | 永久，只增 | — | — | 01 §3.12 |
| events（已处理） | 180 天后删除（活动流只看半年内；不建归档表） | 删行 | `gc.events` 每周 | 本文 |
| events（未处理） | 直到处理；> 1 小时未处理由 `outbox.drain` 发 `system.outbox_stalled`（admin，01 §4） | — | `outbox.drain`（自循环，5 s） | 01 §3.10 |
| 备份 dump | 14 天 | 删文件 | `backup.daily` 03:00 | 05 §8 |
| 导出 zip | 7 天 | 删文件 + job 记录 | `gc.exports` 每日 | 本文 |
| collab 票据 | 5 分钟 | 过期即失效；`jti` LRU 5 分钟 | 进程内 | 02 §9 |
| 会话 | 7 天无活动过期（Better Auth 默认 `expiresIn`），活动时滚动续期 | Better Auth 清理 | Better Auth | 本文 |
| push 订阅 | 直到端点 410 或用户删除 | 删行 | 推送时 | 01 §3.11 |
| 登录失败计数 | 15 分钟 | 内存过期 | 进程内 | 本文 |
| 上传临时文件 | 请求结束 | 删除 | 请求处理 | 本文 |
| 派生列 `derived_error` | 直到重建成功 | `rebuild-derived` 重试 | `derive.retry` 每 10 分钟 | 03 §4.2 |

所有 `gc.*` 作业：幂等、单次上限 1000 行、失败写 `audit_log(action=gc.failed)`。

---

## 4. 账号与成员生命周期

```
邀请(invited) → 接受(active) → [停用(suspended)] → 移除(removed) → [注销(deleted)]
```

| 转换 | 谁触发 | 端点（02 §9） | 内容 | 会话 / API Key | collab / SSE | 通知（01 §4） | 审计 action（01 §3.12） |
|---|---|---|---|---|---|---|---|
| 邀请 | admin / owner | `POST /workspace/invitations` | — | — | — | 被邀者收邀请邮件（工作区邀请由 Better Auth `sendInvitationEmail` 钩子经 `templates/workspace-invitation.tsx` 发送，不进 events；`space.invited` 仅用于已是成员者被加入空间，01 §4.1） | `member.invited` |
| 接受 | 被邀者（邮箱匹配） | `POST /api/v1/workspace/invitations/:id/accept`（自建，02 §9；~~`POST /api/auth/organization/accept-invitation`~~ 需已登录会话，与「注册关闭」矛盾，2026-09-23 注）+ 同事务建个人空间 | 建 `member(role)` 与个人空间（01 §3.1）；默认加入 `visibility=workspace` 的空间「我的空间」列表 | 建会话 | — | `member.joined` → admin in_app | `member.joined` |
| 活跃 | — | — | 正常 | — | — | — | — |
| 停用（封禁） | admin | `POST /workspace/members/:userId/suspend`（内部调 Better Auth `admin.banUser`） | **保留**，仍可见于他人 | 全部会话删除；API Key 全部禁用 | `user.revoked` 广播，立即断开全部 WS（4403）与 SSE | 停止扇出给该用户 | `member.suspended` |
| 恢复 | admin | `POST /workspace/members/:userId/unsuspend` | — | 需重新登录 | — | 恢复 | `member.unsuspended` |
| 移除（退出工作区） | admin，或本人退出 | `DELETE /workspace/members/:userId`；本人退出 `DELETE /workspace/members/me` | 内容**保留**；作者名显示「已离开的成员」；其未完成任务的 `assignee_id` 置空并发 `task.unassigned`（接收者：该任务所在空间的 admin，01 §4.1）；admin 可批量转移作者（`POST /workspace/members/:userId/transfer-content { toUserId }`） | 同停用 | 同停用 | 删除其偏好、push 订阅 | `member.removed`；转移时 `member.content_transferred` |
| 注销（删除账号） | 本人（需 2FA 或密码确认）或 owner | `DELETE /me`（本人）/ `DELETE /workspace/members/:userId?purge=1`（owner） | **匿名化**：`user` 行保留 id，`email/name/avatar` 清空为 `deleted-<短id>`；内容保留 | 全部删除 | 全部断开 | 删除通知与偏好 | `user.deleted` |
| owner 转让 | 当前 owner | `POST /workspace/owner-transfer { toUserId }` | 双方角色互换 | — | — | `workspace.owner_transferred` → 双方 in_app + 邮件 | `workspace.owner_transferred` |

规则：最后一个 owner 不可移除 / 降级 / 注销（409 `CONFLICT_LAST_OWNER`），须先转让；停用与移除都必须在同一事务内完成会话删除，并在提交后向 collab 与 SSE 广播 `user.revoked(userId)`。审计 action 名一律取 01 §3.12 的枚举清单（唯一源，本文不复制）。

---

## 5. 限额表

| 限额 | 数值 | 超限行为 | 出处 |
|---|---|---|---|
| 每用户存储配额（附件） | 5 GB | 413 `QUOTA_EXCEEDED`；设置页显示用量 | ADR §9.4、本文、02 §3 |
| 单文件上限 | 图片 20 MB · PDF 100 MB · 其他 50 MB | 413 `PAYLOAD_TOO_LARGE` | 02 §7 |
| 单篇图片数 | 200 | 422（插入第 201 张时拒绝） | 03 §11.5 |
| 单篇正文 `ydoc` | 软限 10 MB / 硬限 20 MB | 10 MB 起提示并拒绝新附件节点；20 MB collab 拒绝 update，编辑器只读 | 本文、03 §11.5 |
| 单条 Yjs update | 2 MB | 断开连接，日志 | 本文 |
| 派生 `pm_json` | 5 MB | 派生跳过并记 `derived_error` | 本文 |
| 图片像素 | 50 MP | 422 `VALIDATION`（`errors[].path = file`） | 本文 §2.4 |
| 列表 `limit` | 默认 50，最大 200 | 超过 200 → 422 `VALIDATION` | 02 §4 |
| 批量操作 | 100 条 | 422 | 02 §5 |
| 搜索 `q` 长度 | 200 字符 | 422 | 本文 |
| 限流（通用） | 600/min/用户或 IP | 429 `RATE_LIMITED` | 02 §2 |
| 限流（登录） | 10/min/IP + 10/min/邮箱；连续失败 10 次锁 15 分钟 | 429 `RATE_LIMITED` / 403 `ACCOUNT_LOCKED` | 02 §2、02 §3、本文 |
| 限流（上传） | 30/min | 429 | 02 §2 |
| 限流（搜索） | 60/min | 429 | 02 §2 |
| 限流（API Key） | 300/min/Key | 429 | 本文 |
| 每用户并发 collab 连接 | 10 | 拒绝新连接，关闭码 4429 | 本文、03 §4.2 |
| 每用户 SSE 连接 | 3（多标签页） | 最旧的被关闭 | 本文 |
| 邀请有效期 | 7 天，一次性 | 410 `INVITATION_EXPIRED` | 本文 |
| 密码重置链接 | 15 分钟，一次性 | 410 | 本文 |
| 工作区成员上限 | 50（ADR §8 决定 6「数十人内」） | `POST /workspace/invitations` 第 51 人 → 422 `VALIDATION`，提示需架构重估 | ADR §9.4、02 §9 |
| 同屏 `backdrop-filter` | 6 | CI 失败 | 06 §8 |
| 外链抓取 | 5 s 超时、1 MB、白名单域名 | 卡片降级为纯链接 | 本文 §2.5 |

---

## 6. 隐私与合规（个人工具级）

- **数据出口**：任何成员可导出自己可见的内容（05 §8、02 §8）；admin 可导出全工作区。
- **删除权**：注销 = 匿名化（§4）；软删 30 天后硬删（§3）；用户可在设置页看到并删除自己的 API Key、push 订阅、会话列表。
- **不接第三方脚本**：无分析、无 CDN 字体（字体自托管，04 §2.2）；CSP `default-src 'self'`（02 §2）。
- **日志**：不记正文、密码、token、Cookie（§2.9）；请求日志保留 30 天（Docker 日志轮转 `max-size=50m, max-file=5`）。
- **邮件**：只含标题与 ≤ 100 字摘要，不含正文、不含附件。
- **备份**：加密后离站，私钥不在服务器（05 §8）。

---

## 7. 安全测试要求（05 §5 的补充，新路由与新钩子必带）

| 测试 | 层 | 断言 |
|---|---|---|
| 角色矩阵 | unit + api | owner/admin/member/guest/anon × 全部动作，与 01 §5 表一致（05 §5 已定 100%） |
| CSRF | api | 非 GET 且 `Sec-Fetch-Site: cross-site` → 403 `CSRF`；API Key 请求豁免 |
| 不可见 404 | api | 无权读 → 404 而非 403；明确无权动作 → 403 |
| 上传伪造 MIME | api | `.png` 扩展名 + HTML 内容 → 415 `UNSUPPORTED_MEDIA`；SVG → 存储为 PNG，文件内无 `<script>` |
| 上传超限 | api | 超 mime 上限 → 413，且磁盘无残留文件 |
| 路径穿越 | api | `filename=../x` → `storage_key` 不含 `..`，`Content-Disposition` 正确编码 |
| SSRF | unit + api | `http://127.0.0.1`、`http://169.254.169.254`、`http://xz-pg`、解析到私网的域名、重定向到私网 → 全部拒绝 |
| 票据过期 / 重放 / 伪造 | collab | 6 分钟前的票据、二次使用的 `jti`、错误签名 → `onAuthenticate` 拒绝 |
| WS Origin | collab | 非 `APP_URL` Origin → 拒绝 |
| 只读连接 | collab | viewer 推 update → 被丢弃，ydoc 不变 |
| 吊销联动 | collab + api | 移除成员 / 封禁 / 改密 → 其 session 行为 0、WS 在 1 s 内以 4403 断开、SSE 断开 |
| 可见性变更联动 | collab | 把用户移出空间或记录改 `private` → 广播 `entry.access_changed` → 该用户连接 1 s 内 4403 断开，其他人不受影响 |
| impersonation 禁用 | api | `POST /api/auth/admin/impersonate-user` → 404 |
| 魔法链接不建号 | api | 陌生邮箱 `POST /api/auth/magic-link` → 200 但 Mailpit 无邮件、`user` 表无新行 |
| fanout 幂等 | unit + api | 同一 `event_id` 跑两次 `notify.fanout` → `notifications` 每接收者 1 行 |
| 最后一个 owner | api | 降级 / 移除 / 注销 → 409 `CONFLICT_LAST_OWNER` |
| API Key scope | api | `read` key 调 POST → 403 `SCOPE`；`admin` scope 但持有者是 member → 仍按 member 判定 |
| 邀请一次性 | api + e2e | 同一链接第二次接受 → 410 `INVITATION_EXPIRED`；邮箱不匹配 → 403 |
| 通知可见性 | api | @ 无 `entry.read` 的用户 → 无 notification 行 |
| 去重范围 | api | 两个用户上传同 sha256 → 两条 attachments 行 |
| 日志脱敏 | unit | pino 输出不含 `authorization`、`cookie`、`ydoc` 字段 |
| 限流 | api | 第 11 次登录 → 429；`RateLimit-*` 头存在 |
| GC 幂等 | api | `gc.*` 连跑两次结果一致，且不删未到期数据 |

---

## 裁定记录（2026-09-23，与 00 §21 同步）

| 问题 | 裁定 |
|---|---|
| 空间删除权限 | 仅工作区 owner/admin；空间 admin 只能归档（01 §5 已拆 `space.delete`） |
| collab 票据绑定 | 绑 `entryId` + `jti`，一票一文档（02 §9、03 §4.2） |
| SVG | 栅格化为 PNG，原件丢弃；矢量保留属二期 |
| `events` 归档 | 180 天后直接删除，不建归档表 |
| 配额 | 每用户 5 GB；`ydoc` 软限 10 MB / 硬限 20 MB；`pm_json` 5 MB |
| 注销 | 匿名化保留 `user` 行 |
| 登录锁定 / 重置链接 | 15 分钟 / 15 分钟 |
| 成员移除时的指派 | 置空并通知空间 admin |
| 工作区邀请 vs `space.invited` | 工作区邀请走 Better Auth 钩子 + 同一模板模块，不进 events；`space.invited` 仅用于已成员（01 §4.1） |
| 外链抓取白名单 | 二期实现；域名放 `.env` `LINK_FETCH_ALLOWLIST`（逗号分隔），默认 `github.com` + 简斋域名，`gitee.com` 按需加 |
| outbox 接力（D11） | `outbox.drain` 为自循环作业（`startAfter: 5`，`singletonKey`），不是 cron；pg-boss cron 最小粒度 1 分钟 |
| 图片处理（D12） | 上传请求内同步生成变体与 blurhash，`limitInputPixels` 超限 422；不用异步作业 |
| 通知每小时上限（D18） | 删除；5 分钟合并 + 通用限流已够 |
| 权限变更联动（D19） | 只用 `user.revoked` 与 `entry.access_changed` 两种广播，不做定时复核 |
