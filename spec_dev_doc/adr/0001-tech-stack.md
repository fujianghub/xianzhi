# ADR-0001 技术栈选型

> 状态：**已采纳** · 采纳日期：2026-09-23 · 演进：v1 按「一期最简」→ v2 按「富文本内核 + 性能不返工」→ v3 增补多用户、通知、UI 交互/设计体系（§9）。§8 为最终决定；§10 为每项技术的介绍 / 作用 / 语言清单。
> 变更本文任何选型须新开 ADR（`adr/NNNN-*.md`）并在此处标注「被 ADR-NNNN 部分取代」。
> 产品：生长间奏 · Growing Interlude —— 个人工作台（学习计划 / 工作任务 / 产品开发过程沉淀）。

---

## 0. 结论

| 层 | 选型 | 一句话理由 |
|---|---|---|
| 编辑器内核 | **Tiptap 3（ProseMirror）+ Yjs**，一期即上 | 内核只能选一次；Yjs 让多设备/多标签页/离线全部无冲突，并消灭简斋那套 409/草稿备份/自动保存竞态 |
| 协同后端 | **Hocuspocus 4**（MIT，自托管） | 与 Tiptap 同厂，官方路径；单实例不需要 Redis |
| 内容存储 | **Yjs 二进制为真源** + 派生 ProseMirror JSON + 派生纯文本/Markdown | 简斋教训：Markdown 作真源，富文本往返每保存一轮腐蚀一层 |
| 前端 | **Vite 8 + React 19 + React Compiler** · TanStack Router/Query/Virtual/Table · **Tailwind v4 + shadcn/ui** | 编译器自动记忆化；Rolldown 构建快；组件代码归自己，主题不与 UI 库打架 |
| 后端 | **Node 24 + Hono + Zod 4 + Drizzle 1.0** | 一门语言、类型端到端（Hono RPC）；HTTP 框架吞吐对单用户应用不是瓶颈 |
| 数据库 | **PostgreSQL 16（pgvector 镜像）** | jsonb / pg_trgm / pgvector 一步到位；本机与腾讯云都已在跑 PG，不是新增运维负担 |
| 中文检索 | 应用侧 `@node-rs/jieba` 分词 → `tsvector` + `pg_trgm` 兜底；语义检索 pgvector | PG 的中文分词扩展（zhparser/pg_jieba）维护差，分词放 Node 侧可控 |
| 认证授权 | **Better Auth**（Drizzle 适配 + Hono）+ 自建单收口点 `can()` | 多用户：邀请、重置、2FA、OAuth、组织成员均为插件；授权只有一个入口 |
| 通知 | 事件出箱（`events` 表）→ pg-boss 扇出 → 站内 / **SSE** / Web Push / 邮件 | 业务不直接发通知；非文档数据的实时性靠 SSE 触发 Query 失效 |
| 任务队列 | **pg-boss**（PG 做队列） | git 扫描、AI 摘要、导出、备份、通知扇出；不引 Redis/Celery |
| 文件 | 本地卷 + Hono 流式（支持 Range）+ `sharp` 缩图 | 附件、截图、PDF；后续可切 COS |
| UI 交互 | cmdk 命令面板 · 全局快捷键 · Sonner · **Motion** 动效 · Lucide · react-hook-form + Zod · i18next | 工作台标配；设计 token 先于组件 |
| 工程 | Biome · Vitest · Playwright · pnpm · 单仓三目录 | |
| 部署 | Compose：app + collab + pg；复用腾讯云 Caddy（TLS/HTTP2/Brotli） | |
| 集成 | **MCP Server** 包一层 API | 让 Claude Code 在开发时直接往工作台写迭代/Bug/决策记录 |

> 注（2026-09-23）：上表「派生纯文本/Markdown」中 Markdown 不落列，仅在导出时由 `pm_json` 生成（03 §8）；派生列只有 `pm_json / plain / tsv / word_count`（01 §3.4）。工期数字被 ADR-0003 取代。

不选：Lexical（Yjs 与扩展生态不如 ProseMirror 系）、Slate/Plate（历史上 CJK 输入法问题多）、Milkdown（Markdown 为真源，正是要避免的）、SQLite（v1 选择；改 PG 的原因见 §4）、Redis/Celery（无必要）、Next.js/TanStack Start（私有工具无 SSR 需求；Start 尚在 RC）、Bun（未安装，收益不值风险）。

---

## 1. 需求重述

「记录 + 规划」的个人工作台，三类对象在一条时间轴上交织并互相链接：

