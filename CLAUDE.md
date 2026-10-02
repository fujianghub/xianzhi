# 衔枝 / Xianzhi — AI 开发指南

> 个人工作台：学习计划 · 工作任务 · 开发过程沉淀（迭代 / 决策 / Bug / 变更）。多用户：邀请或注册 + 管理员审批（ADR-0008）。燕子衔枝筑巢（ADR-0004）。
> 本文只放坐标、命令、不变量。**规范在 `spec_dev_doc/`（权威），踩坑在 `debug/`，本文 ≤ 80 行。**

## 坐标

- 单 package TypeScript：`src/client`（Vite 8 + React 19 + TanStack + Tailwind v4 + shadcn）· `src/server`（Hono + Drizzle + pg-boss）· `src/collab`（Hocuspocus）· `src/shared`（Zod schema、编辑器模板、`tz.ts`）
- 数据：PostgreSQL 16（pgvector 镜像，独立容器）；正文 = Yjs 二进制 `entries.ydoc`
- 认证：Better Auth（organization/admin/2FA/passkey/magicLink/apiKey/username）；Better Auth 自助注册关闭，注册只走 `POST /workspace/join-requests`，审批前无 `member` 行 = 不能登录；邮箱或用户名 + 密码（≥ 8 位）登录，前置服务端拼图滑块（ADR-0006 / 0008）；collab WebSocket 用 `POST /collab/token` 按文档签发的 5 分钟票据，不用 Cookie
- 视觉：Apple 玻璃（ADR-0002）+ 翡翠主色、燕印、动效档位（ADR-0005）+ 空间 / 标签 / 日历共用鲜艳 9 色板（ADR-0010）；日场 / 夜场，默认跟随系统；字体 npm 自托管、异步加载；记录页 = 标题 → 紧凑属性列表（空属性收起、流转摘要弹层）→ 文档栏（字数 · 阅读弹层 · 专注 · 保存 · Markdown）→ 吸顶格式栏（吸顶才有底线）→ 正文（ADR-0035 · 0037），排版由按人存的阅读偏好（`user_preferences`，ADR-0024 ~ 0031）决定；认证四页共用 `AuthShell`「衔枝小院」：幼燕插画 + 情绪状态机，动作引擎 `components/auth/bird-engine.ts`，开发用 `/login?birdlab` 逐个触发（ADR-0034）；材质类在 `@layer components`（去外投影用 `--xz-mat-drop`，不用 `shadow-none`）、浮层退出动效带 `data-xz-exit`（ADR-0046）；玻璃强度 `html[data-glass]` 默认流光、只调 token 不加 blur（ADR-0047 · 0048）；外观偏好（主题 / 密度 / 动效 / 玻璃）随账号存 `user_preferences.appearance`、工作区可设默认，本机 `xz:*` 只作首帧缓存（ADR-0049）
- 分期：一期 = Phase 0–2（可用版本）· 二期 = Phase 3（MCP / 导入 / AI / pgvector）；规范里不出现「三期」
- 端口：3010 Vite · 8010 API · 8011 collab · 5433 PG · 8025 Mailpit（简斋占 3001/8002/5432/6379，勿撞）
- 部署：腾讯云与简斋同机，Compose 三服务，复用其 Caddy；`infra/`；远端 `github.com/fujianghub/xianzhi`

## 命令

```
pnpm i                 # .npmrc 已指 npmmirror；直连 npmjs 会超时
pnpm db:up             # pg + mailpit 容器
pnpm dev               # 三服务并行（tsx watch）；**本地开发环境只有 3010**：由 systemd `xianzhi-dev` 托管（开机自启，`systemctl restart|status xianzhi-dev`，日志 data/dev.log），勿再手动起
pnpm dev:verify        # 验证实例 3011/8012/8013 + xz_e2e，仅跑 e2e 时按需起、跑完即停；局域网加 APP_URL=http://<ip>:3011；worktree 另起加 CLIENT_PORT/API_PORT/COLLAB_PORT；api/collab 不带 watch，改服务端须重启
pnpm db:generate / db:migrate / auth:generate
pnpm test / e2e / lint / lint:drift / build   # lint 含裸色值/对比度/i18n；build 含性能预算
pnpm start / start:collab        # 生产：app 容器（migrate+api+worker）/ collab 容器，一一对应
pnpm xz <cmd>          # rebuild-derived | export | snapshot | backup | restore | create-owner [--username] | seed | migrate-prefix（import-debug 属二期）
```

