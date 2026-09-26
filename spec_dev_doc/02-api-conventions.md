# 02 API 约定

> 状态：已采纳 · 版本：v3 · 更新：2026-09-25 · 最后对照代码：2026-09-25（`/workspace/join-requests*`、`/calendars`、`/calendar-events`、`/sign-in/username`；`check-openapi-drift` 零差异） · 依据 ADR-0001 §4。Hono 路由、错误、分页、鉴权、实时、文件、MCP 的权威约定。新路由不符合本文即为 bug。§9 路由表是 `scripts/check-openapi-drift.ts` 的机器契约（05 §6）。

---

## 1. 总则

| 项 | 约定 |
|---|---|
| 前缀 | `/api/v1`；Better Auth 挂 `/api/auth/*`；健康 `/api/health`（无鉴权，只返回 `{ ok: true }`）；详情 `/api/health/details`（admin，见 05 §10）；登录拼图 `GET /api/captcha`（匿名，IP 30/min，`no-store`，ADR-0006） |
| 风格 | 资源型 REST，JSON；路径复数名词、**扁平**（`/tasks?spaceId=`，不做 `/spaces/:id/tasks`）；动作用子资源（`POST /entries/:id/snapshots`） |
| 类型直通 | 每个路由文件 `export const tasks = new Hono<Env>().get(...).post(...)`，根 `app.route('/tasks', tasks)`；`export type AppType = typeof app`；前端 `hc<AppType>()`。**禁止**在路由上使用会丢类型的中间写法（先 `const r = new Hono(); r.get(...)` 不链式） |
| 校验 | `@hono/zod-validator`，schema 一律来自 `src/shared/schemas/*`；`json` / `query` / `param` 三处都校验 |
| 字段命名 | JSON `camelCase`；时间 ISO 8601 带时区偏移；日期 `YYYY-MM-DD`；ID 字符串 |
| 版本 | 新增字段/端点自由；删字段、改语义 → `/api/v2`；一期不会到 v2 |
| 分层 | `routes/` 只做：校验 → 取 `c.var.user` → 调 `services/` → 序列化。**业务与 `can()` 调用在 `services/`**，jobs、MCP、CLI 复用同一 service，不重复权限逻辑 |

---

## 2. 鉴权与授权

- **会话**：Better Auth Cookie；中间件 `session()` 解析后写入 `c.var.user`、`c.var.workspaceRole`；未登录 401。
- **API Key**：`Authorization: Bearer xz_<key>`（Better Auth apiKey 插件）；用于 MCP、脚本；scope 限定（`read`、`write`、`admin`）；**有效权限 = min(scope, 持有者当前工作区角色)**，持有者降级或移除即同步收窄；可选 `expiresAt`；单 Key 限流 300/min；创建、使用（每日首次）、吊销写入 `audit_log`（07 §2.7）。
- **注册与用户名登录**（注 2026-09-25，ADR-0008）：Better Auth `/sign-up/email` 保持关闭；自助注册只走 `POST /workspace/join-requests`（公开，须 `x-captcha`，每 IP 5 次 / 小时），建号但不建 `member` → 待审批。`/sign-in/username` 与 `/sign-in/email` 共用 `loginGuard`（拼图、锁定、限流按解析出的邮箱计）；待审批账号密码正确时撤销刚建的会话、不下发 Cookie，返回 403 `REGISTRATION_PENDING`。
- **改资料 / 改密只走 `/api/v1`**（注 2026-09-25，ADR-0010）：Better Auth `/update-user`、`/change-password`、`/change-email` 与 admin 插件 `/admin/*` 一律路由层 404——前者绕过审计与唯一性校验（且 `image` 可指向外链），后者绕过 `can()`；用户管理走 `/workspace/users*`，本人走 `/me/account`、`/me/password`、`/me/avatar`。
- **会话吊销**：admin 吊销某用户全部会话走 `POST /workspace/members/:userId/revoke-sessions`（包装 Better Auth admin `revokeUserSessions`），同时广播 `user.revoked` 断其 WS / SSE（07 §4）。
- **Better Auth 插件约束**：`magicLink({ disableSignUp: true })`，陌生邮箱请求魔法链接不建号、响应与已注册邮箱一致；admin 插件的 impersonation（模拟登录）**一期禁用**（`impersonationSessionDuration: 0` 且不暴露端点），二期若启用须写 `audit_log(admin.impersonated)` 且不得对 owner 使用（07 §2.1）。
- **授权**：service 内 `assertCan(user, action, resource)`，失败抛 `ForbiddenError` → 403；**列表**用 `visible*Where(user)`（01 §5 不变量 3）。对不可见资源统一返回 404 而非 403（不泄露存在性）；**明确知道存在但无权的动作**（如空间成员修改归档空间）返回 403。
- **CSRF**：Cookie `SameSite=Lax`；所有非 GET 请求校验 `Origin`/`Sec-Fetch-Site` 为同站，否则 403；API Key 请求豁免。
- **安全头**：`hono/secure-headers`；CSP：`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' wss://<APP_HOST>; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'`（Tiptap/KaTeX 需 inline style）。
- **限流**：内存令牌桶，按 `userId` 或 IP；默认 600/min，上传 30/min，搜索 60/min，API Key 300/min/Key；返回 `RateLimit-Limit/Remaining/Reset`，超限 429 `RATE_LIMITED`。登录按 **IP 与邮箱双维度**各 10/min；同一账号连续失败 10 次锁定 15 分钟 → 403 `ACCOUNT_LOCKED`（正确密码也拒绝），并写 `audit_log(auth.locked)`（07 §5）。邮箱密码登录另须头 `x-captcha: <id>:<x>`（或邀请通行证 `pass:<id>`），在锁定与限流之后校验，失败 400 `CAPTCHA_INVALID`、不计入失败次数（ADR-0006）。

---

## 3. 响应与错误

- 成功：`200` 直接返回资源（无信封）；创建 `201` + 资源；删除/无内容 `204`；异步作业 `202 { jobId }`。
- 列表：`{ items: T[], nextCursor: string | null, total?: number }`（`total` 仅在 `?withTotal=1` 时计算）。
- 错误：**RFC 9457 Problem Details**，`Content-Type: application/problem+json`：

```json
{ "type": "https://xz.local/errors/conflict", "title": "Conflict", "status": 409,
  "code": "CONFLICT_STALE", "detail": "记录已被他人修改", "current": { ...最新资源 }, "errors": [ { "path": "title", "message": "..." } ], "requestId": "..." }
```