| 对象 | 内容 | 对内核的要求 |
|---|---|---|
| 任务 Task | 学习计划、工作待办、子任务、排期、看板 | 列表/看板/日历高频操作，需要虚拟滚动与乐观更新 |
| 周期 Cycle | 周/月/季目标与复盘（「间奏」） | 结构化字段 + 一段富文本 |
| 记录 Entry | 迭代日志、ADR、Bug 记录、变更日志、随笔 | **富文本编辑器是主战场**：代码块、表格、Mermaid、图片、任务列表、双链、模板 |

明确的后续需求（用户已声明）：**富文本内核、性能**。隐含需求：多设备（服务器浏览器 + 手机）、离线可写、版本历史、AI 辅助、与开发过程打通。

---

## 2. 编辑器内核：为什么是 Tiptap 3 + Yjs，且一期就上

### 2.1 候选

| 内核 | 基础 | 评价 |
|---|---|---|
| **Tiptap 3** | ProseMirror | 你已深度使用；2025-06 起 10 个原 Pro 扩展（含 drag-handle、table-of-contents、details 等）转 MIT；仍收费的只有依赖其云服务的 Comments / Snapshots / AI。Yjs 协同扩展免费。 |
| BlockNote 0.5x | Tiptap 之上的 Notion 式块编辑器 | 开箱即得斜杠菜单/拖拽把手/嵌套块，有 `@blocknote/shadcn`；核心 MPL-2.0 可商用，**XL 包（多列、导出、AI）GPL-3.0**。深度定制受限。 |
| Lexical | Meta 自研 | 体积小、快；但 Yjs 绑定和扩展生态弱于 ProseMirror 系，需要自己造的东西多。 |
| Milkdown | ProseMirror + Markdown 优先 | Markdown 真源，与本项目要规避的问题相反。 |

**选 Tiptap 3 裸内核**。BlockNote 是可选加速器：若想快速得到 Notion 手感，可以在 Tiptap 之上叠 BlockNote（它就是 Tiptap），但 Bug 记录/ADR 需要自定义节点与模板，裸 Tiptap 更可控。这是需要你拍板的一点（§8）。

### 2.2 为什么 Yjs 一期就上

- **改造成本不对称**：JSON → Yjs 迁移要跑一次全量转换并改所有保存路径；一开始用 Yjs 只多 2–3 天。
- **消灭一整类 bug**：简斋里的 409 冲突、`localDraftBackup`、自动保存竞态、双写不一致，在 CRDT 模型下不存在。
- **性能即体验**：编辑动作先落本地（`y-indexeddb`），后台同步；手机弱网也能写。
- **版本历史免费**：Yjs 快照（`Y.snapshot`）自建即可，不需要 Tiptap 付费 Snapshots。

### 2.3 内容存储模型

```
entries
  id, kind, title, space_id, fields(jsonb), ...
  ydoc      bytea        ← 真源：Yjs 文档二进制（Hocuspocus onStoreDocument 落库）
  pm_json   jsonb        ← 派生：ProseMirror JSON（服务端 yDocToProsemirrorJSON），供列表预览/导出
  plain     text         ← 派生：纯文本，供分词与 tsvector
  tsv       tsvector     ← 派生：jieba 分词后写入，GIN 索引
  embedding vector(…)    ← 派生（二期）：pgvector 语义检索
  updated_at, version
```

派生列由服务端在 `onStoreDocument` 钩子中同步更新（防抖），Markdown 导出从 `pm_json` 生成。**任何时候只有 `ydoc` 是可写真源。**

---

## 3. 前端

| 项 | 选型 | 说明 |
|---|---|---|
| 构建 | Vite 8（Rolldown） | 2026-03 稳定；构建速度大幅提升 |
| 框架 | React 19 + **React Compiler 1.0** | `@vitejs/plugin-react` v6 `{ compiler: true }` 原生启用；自动 memo，编辑器周边组件不再手写 `useMemo/useCallback` |
| 路由 | TanStack Router | 类型化 search params：看板筛选、日期、搜索词全在 URL |
| 数据 | TanStack Query | 乐观更新、失效、预取 |
| 大列表 | TanStack Virtual | 任务列表、记录列表、搜索结果 |
| 表格 | TanStack Table | |
| UI | Tailwind v4 + shadcn/ui（Radix） | 主题 = CSS 变量；深色/品牌色无 `!important` 战争 |
| 拖拽 | dnd-kit | 看板、任务排序、编辑器块拖拽（Tiptap drag-handle 扩展） |
| 本地状态 | Zustand（仅主题、布局） | |
| 编辑器 | Tiptap 3 + `@tiptap/extension-collaboration` + `y-indexeddb` + `HocuspocusProvider` | 按路由懒加载，编辑器 chunk 与主包分离 |
| 渲染扩展 | lowlight（代码高亮）、KaTeX、Mermaid 11（懒加载） | 复用简斋经验 |
| PWA | vite-plugin-pwa | 壳与静态资源预缓存；内容离线靠 y-indexeddb |
| 图表 | Recharts 或原生 SVG | 统计/热力图 |

