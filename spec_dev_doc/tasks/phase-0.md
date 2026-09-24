# tasks / Phase 0 —— 脚手架与地基

> 状态：已采纳 · 版本：v2 · 更新：2026-09-23 · 最后对照代码：2026-09-23（M0.1） · 依据 ADR-0001 §7 §9.5、ADR-0002、ADR-0003、05 §11、06 §11、07 §7、00（Phase 0 REQ）。
> 目标：三服务跑通、认证与授权闭环、正文协同落库、事件到通知闭环、玻璃 token 与 `/design`、部署与备份可用。
> 工期：计划值 ≈ 106.5h（本表脚本求和，见文末）；ADR-0001 §9.5 的「5 天」与 ADR-0002 的「+1 天」为历史乐观值，工期决定见 ADR-0003。
> 验收：05 §11 清单全绿 + 00 中 `Phase = 0` 的 P0 REQ 全部有通过的测试（`debug/perf/req-coverage.json`，按本次 CI 实际运行的层计算，05 §5）。

任务 ID `T0-NNN`；估时为单人小时；「完成定义」写到可执行的命令或以 REQ ID 开头的测试名（05 §5 追溯约定）。

## 任务表

| ID | 任务 | 涉及文件 / 目录 | 依赖 | REQ | 估时 | 完成定义 |
|---|---|---|---|---|---|---|
| T0-001 | `git init`、`.gitignore`（`data/ .env node_modules dist .vite*`）、首次提交 | 仓库根 | — | — | 0.5 | `git log` 有 1 条 `chore: init` |
| T0-002 | 单 package 脚手架：`package.json`（pnpm 11、node ≥ 24、scripts 全部按 05 §3 含 `typecheck` / `dev:verify` / `xz seed`）、`.npmrc`、`.nvmrc`、`tsconfig.*`、`biome.json` | 根 | T0-001 | REQ-OPS-006 | 2 | `pnpm i && pnpm lint && pnpm typecheck` 通过（空项目）；`REQ-OPS-006 CI 阶段顺序` 由 T0-029 收口 |
| T0-003 | `infra/docker-compose.yml`：`pgvector/pgvector:pg16` 映射 5433 + Mailpit 8025；`pnpm db:up/down`；初始化 `xz` / `xz_test` / `xz_e2e` / `xz_verify` 四库（05 §2） | `infra/` | T0-002 | — | 1 | `pnpm db:up` 后 `psql -p 5433 -l` 列出四库、`http://localhost:8025` 可开 |
| T0-004 | `.env.example` 全字段（05 §2 含 `COLLAB_TOKEN_SECRET`、`AGE_RECIPIENT`）+ `src/server/env.ts` Zod 校验 | 根、`src/server/env.ts` | T0-002 | — | 1 | 缺必填变量时启动报错并列出字段名 |
| T0-005 | Drizzle 配置 + 一期全部业务表（01 §3.1–3.13，含 `derived_error`、`orphaned`、`is_personal`、`notifications(user_id, event_id)` 唯一）+ CHECK/索引 + `pnpm db:generate/migrate` | `src/server/db/schema/*.ts`、`drizzle/` | T0-003 | REQ-OPS-002 | 5 | `pnpm db:migrate` 空库成功；`scripts/check-schema-drift.ts` 对 01 §3 零差异；`REQ-OPS-002 迁移失败容器退出` 由 T0-028 收口 |
| T0-006 | Better Auth 接入：Drizzle 适配、插件 organization/admin/twoFactor/passkey/magicLink/apiKey、全局与 `magicLink` 的 `disableSignUp`、`additionalFields`、一期禁用 impersonation；`pnpm auth:generate` | `src/server/auth.ts`、`drizzle/` | T0-005 | REQ-AUTH-001 · 002 · 006 · 007 · 008 · 010 · 015 | 5 | `REQ-AUTH-002 拒绝自助注册`、`REQ-AUTH-015 魔法链接对陌生邮箱不建号`、`REQ-AUTH-010 API Key 明文只返回一次` api 测试绿 |
| T0-007 | `pnpm xz create-owner` CLI 骨架（`src/server/cli.ts`）+ 默认 Workspace + owner 的「个人」空间；成员接受邀请时同样自动建个人空间（01 §3.1 `is_personal`） | `src/server/cli.ts`、`services/spaces.ts` | T0-006 | REQ-AUTH-013 · REQ-SPACE-009 | 2 | `REQ-AUTH-013 create-owner 二次执行拒绝`、`REQ-SPACE-009 新成员自动获得个人空间` 测试绿 |
| T0-008 | Hono 应用骨架：`/api/health`、`/api/health/details`、pino（`redact` authorization/cookie/ydoc/pmJson）、`secure-headers`（02 §2 CSP）、限流（IP + 邮箱双维度、登录锁定）、CSRF 校验、`AppError` + Problem Details 信封、`session()` 中间件 | `src/server/index.ts`、`middleware/*`、`lib/logger.ts` | T0-006 | REQ-OPS-001 · 003 · 004 · 009 · 014 · REQ-AUTH-011 · 012 · 015 | 4.5 | `REQ-OPS-003 日志不含 authorization/cookie/ydoc`、`REQ-OPS-014 错误响应为 problem+json 且带 requestId`、`REQ-AUTH-011 跨站 POST 403 CSRF`、`REQ-AUTH-012 连续失败 10 次 403 ACCOUNT_LOCKED` 测试绿；`curl /api/health` 返回 `{ok,version}` |
| T0-009 | `src/server/authz.ts`：`can()` 纯函数 + `visibleTasksWhere/visibleEntriesWhere`（含孤儿附件仅 owner 可读）+ 角色矩阵测试（01 §5 全组合） | `src/server/authz.ts`、`__tests__/authz.test.ts` | T0-005 | REQ-WS-007 · 008 · 009 · 011 | 4 | `REQ-WS-007 角色矩阵全组合` 单测覆盖 动作 × 5 角色 × 3 空间角色；`REQ-WS-008 不可见 404 / 无权 403` api 测试绿 |
| T0-010 | 邀请流程：`/workspace/invitations` CRUD、邀请邮件（react-email + nodemailer → Mailpit，Better Auth `sendInvitationEmail` 钩子）、`/invite/$token` 页面、7 天一次性、绑定邮箱、再次打开 410 | `src/server/routes/workspace.ts`、`mail/`、`src/client/routes/invite.$token.tsx` | T0-006 · T0-008 | REQ-AUTH-003 · 004 · 005 · REQ-NOTIF-009 | 4 | e2e `REQ-AUTH-003 邀请→设密码→登录` 绿；api `REQ-AUTH-004 已用邀请 410` 绿；`REQ-NOTIF-009 Mailpit 收到邀请邮件` 绿 |
| T0-011 | 成员管理与审计：`/workspace/members`（角色改、移除含同事务吊销会话与 Key、`user.revoked` 广播、未完成任务置空并发 `task.unassigned`）、`POST /workspace/members/:userId/revoke-sessions`、`POST /workspace/owner-transfer`、`/workspace/audit-log`、`audit_log` action 枚举（01 §3.12）写入点、最后 owner 保护 | `routes/workspace.ts`、`services/members.ts`、`services/audit.ts` | T0-009 · T0-010 | REQ-WS-001 · 002 · 003 · 004 · 005 · 006 · 012 · 013 · 017 · REQ-AUTH-009 · 014 | 4.5 | `REQ-WS-004 移除后旧 Cookie 401 且 WS 1s 内断开`、`REQ-WS-003 最后 owner 降级 409 CONFLICT_LAST_OWNER`、`REQ-WS-006 审计 action 名与 01 §3.12 枚举一致`、`REQ-AUTH-009 admin 吊销会话后 401` api 测试绿 |
| T0-012 | `src/shared/schemas/*`：Zod 4 全部一期实体 + `events.ts` 判别联合（含 `task.unassigned` / `task.uncompleted` / `workspace.owner_transferred` / `member.joined`）+ `entryFields.ts` | `src/shared/` | T0-005 | REQ-ENTRY-001 | 3 | `REQ-ENTRY-001 fields 按 kind 严格校验` 单测每 kind 正反用例；events 每 kind 一例 |
| T0-013 | Entries 最小 CRUD（创建返回 id、详情、软删）+ `rebuild-derived` CLI（`--entries/--tasks/--comments`） | `routes/entries.ts`、`services/entries.ts`、`cli.ts` | T0-009 · T0-012 | REQ-ENTRY-001 · 010 | 3 | `REQ-ENTRY-001 创建 201 / fields 422` api 绿；`REQ-ENTRY-010 rebuild-derived 与 collab 派生逐字节相同` 单测绿 |
| T0-014 | Hocuspocus 服务：`onAuthenticate`（`POST /collab/token { entryId }` HMAC 5 分钟票据，一票一文档、`jti` 防重放、`Origin` 校验、每用户 ≤ 10 连接、关闭码 4401/4403/4409/4413）、`onLoadDocument`（模板注入占位、schema 迁移 bump）、`onStoreDocument`（防抖 2s/10s、派生列、`derived_error`、`entry.updated` 5 分钟合并、派生失败不阻塞）、`user.revoked` 广播断连、`gc:false`、`/collab/health` | `src/collab/server.ts`、`derive.ts`、`routes/collab.ts` | T0-013 | REQ-COLLAB-002 · 003 · 006 · 009 · 014 · 015 | 6 | 协同集成测试 `REQ-COLLAB-002 无票据 4401 / 错文档拒绝 / jti 重放拒绝 / viewer 只读`、`REQ-COLLAB-003 落库后派生列与 ydoc 一致`、`REQ-COLLAB-009 派生抛错不阻塞且写 derived_error` 绿 |
| T0-015 | 快照：策略（50 次 / 30 分钟 / 手动）、`entry_snapshots` 写入、保留清理 cron `gc.snapshots`、`pnpm xz snapshot` | `src/collab/snapshots.ts`、`jobs/` | T0-014 | REQ-COLLAB-007 | 2.5 | `REQ-COLLAB-007 第 50 次落库产生快照且标记快照不被清理` 集成测试绿 |
| T0-016 | 前端脚手架：Vite 8 + React 19 Compiler、TanStack Router 文件式（数组型 search param 逗号分隔 `parseSearch`）、Query、`api.ts`（`hc<AppType>` + CSRF/重试）、i18next 骨架（`zh-CN`，`scripts/check-i18n.ts` 硬编码中文 lint） | `src/client/` | T0-008 | REQ-UI-012 | 3 | `pnpm dev` 三服务起；`/` 重定向 `/today` 占位页；`REQ-UI-012 组件无硬编码中文` 由 `scripts/check-i18n.ts` 零违规 |
| T0-017 | `tokens.css`（06 §3 全部 token 两主题含 `fg/fg-muted`、`@utility glass*/paper`、blur token、reduced-transparency / `@supports` 回退）+ Tailwind v4 `@theme` 映射 + body 底板光晕 | `src/client/styles/tokens.css` | T0-016 | REQ-UI-002 · 016 | 4 | `REQ-UI-002 check-css 零违规`、`REQ-UI-003 两主题对比度矩阵通过`（`scripts/check-contrast.ts`）绿 |
| T0-018 | 主题切换 `theme.ts`（跟随系统 / 手动 / VT 圆形揭幕与溶解 / 连点 skip / `.vt-live`） | `src/client/lib/theme.ts` | T0-017 | REQ-UI-001 | 2 | e2e `REQ-UI-001 切换后 data-theme 与 color-scheme 正确、reduced-motion 无 VT` 绿 |
| T0-019 | shadcn 初始化 + 基础原语按 06 §4 换材质（Button 五变体、Input、Dialog、Sheet、Popover、Tooltip、Command、Toast(Sonner 队列 API + 自建容器)、Skeleton、Tabs、Checkbox、Avatar、KeyHint）；折射环 / 左上高光随 `glass-thick` 生效；浮层 portal 到 body；**Toast 形变与非 modal Sheet 先做 2h 原型验证再定稿** | `src/client/components/ui/` | T0-017 | REQ-UI-023 | 6 | `/design` 组件矩阵页可见；`REQ-UI-023 浮层父节点为 body` 单测绿；axe 无 serious；原型结论写入 06 §4 |
| T0-020 | 布局骨架：Topbar / Sidebar / Aside / 底部导航（< lg），`[`/`]` 折叠，StatusPill 占位 | `src/client/components/layout/` | T0-019 | REQ-UI-014 · REQ-MOBILE-001 | 3 | e2e `REQ-UI-014 1280 三栏 / 1024 抽屉`、`REQ-MOBILE-001 390 视口底部导航含 safe-area` 绿 |
| T0-021 | `/design` 画廊：token 页 + 材质 / 深度 / 切换三页 + 组件矩阵；admin 门禁；Playwright 截图基线；同屏 `backdrop-filter` 计数测试（Scrim 计入） | `src/client/routes/design.tsx`、`e2e/design.spec.ts` | T0-019 · T0-020 | REQ-UI-003 · 004 · 016 | 4 | e2e `REQ-UI-004 member 访问 /design 404、admin 四页可见、截图差 ≤ 0.1%`、`REQ-UI-016 同屏 backdrop-filter ≤ 6` 绿 |
| T0-022 | 登录 / 2FA / 安全设置页（Passkey、恢复码、会话列表） | `routes/login*.tsx`、`routes/settings.security.tsx` | T0-019 · T0-006 | REQ-AUTH-001 · 006 · 009 | 3 | e2e `REQ-AUTH-001 登录成功跳 /today`、`REQ-AUTH-006 开启 2FA 后需 TOTP 且恢复码一次性` 绿 |
| T0-023 | 编辑器最小闭环：fullKit（starter-kit + collaboration + caret）、`resolve.dedupe`、懒加载 chunk、`/entries/$entryId` 页面接 provider + y-indexeddb、StatusPill 连接态、远端光标 | `src/client/editor/`、`routes/entries.$entryId.tsx` | T0-014 · T0-020 | REQ-COLLAB-001 · 004 · 005 · 010 · REQ-EDITOR-014 | 6 | e2e `REQ-COLLAB-001 两 context 协同收敛`、`REQ-COLLAB-004 setOffline 后编辑再恢复同步`、`REQ-COLLAB-005 本地缓存首屏 ≤ 300ms` 绿；`REQ-EDITOR-014 编辑器 chunk gzip ≤ 400KB` 由 check-budget 收口 |
| T0-024 | 事件出箱：`emit()` 同事务、`outbox.drain` **自循环作业**（完成后 `send` 自身 `startAfter: 5`，`FOR UPDATE SKIP LOCKED` 批 200，非 cron）、`notify.fanout`（`singletonKey = event_id`、`can(read)` 过滤、合并窗口、`ON CONFLICT (user_id, event_id) DO NOTHING`）、in_app 写入、未读数、`system.outbox_stalled` 监测 | `services/events.ts`、`jobs/outbox.ts`、`jobs/fanout.ts` | T0-009 · T0-012 | REQ-NOTIF-001 · 011 · 014 · 016 | 5.5 | 集成测试 `REQ-NOTIF-001 事务回滚无事件行 / 写入后 ≤ 6s processed_at`、`REQ-NOTIF-011 无权接收者被跳过`、`REQ-NOTIF-016 fanout 重跑不重复` 绿；`REQ-NOTIF-014 routes/client 无通知写入` 静态扫描绿 |
| T0-025 | SSE `/stream`：每用户 ≤ 3 连接（最旧关闭）、25s 心跳、每用户单调 `eventSeq` 作 `id:`、`Last-Event-ID` 环形缓冲、`EventBus`、`user.revoked` 断连；前端 `useRealtime()` 指数退避 | `routes/stream.ts`、`src/client/hooks/useRealtime.ts` | T0-024 | REQ-NOTIF-002 · 003 | 3 | e2e `REQ-NOTIF-002 事件后 2s 内铃铛 +1`、`REQ-NOTIF-003 断线 10s 重连带 Last-Event-ID 补发、第 4 个连接踢最旧` 绿 |
| T0-026 | pg-boss 接入与作业清单（07 §3 名称）：`gc.soft-deleted` 30d、`gc.idempotency` 24h、`gc.attachments` 7d、`gc.snapshots`、`gc.events` 180d、`gc.exports` 7d、`backup.daily` 03:00、`derive.retry` | `src/server/jobs/index.ts` | T0-005 | REQ-OPS-007 | 2 | `REQ-OPS-007 每个作业名注册、可手动触发、连跑两次幂等` 单测绿 |
| T0-027 | 备份与导出 CLI：`pnpm xz backup`（`pg_dump -Fc` + age `AGE_RECIPIENT`）、`pnpm xz restore <dump.age> --db xz_verify`、`pnpm xz export --workspace` 骨架（完整导出在 T1-028）、失败发 `system.backup_failed` | `cli.ts`、`infra/backup.sh` | T0-026 · T0-024 | REQ-EXPORT-005 | 2.5 | `REQ-EXPORT-005 产出 .dump.age 并能解密恢复到 xz_verify 且行数一致`；模拟失败 admin 收到通知 |
| T0-028 | 生产镜像与 Compose：多阶段 Dockerfile（`USER node`、`data/` 属 node）、`docker-compose.prod.yml`（app / collab / pg；`xz-collab` `depends_on: xz-app: condition: service_healthy`；日志轮转 `max-size=50m, max-file=5`）、`pnpm start` / `start:collab`、启动先 migrate、`Caddyfile.snippet`、`deploy.sh` | `infra/` | T0-014 · T0-008 | REQ-OPS-002 · 005 | 4 | 本机 `docker compose -f infra/docker-compose.prod.yml up` 后 `REQ-OPS-005 /api/health 200 且 wss /collab 握手成功`；`REQ-OPS-002 注入失败迁移则新容器退出、旧容器 healthy`；`docker inspect` 显示非 root 与日志轮转 |
| T0-029 | CI：`lint → typecheck → drift（schema / openapi）→ test（pgvector 服务容器）→ build（预算）→ audit（pnpm audit --audit-level high）→ e2e（main 与标签）`；`req-coverage` 分层 reporter（Vitest / Playwright 各输出 `req-coverage.{unit,api,collab,e2e}.json`，CI artifact 合并），P0 门槛按本次实际运行的层计算，测试层「—」的 REQ 排除 | `.github/workflows/ci.yml`、`scripts/check-*.ts`、`scripts/req-coverage.ts` | T0-021 · T0-023 · T0-025 | REQ-OPS-006 · REQ-UI-013 · REQ-UI-015 | 4.5 | 一次绿的 CI 运行（含 `REQ-UI-015 check-budget ≤ 250KB`、`REQ-UI-013 axe 全路由 0 serious`）；故意删一个已运行层的 P0 测试则失败；`REQ-OPS-006 阶段顺序` 由 workflow 文件断言 |
| T0-030 | `pnpm xz seed`（08 §7；固定 id 形如 `01920000-0000-7000-8000-0000000NNNNN`，upsert 幂等）+ e2e 前自动跑在 `xz_e2e` + 生产禁用 | `cli.ts`、`src/server/seed/` | T0-013 · T0-011 | — | 3 | 二次执行行数不变；`pnpm e2e` 无需手工准备数据；`NODE_ENV=production` 下退出码非 0 |
| T0-031 | 验证实例 `pnpm dev:verify`（独立端口 3011/8012/8013、`cacheDir .vite-verify`、`xz_e2e` 库） | `vite.config.ts`、`package.json` | T0-016 | REQ-OPS-012 | 1 | `REQ-OPS-012 主 dev 运行时同时起 verify 无冲突`（手工验收，记入 debug/） |
| T0-032 | Phase 0 一致性审查（05 §9）：01/02 与代码漂移零差异、`CHANGELOG.md`、各规范「最后对照代码」日期更新 | `spec_dev_doc/` | T0-029 · T0-030 · T0-031 | — | 2 | `pnpm lint` 的 drift 步骤零差异；CHANGELOG 有 Phase 0 审查条目 |