- 后端 API 测试用 `app.request()`，不起端口；`signIn()` 辅助自动取拼图答案；worktree 要隔离测试库用 `XZ_TEST_DATABASE_URL`（用例勿写死库名，见 `debug/2026-09-30-jobs-test-restore-hardcoded-db`）。E2E 用独立端口 3011/8012/8013 与独立 `.vite-verify` 缓存；`pnpm e2e` 会重建 `xz_e2e`，且只认 `localhost:3011`（跑前停掉按 IP 起的验证实例）；对其它实例跑指定用例：`XZ_E2E_BASE=<与该实例 APP_URL 同源，按 IP 起的就用 IP> pnpm exec playwright test <spec> --project=setup --project=desktop`（Origin 不一致则登录 setup 超时）；另起的 worktree 实例与 3011 同连 xz_e2e 时，实时 / 协同 / 历史类 e2e 会串（SSE 丢帧、恢复执行两次），这类用例只留一套实例跑（见 `debug/2026-09-27-spaces-list-truncated-200`）；REQ-COLLAB-011 写死杀 8013 的 collab，对别的实例无效（`debug/2026-09-29-e2e-collab-kill-hardcoded-port`）
- 验证实例设 `XZ_CAPTCHA_DEBUG=1`（拼图答案回显，e2e `solveCaptcha()` 真实拖拽）；production 由服务端强制忽略。`xz_e2e` 各 worktree 共用，附件目录固定为主仓 `data/e2e`；不重建库也要能过，用例勿依赖累积数据（自建大类 / 空间，遮罩未读数等易变区域；见 `debug/2026-09-26-e2e-shared-db-data-drift`）；改阅读偏好的用例前后都要复位；指定外观用 `helpers.setAppearancePref` / `resetAppearance` 走 API（写 localStorage 会被账号值覆盖），夜场用 `emulateMedia`，e2e 定位浮层过滤 `[data-state="open"]`（退场中的浮层仍在 DOM）（按人存在共享库）
- 视觉基线：改样式后先在 `/settings/design?theme=both` 逐页过一遍，确认后 `pnpm exec playwright test e2e/design.spec.ts e2e/feedback.spec.ts --project=setup --project=desktop --update-snapshots`
- **主 dev server 运行时勿在同目录再起共享 `.vite` 缓存的实例**（简斋教训：prosemirror/codemirror 多实例崩溃）；worktree 有自己的 `node_modules`，可在另一端口起预览
- 改被 `inList()` 引用的枚举（`AUDIT_ACTIONS`、`PALETTE_COLORS` 等）必须 `pnpm db:generate` 重建 check 约束，否则插库 500（见 `debug/2026-09-25-audit-action-check-constraint`）
- 客户端生成 id / `Idempotency-Key` 只用 `lib/uuid.ts` 的 `newId()`：按局域网 IP 走 HTTP 时没有 `crypto.randomUUID`（check-css 拦截；见 `debug/2026-09-25-randomuuid-insecure-context`）
- 原生依赖只允许 npm 平台包分发（`@node-rs/*`、`sharp`）；禁止依赖 GitHub prebuild 的包；> 10 MB 的包先测镜像速度（npmmirror 大 tarball 会挂死，见 05 §2）；`mermaid` / `katex` 只在节点视图里动态 `import()`（不进编辑器首包）；KaTeX 区域勿继承 `text-wrap: pretty`（Chromium 崩溃，`debug/2026-09-28-katex-text-wrap-pretty-crash`）

## 不可违背的不变量

1. **`entries.ydoc` 是正文唯一可写真源**；entries 的 `pm_json/plain/tsv` 只由 collab `onStoreDocument` 派生，tasks / comments 的 `*_plain/tsv` 只由 service 同事务写入；都可 `xz rebuild-derived` 重建。正文永不经 Markdown 往返（源码对话框 / 粘贴 / 模板正文都是一次性导入，ADR-0011）。
2. **`src/server/authz.ts` 的 `can()` 是唯一授权入口**；API、Hocuspocus 钩子、SSE、附件、MCP、jobs 全走它；列表用 `visible*Where()`；业务代码禁止直接比较角色。
3. **通知只来自 `events` 出箱**：service 内同事务 `emit()`，pg-boss 扇出到 in_app/SSE/WebPush/邮件；路由层与前端不直接发通知。
4. **路由不含业务**：routes 只做校验 → service → 序列化；service 被 jobs/MCP/CLI 复用。
5. **颜色与动效只从 `tokens.css` 取**；禁止 `!important`、禁止组件私有主题变量、禁止裸色值。`primary` 只作填充，主色当文字 / 图标用 `primary-text`；动效档位只经 `lib/motion.ts`；新增带 `backdrop-filter` 的类须同时处理 reduced-transparency。
6. **列表接口不返回正文列**；分页一律游标；写操作带 `ifUpdatedAt` 或 `Idempotency-Key`。
7. **Y.Doc `gc:false`**（前后端一致），否则快照失效；节点视图里的源码编辑（Mermaid / 公式）失焦或停顿后才写回属性，勿逐键写。collab `onStateless` 不被 await，钩子内绝不抛（try/catch 只回执），手动落库须在 `document.saveMutex` 内（ADR-0026）。
8. 改任何 ADR 决定 → 新开 `spec_dev_doc/adr/NNNN-*.md`，不改旧文（只允许加「注」与删除线标注）。
9. **安全收口**（规则在 `07`）：通知深链永不带 token；正文 `image.src` 只接受 `xz:attachment/`；日志脱敏 `authorization / cookie / ydoc`；上传按魔数判 mime；WebSocket 只认 `POST /collab/token` 按文档签发的票据；邮箱密码登录须过服务端拼图（`x-captcha`，失败不计入锁定，ADR-0006）；账号变更只走带审计的 `/me/account` `/me/password` `/me/avatar` 与 owner 的 `/workspace/users*`（`can('user.manage')`），Better Auth `/update-user` `/change-password` `/change-email` `/admin/*` 一律 404（ADR-0010）。