### 性能预算（写进 CI）
- 首屏主 chunk（gzip）≤ 250 KB；编辑器 chunk 独立懒加载。
- 列表页 API P95 ≤ 100 ms（本机）；列表接口不返回正文列（defer body，简斋已踩过）。
- 长列表一律虚拟滚动；分页用游标。
- Lighthouse Performance ≥ 90（Playwright 跑，报告存 `debug/perf/`）。

---

## 4. 后端与数据

### 4.1 运行时与框架
- **Node 24 + Hono**。Hono 在 Node 上的吞吐低于 Fastify，但本应用单用户，瓶颈永远在 DB 与编辑器；Hono 的 `hc` 客户端把路由类型直接带到前端，抵得过任何吞吐差距。
- **Zod 4** schema 放 `src/shared/`，一份定义供表单校验 + API 校验 + OpenAPI（`hono-openapi`）+ MCP 工具描述。
- **Drizzle 1.0**：SQL 风格、迁移可读；PG 与 SQLite 两端都支持，万一要回退成本极低。

### 4.2 为什么改 PostgreSQL
v1 选 SQLite 的理由是「单文件、单容器」。改 PG 的理由：
1. **pgvector**：AI 语义检索（「找出我上个季度所有和缓存有关的决策」）是这个工具的自然延伸，SQLite 的 sqlite-vec 成熟度差一档。
2. **jsonb + GIN**：Entry 的 `fields` 按 kind 结构不同，jsonb 索引查询比 SQLite 的 JSON 函数强得多。
3. **并发写**：Hocuspocus 落库 + pg-boss 队列 + API 写入同时发生，SQLite 单写锁会开始咬人。
4. **不是新负担**：本机与腾讯云都已在跑 PG16；备份脚本、监控套路你已有。

镜像用 **`pgvector/pgvector:pg16`**（官方 `postgres:16-alpine` 不含 pgvector），**独立容器、端口 5433**，不与简斋共库（升级、备份、故障隔离）。

### 4.3 中文检索
- PG 的 zhparser / pg_jieba 在新版本上维护差，不上。
- 分词在 Node 侧：`@node-rs/jieba`（napi，平台包走 npm，mirror 可达），写入 `tsvector`（`'simple'` 配置 + 分词结果以空格拼接）。
- `pg_trgm` GIN 做子串/模糊兜底（标题、标签）。
- 升级路径：若检索体验不够（错别字容忍、即时搜索），加 **Meilisearch** 容器（CJK 原生支持，单二进制），派生数据由 pg-boss 同步。不在一期。

### 4.4 协同服务
- **Hocuspocus 4**：MIT；单实例内存持有活跃文档，`onStoreDocument` 防抖落 PG；`onAuthenticate` 校验会话 Cookie/Token。
- 作为独立进程（端口 8011）与 API 同镜像部署；Caddy 路由 `/collab` → 8011。单用户不需要 Redis 扩展。
- 快照：每日或每 N 次更新存 `entry_snapshots(ydoc_snapshot bytea)`，前端用 Yjs 快照对比做「历史版本 / diff」。

### 4.5 队列与定时
- **pg-boss**：git 日志扫描、AI 周复盘生成、Markdown 导出、`pg_dump` 备份、embedding 计算。
- 与 API 同进程起 worker（单用户够用），要隔离时拆成第三个服务，代码不改。

### 4.6 认证与授权（v3 改：多用户）
- **Better Auth**：TypeScript 原生，Drizzle 适配器，Hono 中间件；启用插件 `organization`（Workspace/Space 成员与角色）、`admin`（管理员后台：用户、封禁、模拟登录）、`twoFactor`、`passkey`、`magicLink`；OAuth 提供方按需（GitHub/Google）。会话 Cookie `HttpOnly/SameSite=Lax/Secure`。
- **注册策略：邀请制，不开放自助注册**（`disableSignUp` + 邀请链接）。这是控制滥用、邮件送达与配额复杂度的关键边界。
  - 注（2026-09-25）：被 ADR-0008 部分替代——改为「邀请 或 自助注册 + 管理员审批」，Better Auth 自助注册端点仍关闭。