| status | code | 场景 |
|---|---|---|
| 400 | `BAD_REQUEST` | 语法/参数不可解析 |
| 400 | `CAPTCHA_INVALID` | 登录拼图缺失 / 错位 / 过期 / 已用（ADR-0006） |
| 401 | `UNAUTHENTICATED` | 无会话 |
| 403 | `FORBIDDEN` / `CSRF` / `SCOPE` / `ACCOUNT_LOCKED` / `REGISTRATION_PENDING` | 权限、跨站、API Key scope、登录连续失败锁定（07 §5）、注册申请待审批（ADR-0008） |
| 404 | `NOT_FOUND` | 不存在或不可见 |
| 409 | `CONFLICT_STALE`（带 `current`）/ `CONFLICT_UNIQUE` / `CONFLICT_LAST_OWNER` / `CONFLICT_IN_FLIGHT` | 乐观锁 / 唯一约束 / 最后一名 owner 不可降级、移除、注销（07 §4）/ 同一 `Idempotency-Key` 的请求仍在处理中（注 2026-09-24） |
| 410 | `INVITATION_EXPIRED` / `LINK_EXPIRED` | 邀请或重置链接过期、已使用（07 §5） |
| 413 | `PAYLOAD_TOO_LARGE` / `QUOTA_EXCEEDED` | 单文件超限 / 每用户配额超限（07 §5） |
| 415 | `UNSUPPORTED_MEDIA` | mime 不在白名单或魔数与扩展名不符（07 §2.4） |
| 422 | `VALIDATION`（带 `errors[]`） | Zod 失败 |
| 429 | `RATE_LIMITED` | |
| 500 | `INTERNAL` | 只带 `requestId`，不带栈 |

客户端按 `code` 映射 i18n 文案；`detail` 仅用于日志与开发。服务端错误类：`AppError(status, code, detail?, extra?)`，全局 `app.onError` 统一序列化并打日志。

---

## 4. 分页、筛选、排序

- **游标分页**：`?cursor=&limit=`；`limit` 默认 50、最大 200，**超过 200 → 422 `VALIDATION`**（不钳制）；游标 = base64url(`[sortValue, id]`)，服务端用 `(sort_col, id) < (?, ?)` 键集查询；**不提供 offset**。
- **排序**：`?sort=-updatedAt,title`（`-` 降序）；每资源白名单见 §9 各 `GET` 行，白名单外 → 422。
- **筛选**：同名查询参数，多值**逗号分隔**（`status=todo,doing`；前端数组型 search param 序列化为同一形式，08 §2）；**筛选参数指向不可见资源**（如 `spaceId`、`cycleId`、`assigneeId` 指向无权对象）→ 404（与详情一致，不返回空列表）；范围 `dueBefore/dueAfter`（ISO）；**任何 `*Id` 参数接受 `me` 别名**（`assigneeId=me`、`authorId=me`、`ownerId=me`）；布尔 `1/0`。**筛选参数指向当前用户不可见的资源**（如 `spaceId` 为不可见空间、`cycleId` 为他人周期）→ 404 `NOT_FOUND`，不返回空列表（与 §2「不泄露存在性」一致）。
- **视图别名**（tasks）：`view=today|inbox` 由服务端按 `c.var.user.timezone` 计算，定义见 §9 `GET /tasks`；`due=today|week|overdue` 同样服务端计算（`today` = 本地今日 00:00–24:00；`week` = 本地本周（`week_starts_on`）；`overdue` = `dueAt < now` 且未完成）。
- **轻量列表**：列表永不返回 `ydoc/pmJson/descriptionPm/plain`；详情端点才返回；列表附 `excerpt`（前 160 字）。
- **搜索**：`GET /search?q=&types=task,entry&spaceId=&limit=`；返回 `{ groups: { tasks: [...], entries: [...] }, cursors: { tasks, entries } }`，规则见 §4.1。

### 4.1 搜索规则

| 项 | 规则 |
|---|---|
| 范围 | `tasks.title + description_plain`、`entries.title + plain`、`tags.name`；评论一期不入索引 |
| 权限 | 先用 `visibleTasksWhere(user)` / `visibleEntriesWhere(user)` 过滤，再排序；软删与归档不入结果（01 §5） |
| 分词 | 索引与查询用**同一个**函数 `tokenize()`（`@node-rs/jieba` `cut` 精确模式，小写化，去停用词），写入 `to_tsvector('simple', tokens.join(' '))`；查询 ≤ 2 个字符时不走 tsvector，改走 `pg_trgm` 的 `ILIKE '%q%'`（GIN trgm 索引）兜底 |
| 排序 | `ts_rank_cd(tsv, query)`，标题权重 `A`、正文 `D`（`setweight`）；乘近期系数 `1 / (1 + days_since_updated / 30)`；`pinned` 记录 +0.2；同分按 `updated_at desc, id` |
| 高亮 | `ts_headline('simple', plain, query, 'MaxFragments=2, MaxWords=24, MinWords=8, StartSel=<mark>, StopSel=</mark>')` → `highlight`；片段只含 `<mark>` 标签，其余文本已转义；前端只允许渲染 `mark`，不做 `dangerouslySetInnerHTML` 之外的解析 |
| 分组与数量 | `groups.tasks` / `groups.entries` 各自独立游标（`cursors: { tasks, entries }`）；每组默认 10，`limit` 上限 50；`types` 缺省两组都查 |
| 空查询 | `q` 为空时返回最近访问的 10 个对象（客户端 `recent` 列表回传 id，服务端按可见性过滤后返回） |
| 筛选 | `spaceId`、`kind`、`status`、`tag` 与列表接口同名同义 |
| 性能 | 1 万条内本机 P95 ≤ 150 ms；超出或需要错别字容忍时按 ADR §4.3 升级 Meilisearch，接口形状不变 |

注（2026-09-24，T1-025）实现偏差与细化：
- 「≤ 2 个字符只走子串」改为「只有 1 个字符或分不出词才只走子串」。中文两个字就是一个词（如「缓存」），原规则会让最常见的查询搜不到正文。
- 高亮不用 `ts_headline`：`simple` 配置的默认解析器把连续中文当成一个词，无法高亮「缓存」。改为在 JS 里按 jieba 分词结果定位，其余文本转义，只输出 `<mark>`，片段数与长度同表。
- tsv 改为「标题权重 A + 正文权重 D」（`services/derived.ts weightedTsv`），记录的标题此前没进 tsv。升级后需执行一次 `xz rebuild-derived`（迁移 0005 注释）。
- 标题 / 标签子串命中加 0.1 分；空 `q` 用 `recent=id1,id2` 回传最近访问（≤ 20 个）；分组游标为 `cursorTasks / cursorEntries`；每用户 60 次 / 分钟。