## 规范索引（按需 Read，勿全量内联）

| 文件 | 内容 |
|---|---|
| `spec_dev_doc/adr/0001-tech-stack.md` | 选型与 8 项决定、分期、各技术介绍 / 作用 / 语言（§10） |
| `spec_dev_doc/adr/0002 ~ 0011` | 视觉改 Apple 玻璃 · 工期基线 = 任务级估时 · 更名衔枝（gi → xz） · 翡翠主色 / 燕印 / 动效档位 · 登录拼图滑块 · 晨光白燕燕印 · 开放注册 + 审批 / 用户名 / 密码 8 位 · 日历日程（重复、提醒、节假日） · 鲜艳 9 色板 / 日历拖选 / owner 用户管理 / 个人资料 · 历史版本恢复 · Markdown 源码对话框 / 语雀式识别 · 附件类型（Office / csv）· 记录模板（`entry_templates`、kind `optimize` `plan`） |
| `spec_dev_doc/adr/0012 ~ 0015` | 大类 `space_groups`（大类 → 空间 → 记录）· 空间概览 / 类型视图 · 目录树 · `/links` 关联与反链 · 界面称呼定为「空间」· 我的记录：位置导航（大类 → 空间 → 目录）· 标签自定义 / 合并 · 收藏 / 最近 · 批量 `/entries/batch` · 看板 / 时间线 · 目录引导线与字重分级（`DirTree` / `TreeGuides`）· 个人空间工作台（空间目录）· 记录类型图标色块（`KindIcon`，`.xz-chip` 只取 token） |
| `spec_dev_doc/adr/0016 · 0017` | 日历快速编辑气泡 / 任务拖动 · 记录默认列表 + 批量改类型 / 状态 · 侧栏「空间」可点 · 标签与自定义类型按人隔离（读写按 `tags.created_by` 过滤）· 内置类型所有者维护（`entry_kind_overrides`、`/settings/types`） |
| `spec_dev_doc/adr/0018 ~ 0022` | 大类就地管理（侧栏 ⋯）· 在空间里就地新建：对话框「建在」行、`e` 跟随上下文（`useNewEntryContext`）、新建子页面 / 新建并关联（`linkFrom`）· `[[` 新建 · 侧栏 / 目录「+」· 空间默认类型与模板 · 设计画廊挪进设置（`/settings/design`，旧 `/design` 跳转）、工具栏 / 对比度表 / 领域组件 · 空间批量管理：`POST /spaces/batch`（dryRun 计数、purge 只收回收站）· `/spaces`「批量管理」· 回收站空间多选 · 0022 合并空间 `POST /spaces/:id/merge` |
| `spec_dev_doc/adr/0023 ~ 0034` | 模板直接编辑 / 工作区共享 · 阅读偏好（`/me/preferences`、阅读设置、专注、纸张）· 编辑器对齐简斋（插入面板、块手柄菜单、表格工具条、代码块复制 / 折叠、提示块、色板文字色 / 背景色、Mermaid / KaTeX）· 版心默认满栏 · 目录自动编号与卡片 · Ctrl+S 保存版本（stateless）/ 打标记 · 文档栏 + 素净格式栏 · 表头列 · 插入时间 · 0033 Bug 跟踪：四态 `new/pending/fixed/wontfix` + 优先级、`/entries/stats` `/entries/bug-stats` 统计视图、流转 `entry_field_changes`、保存视图 `entry_views`、查询块 `entryQuery`，记录页筛选白名单 `src/shared/entry-search.ts` · 0034 认证页「衔枝小院」：双栏插画 / 窄屏探头幼燕、`--xz-bird-*` token、扭头躲开 / 转身 / 喙指向指针，减弱档 CSS 须留 `auth.css` 末尾 |
| `spec_dev_doc/adr/0035 ~ 0049` | 就地管理（`SpaceMenu` / `EntryRowMenu`，含右键）· 属性面板与元数据配色（`FieldValue`、`lib/field-tones.ts`）· 表格就地编辑（`useFieldCommit`）· 0036 空间类型（`entry_types.space_id`）/ 启用清单（`spaces.enabled_kinds`）/ 字段定义（`field_defs`，值存 `fields` 的 `x`+6 位大写键）/ 模板绑任一类型 · 0037 编辑区极简排版 + 模板编辑器工具栏 · 0038 内置模板所有者覆盖（`builtin_template_overrides`，`/restore` 取消删除、`/reset` 恢复默认）/ 新增（scope `builtin`）· 0039 模板元数据：模板属性（`entry_templates.field_defs`，键由服务端生成）/ 移除类型属性（`hidden_fields`）/ 记录的来源模板 `entries.template_id`（有效字段 = 类型字段 − 移除的 + 模板属性），目录 `GET /templates/fields`，`useFieldSpecs(kind, typeId, templateId)` · 0040 模板属性并入记录页筛选 / 分组（`lib/template-fields.ts`，目录项带 `name`）· 0041 查询块条件支持类型自定义字段与模板属性（与记录页共用 `useTypeTemplateSpecs`）· 0042 内置字段覆盖层（`entry_kind_overrides.base_fields/field_order`，隐藏 / 显示名 / 选项名与色 / 顺序，统一出口 `useFieldSpecs`）· 0043 任务页 `/tasks` + 快速添加（`shared/quick-add.ts`）· 0044 个人清单（`task_lists` / `task_list_items` 按人归类）、`/tasks/counts`、拖拽 · 0045 任务行内编辑、⋯ / 右键菜单、页面级多选与批量（`lib/task-selection.ts`、`TaskBatchBar`）· 0046 界面精修（材质层级、退出动效、图标描边 CSS 统一、EmptyState 紧凑档）· 0047 玻璃强度预设（改 tokens 预设块时日场写过的变量夜场块须覆盖回来；`check-contrast` 预设矩阵）· 0048 侧栏 / 顶栏专用材质 + 定向光晕（仅日场）· 0049 外观偏好随账号 + 工作区默认外观（`lib/appearance.ts`） |
| `spec_dev_doc/01-domain-model.md` | 表结构、`fields` schema、事件种类、权限矩阵 |
| `spec_dev_doc/02-api-conventions.md` | 路由/错误/分页/SSE/文件/MCP 约定、路由清单 |
| `spec_dev_doc/03-editor-kernel.md` | Tiptap schema、Hocuspocus 钩子、快照、模板、交互规格、简斋陷阱 |
| `spec_dev_doc/04-design-system.md` | token、动效档位、布局、交互、`/settings/design` 画廊（ADR-0020，旧 `/design` 跳转） |
| `spec_dev_doc/05-dev-workflow.md` | 环境、测试策略、CI、部署、备份、Phase 0 验收清单 |
| `spec_dev_doc/06-visual-style.md` | Apple 玻璃材质、日场 / 夜场 token、组件材质表、性能预算（ADR-0002） |
| `spec_dev_doc/07-security-and-data.md` | 威胁模型、保留 / 清理表、成员生命周期、限额表、安全测试 |
| `spec_dev_doc/08-pages-and-flows.md` | 路由表、每页规格与 search params（含日历 §2.17）、关键流程、边界情况、seed |
| `spec_dev_doc/00-requirements.md` | **需求层**：`REQ-<AREA>-<NNN>` 编号、EARS + GWT 验收、追溯约定 |
| `spec_dev_doc/glossary.md` | 术语表：中文 / 标识符 / 表名 / UI 文案 / i18n key；禁用词 |
| `spec_dev_doc/tasks/phase-N.md` | 任务拆分：依赖、REQ、估时、完成定义 |
| `spec_dev_doc/CHANGELOG.md` | 规范变更记录与每 Phase 的一致性审查 |
| `debug/README.md` | 踩坑条目五段模板（症状/复现/根因/修复/验证） |

## 会话纪律

- **动手前先找 REQ**：实现任何功能先在 `00-requirements.md` 定位编号；没有就先补需求再写代码。测试名以 REQ ID 开头，PR 描述列出覆盖的 REQ（05 §4 DoD）
- 术语以 `glossary.md` 为准；新词先加表再进代码
- 会话结束前：决策 → `spec_dev_doc/adr/`；踩坑 → `debug/YYYY-MM-DD-<slug>/README.md`（症状/复现/根因/修复/验证）；规范改动 → `CHANGELOG.md` 加行；改了命令或约定 → 提醒用户更新本文，不自动改
- 不自动 commit/push（用户明确要求时照做）；功能分支合并回 main 用 `--no-ff`；红线操作（删文件、改 `.env`/密钥/CI、push/rebase/reset）先问
- 中文回复，代码与路径英文；结论先行