- **授权唯一收口点**：`src/server/authz.ts` 导出 `can(user, action, resource)`；API 中间件、Hocuspocus `onAuthenticate`/`onLoadDocument`、文件下载、SSE 订阅、MCP 工具**全部**经它判定；禁止在业务代码里散写 `if (user.role === ...)`。测试按角色矩阵覆盖（owner / admin / member / guest / anon）。
- API Token（给 MCP、脚本）：Better Auth `apiKey` 插件，可吊销、可限 scope。
- 审计日志：`audit_log` 表记录登录、权限变更、删除、导出；一期就建表，后台二期展示。

---

## 5. 与开发过程打通（自建的核心理由）

| 能力 | 做法 | 阶段 |
|---|---|---|
| **MCP Server** | 用 Zod schema 自动生成工具，Claude Code 在会话结束时直接创建「迭代记录 / Bug 记录 / 决策」 | 二期，但 API 一期就按此设计 |
| git 日志导入 | pg-boss 定时扫 `/root/Claude_Code/*`，按天聚合 commit 生成迭代记录草稿 | 二期 |
| `debug/` 导入 | 目录模板（症状/复现/根因/修复/验证）与 `Entry(kind=bug)` 字段一一对应，一键导入 | 二期 |
| 简斋互链 | 一期 URL 链接；二期调简斋 API 取标题/摘要做卡片 | 一期/二期 |
| AI | Anthropic SDK 仅后端持 Key；周复盘摘要、零散日志 → ADR、语义检索 | 二期 |
| 数据出口 | 全量导出 Markdown + frontmatter（Obsidian 可读）+ `pg_dump` | 一期 |

---

## 6. 目录与工程约定

```
GrowingInterlude/
├── CLAUDE.md                 # ≤ 80 行：坐标 + 命令 + 不变量；细节指向 spec_dev_doc/
├── spec_dev_doc/             # 权威规范
│   ├── adr/0001-tech-stack.md      ← 本文
│   ├── 01-domain-model.md
│   ├── 02-api-conventions.md       # Hono 路由/错误码/分页/鉴权
│   ├── 03-editor-kernel.md         # Tiptap schema、自定义节点、Yjs 落库、快照
│   ├── 04-design-system.md
│   └── 05-dev-workflow.md          # 命令、端口、测试、部署、备份
├── debug/                    # YYYY-MM-DD-<slug>/README.md（五段模板）+ perf/ 报告
├── src/
│   ├── client/               # Vite + React
│   ├── server/               # Hono API + pg-boss worker + MCP
│   ├── collab/               # Hocuspocus 入口
│   └── shared/               # Zod schema、类型、常量
├── drizzle/                  # 迁移
├── e2e/                      # Playwright
├── infra/                    # Dockerfile、compose、Caddy 片段、backup.sh
└── data/                     # 运行时卷（gitignore）：uploads、backups
```

- 端口：3010（Vite dev）/ 8010（API）/ 8011（collab）/ 5433（PG）。
- `.npmrc`：`registry=https://registry.npmmirror.com`。
- 原生依赖白名单：仅允许通过 npm 平台包分发的（`@node-rs/*`、`sharp`、`pg` 纯 JS）；**禁止**依赖 GitHub prebuild 下载的包（better-sqlite3、canvas 等）。
- Biome 统一 lint/format；Vitest 单测 + `app.request()` 级 API 测试；Playwright E2E；CI 跑性能预算。

---

## 7. 分期

| 阶段 | 内容 | 时长 |
|---|---|---|
| Phase 0 | 脚手架、认证、PG + Drizzle 迁移、Hocuspocus 跑通、Dockerfile/Compose、Caddy 接入、备份 | 3 天 |
| Phase 1 | Space / Task（列表、看板、今日）/ Entry（Tiptap + Yjs 编辑器，代码块、表格、任务列表、图片上传）/ 标签 / 中文检索 / Markdown 导出 | 1.5 周 |
| Phase 2 | Cycle 周期复盘、双向链接与反链面板、日历/时间线、快照历史、模板（ADR/Bug/迭代）、Mermaid/KaTeX | 1.5 周 |
| Phase 3 | MCP Server、git 日志导入、`debug/` 导入、AI 周复盘、pgvector 语义检索、PWA 打磨 | 按需 |