---

## 5. 写操作

- **乐观锁**：`PATCH` body 带 `ifUpdatedAt`（详情返回的 `updatedAt` 原样回传）；不匹配 → `409 CONFLICT_STALE` + `current`；富文本正文不走 API（Yjs）。
- **幂等**：以下创建端点接受 `Idempotency-Key` 头（UUID）：`POST /tasks`、`/entries`、`/spaces`、`/comments`、`/tags`、`/links`、`/attachments`、`/exports`、`/cycles`、`/workspace/invitations`；`idempotency_keys(key, user_id, response_status, response_body, created_at)` 保存 24h；同 key 重复请求原样回放（同状态码同 body），不同 user 的同 key 视为不同。PWA 离线重试必带。
  - 注（2026-09-24，T1-037）实现细节：
    - 先占位（`response_status = 0`）再执行。并发的同 key 第二个请求得到 409 `CONFLICT_IN_FLIGHT`，不会重复创建。
    - 只记录 2xx。失败请求会删掉占位，允许用同一 key 重试。回放时带响应头 `Idempotent-Replayed: true`；key 不是 UUID 则 422。
    - `idempotency_keys` 的主键只有 `key`（01 §3.13），所以「不同 user 的同 key 视为不同」实现为：key 已被他人占用时照常处理，但不回放、不记录，绝不回放他人的响应。
    - 已挂载 `POST /tasks`、`/spaces`、`/entries`；其余创建端点随各自任务接入，由 T1-040 统一验收。
- **批量**：`POST /tasks/batch { ops: [{op:'update', id, patch}, …] }` 最多 100 条，整体事务，返回逐条结果；看板拖拽只发一条（改 `sortKey` + `status`）。
- **软删/恢复**：`DELETE` → 软删 204；`POST /:id/restore`；`DELETE /:id?permanent=1` 仅 owner/admin。回收站：`GET /tasks|/entries|/spaces?deleted=1` 只返回软删对象（本人可恢复的；owner/admin 全部），带 `deletedAt` 与剩余天数。
- **事件**：所有会触发通知的写在 service 内同事务 `emit(event)`（01 §3.10）；路由层不发事件。

---

## 6. 实时（SSE）

- `GET /api/v1/stream?spaceId=`（`text/event-stream`）；**每用户最多 3 条连接**（多标签页），第 4 条建立时关闭最旧的（07 §5）。
- **帧 id**：服务端为每用户维护进程内单调递增 `eventSeq`，**所有数据帧**（`notification` / `invalidate` / `presence`）都带 `id: <eventSeq>`；心跳注释行不带。环形缓冲按用户保留最近 5 分钟的帧，重连带 `Last-Event-ID` 时补发 `seq > lastId` 的帧；超出缓冲则前端整体重取（`GET /notifications?unread=1` + 失效全部列表）。
- 事件类型：
  - `notification`：`{ notificationId, kind, title, url, createdAt }`
  - `invalidate`：`{ keys: [["tasks", {spaceId}], ["entry", id]] }`（与前端 Query key 同构）
    - 注 2026-09-24（REQ-NOTIF-004 实现）：任务 / 记录元数据写提交后 service 调 `publishChange` → 总线 `data.changed { spaceIds, keys }` → app 对在线用户逐个 `can(space.read)` 后推送；keys 用前缀 `["tasks"]`、`["task", id]`、`["entries"]`、`["entry", id]`（private 记录不带 id）。这是缓存失效，不是通知，不经 events 出箱；批量写在外层事务提交后统一发一次。
  - `presence`（**Phase 2**）：`{ spaceId, online: [userId…] }`；「在线」= 连接带 `spaceId` 注册且 60s 内有心跳
  - 心跳：每 25s 一条注释行 `: ping`
  - `hello`：首连（不带 `Last-Event-ID`）即发，`id` = 当前 `eventSeq`、`data: null`——补发基线，否则一帧未收到就断线的客户端重连时无从补发。注（2026-09-24，T0-032）。
  - `reset`：`{ reason }`，超出缓冲，或 `Last-Event-ID` > 当前 seq（进程重启过）→ 前端整体重取。
  - `evicted`：`{ reason: 'too-many-connections' }`，第 4 条连接挤掉最旧的时先发给被挤者；前端收到后**停止自动重连**，页面回到前台（`visibilitychange`）再连，避免多标签页互相挤掉。
- 服务端进程内 `EventBus`（按 userId 订阅）；pg-boss 消费 `events` 后调用 bus；单实例无需外部 pub/sub（多实例时换 PG `LISTEN/NOTIFY`）。注（2026-09-23，T0-014）：xz-app 与 xz-collab 本就是两个进程（05 §7），`user.revoked` / `entry.access_changed` 一期即经 PG `NOTIFY xz_bus` 单向桥接到 collab（`src/server/lib/bus-pg.ts`）；`notify` 帧仍只在 app 进程内。
- 前端：`EventSource` 封装 `useRealtime()`；断线指数退避重连；收到 `invalidate` 调 `queryClient.invalidateQueries`。

---

## 7. 附件

- `POST /attachments`（multipart，字段 `file`；`targetType/targetId` **上传即带**：编辑器传 `entry`、任务描述传 `task`、评论传 `comment`、头像传 `user`；无 target 的附件仅 `owner_id` 本人可读，7 天后清理）→ `201 { id, url, mime, size, width, height, blurhash, variants }`。上限按 mime：图片 20 MB、PDF 100 MB、其他 50 MB（超限 413）；类型白名单且按**魔数**判定（`file-type`），不符 415；**SVG 经 sharp 栅格化为 PNG 存储，原件丢弃**；图片处理（变体、blurhash、SVG 栅格化）**在请求内同步完成**，`sharp({ limitInputPixels: 50e6 })`，像素超限 → 422 `VALIDATION`（`errors[].path = file`）；响应因此总是含完整 `variants`；sha256 去重只在同 workspace + 同 owner 内命中并返回既有记录（跨用户不去重，07 §2.4）；每用户配额 5 GB，超限 413 `QUOTA_EXCEEDED`（07 §5）。
- `GET /attachments/:id[/thumb|md]`：`can(attachment.read)` 后流式输出，支持 `Range`（206），`Cache-Control: private, max-age=86400`，`ETag`=sha256；`?download=1` 加 `Content-Disposition`。
- 编辑器内 `src="xz:attachment/<id>"` 由客户端解析为 `/api/v1/attachments/<id>/md`；同源 Cookie 生效，不做签名 URL（二期切 COS 时再加）。
- 头像：`POST /me/avatar` 复用附件管线 + sharp 方形裁切。
- 注（2026-09-24，T1-020）实现细节：
  - 魔数识别见 `lib/sniff.ts`：HTML / 可执行文件 → 415。变体是 webp，响应里 `variants` 给 URL。去重命中返回 201 同 id，原先的孤儿附件在此时认领 target。
  - 上传带 target 时：entry / task 需写权限，comment 须是自己的评论，user 只能是自己。
  - 配额超限返回 413 `QUOTA_EXCEEDED`。`If-None-Match` 命中返回 304，越界 Range 返回 416。
  - 生产静态托管对 `/data/*`、`/uploads/*` 返回 404，不走 SPA 兜底。