**估时合计：106.5h**（脚本按第 6 列求和）。裁剪建议：若需压缩，T0-015 快照、T0-022 的 Passkey、T0-021 的截图基线、T0-030 seed 可顺延到 Phase 1 首周，约省 10h；取舍见 ADR-0003。

豁免项：REQ-OPS-011（季度恢复演练）为持续项，不进任务表，手工验收记入 `debug/`，不计入 P0 门槛。

## 里程碑

| # | 节点 | 包含任务 | 可演示什么 |
|---|---|---|---|
| M0.1 地基 | T0-001 ~ T0-009 | 三服务起、迁移跑通、`can()` 矩阵绿、健康检查 |
| M0.2 进得来 | T0-010 ~ T0-012 · T0-016 ~ T0-022 | 邀请邮件 → 注册 → 登录 → 玻璃壳子 + `/design` 两主题 |
| M0.3 写得下 | T0-013 ~ T0-015 · T0-023 | 两个浏览器协同编辑一篇记录、离线恢复、快照 |
| M0.4 通得到 | T0-024 ~ T0-032 | 事件 → 通知 → SSE 铃铛；备份；生产 Compose 本机起；CI 绿；一致性审查 |

## 裁定记录（2026-09-23）

1. **工期**：计划值取本表脚本求和；ADR-0001 §9.5 的「5 天」为历史乐观值，正式取代见 **ADR-0003**；是否裁剪由 ADR-0003 决定。
2. **个人空间**：`create-owner` 与接受邀请时自动创建，见 T0-007 与 01 §3.1。
3. **恢复演练目标库**：`xz_verify`（05 §2 四库用途）；REQ-OPS-011 豁免出任务表。