> 注（2026-09-23 补）：Phase 0 / 1 工时 §9.5（5 天 / 2.5 周）与 ADR-0002 的 +1 天已**被 ADR-0003 取代**（计划值 = `tasks/phase-N.md` 估时）；术语「一期 = Phase 0–2、二期 = Phase 3」，各规范内的「二期」均指 Phase 3。

---

## 8. 决定（2026-09-23 全部按建议采纳）

| # | 问题 | 决定 |
|---|---|---|
| 1 | 编辑器 UI 层：裸 Tiptap 3 自建（可控）还是叠 BlockNote（Notion 手感快） | 裸 Tiptap |
| 2 | Yjs 一期就上（推荐）还是先 JSON 后迁移 | 一期就上 |
| 3 | 数据库 PostgreSQL（推荐）还是坚持 SQLite 单文件 | PG，独立容器 5433 |
| 4 | UI 库 shadcn/ui + Tailwind（推荐）还是 AntD 5 | shadcn |
| 5 | 部署与简斋同机、复用 Caddy | 是 |
| 6 | 多用户范围：~~邀请制~~、单 Workspace 数十人内、~~不开放注册~~（注 2026-09-25，ADR-0008：开放注册 + 审批；数十人 / 50 上限不变） | 是（超出此范围架构需重估：Redis、多实例 Hocuspocus、对象存储） |
| 7 | 邮件服务商：腾讯云 SES 还是 Resend | 腾讯云 SES（与部署同云、国内送达） |
| 8 | 动效库：Motion（原 Framer Motion）还是仅 CSS + View Transitions | Motion，布局动画与手势非 CSS 可及 |


---

## 9. v3 增补：多用户 / 通知 / UI 交互与设计体系

### 9.1 领域模型增量
```
Workspace（租户，一期只有一个）
  └ Member(user, role: owner|admin|member|guest)
Space.visibility: workspace | members        ← 空间级成员表 space_members
Entry.visibility: private | space | workspace
Task.assignee_id, Task.watchers
Comment(target_type, target_id, body_pm_json, parent_id)   ← 评论/回复
Mention(comment_id | entry_id, user_id)                    ← @提及 → 事件
Activity(actor, verb, target, payload, created_at)         ← 活动流（由 events 派生）
Notification(user_id, event_id, channel, read_at, sent_at)
NotificationPreference(user_id, event_kind, channels[])
```
- Tiptap 官方 Comments 扩展是付费云功能：**自建** `comment` mark（存 thread_id）+ `comments` 表；提及用 `@tiptap/suggestion`（简斋已用过）。
- 多人同时编辑靠 Yjs awareness 显示光标与头像，Hocuspocus 单实例在数十人规模内足够。

### 9.2 通知管线
```
业务写事件 → events(outbox, 事务内) → pg-boss 消费 → 按 NotificationPreference 扇出
   ├ in_app   : notifications 表 + 未读数；前端通知中心
   ├ realtime : SSE（Hono 流式响应，每用户一条连接，心跳 25s，Caddy 无需改）
   ├ webpush  : VAPID + service worker（vite-plugin-pwa 已规划）
   └ email    : react-email 模板 + nodemailer(SMTP: 腾讯云 SES)；即时 / 每日摘要两档
```
- 事件种类一期：任务指派/到期/完成、@提及、评论回复、空间邀请、周复盘提醒、系统（导出完成、备份失败）。
- 去重与合并：同一目标 5 分钟内的事件合并成一条；摘要邮件由 pg-boss cron 汇总。
- **看板/列表实时性**：SSE 推送 `{type:'invalidate', keys:[...]}`，前端 TanStack Query 失效重取；不把任务做成 CRDT。
- 通知偏好页是一期功能，否则多用户第一天就会被打扰。

