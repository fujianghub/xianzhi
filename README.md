<div align="center">

# 衔枝 · Xianzhi

**一枝一枝衔回来，筑成自己的巢。**

自托管的个人工作台：学习计划 · 工作任务 · 开发过程沉淀（迭代 / 决策 / Bug / 变更）。

`TypeScript` · `React 19` · `Tiptap 3 + Yjs` · `Hono` · `PostgreSQL 16` · `Better Auth`

</div>

---

## 它是什么

衔枝是一个把「规划」和「记录」放在同一条时间线上的工作台。任务管得住每天要做的事，记录沉淀做事过程里的决策、踩坑和复盘，两者通过空间、标签、关联和日历互相串起来。

它面向个人和小团队：默认单人使用，也支持多用户（邀请或申请注册，管理员审批后才能登录）。

名字取自燕子衔枝筑巢：每天积累的一条记录、一个任务，就是衔回来的一根枝。

## 功能

### 任务

- **任务页**：快速添加栏直接识别句子里的日期、优先级、标签和清单，例如 `明天下午3点 复盘迭代 !高 #周会 ~工作`；默认按清单分组，也可按截止日期分组；常用日期一键选
- **清单**：自建清单，支持就地改名、改色、排序；任务支持批量操作和撤销
- **看板 / 列表**：空间内任务两种视图切换，拖拽改状态，乐观更新
- **今日 / 收件箱**：今天要做的和还没归类的任务各有入口
- **优先级与详情**：优先级用鲜艳色胶囊标出；宽屏下任务详情在右侧详情坞就地打开，字段用选择器直接改

### 记录与编辑器

- **富文本编辑器**：基于 Tiptap 3，支持代码块高亮、表格、任务列表、折叠块、提示框、Mermaid 图、KaTeX 公式、图片 / 附件、网页链接卡片、`@` 提及、`[[` 记录双链、查询块
- **实时协同与离线**：正文用 Yjs CRDT 存储，多标签页、多设备同时编辑不冲突；断网照样能写（IndexedDB 本地缓存），联网后自动合并
- **版本历史**：随时标记版本，浏览快照、对比差异、一键恢复
- **模板**：内置模板（迭代 / ADR / Bug / 变更日志等）+ 个人模板 + 工作区共享模板；模板可绑定类型和属性
- **类型与属性**：每条记录有类型（内置类型可由所有者调整，也可以自建），类型带状态流转和自定义属性；属性可用于筛选、分组和查询块
- **Bug 跟踪**：Bug 类型自带严重度、状态等字段和统计
- **阅读与写作偏好**：字体、字号、行距、版心、纸张、首行缩进、章节编号、目录深度，按人保存
- **Markdown**：可以导入、查看源码、导出；但正文永远以 Yjs 为真源，不做 Markdown 往返

### 组织与查找

- **空间**：按主题分空间，每个空间有概览页、目录树、记录列表和任务；支持分组、批量管理、归档、合并；每人有一个个人空间作为工作台
- **标签**：个人标签，可选色、改名、合并
- **关联**：记录之间双向关联，详情侧栏可见反链
- **日历**：日 / 周 / 月 / 年视图，日程和带截止日期的任务叠加显示，跨天日程画成连续条（仿 macOS），支持重复日程、提醒和中国法定节假日
- **搜索**：⌘K 命令面板 + 全文搜索；中文用 jieba 分词，`pg_trgm` 兜底
- **回收站**：任务、记录、空间软删除后可恢复

### 协作与通知

- **多用户**：Better Auth 认证，支持邮箱 / 用户名密码、Passkey、两步验证（TOTP）、魔法链接、API Key；登录前须通过服务端拼图滑块验证
- **注册审批**：自助注册只能提交申请，所有者审批通过后才能登录；也可以直接发邀请
- **角色与权限**：owner / admin / member / guest 四级，权限判断全部经过统一入口 `can()`
- **评论与提及**：任务和记录都能评论、`@` 成员
- **通知**：站内通知 + SSE 实时推送 + 邮件，按人设置通知偏好；到期提醒和日程提醒由后台作业发出
- **审计日志**：成员、账号、权限等敏感变更都有记录

### 界面

