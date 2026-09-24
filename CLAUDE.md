# 生长间奏 / Growing Interlude — AI 开发指南

> 个人工作台：学习计划 · 工作任务 · 开发过程沉淀（迭代 / 决策 / Bug / 变更）。多用户邀请制。
> 本文只放坐标、命令、不变量。**规范在 `spec_dev_doc/`（权威），踩坑在 `debug/`，本文 ≤ 80 行。**

## 坐标

- 单 package TypeScript：`src/client`（Vite 8 + React 19 + TanStack + Tailwind v4 + shadcn）· `src/server`（Hono + Drizzle + pg-boss）· `src/collab`（Hocuspocus）· `src/shared`（Zod schema、编辑器模板）
- 数据：PostgreSQL 16（pgvector 镜像，独立容器）；正文 = Yjs 二进制 `entries.ydoc`
- 认证：Better Auth（organization/admin/2FA/passkey/apiKey 插件），不开放注册；collab WebSocket 用 `POST /collab/token` 按文档签发的 5 分钟票据，不用 Cookie
- 分期：一期 = Phase 0–2（可用版本）· 二期 = Phase 3（MCP / 导入 / AI / pgvector）；规范里不出现「三期」
- 端口：3010 Vite · 8010 API · 8011 collab · 5433 PG · 8025 Mailpit（简斋占 3001/8002/5432/6379，勿撞）
- 部署：腾讯云与简斋同机，Compose 三服务，复用其 Caddy；`infra/`

## 命令

```
pnpm i                 # .npmrc 已指 npmmirror；直连 npmjs 会超时
pnpm db:up             # pg + mailpit 容器
pnpm dev               # 三服务并行
pnpm db:generate / db:migrate / auth:generate
pnpm test / e2e / lint / build   # lint 含裸色值/对比度脚本；build 含性能预算检查
pnpm start / start:collab        # 生产：app 容器（migrate+api+worker）/ collab 容器，一一对应
pnpm gi <cmd>          # rebuild-derived | export | snapshot | backup | restore | create-owner | seed（import-debug 属二期）
```

- 后端 API 测试用 `app.request()`，不起端口；E2E 用独立端口 3011/8012/8013 与独立 `.vite-verify` 缓存
- **主 dev server 运行时勿在同目录再起共享 `.vite` 缓存的实例**（简斋教训：prosemirror/codemirror 多实例崩溃）
- 原生依赖只允许 npm 平台包分发（`@node-rs/*`、`sharp`）；禁止依赖 GitHub prebuild 的包

## 不可违背的不变量

1. **`entries.ydoc` 是正文唯一可写真源**；entries 的 `pm_json/plain/tsv` 只由 collab `onStoreDocument` 派生，tasks / comments 的 `*_plain/tsv` 只由 service 同事务写入；都可 `gi rebuild-derived` 重建。正文永不经 Markdown 往返。
2. **`src/server/authz.ts` 的 `can()` 是唯一授权入口**；API、Hocuspocus 钩子、SSE、附件、MCP、jobs 全走它；列表用 `visible*Where()`；业务代码禁止直接比较角色。
3. **通知只来自 `events` 出箱**：service 内同事务 `emit()`，pg-boss 扇出到 in_app/SSE/WebPush/邮件；路由层与前端不直接发通知。
4. **路由不含业务**：routes 只做校验 → service → 序列化；service 被 jobs/MCP/CLI 复用。
5. **颜色与动效只从 `tokens.css` 取**；禁止 `!important`、禁止组件私有主题变量、禁止裸色值。
6. **列表接口不返回正文列**；分页一律游标；写操作带 `ifUpdatedAt` 或 `Idempotency-Key`。
7. **Y.Doc `gc:false`**（前后端一致），否则快照失效。
8. 改任何 ADR 决定 → 新开 `spec_dev_doc/adr/NNNN-*.md`，不改旧文（只允许加「注」与删除线标注）。
9. **安全收口**（规则在 `07`）：通知深链永不带 token；正文 `image.src` 只接受 `gi:attachment/`；日志脱敏 `authorization / cookie / ydoc`；上传按魔数判 mime；WebSocket 只认 `POST /collab/token` 按文档签发的票据。

## 规范索引（按需 Read，勿全量内联）

| 文件 | 内容 |
|---|---|
| `spec_dev_doc/adr/0001-tech-stack.md` | 选型与 8 项决定、分期、各技术介绍 / 作用 / 语言（§10） |
| `spec_dev_doc/adr/0002 · 0003` | 视觉改 Apple 玻璃 · 工期基线 = 任务级估时 |
| `spec_dev_doc/01-domain-model.md` | 表结构、`fields` schema、事件种类、权限矩阵 |
| `spec_dev_doc/02-api-conventions.md` | 路由/错误/分页/SSE/文件/MCP 约定、路由清单 |
| `spec_dev_doc/03-editor-kernel.md` | Tiptap schema、Hocuspocus 钩子、快照、模板、交互规格、简斋陷阱 |
| `spec_dev_doc/04-design-system.md` | token、动效档位、布局、交互、`/design` 画廊 |
| `spec_dev_doc/05-dev-workflow.md` | 环境、测试策略、CI、部署、备份、Phase 0 验收清单 |
| `spec_dev_doc/06-visual-style.md` | Apple 玻璃材质、日场 / 夜场 token、组件材质表、性能预算（ADR-0002） |
| `spec_dev_doc/07-security-and-data.md` | 威胁模型、保留 / 清理表、成员生命周期、限额表、安全测试 |
| `spec_dev_doc/08-pages-and-flows.md` | 路由表、每页规格与 search params、关键流程、边界情况、离线范围、支持矩阵、seed |
| `spec_dev_doc/00-requirements.md` | **需求层**：`REQ-<AREA>-<NNN>` 编号、EARS + GWT 验收、追溯约定 |
| `spec_dev_doc/glossary.md` | 术语表：中文 / 标识符 / 表名 / UI 文案 / i18n key；禁用词 |
| `spec_dev_doc/tasks/phase-N.md` | 任务拆分：依赖、REQ、估时、完成定义 |
| `spec_dev_doc/CHANGELOG.md` | 规范变更记录与每 Phase 的一致性审查 |
| `debug/README.md` | 踩坑条目五段模板（症状/复现/根因/修复/验证） |

## 会话纪律

- **动手前先找 REQ**：实现任何功能先在 `00-requirements.md` 定位编号；没有就先补需求再写代码。测试名以 REQ ID 开头，PR 描述列出覆盖的 REQ（05 §4 DoD）
- 术语以 `glossary.md` 为准；新词先加表再进代码
- 会话结束前：决策 → `spec_dev_doc/adr/`；踩坑 → `debug/YYYY-MM-DD-<slug>/README.md`（症状/复现/根因/修复/验证）；规范改动 → `CHANGELOG.md` 加行；改了命令或约定 → 提醒用户更新本文，不自动改
- 不自动 commit/push；红线操作（删文件、改 `.env`/密钥/CI、push/rebase/reset）先问
- 中文回复，代码与路径英文；结论先行