### 9.3 UI 交互与设计体系
| 项 | 选型 | 说明 |
|---|---|---|
| 设计 token | `04-design-system.md` 先行：色阶（品牌色 + 语义色）、字体（自托管中文字体子集化）、间距/圆角、阴影、动效三档（减弱/标准/丰富）、深浅色 | 组件只消费 token；用 CSS 变量，不用 `!important` |
| 组件基座 | shadcn/ui（Radix）| 可访问性、键盘导航自带 |
| 命令面板 | cmdk（shadcn Command） | ⌘K：跳转、新建任务/记录、切换空间、搜索 |
| 快捷键 | react-hotkeys-hook + 统一注册表 | `?` 打开快捷键面板；与编辑器快捷键分域 |
| 反馈 | Sonner（Toast）· 骨架屏 · 乐观更新（Query）· 空状态插画 | |
| 动效 | Motion（layout 动画、手势、弹簧）+ View Transitions（路由级） | 简斋的三档位动效经验直接迁移；所有动效受 `prefers-reduced-motion` |
| 表单 | react-hook-form + Zod（shadcn Form 标准路径） | 与后端共享同一 schema |
| 图标 | Lucide | shadcn 默认；品牌图标自绘 SVG |
| 组件画廊 | 应用内 `/design` 路由（仅 admin 可见） | 替代 Storybook；每个组件的状态矩阵一页看完 |
| i18n | i18next + 类型化 key；一期只有 zh-CN 资源文件 | **字符串从第一天外置**，后补极痛 |
| 移动端 | PWA + 响应式；底部导航；编辑器移动工具条 | 手机主要是查看、勾任务、快速记录 |
| 设计稿 | 进入 UI 阶段前用设计画布定视觉语言（品牌：乐章/间奏/小节隐喻），再写组件 | ~~避免复制简斋的玻璃态~~ **被 ADR-0002 部分取代**：材质改为 Apple 玻璃，见 `06-visual-style.md` |

### 9.4 对性能与运维的影响
- 多用户后加：每用户限流（内存令牌桶，单实例足够）、每用户存储配额、`N+1` 检查（Drizzle 关系查询 + 测试里断言查询数）。
- 仍然不引 Redis：会话在 PG（Better Auth）、队列在 PG（pg-boss）、SSE 在进程内。**触发重估的信号**：并发在线 > 50、需要多实例、附件 > 50 GB（此时上 Redis + 多实例 Hocuspocus + 对象存储 COS）。
- 备份加密：`pg_dump` 后 age/gpg 加密再离站，多用户数据不能明文躺在备份盘。

### 9.5 分期调整
- Phase 0 增加：Better Auth 接入、邀请流程、`can()` 收口点与角色测试矩阵、设计 token 与 `/design` 画廊、i18n 骨架、SMTP 打通。**时长 3 天 → 5 天。**
- Phase 1 增加：通知中心 + SSE + 偏好页、任务指派、评论与提及。**1.5 周 → 2.5 周。**
- Phase 2 增加：Web Push、邮件摘要、活动流、后台用户管理。
- 总体：一期可用版本约 **5 周**（原 3 周）。

---

## 10. 技术栈清单：介绍 · 作用 · 语言

> 本节是 §0 结论表的展开：每项技术是什么、在本项目里负责什么、用什么语言写 / 用什么语言调用。§0 管「为什么选」，本节管「它是什么」。

### 10.1 编程语言总览

| 语言 | 用在哪里 | 说明 |
|---|---|---|
| **TypeScript** | `src/client` · `src/server` · `src/collab` · `src/shared` · `e2e/` · 脚本 | 全项目唯一业务语言；前后端共享 Zod schema 与 Hono RPC 类型，端到端类型安全 |
| **SQL**（PostgreSQL 方言） | `drizzle/` 迁移、tsvector / pg_trgm / pgvector 查询 | 由 Drizzle 生成迁移，复杂检索手写 SQL 片段 |
| **CSS** | `tokens.css`、Tailwind v4 配置 | 设计 token 用 CSS 变量；Tailwind v4 以 CSS 为配置入口，无 `tailwind.config.js` |
| **YAML / Dockerfile / Caddyfile / Shell** | `infra/` | Compose 编排、镜像构建、反代片段、备份脚本 |
| **Rust**（间接） | Rolldown、Biome、`@node-rs/jieba`、`sharp`(C++) 的底层实现 | 本项目不写 Rust；只以 npm 平台包形式消费编译产物 |
| 运行时 | **Node 24** | 服务端、协同服务、pg-boss worker、CLI 均跑在 Node 上 |

### 10.2 编辑器与协同