---

## 8. 异步作业

- `POST /exports { scope: 'workspace'|'space'|'entry', id?, format: 'zip'|'md'|'html' }` → `202 { jobId }`。`scope=workspace` 仅 owner/admin；任何 scope 的导出内容都按**发起人**的 `visibleEntriesWhere / visibleTasksWhere` 过滤，不因 admin 身份放宽（07 §2.4）；产物 7 天后清理。
- `GET /jobs/:id` → `{ id, kind, status: queued|active|completed|failed, progress, resultUrl?, error? }`；完成时同时发 `system.export_done` 通知。
- 注（2026-09-24，T1-028）实现细节：
  - `POST /exports` 只做鉴权与入队（`export.requested` 审计）。`/jobs/:id` 与 `/download` 只对发起人可见，他人 404。`progress` 只有 0 / 50 / 100 三档。
  - 重试在处理函数内完成（共 4 次，退避 1s / 2s / 4s），仍失败则审计 `export.failed`。权限类错误不重试。
  - `scope=entry` 且 `format=md|html` 产出单文件，其余为 zip。
  - 单篇同步导出为 `POST /entries/:id/export?format=md|html`（02 §9）。
  - 周期只导出发起人自己的。
- pg-boss 队列名 = 作业 kind；重试 3 次指数退避；`failed` 写 `audit_log`。

---

## 9. 路由清单（一期）

**机器契约**：`scripts/check-openapi-drift.ts` 只读本表的前两列（Method、Path），与 `hono-openapi` 生成的路由集合比对；一行一端点，Path 以 `/api/v1` 为根，参数用 `:name`。`Method` 列只写单个动词。查询参数写在说明列。