- Apple 风格玻璃材质 + 翡翠主色；日场 / 夜场主题默认跟随系统
- 主题、密度、动效档位、玻璃强度随账号保存，工作区可以设默认值
- 尊重系统的「减少动态效果」和「降低透明度」设置
- 登录、注册等认证页由一只幼燕陪着：它会随输入改变神情和动作
- 字体本地托管（MiSans、霞鹜文楷、JetBrains Mono 等），异步加载
- 桌面和移动端都能用，宽屏下详情统一在右侧详情坞打开

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite 8 · React 19（React Compiler）· TanStack Router / Query / Virtual · Tailwind CSS v4 · shadcn/ui（Radix）· Motion · cmdk · i18next |
| 编辑器 | Tiptap 3（ProseMirror）· Yjs · y-indexeddb · CodeMirror 6（源码编辑）· lowlight · Mermaid · KaTeX |
| 协同 | Hocuspocus 4（独立进程；WebSocket 使用按文档签发、5 分钟有效的票据） |
| 后端 | Node 24 · Hono · Zod 4 · Drizzle ORM · pg-boss（PostgreSQL 做队列）· pino |
| 数据 | PostgreSQL 16（pgvector 镜像）· `@node-rs/jieba` 分词 → `tsvector` · `pg_trgm` |
| 认证 | Better Auth（organization / admin / 2FA / passkey / magicLink / apiKey / username 插件） |
| 文件 | 本地卷 + 鉴权流式输出（支持 Range）· `sharp` 生成缩略图 · 按文件头魔数识别类型 |
| 工程 | pnpm · Biome · Vitest · Playwright（含 axe 无障碍检查、视觉基线）· TypeScript 5.9 |
| 部署 | Docker Compose（app / collab / pg）· Caddy 反向代理 · age 加密备份 |

为什么这样选，见 [ADR-0001 技术栈选型](spec_dev_doc/adr/0001-tech-stack.md)。

## 架构

```
浏览器 ── HTTP / SSE ──▶ Caddy ──▶ xz-app :8010     Hono API + pg-boss worker
   │                         │                    │
   └── WebSocket ────────────┴──▶ xz-collab :8011  Hocuspocus（Yjs 协同、快照、派生列）
                                                  │
                                                  ▼
                                          PostgreSQL 16（xz-pg）
```

几条贯穿全项目的设计约束：

1. **正文唯一真源是 `entries.ydoc`**（Yjs 二进制）。`pm_json`、纯文本和全文索引都由协同服务落库时派生，随时可以用 `pnpm xz rebuild-derived` 重建。
2. **授权只有一个入口**：`src/server/authz.ts` 的 `can()`。API、协同钩子、SSE、附件、后台作业都经过它，业务代码不直接比较角色。
3. **通知只来自事件出箱**：业务在同一事务里写 `events`，pg-boss 再分发到站内、SSE、邮件；路由和前端不直接发通知。
4. **路由不含业务逻辑**：route 只做校验 → service → 序列化，service 可被作业和 CLI 复用。
5. **颜色和动效只从设计 token 取**：禁止裸色值和 `!important`，lint 会检查对比度和裸色值。

## 快速开始

### 环境要求

- Node.js ≥ 24（见 `.nvmrc`）
- pnpm 11（`corepack enable` 即可）
- Docker（运行 PostgreSQL 和 Mailpit）

### 本地运行

```bash
pnpm i                      # .npmrc 默认指向 npmmirror，海外网络可自行改回 npmjs
cp .env.example .env        # 填写 BETTER_AUTH_SECRET、COLLAB_TOKEN_SECRET（openssl rand -base64 48）
pnpm db:up                  # 启动 PostgreSQL（5433）和 Mailpit（8025）
pnpm db:migrate             # 执行数据库迁移
pnpm xz create-owner        # 创建第一个所有者账号和默认工作区
pnpm xz seed                # 可选：写入示例数据（生产环境禁用）
pnpm dev                    # 同时启动 client / api / collab
```

打开 <http://localhost:3010> 登录。开发环境的邮件（邀请、魔法链接）在 Mailpit 查看：<http://localhost:8025>。

### 端口

| 端口 | 用途 |
|---|---|
| 3010 | Vite 前端（代理 `/api`、`/collab`） |
| 8010 | API |
| 8011 | 协同服务 |
| 5433 | PostgreSQL |
| 8025 | Mailpit Web UI（SMTP 1025） |
| 3011 / 8012 / 8013 | E2E 验证实例（`pnpm dev:verify`，按需启动） |

## 常用命令

```bash
pnpm dev                 # 开发：三个服务并行（watch 模式）
pnpm test                # Vitest 单元 / API / 协同集成测试 + 需求覆盖校验
pnpm e2e                 # Playwright 端到端测试（会重建 xz_e2e 库）
pnpm lint                # Biome + 裸色值 / 对比度 / i18n 检查
pnpm lint:drift          # 规范与代码一致性检查（表结构、路由清单）
pnpm typecheck           # 三套 tsconfig 类型检查
pnpm build               # 生产构建 + 性能预算检查
pnpm db:generate         # 根据 Drizzle schema 生成迁移
```

运维 CLI `pnpm xz <cmd>`：

| 命令 | 作用 |
|---|---|
| `create-owner` | 创建首个所有者 + 默认工作区 |
| `seed` | 写入示例数据（生产禁用） |
| `rebuild-derived` | 从 Yjs 正文重建派生列和全文索引 |
| `snapshot <entryId>` | 为指定记录生成版本快照 |
| `backup` | `pg_dump` → age 加密 → `data/backups/` |
| `restore <file> --identity <key>` | 解密并恢复到演练库，核对行数 |
| `export --workspace` | 导出工作区 |
| `job <name>` | 手动触发一个后台作业 |