| 技术 | 是什么 | 在本项目的作用 | 语言 |
|---|---|---|---|
| **ProseMirror** | 富文本编辑器底层工具包：schema 驱动的不可变文档模型 + 事务系统 | Tiptap 的内核；决定了文档结构可被严格约束、可与 Yjs 绑定 | TypeScript |
| **Tiptap 3** | ProseMirror 之上的无头（headless）编辑器框架，扩展式装配节点 / 标记 / 命令 | Entry 正文编辑器：代码块、表格、任务列表、图片、双链、模板、自定义节点（ADR / Bug 字段） | TypeScript |
| **Yjs** | CRDT 库：多副本并发修改自动合并，无冲突 | 正文真源格式（`entries.ydoc` 二进制）；多设备 / 多标签页 / 离线编辑；快照做版本历史 | TypeScript |
| **y-indexeddb** | Yjs 的浏览器持久化 provider | 编辑先落本地 IndexedDB，弱网 / 离线可写，联网后同步 | TypeScript |
| **Hocuspocus 4** | Tiptap 官方 Yjs WebSocket 协同后端（MIT） | `src/collab` 独立进程（8011）：持有活跃文档、`onAuthenticate` 鉴权、`onStoreDocument` 防抖落库并派生 `pm_json/plain/tsv` | TypeScript（Node） |
| **lowlight / KaTeX / Mermaid 11** | 代码高亮（highlight.js 的 AST 版）/ 数学公式 / 文本转图表 | 编辑器内代码块高亮、公式、流程图；均懒加载 | TypeScript / JavaScript |

### 10.3 前端

| 技术 | 是什么 | 在本项目的作用 | 语言 |
|---|---|---|---|
| **Vite 8** | 前端构建工具与 dev server；8.x 以 Rolldown（Rust）替代 Rollup + esbuild | `src/client` 开发与打包；编辑器 chunk 独立分包；性能预算检查挂在 `build` | TypeScript 配置；内核 Rust |
| **React 19** | 组件化 UI 库 | 全部界面 | TypeScript（TSX） |
| **React Compiler 1.0** | 官方编译期自动记忆化工具 | 自动 memo，省去手写 `useMemo/useCallback`；经 `@vitejs/plugin-react` 开启 | Babel 插件（JavaScript） |
| **TanStack Router** | 类型安全的文件式路由，search params 有 schema | 页面路由；看板筛选 / 日期 / 搜索词全部放 URL | TypeScript |
| **TanStack Query** | 服务端状态管理：缓存、失效、乐观更新、预取 | 所有 API 数据；SSE 推 `invalidate` 后自动重取 | TypeScript |
| **TanStack Virtual / Table** | 虚拟滚动 / 无头表格逻辑 | 任务列表、记录列表、搜索结果的长列表；表格视图 | TypeScript |
| **Tailwind v4** | 原子类 CSS 框架，v4 以 CSS 文件为配置 | 布局与样式；颜色 / 动效只从 `tokens.css` 变量取 | CSS |
| **shadcn/ui（Radix）** | 可复制进仓库的组件源码集合，底层 Radix 提供无障碍原语 | 按钮、对话框、命令面板等基础组件；代码归自己，主题不与库打架 | TypeScript（TSX） |
| **dnd-kit** | 拖拽工具包 | 看板拖卡、任务排序、编辑器块拖拽 | TypeScript |
| **Zustand** | 极简客户端状态库 | 仅主题、布局等本地 UI 状态 | TypeScript |
| **Motion** | 动画库（原 Framer Motion）：布局动画、手势、弹簧 | 三档动效（减弱 / 标准 / 丰富）；受 `prefers-reduced-motion` 约束 | TypeScript |
| **cmdk** | 命令面板组件 | ⌘K：跳转、新建、切空间、搜索 | TypeScript |
| **react-hotkeys-hook** | 快捷键 Hook | 全局快捷键注册表，与编辑器快捷键分域 | TypeScript |
| **Sonner** | Toast 通知组件 | 操作反馈 | TypeScript |
| **react-hook-form + Zod** | 表单状态 + schema 校验 | 表单与后端共享同一份 `src/shared` schema | TypeScript |
| **Lucide** | 图标集 | 通用图标；品牌图标自绘 SVG | TypeScript（SVG） |
| **i18next** | 国际化框架 | 字符串从第一天外置；一期仅 zh-CN | TypeScript |
| **vite-plugin-pwa** | PWA 壳与 service worker 生成 | 静态资源预缓存、Web Push 载体；内容离线靠 y-indexeddb | TypeScript |
| **Recharts / 原生 SVG** | 图表库 | 统计、热力图 | TypeScript |

### 10.4 后端与数据