| Method | Path | 说明 | 主 REQ / 章节 |
|---|---|---|---|
| GET | `/me` | 当前用户资料与工作区角色 | REQ-WS-010 |
| PATCH | `/me` | `displayName / locale / timezone / weekStartsOn` | REQ-WS-010 |
| POST | `/me/avatar` | multipart，复用附件管线 + 方形裁切；回写 `image` 与 `avatarAttachmentId` | REQ-ATTACH-007 · REQ-WS-023 |
| DELETE | `/me/avatar` | 移除头像（回到首字母）；204 | REQ-WS-023 |
| PATCH | `/me/account` | `{ username?, email?, currentPassword? }`；改邮箱须当前密码（错 422 `currentPassword`）；占用 409（字段级）；仅会话；返回新 `/me` | REQ-WS-022 |
| POST | `/me/password` | `{ currentPassword, newPassword }`；删本人其他会话、保留当前；审计 `auth.password_changed`；仅会话；返回 `{ sessions }` | REQ-AUTH-021 |
| GET | `/me/keys` | API Key 列表（只含前缀、scope、expiresAt、lastUsedAt） | REQ-AUTH-010 |
| POST | `/me/keys` | `{ name, scope, expiresAt? }` → 明文只返回一次 | REQ-AUTH-010 |
| DELETE | `/me/keys/:id` | 吊销 | REQ-AUTH-010 |
| GET | `/me/sessions` | 本人会话列表 | REQ-AUTH-009 |
| DELETE | `/me/sessions/:id` | 注销某会话 | REQ-AUTH-009 |
| DELETE | `/me` | 注销账号（匿名化，需密码或 TOTP 确认；最后 owner 409） | REQ-WS-015 · 07 §4 |
| DELETE | `/workspace/members/me` | 本人退出工作区（等价于被移除，同事务吊销与断连；最后 owner 409） | REQ-WS-004 · 012 · 013 |
| DELETE | `/workspace/members/:userId?purge=1` | owner 删除他人账号（`user.manage`）：移除 + 吊销 + 删凭据 / 2FA / Passkey / Key + 匿名化；owner 不可删 409；审计 `user.deleted` | REQ-WS-021 · 07 §4 |
| GET | `/workspace` | 工作区信息 | REQ-WS-001 |
| PATCH | `/workspace` | 名称、设置（owner/admin） | REQ-WS-001 |
| GET | `/workspace/members` | 成员列表（含 `status: active|suspended`） | REQ-WS-002 |
| PATCH | `/workspace/members/:userId` | 改角色；最后一名 owner 降级 → 409 `CONFLICT_LAST_OWNER` | REQ-WS-002 · 003 |
| DELETE | `/workspace/members/:userId` | 移除：同事务吊销会话与 Key、断 WS/SSE、指派置空并发 `task.unassigned` | REQ-WS-004 |
| POST | `/workspace/members/:userId/suspend` | 停用（Better Auth `banUser`），会话与 Key 立即失效 | REQ-WS-014 · 07 §4 |
| POST | `/workspace/members/:userId/unsuspend` | 恢复 | REQ-WS-014 |
| POST | `/workspace/members/:userId/revoke-sessions` | 吊销该用户全部会话并广播 `user.revoked` | REQ-AUTH-009 |
| POST | `/workspace/members/:userId/transfer-content` | 把已移除成员的内容作者批量转给指定成员（owner/admin） | 07 §4 |
| POST | `/workspace/owner-transfer` | `{ toUserId }`，仅 owner；发 `workspace.owner_transferred` | REQ-WS-003 |
| GET | `/workspace/invitations` | 待接受邀请列表 | REQ-AUTH-003 |
| POST | `/workspace/invitations` | `{ email, role }`；7 天一次性；成员数达 50 → 422 | REQ-AUTH-003 · 005 |
| DELETE | `/workspace/invitations/:id` | 撤回 | REQ-AUTH-003 |
| GET | `/workspace/invitations/:id` | **公开**（受邀者尚无账号）：邀请页读取；返回脱敏邮箱、角色、工作区名、邀请人；已用 / 过期 / 撤回 → 410 `INVITATION_EXPIRED` | REQ-AUTH-003 · 004 |
| POST | `/workspace/invitations/:id/accept` | **公开**：`{ email, name, password }`；邮箱须与邀请一致（否则 403）；建号 + `member(role)` + 个人空间 + `member.joined`；一次性，再次 → 410；201 响应含 `captchaPass`（60 s 一次性，供随后自动登录免拼图，ADR-0006） | REQ-AUTH-003 · 004 · REQ-SPACE-009 · REQ-AUTH-016 |
| GET | `/workspace/users` | 用户管理列表（仅 owner，`user.manage`）：用户名、头像、角色、状态、2FA、最近活跃、会话数 | REQ-WS-018 |
| POST | `/workspace/users` | 直建用户 `{ email, username, name, password, role? = member }` → 立即成为成员；占用 409（字段级）；成员数达 50 → 422；审计 `user.created` | REQ-WS-018 |
| PATCH | `/workspace/users/:userId` | 改他人 `{ displayName?, username?, email? }`（不含本人）；审计 `user.updated`；204 | REQ-WS-019 |
| POST | `/workspace/users/:userId/password` | 重置他人密码 `{ password }`；删其全部会话并广播 `user.revoked`；审计 `auth.password_reset`（`byAdmin`） | REQ-WS-020 |
| POST | `/workspace/join-requests` | **公开**：`{ email, username, name, password }` + `x-captcha`；建待审批账号，发 `member.requested`；201 `{ status: 'pending' }`；拼图错 400、占用 409（字段级）、每 IP 5 次 / 小时与待审批 ≥ 200 → 429 | REQ-AUTH-017 |
| GET | `/workspace/join-requests` | 待审批列表（owner/admin，`member.approve`） | REQ-AUTH-018 |
| POST | `/workspace/join-requests/:id/approve` | `{ role? = member }`；写 `member` + 个人空间 + `member.joined`；已处理 409；成员数达 50 → 422 | REQ-AUTH-018 |
| POST | `/workspace/join-requests/:id/reject` | 驳回并删号（级联），审计 `member.rejected`；204 | REQ-AUTH-019 |
| GET | `/workspace/audit-log` | 游标；`action / actorId / from / to / jobId` 筛选（admin） | REQ-WS-005 |
| GET | `/spaces` | 筛选 `archived=1`、`deleted=1`；sort 白名单 `sortKey name createdAt` | REQ-SPACE-001 · 004 |
| POST | `/spaces` | 创建，创建者为 space admin | REQ-SPACE-001 |
| GET | `/spaces/:id` | 详情（不可见 → 404）；含 `groupId` | REQ-SPACE-002 |
| GET | `/spaces/:id/tree` | 目录树：目录内全部可见记录的 `{ id, title, kind, parentId, treeOrder }`（扁平，前端组树；读不到的父页连同子树不出现） | REQ-KB-005 |
| PATCH | `/spaces/:id` | 改名、可见性、颜色、图标（space admin+） | REQ-SPACE-003 |
| DELETE | `/spaces/:id` | 软删；`?permanent=1` 永久；仅工作区 owner/admin | REQ-SPACE-003 · 007 |
| POST | `/spaces/:id/archive` | 归档（只读） | REQ-SPACE-004 |
| POST | `/spaces/:id/unarchive` | 取消归档 | REQ-SPACE-004 |
| POST | `/spaces/:id/restore` | 从回收站恢复 | REQ-SPACE-007 |
| GET | `/spaces/:id/members` | 空间成员 | REQ-SPACE-006 |
| POST | `/spaces/:id/members` | `{ userId, role }`；发 `space.invited`；个人空间 403 | REQ-SPACE-006 · 009 |
| PATCH | `/spaces/:id/members/:userId` | 改空间角色 | REQ-SPACE-003 |
| DELETE | `/spaces/:id/members/:userId` | 移出空间；广播 `entry.access_changed` | REQ-SPACE-003 |
| PATCH | `/spaces/reorder` | `{ id, after, groupId? }` 只改一行 `sortKey`；带 `groupId` 同时移入该大类（ADR-0012） | REQ-SPACE-005 · REQ-KB-002 |
| GET | `/space-groups` | 大类列表（全员可读） | REQ-KB-001 |
| POST | `/space-groups` | `{ name, color?, icon?, description? }`；`group.manage`；同名 409 | REQ-KB-001 |
| PATCH | `/space-groups/reorder` | `{ id, after }` | REQ-KB-001 |
| PATCH | `/space-groups/:id` | 改名 / 色 / 图标 / 说明 | REQ-KB-001 |
| DELETE | `/space-groups/:id` | 删除；其下空间变未分类 | REQ-KB-001 |

注（2026-09-24，T1-001）：
- `/spaces/:id` 的 `:id` 兼收 slug：UUID 形态按 id 查，否则按 slug。前端路由是 `/spaces/$spaceSlug`，免去先列表再找 id。
- `GET /spaces` 不列**他人的个人空间**：owner/admin 按矩阵可读，但放进侧栏只是噪音；按 id / slug 仍可访问。`deleted=1` 只对工作区 owner/admin 返回内容，因为空间只有他们能删；其他人得到空列表。
- 空间视图含 `myRole`（有效空间角色）、`isMember`（显式成员）、`memberCount`；回收站对象另带 `daysLeft`（距硬删天数）。
- `reorder` 要求对被拖项有 `space.manage`，因为 `sort_key` 是工作区共享顺序；`after` 只需可读。
- 个人空间不可归档（它是收件箱默认落点），也不可改成员。`POST /spaces/:id/members` 按工作区角色封顶：guest 只能是 `viewer`，否则 422。
- `DELETE /spaces/:id?permanent=1` 连同任务 / 记录 / 评论 / 附件一并清除，记审计 `space.permanently_deleted`；未软删的空间也可直接永久删。
| GET | `/tasks` | 筛选 `spaceId status assigneeId cycleId tag dueBefore dueAfter q deleted`；日历区间 `from to`（dueAt 或 scheduledAt ∈ [from, to)，须同给、≤ 62 天，REQ-TASK-024）；`view=today\|inbox`（服务端按用户时区；**两者都排除 `done / cancelled`**，`today` = 逾期未完成 ∪ 今日到期 ∪ 今日开始，`inbox` = `status=inbox` 且创建者或指派人为我）；`due=today\|week\|overdue`；sort 白名单 `updatedAt createdAt dueAt priority title sortKey` | REQ-TASK-004 · 005 · 006 |
| POST | `/tasks` | 创建；`Idempotency-Key` | REQ-TASK-001 |
| GET | `/tasks/:id` | 详情（含 `descriptionPm`）；Peek 复用 | REQ-TASK-012 · REQ-UI-007 |
| PATCH | `/tasks/:id` | 带 `ifUpdatedAt`；改 `assigneeId` 发 `task.assigned` | REQ-TASK-007 · 012 |
| DELETE | `/tasks/:id` | 软删；`?permanent=1` 仅 owner/admin | REQ-TASK-013 |
| POST | `/tasks/:id/restore` | 恢复 | REQ-TASK-013 |
| POST | `/tasks/:id/complete` | 完成；处理 recurrence；发 `task.completed` | REQ-TASK-002 · 011 |
| POST | `/tasks/:id/uncomplete` | 撤销完成，回到 `prevStatus`；发 `task.uncompleted` | REQ-TASK-021 |
| POST | `/tasks/batch` | `{ ops[] }` ≤ 100，整体事务 | REQ-TASK-016 |
| GET | `/tasks/:id/watchers` | 关注者 | REQ-TASK-014 |
| POST | `/tasks/:id/watchers` | `{ userId }` | REQ-TASK-014 |
| DELETE | `/tasks/:id/watchers/:userId` | 取消关注 | REQ-TASK-014 |