## 目录结构

```
src/
  client/        前端：routes（TanStack 文件路由）、components、editor（Tiptap 扩展与节点视图）、styles（tokens.css）
  server/        API：routes → services → db（Drizzle schema）；authz.ts、jobs/（pg-boss）、mail/、cli.ts
  collab/        Hocuspocus 协同服务：落库、派生列、快照、历史
  shared/        前后端共用：Zod schema、编辑器模板与序列化、时区与节假日
drizzle/         SQL 迁移
e2e/             Playwright 用例与视觉基线
scripts/         lint / 漂移检查 / 性能预算 / 需求覆盖统计
infra/           Dockerfile、Compose（开发与生产）、Caddy 片段、部署与备份脚本
spec_dev_doc/    规范文档（权威）：需求、领域模型、API 约定、编辑器内核、设计系统、ADR
debug/           踩坑记录（症状 / 复现 / 根因 / 修复 / 验证）
```

## 部署

生产环境用 `infra/docker-compose.prod.yml` 启动三个服务：

- **xz-app**：启动时先执行迁移，再运行 API 和后台作业；健康检查 `GET /api/health`
- **xz-collab**：同一镜像，运行协同服务；等 app 健康后才启动
- **xz-pg**：`pgvector/pgvector:pg16`

反向代理把 `/collab/*` 转给 collab（WebSocket），其余转给 app，配置片段见 `infra/Caddyfile.snippet`。发布流程见 `infra/deploy.sh`：本地构建镜像 → rsync 到服务器 → `docker compose up -d` → 健康检查。

备份：每天凌晨由后台作业执行 `pg_dump` 并用 age 公钥加密，保留 14 天；私钥离站保存。完整说明见 [05 开发流程 §7–§8](spec_dev_doc/05-dev-workflow.md)。

## 测试与质量

- **需求可追溯**：每条需求在 [`00-requirements.md`](spec_dev_doc/00-requirements.md) 有 `REQ-<领域>-<编号>`（目前 400+ 条，覆盖任务、记录、编辑器、协同、日历、通知、权限等 23 个领域），测试名以 REQ ID 开头，`scripts/req-coverage.ts` 统计每层的覆盖情况
- **分层测试**：Vitest（单元、API 用 `app.request()` 不起端口、协同集成）+ Playwright（桌面 / 移动端、无障碍、视觉基线、性能）
- **漂移检查**：数据库 schema 和 API 路由清单必须与规范文档的表格一致，不一致 CI 失败
- **性能预算**：`pnpm build` 会检查首屏 JS 体积；Mermaid / KaTeX 等大依赖只在用到时动态加载

## 文档

规范以 `spec_dev_doc/` 为准，代码和规范冲突时以规范为准修代码。

| 文档 | 内容 |
|---|---|
| [00 需求](spec_dev_doc/00-requirements.md) | REQ 编号、EARS 描述与验收条件 |
| [01 领域模型](spec_dev_doc/01-domain-model.md) | 表结构、字段、事件种类、权限矩阵 |
| [02 API 约定](spec_dev_doc/02-api-conventions.md) | 路由、错误、分页、SSE、文件、路由清单 |
| [03 编辑器内核](spec_dev_doc/03-editor-kernel.md) | Tiptap schema、协同钩子、快照、模板 |
| [04 设计系统](spec_dev_doc/04-design-system.md) | token、动效档位、布局与交互 |
| [05 开发流程](spec_dev_doc/05-dev-workflow.md) | 环境、测试策略、CI、部署、备份 |
| [06 视觉风格](spec_dev_doc/06-visual-style.md) | 玻璃材质、日场 / 夜场、性能预算 |
| [07 安全与数据](spec_dev_doc/07-security-and-data.md) | 威胁模型、数据保留、成员生命周期、限额 |
| [08 页面与流程](spec_dev_doc/08-pages-and-flows.md) | 路由表、每页规格、关键流程、边界情况 |
| [术语表](spec_dev_doc/glossary.md) | 中文术语 / 标识符 / 表名 / 文案对照 |
| [ADR](spec_dev_doc/adr/) | 54 份架构决策记录 |
| [CHANGELOG](spec_dev_doc/CHANGELOG.md) | 规范变更记录 |

## 路线图

- **一期（Phase 0–2，已可用）**：任务、记录与编辑器、实时协同与离线、版本历史、模板、空间、标签、日历、搜索、通知、多用户与权限、导出与备份
- **二期（Phase 3）**：MCP Server（让 AI 编码助手直接往工作台写迭代 / Bug / 决策记录）、外部内容导入、AI 辅助、pgvector 语义检索、周期（周 / 月 / 季目标与复盘）、Web Push

## 许可证

仓库暂未附带 LICENSE 文件。