| 技术 | 是什么 | 在本项目的作用 | 语言 |
|---|---|---|---|
| **Node 24** | JavaScript 运行时 | API、collab、worker、CLI 的运行环境 | — |
| **Hono** | 轻量 Web 框架，多运行时；`hc` 客户端带路由类型到前端 | `src/server` API（8010）、SSE 流式响应、附件 Range 流式、Hono RPC | TypeScript |
| **Zod 4** | TypeScript-first schema 校验库 | `src/shared` 单份定义：表单校验 + API 校验 + OpenAPI + MCP 工具描述 | TypeScript |
| **Drizzle 1.0** | SQL 风格的类型安全 ORM 与迁移工具 | 表定义、关系查询、`drizzle/` 迁移；Better Auth 适配器 | TypeScript（生成 SQL） |
| **PostgreSQL 16** | 关系数据库 | 唯一数据库（独立容器 5433）：业务表、`ydoc` bytea、jsonb 字段、会话、队列 | SQL |
| **pgvector** | PG 向量扩展 | 二期语义检索（`embedding` 列） | C（PG 扩展） |
| **pg_trgm** | PG 三元组模糊匹配扩展 | 标题 / 标签的子串与模糊检索兜底 | C（PG 扩展） |
| **@node-rs/jieba** | 结巴中文分词的 Rust 实现，napi 绑定 | 应用侧分词后写 `tsvector`，替代维护差的 zhparser / pg_jieba | Rust（npm 平台包） |
| **pg-boss** | 以 PG 表为存储的任务队列（含 cron） | 通知扇出、git 扫描、AI 摘要、导出、备份、embedding；不引 Redis | TypeScript |
| **Better Auth** | TypeScript 原生认证框架，插件化 | 登录、邀请制注册、`organization` / `admin` / `twoFactor` / `passkey` / `magicLink` / `apiKey` 插件；会话存 PG | TypeScript |
| **sharp** | 高性能图片处理（libvips 绑定） | 附件缩略图 | C++（npm 平台包） |
| **nodemailer + react-email** | SMTP 发信 / 用 React 写邮件模板 | 通知邮件（即时 / 每日摘要），经腾讯云 SES | TypeScript |
| **Anthropic SDK** | Claude API 客户端 | 二期：周复盘摘要、日志 → ADR、embedding；Key 仅后端持有 | TypeScript |
| **MCP Server** | Model Context Protocol 服务端 | 二期：把 API 包成工具，Claude Code 直接写迭代 / Bug / 决策记录 | TypeScript |

### 10.5 工程与部署

| 技术 | 是什么 | 在本项目的作用 | 语言 |
|---|---|---|---|
| **pnpm** | 包管理器，硬链接存储、严格依赖 | 单 package 依赖管理；`.npmrc` 指 npmmirror | — |
| **Biome** | Rust 写的 lint + format 一体工具 | 替代 ESLint + Prettier | Rust（npm 平台包） |
| **Vitest** | Vite 生态单测框架 | 单测 + `app.request()` 级 API 测试，不起端口 | TypeScript |
| **Playwright** | 浏览器端到端测试 | E2E（独立端口 3011/8012/8013）、Lighthouse 性能预算 | TypeScript |
| **Docker Compose** | 多容器编排 | app + collab + pg 三服务；Mailpit 本地收信 | YAML |
| **Caddy** | 自动 TLS 的反向代理 | 复用简斋的 Caddy：`/api` → 8010、`/collab` → 8011；HTTP/2、Brotli | Caddyfile |
| **Mailpit** | 本地 SMTP 收件箱（8025） | 开发环境查看邀请 / 通知邮件 | — |

---

## 参考（2026-09-23 核实）
- Hocuspocus 4 发布（MIT，多运行时）：https://news.ycombinator.com/item?id=48208834 · https://github.com/ueberdosis/hocuspocus
- Tiptap 开源 10 个原 Pro 扩展：https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap
- BlockNote 许可（核心 MPL-2.0，XL 包 GPL-3.0/商业）：https://www.blocknotejs.org/pricing
- Vite 8 稳定（2026-03）：https://vite.dev/blog/announcing-vite8
- React Compiler 1.0 与 plugin-react v6：https://react.dev/blog/2025/10/07/react-compiler-1
- Drizzle 1.0 / node-sqlite 驱动：https://orm.drizzle.team/docs/latest-releases
- TanStack Start v1 RC：https://tanstack.com/blog/announcing-tanstack-start-v1
- @node-rs/jieba：https://www.npmjs.com/package/@node-rs/jieba
- PG 中文检索现状与 Meilisearch 对比：https://www.meilisearch.com/docs/resources/comparisons/postgresql