注（2026-09-24，T1-003）：
- `view=today` 的人员范围是「我的」任务：指派给我，或未指派且由我创建。本表原文没写人员范围；按 08 §7 seed「给 guest 指派一条任务让今日页非空」的意图裁定。
- `view` 不能与 `deleted=1` 同用，`view=inbox` 不能与 `status` 同用，违反均 422。`/tasks/:id` 的 `:id` 必须是 UUID，否则 422。
- 排序只取第一个字段加 `id` 做游标。`dueAt` 为空的行排在最后（`coalesce(due_at, 'infinity')`）。
- 列表项字段：`spaceSlug`、`assignee { id, displayName }`（已离开的成员显示为「已离开的成员」）、`tags[] { id, name, color }`、`hasDescription`。不含 `descriptionPm`。
- 指派人必须能读该空间，否则 422 `assigneeId`；父任务必须在同一空间。
- 新建任务，或改状态、换空间后，任务落在 `(space, status)` 列的底部。

注（2026-09-24，T1-038）：
- watchers 权限：关注 / 取消关注**自己**只要能读任务（viewer 也可以）。替**别人**增删需要 `task.write`，且被加的人必须能读该空间，否则 422 `userId`。`POST` 返回最新的 watcher 列表。
- `POST /tasks/:id/complete | uncomplete`：请求体可省略，或只带 `{ ifUpdatedAt }`。complete 对已完成任务幂等返回；uncomplete 对未完成任务返回 409。uncomplete 回到最近一次 `task.completed` 载荷里的 `prevStatus`，缺省为 `todo`。状态经 PATCH 或 batch 进出 done 时同样会发 completed / uncompleted。`recurrence` 生成下一实例属 Phase 2（REQ-TASK-011）。
- `POST /tasks/batch`：全部成功时返回 200 `{ results: [{ index, id, ok, status, task }] }`。任一失败则整体回滚，返回第一条失败项的状态码和 problem+json，体内带 `results`，其中成功项标 `rolledBack: true`，失败项带 `code / detail`。
- `GET /tasks?parentId=` 列出某任务的子任务（任务详情 08 §2.7 用；注 2026-09-24，T1-009）。
- 子任务：父任务本身不能有父任务；有子任务的任务不能再挂到别人下面；有父任务（且没有同时解除）或有子任务的任务不能单独换空间。违反均 422。
| GET | `/cycles` | `kind year`；sort 白名单 `startDate` | REQ-CYCLE-001 |
| POST | `/cycles` | 幂等：同 owner/kind/start 返回既有（200）；同时建 review 记录 | REQ-CYCLE-001 · 004 |
| GET | `/cycles/current` | `kind`；按用户时区与 `weekStartsOn` | REQ-CYCLE-002 |
| GET | `/cycles/:id` | 详情（含任务列表与完成数） | REQ-CYCLE-006 · REQ-TASK-018 |
| PATCH | `/cycles/:id` | `goals / status`（单向流转） | REQ-CYCLE-003 · 005 |
| GET | `/entries` | 筛选 `spaceId kind authorId tag q pinned deleted`；sort 白名单 `updatedAt createdAt title`；不返回正文列（注 2026-09-26 ADR-0012：`kind` 逗号多值；`fields=status=open\|fixed,severity=high` 按 fields 过滤；`inTree=1\|0`；每项带 `tagIds`；注 ADR-0014：+`under` 目录子树、`groupId`（uuid \| `none`）、`favorite=1`、`ids` csv ≤ 50，每项带 `path` `favorited`；注 ADR-0016：+`typeId` csv（自定义类型，与 `kind` 同给为任一命中），每项带 `typeId`） | REQ-ENTRY-002 · REQ-KB-004 · REQ-ENTRY-012 · 018 |
| POST | `/entries/batch` | `{ op: move\|tags\|archive\|unarchive\|delete, ids ≤ 100, spaceId? / add? / remove? }` 逐条鉴权 → `{ ok, failed[{id, code, message}] }`（ADR-0014；注 ADR-0016：op 增 `retype {kind, typeId?}` · `fields {set:{status?, progress?}}` · `pin` · `unpin`） | REQ-ENTRY-013 · 017 |
| PUT | `/entries/:id/favorite` | 收藏（个人；需可读；幂等）（ADR-0014） | REQ-ENTRY-012 |
| DELETE | `/entries/:id/favorite` | 取消收藏（ADR-0014） | REQ-ENTRY-012 |
| PATCH | `/entries/:id/move` | `{ parentId, after }` 移到目录某处 / `{ detach: true }` 移出目录；需 entry.write；防环、after 须同级 | REQ-KB-005 |
| POST | `/entries` | `{ kind, title, spaceId?, fields, visibility, templateId? }` → `{ id }`；正文经 collab；`templateId`（`builtin:<key>` / uuid / `builtin:blank`）→ 模板正文写成初始 ydoc（ADR-0011 §2） | REQ-ENTRY-001 · REQ-TPL-003 |
| GET | `/entries/:id` | 元数据详情（无 `ydoc`；`pmJson` 仅 `?withBody=1`） | REQ-ENTRY-003 |
| PATCH | `/entries/:id` | 标题、fields、可见性、`spaceId`（移动）、`pinned`；带 `ifUpdatedAt`（注 ADR-0016：可改 `kind`（自定义再给 `typeId`），未给 fields 时按目标类型重建） | REQ-ENTRY-004 · 006 · 011 · 017 |
| DELETE | `/entries/:id` | 软删；`?permanent=1` | REQ-ENTRY-007 |
| POST | `/entries/:id/restore` | 恢复 | REQ-ENTRY-007 |
| POST | `/entries/:id/archive` | 归档 | REQ-ENTRY-006 |
| POST | `/entries/:id/unarchive` | 取消归档（与空间同构；2026-09-23 T0-013 补） | REQ-ENTRY-006 |
| GET | `/entries/:id/preview` | 卡片数据 | REQ-ENTRY-008 |