## 进度记录

### 2026-09-23 · M0.1 地基（T0-001 ~ T0-009）

| ID | 状态 | 备注 |
|---|---|---|
| T0-001 | 部分 | `git init` + `.gitignore` 已做；`chore: init` 提交按全局 Git 规则留给用户（全部文件已按路径暂存） |
| T0-002 | 完成 | pnpm 11 需 `pnpm-workspace.yaml: allowBuilds`；`typecheck` 改逐项目 `tsc -p`（05 §3 v3） |
| T0-003 | 完成 | `infra/docker-compose.yml` + `pg-init/01-databases.sql` 四库；Mailpit 8025 / SMTP 1025 |
| T0-004 | 完成 | `src/server/env.ts` Zod；缺变量时列字段名退出 1 |
| T0-005 | 完成 | 21 张业务表 + 10 张认证表；`drizzle/0000_extensions.sql`（pg_trgm / vector）+ `0001_init.sql`；`scripts/check-schema-drift.ts` 零差异（197 列） |
| T0-006 | 完成 | 插件 organization / admin / twoFactor / magicLink（主包）+ `@better-auth/passkey` / `@better-auth/api-key`；REQ-AUTH-002 · 010 · 015 测试绿；REQ-AUTH-001 · 012 一并绿 |
| T0-007 | 完成 | `pnpm xz create-owner`（REQ-AUTH-013 绿、二次退出码 2）；`ensurePersonalSpace` 幂等（REQ-SPACE-009 绿）；接受邀请时建个人空间的钩子（`organizationHooks.afterAcceptInvitation`）留到 T0-010 一起接 |
| T0-008 | 完成 | `app.ts` + 中间件（requestId / pino redact / secure-headers CSP / 600 限流 / CSRF / session / 登录锁定）；REQ-OPS-001 · 003 · 004 · 009 · 014、REQ-AUTH-011 · 012 绿；`curl /api/health` → `{ok,version}` |
| T0-016 | 完成 | Vite 8 + React 19（Compiler 经 `oxc-transform-react`）+ TanStack Router 文件式（逗号分隔 `parseSearch/stringifySearch`）+ Query + `lib/api.ts`（`hc<AppType>`、`ApiError`、GET 重试）+ i18next（`i18n/zh-CN.ts`）+ `check-i18n` 真实实现；REQ-UI-012 绿 |
| T0-017 | 完成 | `styles/tokens.css` 两主题全部 token + 8 色板 + 派生 token（每个 `[data-theme]` 容器重算）、`app.css` 的 `@theme inline` 映射与 `@utility glass/glass-thin/glass-thick/glass-thick-flat/paper/scrim`、回退与 View Transition CSS；`check-contrast` 44 项全部达标（4 个原值按最小修正，见 06 §3 注）；REQ-UI-002 · 003 绿 |
| T0-018 | 完成 | `lib/theme.ts`（跟随系统 / 手动 / 圆形揭幕 / 溶解 / 连点 skip / `.vt-live`）+ 首帧 `public/theme-init.js`；e2e REQ-UI-001 绿 |
| T0-019 | 完成 | `components/ui/` 13 个原语（Button 五变体、Input、Label、Dialog、Sheet 含非 modal、Popover、Tooltip、Command、Skeleton、Tabs、Checkbox、Avatar、KeyHint）+ 光标高光 hook；Toast = `useSonner` 队列 + Topbar 内自建容器（`StatusPill.tsx`，Motion `layoutId` 形变）。原型结论：非 modal Sheet 用 Radix `modal={false}` 即可；Toast 无需 Sonner 的 Toaster。secondary 按钮去 blur（06 §5.1 注）；REQ-UI-023 unit + e2e 绿 |
| T0-020 | 完成 | `components/layout/AppShell.tsx`（Topbar 56 / Sidebar 240 / Aside 320、`[` `]` 折叠、< lg 抽屉、底部导航 safe-area、Dialog 打开时 Aside 自动收起）、`NotificationBell`、`ThemeToggle`；e2e REQ-UI-014 · REQ-MOBILE-001 绿 |
| T0-021 | 完成 | `routes/_app.design.tsx` 五页（tokens / materials / depth / switch / components），非 admin 404；截图基线 `e2e/__screenshots__/`（≤ 0.1%）；blur 计数（默认只渲染当前主题，`theme=both` 并排）；REQ-UI-004 · 016 e2e 绿 |
| T0-022 | 完成 | `/login`、`/login/2fa`（文件 `login_.2fa.tsx`，见 debug）、`/invite/$token`、`/settings/security`（2FA 开启 + 10 个恢复码、Passkey 列表与添加、会话列表与注销）；e2e REQ-AUTH-001 · 003 · 004 · 006 与 api REQ-AUTH-006 · 008 绿 |
| T0-023 | 完成 | `editor/`（fullKit、自定义节点 entryLink / callout / mermaid / mathBlock / 仅 `xz:attachment/` 图片）、`EntryEditor`（y-indexeddb 先渲染、按文档取票据、关闭码处理、StatusPill）、`/entries/$entryId`（懒加载、Aside 属性面板）；e2e REQ-COLLAB-001 · 004 · 005 · 010 绿；编辑器 chunk 179 KB gzip（REQ-EDITOR-014 ≤ 400） |
| T0-015 | 完成 | `src/collab/snapshots.ts`：以「上一快照版本（无则 0）/ 上一快照时间（无则记录创建时间）」为基准，版本差 ≥ 50 或 ≥ 30 分钟且版本前进时自动快照（满足 REQ-COLLAB-007「60 次落库 1 行」）；`GET/POST /entries/:id/snapshots`、`GET …/:sid`；`gcSnapshots` 保留策略；`pnpm xz snapshot`。REQ-COLLAB-007 unit + api + collab 绿 |
| T0-024 | 完成 | `jobs/outbox.ts`（自循环 `outbox.drain`，pg 事务内 `FOR UPDATE SKIP LOCKED` + `send(..., { db })` + 标 `processed_at`；积压 > 1h 发 `system.outbox_stalled` 同日一条）、`services/notify.ts`（01 §4 接收者 / 默认通道 / §4.1 模板 / 5 分钟合并 / `can(read)` / 幂等）；另加最小通知接口 `GET /notifications`（带 `unreadCount`）、`read` / `read-all` / `archive`。REQ-NOTIF-001 · 011 · 014 · 016 绿。webpush 投递落 `skipped`（Phase 2） |
| T0-025 | 完成 | `lib/sse-hub.ts` + `GET /api/v1/stream`（每用户 ≤ 3、25s 心跳、每用户 seq、5 分钟环形缓冲补发、超出发 `reset`、`user.revoked` 断开）；REQ-NOTIF-002 · 003 api 绿。前端 `hooks/useRealtime.ts`（EventSource、指数退避、`lastEventId` 查询参数重连）已接入；e2e `REQ-NOTIF-002 事件后 2s 内铃铛 +1` 绿 |
| T0-026 | 完成 | `jobs/index.ts` 12 个作业（07 §3 名称 + outbox / fanout）、`startWorker` 与 API 同进程（`XZ_WORKER=0` 可关）、`pnpm xz job <name>` 手动触发；REQ-OPS-007 绿。`gc.events` 跳过仍被通知引用的事件（见 CHANGELOG） |
| T0-027 | 完成 | `services/backup.ts`：`pg_dump -Fc` → `age-encryption`（纯 JS）→ `data/backups/xz-YYYYMMDD.dump.age`，14 天清理；`pnpm xz restore <file> --identity <key> [--db xz_verify]` 恢复并对照行数、清空 session；失败写 `audit backup.failed` + `system.backup_failed`；`xz export --workspace` 骨架。REQ-EXPORT-005 绿 |
| T0-030 | 完成 | `services/seed.ts` 按 08 §7 全量（固定 id、幂等）；`pnpm xz seed`，生产拒绝；账号 `owner@demo.local / demo-owner`、`member@demo.local / demo-member`、`guest@demo.local / demo-guest` |
| T0-028 | 完成 | `infra/Dockerfile`（多阶段 node:24-alpine、`USER node`、PG16 客户端、tini、4 并发拉包 + store 缓存挂载）、`docker-compose.prod.yml`（三服务、健康检查依赖、`json-file 50m × 5`）、`Caddyfile.snippet`、`deploy.sh`、`backup.sh`；生产模式 API 托管 `dist/client`。本机验收：三服务 healthy、`/api/health` 200、`/collab` 握手 101、`node` 用户、日志轮转；坏迁移新容器退出 1、旧容器 healthy（REQ-OPS-002 · 005，手工记录见本表与 debug）。`deploy.sh` 未执行（会连远程服务器）。补（2026-09-24）：验收自动化为 `pnpm e2e:infra`（`e2e/infra.spec.ts`，4 例），经 Caddy 的用例发现并修复 `Caddyfile.snippet` 的 `/collab` 匹配缺陷（debug/2026-09-24-caddy-collab-matcher） |
| T0-029 | 草稿待确认 | 工作流写在 `infra/ci/ci.yml`（红线：改 CI 需用户确认后移入 `.github/workflows/`）；`scripts/vitest-req-reporter.ts` + `e2e/req-reporter.ts` 分层产出、`scripts/req-coverage.ts` 门槛（unit 需求可由 api / collab 满足）、`check-openapi-drift.ts` 真实实现（按 REQ Phase 过滤）、`check-budget.ts`；REQ-OPS-006 阶段顺序单测 + 删测试即失败单测绿。`pnpm audit` 在 npmmirror 无接口，CI 指向 npmjs，本机未能执行 |
| T0-031 | 完成 | `scripts/verify-env.sh` + `pnpm dev:verify`（3011/8012/8013、`xz_e2e`、`.vite-verify`）；手工验收记入 `debug/2026-09-24-dev-verify-coexist` |
| T0-032 | 完成 | 见 CHANGELOG「Phase 0 一致性审查」。e2e 门槛首跑未过（4 条 P0 缺 e2e / infra 用例），补测试时修了 SSE 补发基线（debug/2026-09-24-sse-replay-baseline）与登录页首屏（Lighthouse 69 → 93，debug/2026-09-24-lighthouse-first-paint） |
| T0-014 | 完成 | `src/collab/server.ts`（票据 HMAC + jti 防重放 + Origin + 每用户 ≤ 10 + readOnly；onLoadDocument 读 ydoc / 模板注入 / schema bump；onStoreDocument 防抖 2s/10s、`ydoc_version+1`、savepoint 内派生、失败写 `derived_error`、`entry.updated` 5 分钟合并；`user.revoked` / `entry.access_changed` 订阅；2 MB / 20 MB 上限；`gc:false`；`/collab/health`）、`POST /api/v1/collab/token`、`shared/editor/templates.ts`、PG 广播桥 `lib/bus-pg.ts`；REQ-COLLAB-002 · 003 · 009、REQ-WS-004（WS 1s 内 4403）绿。延后：`derive.retry` 入队（T0-026）、快照策略（T0-015）、正文 `links(mentions)` / `mentions` 同步与 `mention.created`（Phase 1，REQ-LINK / REQ-COMMENT） |
| T0-013 | 完成 | `services/entries.ts` + `routes/entries.ts`（列表 / 创建 / 详情 / PATCH 乐观锁 / 软删 / 永久删 / 恢复 / 归档）、`src/collab/derive.ts`（yDoc → pm_json / plain / word_count / tsv 文本，与 `rebuild-derived` 共用）、`lib/tokenize.ts`（jieba）、`pnpm xz rebuild-derived [--entries|--tasks|--comments]`；REQ-ENTRY-001 · 002 · 003 · 004 · 007 · 010、REQ-WS-008 绿；authz 新增 `entry.create` 动作 |
| T0-012 | 完成 | `src/shared/schemas/*` 20 个文件 + barrel；REQ-ENTRY-001 每 kind 正反用例、events 每 kind 一例、recurrence / sort / liteKit 用例绿 |
| T0-011 | 完成 | `services/members.ts`（改角色 / 移除 / 停用恢复 / 吊销会话 / owner 转让，同事务删 session + 禁用 Key，提交后 `EventBus` 广播 `user.revoked`）、`GET|PATCH /workspace`、`GET /workspace/audit-log` 游标、`/me` `/me/sessions` `/me/keys`（Key 审计写入点）、登出审计；REQ-WS-001 · 002 · 003 · 004 · 005 · 006 · 012 · 013 · 014 · 017、REQ-AUTH-009 · 014 绿。WS「1s 内 4403 断开」的 collab 侧在 T0-014 订阅 bus 后补断言；`?purge=1`（REQ-WS-015）与 `transfer-content`（REQ-WS-016）按 Phase 1/2 留空 |
| T0-010 | 完成 | `routes/workspace.ts` 邀请五端点（含新增公开 `GET /:id` 与 `POST /:id/accept`，02 §9 v3）、react-email + nodemailer → Mailpit；REQ-AUTH-003（api）· 004 · 005 · REQ-NOTIF-009 绿。`invite.$token.tsx` 页面与 e2e `REQ-AUTH-003 · REQ-NOTIF-009 · REQ-AUTH-004` 已随 T0-022 补齐 |
| T0-009 | 完成 | `can()` 23 个动作 × 5 角色 × 4 空间角色 = 805 例字面量矩阵（REQ-WS-007）；`visible*Where()` 已写，REQ-WS-008 的 api 用例随 T0-013 路由补 |

版本裁定：`drizzle-orm@0.45.3`（1.0 仍为 beta）、`typescript@5.9`（7.0 为新实现，工具链未验证）、`vitest@5`、`hono@4.13`、`better-auth@1.7.5`。