注（2026-09-24，T1-012）：
- `visibility` 可省略：落在个人空间时缺省 `private`，其余缺省 `space`。个人空间里的记录只能是 `private`，否则 422 `visibility`，移入个人空间时同样校验（REQ-ENTRY-003）。
- `/entries/:id*` 的 `:id`（快照的 `:sid` 同理）必须是 UUID，否则 422。
- `preview` 返回 `{ id, kind, title, excerpt, author, spaceSlug, visibility, updatedAt, fieldsSummary }`，`fieldsSummary` 按 kind 取最多 3 个标量字段。
- 列表查询不读取 `ydoc / pm_json / tsv`，`plain` 只取前 160 字作为 excerpt。
| GET | `/entries/:id/backlinks` | 反链（经 `can(read)` 过滤） | REQ-LINK-002 |
| GET | `/entries/:id/snapshots` | 快照列表 | REQ-COLLAB-007 |
| POST | `/entries/:id/snapshots` | `{ label }` 手动标记版本 | REQ-COLLAB-007 |
| GET | `/entries/:id/snapshots/:sid` | 单个快照二进制（历史面板） | REQ-COLLAB-008 |
| GET | `/entries/:id/snapshots/:sid/content` | 快照时刻正文 `pmJson` + 当前 `currentPmJson`（服务端以 gc:false ydoc 重建；预览 / 对比） | REQ-COLLAB-008 |
| POST | `/entries/:id/snapshots/:sid/restore` | 恢复：需 `entry.write`；审计 `entry.restored` 后经总线 `entry.restore` 请 collab 以一次修改写回在线文档；**202**（异步生效） | REQ-COLLAB-008 |
| POST | `/entries/:id/export` | `format=md\|html` 单篇导出（同步返回文件） | REQ-EXPORT-003 · 006 |
| GET | `/comments` | `targetType targetId`；含软删占位 | REQ-COMMENT-001 · 007 |
| POST | `/comments` | `{ targetType, targetId, threadId?, parentId?, bodyPm }`；发 `*.commented` / `mention.created` | REQ-COMMENT-001 · 005 · 006 |
| PATCH | `/comments/:id` | 编辑（作者） | REQ-COMMENT-001 |
| DELETE | `/comments/:id` | 软删，保留占位 | REQ-COMMENT-007 |
| POST | `/comments/:id/resolve` | 解决线程 | REQ-COMMENT-003 |
| POST | `/comments/:id/unresolve` | 取消解决 | REQ-COMMENT-003 |
| GET | `/entry-types` | `{ builtin[{kind, hidden, usage}], items[{id, name, color, statuses, canManage, usage}], canManageBuiltin, canCreate }`（ADR-0016） | REQ-ENTRY-018 |
| POST | `/entry-types` | `{ name, color, statuses? }`；重名 409；`Idempotency-Key` | REQ-ENTRY-018 |
| PATCH | `/entry-types/:id` | `{ name?, color?, statuses?, renames? }`；需 `entry_type.manage` | REQ-ENTRY-018 |
| DELETE | `/entry-types/:id` | 其下记录转随笔后删除；审计 `entry_type.deleted` | REQ-ENTRY-019 |
| PUT | `/entry-types/builtin/:kind` | `{ hidden }` 隐藏 / 显示内置类型（管理员） | REQ-ENTRY-019 |
| GET | `/tags` | 列表 | REQ-TAG-001 |
| POST | `/tags` | `{ name, color }`；重名 409 | REQ-TAG-001 · 003 |
| PATCH | `/tags/:id` | 改名 / 颜色 | REQ-TAG-001 |
| DELETE | `/tags/:id` | 删除并解除关联 | REQ-TAG-001 |
| POST | `/tags/:id/merge` | `{ intoId }` 关联并入目标（去重）后删源；需两者 `tag.manage`（ADR-0014） | REQ-TAG-005 |
| GET | `/templates` | 内置 + 本人个人 + 工作区模板（`?kind=&spaceKind=`）；不返回正文 | REQ-TPL-001 · 004 |
| POST | `/templates` | `{ name, scope, description?, spaceKind?, body+kind \| fromEntryId }`；workspace 范围需管理员；幂等 | REQ-TPL-004 |
| GET | `/templates/:id` | 详情带 `body`（id 可为 `builtin:<key>`） | REQ-TPL-001 · 005 |
| PATCH | `/templates/:id` | 改名 / 说明 / 范围 / 推荐空间类型；内置 403 | REQ-TPL-004 |
| DELETE | `/templates/:id` | 删除；内置 403；已建记录不受影响 | REQ-TPL-004 |

注（2026-09-24，T1-021 / T1-022）：
- 标签：创建为非 guest（authz `tag.create`，供 TagPicker 输入即创建）；改名、改色、删除限 owner/admin（`tag.manage`，影响全工作区；注 2026-09-26 ADR-0014：创建者也可，`tags.created_by`，列表每项带 `canManage`）。`GET /tags` 不分页，附 `usage { tasks, entries }` 计数。`?tag=a,b` 为逗号多值，任一命中，最多 20 个。
- 评论：未带 `threadId` / `parentId` 时首条评论 id 即 threadId；回复继承父评论的线程。空正文 422。编辑只限作者且带 `ifUpdatedAt`，只对新增的提及发通知。删除限作者或 owner/admin，列表保留占位（`deleted: true, bodyPm: null`）。resolve / unresolve 对整条线程生效，按线程首条评论判 `comment.resolve`。
- 评论里的提及发 `mention.created`（`targetType: 'comment'`），扇出前按评论所在目标的读权限过滤。
| GET | `/calendars` | 本人日历列表（首次自动建 4 个默认）；不分页 | REQ-CAL-001 |
| POST | `/calendars` | `{ name, color }`；`Idempotency-Key`；每人 ≤ 30 | REQ-CAL-001 |
| PATCH | `/calendars/:id` | `{ name?, color?, hidden?, position? }` | REQ-CAL-001 |
| DELETE | `/calendars/:id` | 连同日程删除；至少保留 1 个（否则 422） | REQ-CAL-001 |
| GET | `/calendar-events` | `from to`（必填，跨度 ≤ 400 天）；返回区间内的**发生**（重复已展开，`key` 唯一），不分页 | REQ-CAL-002 · 004 · 006 |
| POST | `/calendar-events` | `{ calendarId, title, allDay, startAt, endAt, timezone, rrule?, alarms?, location?, url?, notes? }`；`Idempotency-Key` | REQ-CAL-002 · 004 |
| PATCH | `/calendar-events/:id` | 带 `ifUpdatedAt`；重复日程带 `scope=this\|future\|all` 与 `occurrenceStart` | REQ-CAL-003 · 005 |
| DELETE | `/calendar-events/:id` | `?scope=this\|future\|all&occurrenceStart=`；软删 | REQ-CAL-005 |

注（2026-09-25，ADR-0009）：
- 日历与日程个人私有（`calendar.read / calendar.write` 仅本人，列表 `visibleCalendarEventsWhere`）；他人资源按 404 处理。
- `GET /calendar-events` 是区间查询而非游标分页（与 `GET /tasks?from&to` 同类，结果集由区间天然有界；单次最多展开 2000 次发生）。
- 全天事件的 `startAt / endAt` 为 `timezone` 下本地零点；前端按事件自身时区取日期。

| GET | `/links` | `fromType fromId` | REQ-LINK-003 · 005 |
| POST | `/links` | 五元组唯一，重复 409 | REQ-LINK-003 · 004 |
| DELETE | `/links/:id` | 删除（`kind=mentions` 的由 collab 维护，手删 403） | REQ-LINK-001 · 003 |
| POST | `/attachments` | 见 §7 | REQ-ATTACH-001 ~ 005 |
| GET | `/attachments/:id` | 原件流式输出，`Range` | REQ-ATTACH-003 |
| GET | `/attachments/:id/thumb` | 320 变体 | REQ-ATTACH-004 |
| GET | `/attachments/:id/md` | 1280 变体 | REQ-ATTACH-004 |
| GET | `/search` | `q types spaceId kind status tag limit cursorTasks cursorEntries`；规则见 §4.1 | REQ-SEARCH-001 ~ 006 |
| GET | `/notifications` | 筛选 `unread=1`、`kind=`（如 `mention.created`）、`archived=1`；游标 | REQ-NOTIF-005 |
| POST | `/notifications/read-all` | 全部已读 | REQ-NOTIF-005 |
| POST | `/notifications/:id/read` | 已读（他人的 → 404） | REQ-NOTIF-005 |
| POST | `/notifications/:id/archive` | 归档 | REQ-NOTIF-005 |
| GET | `/notifications/preferences` | 偏好（缺行用默认表） | REQ-NOTIF-006 |
| PUT | `/notifications/preferences` | 整体覆盖 | REQ-NOTIF-006 |
| POST | `/notifications/push-subscriptions` | 订阅（Phase 2） | REQ-NOTIF-008 |
| DELETE | `/notifications/push-subscriptions/:id` | 退订 | REQ-NOTIF-008 |
| GET | `/stream` | SSE，见 §6 | REQ-NOTIF-002 · 003 |
| POST | `/collab/token` | `{ entryId }` → `{ token, expiresAt }`：HMAC-SHA256 5 分钟票据，载荷 `{ userId, entryId, jti, exp }`，一票一文档，`jti` 5 分钟内拒绝重用（07 §2.3）；供 HocuspocusProvider `token` 参数（03 §4.2）；WebSocket 不用 Cookie | REQ-COLLAB-002 |
| POST | `/exports` | 见 §8 | REQ-EXPORT-001 |
| GET | `/jobs/:id` | 作业状态 | REQ-EXPORT-001 |
| GET | `/jobs/:id/download` | 产物下载（发起人） | REQ-EXPORT-001 |
| POST | `/imports/markdown` | multipart zip，一次性转记录（**二期 Phase 3，不验收**） | REQ-EXPORT-004 |
| POST | `/imports/debug-dir` | `debug/` 目录导入（**二期**，一期只预留路径，不实现） | — |
| GET | `/health` | 公开 `{ ok, version }`（挂 `/api/health`，不在 `/v1` 下） | REQ-OPS-001 |
| GET | `/health/details` | admin 或 API Key scope admin（挂 `/api/health/details`） | REQ-OPS-001 |

`/api/auth/*` 由 Better Auth 托管（sign-in / sign-out / magic-link / two-factor / passkey / organization invitation accept），不在本表，漂移检查排除该前缀。

---

## 10. MCP Server（`src/server/mcp/`，二期实现、一期预留）

- 传输：stdio（本机 Claude Code）与 Streamable HTTP（`/mcp`，API Key 鉴权）。
- 工具直接包装 service，输入 schema 复用 `src/shared/schemas`：`create_task`、`list_tasks`、`create_entry(kind, title, markdownBody)`（Markdown 一次性转 ProseMirror → Y.Doc）、`log_bug`（五段字段 → bug 模板）、`log_decision`、`search`、`get_current_cycle`、`append_iteration_note`。
- 每个工具调用写 `audit_log(actor=api_key)`；写操作发事件，与人类操作无差别。

---

## 11. 前端调用约定

- `src/client/api.ts`：`export const api = hc<AppType>('/api/v1', { fetch: withCsrfAndRetry })`；错误统一转 `ApiError(code, status, problem)`。
- Query key 规范：`['tasks', filters]`、`['task', id]`、`['entries', filters]`、`['entry', id]`、`['cycle', kind, start]`、`['notifications', {unread}]`；`invalidate` 事件的 `keys` 与之同构。
- 写操作用 `useMutation` + 乐观更新模板（`optimisticPatch(queryKey, id, patch)`），409 时用 `current` 覆盖缓存并 Toast。
- 一律不在组件里 `fetch`；一律不在 hooks 里拼 URL 字符串（走 `hc` 类型）。

---

## 12. 测试模板

每个路由文件对应 `routes/__tests__/<name>.test.ts`：
1. 未登录 401；
2. 各角色矩阵（owner/admin/member/guest/非成员）对每个端点的 2xx/403/404；
3. 校验失败 422 且 `errors[].path` 正确；
4. 乐观锁 409 带 `current`；
5. 事件：写操作后 `events` 表有对应 kind；
6. 列表：游标翻页无重复无遗漏、轻量字段不泄漏正文。
