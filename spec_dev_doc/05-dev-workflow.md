# 05 开发流程

> 状态：已采纳 · 版本：v4 · 更新：2026-09-24 · 最后对照代码：2026-09-24（拼图 e2e、视觉基线、依赖安装） · 依据 ADR-0001 §6–7。命令、端口、环境、测试、CI、部署、备份、文档纪律的权威来源。CLAUDE.md 只摘录本文的命令段。
> 分期术语（全部规范统一）：**一期 = Phase 0 + 1 + 2**（可用版本；工期计划值见 ADR-0003 与 `tasks/phase-N.md`）；**二期 = Phase 3**（MCP、git / debug 导入、AI、pgvector、PWA 打磨）。不再使用「三期」。

---

## 1. 仓库结构

```
XianZhi/
├── CLAUDE.md                # ≤ 80 行
├── package.json             # 单 package；"packageManager": "pnpm@11.x"；engines.node ">=24"
├── .npmrc                   # registry=https://registry.npmmirror.com
├── .nvmrc                   # 24
├── biome.json · tsconfig.base.json · tsconfig.client.json · tsconfig.server.json
├── vite.config.ts           # client；plugin-react { compiler: true }；proxy /api,/collab → 8010/8011
├── drizzle.config.ts
├── src/
│   ├── client/              # React；routes/ components/ hooks/ styles/ i18n/
│   ├── server/              # Hono；routes/ services/ authz.ts db/ jobs/ mcp/ index.ts
│   ├── collab/              # Hocuspocus；server.ts derive.ts
│   └── shared/              # Zod schema、类型、常量、editor/（templates、migrations、serializers）
├── drizzle/                 # 迁移 SQL
├── e2e/                     # Playwright
├── scripts/                 # 仅构建/检查期脚本：gen-palette、check-budget、check-css、check-contrast、check-i18n、check-schema-drift、check-openapi-drift、req-coverage；运维命令不在此（走 src/server/cli.ts = `pnpm xz`）
├── infra/                   # Dockerfile、docker-compose.yml(dev)、docker-compose.prod.yml、Caddyfile.snippet、backup.sh、deploy.sh
├── spec_dev_doc/ · debug/
└── data/                    # gitignore：uploads/ backups/ pg/(dev 卷)
```

---

## 2. 端口与环境

| 服务 | dev | prod（容器内） | 说明 |
|---|---|---|---|
| Vite dev | 3010 | — | 代理 `/api` `/collab` |
| API（Hono） | 8010 | 8010 | 生产同时托管 `dist/client` |
| Collab（Hocuspocus） | 8011 | 8011 | Caddy `/collab/*` 反代（WebSocket） |
| PostgreSQL | 5433 | 5432（容器网络） | 镜像 `pgvector/pgvector:pg16`，独立于简斋的 5432 |
| Mailpit | 8025 | — | dev 收邮件 |

`.env`（不入库，`.env.example` 入库）：

```
DATABASE_URL=postgres://xz:xz@localhost:5433/xz
APP_URL=http://localhost:3010
API_PORT=8010  COLLAB_PORT=8011
BETTER_AUTH_SECRET=  BETTER_AUTH_URL=http://localhost:3010   # 必须等于浏览器访问的 APP_URL（经 Vite 代理），否则魔法链接/回调域错
COLLAB_TOKEN_SECRET=                                        # 02 §9 /collab/token 的 HMAC 密钥
AGE_RECIPIENT=                                              # age 公钥，备份加密用（§8）；私钥离站，不进 .env
SMTP_HOST= SMTP_PORT= SMTP_USER= SMTP_PASS= MAIL_FROM=
VAPID_PUBLIC_KEY= VAPID_PRIVATE_KEY= VAPID_SUBJECT=
ANTHROPIC_API_KEY=  AI_MODEL=            # 可空，AI 功能优雅降级
DATA_DIR=./data
LOG_LEVEL=info
```

修改 `.env`/密钥/证书/CI 配置属红线操作，须先征得用户同意（全局 CLAUDE.md）。

**四个数据库**（同一 PG 容器，互不共享数据）：

| 库 | 用途 | 谁创建 / 重置 |
|---|---|---|
| `xz` | 本机开发 | `pnpm db:migrate` |
| `xz_test` | Vitest 单元 / API / 协同集成（每文件 TRUNCATE，串行） | `pnpm test` globalSetup 自动建库并迁移 |
| `xz_e2e` | Playwright + `pnpm xz seed` | `pnpm e2e` 每次重建并 seed |
| `xz_verify` | 仅备份恢复演练 | 手工 `pnpm xz restore <dump> --db xz_verify` |

---

> 注 2026-09-24（依赖安装）：npmmirror 的大 tarball（如 `misans` 43 MB）CDN 仅约 20 KB/s，`pnpm add` 会长时间无响应甚至挂死（进程无 TCP 连接仍不退出）；腾讯云镜像 tarball 快但元数据接口常超时。装 > 10 MB 的包先 `curl` 测速；必要时用临时本地代理（元数据走 npmmirror、tarball 走腾讯并核对 `dist.integrity`），`--registry` 只在该次命令指定，lockfile 只记 integrity、不留镜像地址。

## 3. 命令（`package.json` scripts）

| 命令 | 作用 |
|---|---|
| `pnpm i` | 安装（`.npmrc` 已指 mirror） |
| `pnpm dev` | 并行起 client(3010) + api(8010) + collab(8011)，`tsx watch` |
| `pnpm db:up` / `db:down` | `docker compose -f infra/docker-compose.yml up -d pg mailpit` |
| `pnpm db:generate` / `db:migrate` / `db:studio` | `generate` / `studio` 走 drizzle-kit；`migrate` 走 `tsx src/server/db/migrate.ts`（drizzle-orm migrator，错误可见，与 `start.ts` / 测试建库复用同一函数） |
| `pnpm auth:generate` | `pnpm dlx @better-auth/cli@1.4.21 generate`（CLI 独立版本线停在 1.4，对 1.7 配置可用；不进 devDependencies）→ `src/server/db/schema/auth.ts`，再 `db:generate` |
| `pnpm typecheck` | 逐项目 `tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.tools.json --noEmit`（client 在 T0-016 加入）；不用 `-b`/composite：Better Auth 类型无法生成 d.ts（debug/2026-09-23-better-auth-17-packaging） |
| `pnpm build` | `tsc -p tsconfig.server.json && vite build && tsx scripts/check-budget.ts` |
| `pnpm start` | 生产 app 容器：migrate → api + pg-boss worker 同进程 |
| `pnpm start:collab` | 生产 collab 容器：`node dist/collab/server.js`（与 §7 一一对应，勿在 `start` 里再起 collab） |
| `pnpm lint` / `pnpm format` | Biome + `tsx scripts/check-css.ts`（组件文件裸色值、嵌套 `.glass`、`!important`）+ `tsx scripts/check-contrast.ts`（06 §7 对比度矩阵）+ `tsx scripts/check-i18n.ts`（`src/client` JSX 无硬编码中文） |
| `pnpm test` | Vitest（单元 + API 集成 + 协同钩子，需 `db:up`；globalSetup 自动建 `xz_test` 库并迁移；DB 用例按文件串行 + 文件级 TRUNCATE，见 §5 注）→ 末尾 `req-coverage --layers unit,api,collab` 门槛 |
| `pnpm e2e` | `scripts/e2e-db.ts` 重建 `xz_e2e` 并 seed → Playwright（本机 Google Chrome `channel: chrome`；自动起验证实例）→ `req-coverage --layers e2e` 门槛 |
| `pnpm e2e:infra` | 基础设施层（00「e2e（infra）」）：生产镜像 + `docker-compose.prod.yml` 起三服务（项目 `xz-e2e-infra`、测试密钥、端口 18110/18111）+ 由 `Caddyfile.snippet` 生成配置的 Caddy 容器（18180）→ REQ-OPS-002 · 005、经 Caddy 的 Lighthouse（REQ-UI-015）→ `req-coverage --layers infra`。镜像缺省 `xianzhi:local`，不存在则先构建；需本机 Docker。注 2026-09-24：已存在的同名镜像会被直接复用——代码改动后须换标签重建（`XZ_IMAGE=xianzhi:<tag> pnpm e2e:infra`），否则测的是旧代码（debug/2026-09-24-infra-stale-image） |
| `pnpm dev:verify` | 验证实例（`scripts/verify-env.sh` 注入测试专用环境，不读 `.env`）：独立端口 3011/8012/8013、`cacheDir node_modules/.vite-verify`、库 `xz_e2e`（与 `pnpm e2e` 同库）；可与主 dev 并存（验收见 debug/2026-09-24-dev-verify-coexist）；collab 进程由 `scripts/respawn.sh` 包裹，异常退出后 0.5s 自动拉起（模拟生产容器 restart，REQ-COLLAB-011 e2e 依赖；注 2026-09-24） |
| `pnpm xz <cmd>` | 运维 CLI：`create-owner` `seed`（08 §7，生产禁用）`rebuild-derived [--entries\|--tasks\|--comments]` `snapshot <entryId> [--label]` `job <name>`（手动触发 pg-boss 作业）`backup` `restore <dump> --identity <age 私钥文件> [--db xz_verify]` `export --workspace`（骨架）；二期：`import-debug <dir>` |

验证实例（对照简斋教训）：**永远不要**在主 dev server 运行时于同一目录再起一个共享 `.vite` 缓存的实例；`pnpm e2e` 与 `pnpm dev:verify` 使用独立 `cacheDir: node_modules/.vite-verify` 与独立端口。

---

## 4. 分支、提交、文档纪律

- `main` 可部署；功能分支 `feat/<slug>`、修复 `fix/<slug>`；合并回 main 用 `--no-ff`。
- 提交信息 Conventional Commits（`feat: / fix: / docs: / chore: / perf: / refactor:`），中文描述可。**不自动 commit/push**，仅 `git add <具体文件>`（全局 CLAUDE.md）。
- 每次会话结束前：
  1. 有决策 → `spec_dev_doc/adr/NNNN-<slug>.md`（模板见 §9）；
  2. 有踩坑 → `debug/YYYY-MM-DD-<slug>/README.md` 五段；
  3. 改了命令/端口/约定 → 提醒用户更新 CLAUDE.md（不自动改）。
- 二期（Phase 3）后：上述 1、2 优先写入应用（Entry decision/bug），仓库文件由导出生成。
- CLAUDE.md 超过 80 行视为 bug，内容下沉到本目录。

**完成定义（Definition of Done）**——PR 合并前逐项勾选：

- [ ] 需求追溯：PR 描述列出覆盖的 REQ ID（`00-requirements.md`）；没有对应 REQ 的功能先补需求再合并
- [ ] `pnpm lint` 与 `typecheck` 绿
- [ ] 单测 + 对应 REQ 的 api / e2e 测试（测试名以 REQ ID 开头，见 §5）
- [ ] `@axe-core/playwright` 无 serious 以上
- [ ] 性能预算通过（`pnpm build` 的 check-budget、06 §8 的 backdrop-filter 计数）
- [ ] 文档同步：涉及 01–08 / glossary 的改动随 PR 一起改，头部「更新」日期刷新
- [ ] 涉及决策 → 附 ADR；涉及命令 / 端口 / 约定 → 提醒更新 CLAUDE.md
- [ ] `spec_dev_doc/CHANGELOG.md` 加一行
- [ ] 修 bug 的 PR 附 `debug/YYYY-MM-DD-<slug>/README.md`

---

## 5. 测试策略

**追溯约定**：每个测试用例名以 REQ ID 开头（`it('REQ-TASK-007 拖拽只发一条 batch', …)`），一个用例可覆盖多个 ID。
- 各层用自定义 reporter 各自输出：Vitest → `debug/perf/req-coverage.{unit,api,collab}.json`，Playwright → `req-coverage.e2e.json`，`e2e/infra.spec.ts` → `req-coverage.infra.json`（`{ id, layer, file, title, passed }`）。不跨运行保存旧结果。
- CI 的 `test` 与 `e2e` 阶段各自把产物上传为 artifact；`scripts/req-coverage.ts` 在**每个阶段末尾**合并本次已产出的层并对照 `00-requirements.md`。
- 门槛只按**本次实际运行的层**计算：`test` 阶段只校验测试层含 unit / api / collab 的 P0 REQ；e2e-only 的 P0 REQ 只在 `e2e` 阶段校验（main 与带 `e2e` 标签的 PR）。测试层为「手工」的 REQ（如 REQ-OPS-011）不进门槛，由 Phase 验收清单人工勾选。
- 任何 Phase ≤ 当前 Phase 的 P0 REQ 在对应层没有至少一个通过的用例即失败；P1 只警告。

| 层 | 工具 | 覆盖 | 门槛 |
|---|---|---|---|
| 单元 | Vitest | `shared/`（schema、serializer、templates、authz 纯函数）、client hooks | `authz` 角色矩阵 100% 组合 |
| API 集成 | Vitest + `app.request()` + 真实 PG（`pnpm db:up` 的同一容器内独立库 `xz_test`，不用 testcontainers；**每文件 `beforeAll` TRUNCATE + `fileParallelism:false`**——Better Auth 持有独立连接，无法共享一个事务做回滚） | 每个路由的成功/403/404/409/422 | 新路由必带 |
| 协同 | Vitest + Hocuspocus 内存启动 + PG | onAuthenticate/onLoad/onStore/派生 | |
| E2E | Playwright（Chromium；移动视口一组） | 登录、邀请、任务 CRUD/看板拖拽、编辑器协同/离线/IME、通知到达、导出 | 主流程 |
| 视觉 | Playwright 截图 `/design` | token 与组件回归 | 阈值 0.1% |
| 性能 | `scripts/check-budget.ts`（chunk 大小）+ Playwright `performance.measure` + Lighthouse | 预算见 ADR §3、03 §9、06 §8（同屏 backdrop-filter 计数） | 超预算 CI 失败 |
| 可访问性 | `@axe-core/playwright` | 每个路由 | 无 serious 以上 |

约定：Playwright 对 sticky/被遮挡元素一律 `page.evaluate` DOM `click()`（简斋教训）；轮询网络时夹空 `page.evaluate`。

注（2026-09-24，登录拼图与视觉基线）：
- 登录前置服务端拼图（ADR-0006）。API 测试的 `signIn()` 先取 `/api/captcha`（`captcha: { debug: true, minSolveMs: 0 }`）再提交；e2e `login()` 调 `solveCaptcha()`：读 `data-debug-x`（验证实例 `XZ_CAPTCHA_DEBUG=1` 才有，production 服务端强制不回显），等 700 ms（最短解题时间 + 手柄回弹）后真实拖拽。
- `pnpm e2e` 重建 `xz_e2e` 并只认 `localhost:3011`：按 IP 启动的验证实例（`APP_URL=http://<ip>:3011`）须先停，跑完再起。
- 视觉基线（`/design` 四页 + Toast 三态，阈值 0.1%）改视觉后须用户确认再重拍：`pnpm exec playwright test e2e/design.spec.ts e2e/feedback.spec.ts --project=setup --project=desktop --update-snapshots`，再不带参数复跑一次确认稳定。
- 选择器用精确匹配避免文案包含关系（如 `getByLabel('密码', { exact: true })`，否则命中「显示密码」按钮）。
- axe 用例在首个失败路由即停：修复后须确认其后路由也通过（可逐路由复扫）。
- 测试 / 构建过程的产物**一律不入库**：`debug/perf/`（req-coverage、budget、lighthouse、tasks-list、editor-open 等测量值）、`test-results/`、`playwright-report/`、`e2e/.auth/`、`data/` 均在 `.gitignore`；`.claude/worktrees/` 同。需要留证的性能数字写进 CHANGELOG / 验收记录，不提交 JSON。入库的生成物只有构建必需的：视觉基线 `e2e/__screenshots__/`、`drizzle/`、`src/client/routeTree.gen.ts`。

注（2026-09-23，T0-029）：**分层口径**——00 中测试层为 `unit` 的需求，可由同一 `test` 阶段的 `api` / `collab` 用例满足（更重的集成测试覆盖了同一断言）；`e2e` / `visual` / `a11y` 统一记为 e2e 层；`e2e（infra）` 记为 infra 层，只在 `pnpm e2e:infra` 校验（注 2026-09-24）。测试名里的缩写引用（`REQ-WS-004 · 012 · 013`）由 `scripts/req-ids.ts` 展开。

---

## 6. CI（GitHub Actions，`.github/workflows/ci.yml`）

`push`/`PR` → `lint` → `typecheck` → **`drift`** → `test`（服务容器 pgvector；末尾跑 `req-coverage` 校验本次层）→ `build`（含预算）→ `audit`（`pnpm audit --audit-level high`，失败阻断）→ `e2e`（仅 main 与 PR 标签 `e2e`；末尾跑 `req-coverage` 校验 e2e 层）→ 产物 `dist/`、Playwright 报告、`req-coverage.*.json` 上传。

**漂移检查（`drift`）**——规范与代码不一致即失败并打印差异。机器契约：
- `01-domain-model.md` §3 每张业务表必须是统一三列表 `| 列 | 类型 | 说明 |`，一行一列，类型必填（PG 类型 + 可空标记 `?`）；关联表（`space_members` 等）同样用表格。认证域（Better Auth 生成的表）不入契约。
- `02-api-conventions.md` §9 必须是逐行表 `| method | path | 说明 |`，不用 `CRUD`、`§7` 这类缩写；path 用 `:param` 形式。
- `scripts/check-schema-drift.ts`：从 Drizzle schema 导出「表 → 列 → 类型 / 可空」，与 01 §3 解析结果对照；多表、少表、多列、少列、类型不符都报。
- `scripts/check-openapi-drift.ts`：用 `hono-openapi` 生成 `method + path` 清单，与 02 §9 解析结果对照；多路由、少路由都报。Better Auth 挂载的 `/api/auth/*` 不入契约。
- 改表格格式先改脚本；两者不一致以文档为准并修代码（01 §0、02 §0 已规定）。
镜像构建在 `deploy.sh` 本地完成后 rsync（与简斋一致），CI 不推镜像。

注（2026-09-23，T0-029）：工作流草稿在 `infra/ci/ci.yml`，按全局红线规则待用户确认后移入 `.github/workflows/ci.yml`；CI 安装与 `pnpm audit` 显式指向 `registry.npmjs.org`（npmmirror 无 audit 接口）。路由漂移由 Hono `app.routes` 取清单（与 hono-openapi 的 method+path 等价），02 §9 中所有 REQ 都属更晚 Phase 的端点暂不要求存在。

---

## 7. 部署（腾讯云，与简斋同机）

```
infra/docker-compose.prod.yml
  xz-app     : node:24-alpine 多阶段镜像（Dockerfile `USER node`，data/ 卷属 node）；cmd = pnpm start（api + worker）；卷 xz_data:/app/data；healthcheck = GET /api/health
  xz-collab  : 同镜像；cmd = pnpm start:collab；depends_on xz-app (condition: service_healthy)，保证迁移完成后再连库；不挂 xz_data（附件 GC 由 app worker 执行，collab 不碰文件）
  xz-pg      : pgvector/pgvector:pg16；卷 xz_pg
  三服务 logging: json-file, max-size=50m, max-file=5
  (Caddy 复用简斋的容器，Caddyfile 追加 infra/Caddyfile.snippet)
```

Caddy 片段要点：`xz.<domain>` 站点；`/collab/*` → `xz-collab:8011`（WebSocket 直通）；其余 → `xz-app:8010`；`encode zstd gzip`；`/assets/*` `Cache-Control: immutable`；附件不经 Caddy 直出，全部走 `/api/v1/attachments/*` 鉴权流式输出（02 §7），Caddy 不暴露 `data/` 目录。

发布步骤（`infra/deploy.sh`）：
1. 本地 `pnpm build` + `docker build`；
2. `rsync` 仓库（排除 `.env.prod` / `data/` / `.git`）与镜像 tar；
3. 服务器 `docker compose -f infra/docker-compose.prod.yml up -d`（app 启动时先 migrate；迁移失败容器退出，旧容器不被替换）；
4. `curl /api/health` 与 `/collab/health` 通过后切换；
5. 记录到 `debug/deploys.md`（日期、镜像 tag、迁移编号）。

回滚：镜像 tag 回退 + 若迁移不可逆则恢复备份（§8）。

---

## 8. 备份与数据出口

- 每日 03:00（pg-boss cron `backup.daily`）：`pg_dump -Fc` → `data/backups/xz-YYYYMMDD.dump`，用 `.env` 的 `AGE_RECIPIENT`（age 公钥）加密为 `.dump.age`，保留 14 天；`uploads/` 增量 rsync 到备份盘（复用简斋 `backup.sh` 的目标）；失败发 `system.backup_failed` 事件。
- 每周：`pnpm xz export --workspace` 生成 Markdown zip 存备份盘（可读的数据出口，不依赖本系统即可阅读）。
- 每季度：`pnpm xz restore <dump.age> --db xz_verify` 恢复到 `xz_verify`（需离站私钥），起 `pnpm dev:verify` 核对行数与抽样内容，记入 `debug/`（REQ-OPS-011，手工验收）。
- 密钥（age 私钥、VAPID 私钥、SMTP）离站保存，不在服务器明文备份。

---

## 9. 模板

**ADR**（`spec_dev_doc/adr/NNNN-<slug>.md`）：
```
# ADR-NNNN <标题>
> 状态：提案|已采纳|已取代(by ADR-MMMM) · 日期
## 背景
## 候选方案（表：方案·优点·缺点）
## 决定
## 后果
## 参考
```

**debug 条目**（`debug/YYYY-MM-DD-<slug>/README.md`）：症状 / 复现 / 根因 / 修复 / 验证（见 `debug/README.md`）。

**规范文件头约定**：每份 `spec_dev_doc/*.md`（ADR 除外，ADR 只按上面模板的「状态 · 日期」头）第二行必须是
`> 状态：草案|已采纳|已取代 · 版本：vN · 更新：YYYY-MM-DD · 最后对照代码：YYYY-MM-DD（或「未对照」）· 依据：…`
内容变更 bump 版本并刷新「更新」；跑过 §6 漂移检查或人工核对后刷新「最后对照代码」。每个 Phase 结束前做一次全量一致性审查（对照 00–08、glossary、CLAUDE.md），结果写入 `CHANGELOG.md`。

---

## 10. 日志、健康与观测

- 日志 `pino`，JSON 到 stdout；请求日志含 `reqId`、`userId`、耗时，**不记 body**；错误带 stack；生产 `LOG_LEVEL=info`。`redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.ydoc', '*.pmJson']`（07 §2.9），单测断言输出不含这些字段。
- `GET /api/health`（公开）只回 `{ ok, version }` 供 Caddy/部署脚本探活；`GET /api/health/details`（admin 或 API Key scope `admin`）返回 DB 延迟、队列积压、collab 连接数、磁盘剩余；`/collab/health` 由 Hocuspocus 提供，公开只回 ok。
- 慢查询：Drizzle logger 在 dev 打印 > 50ms 的 SQL；集成测试断言关键列表接口查询数 ≤ 3（防 N+1）。
- 错误上报：一期仅日志；需要时接 Sentry 自托管（不在一期）。

---

## 11. Phase 0 验收清单

- [ ] `git init` + 首次提交（`git init` 已做、全部文件已暂存；首次提交留给用户）
- [x] `pnpm dev` 三服务起、`/design` 可见 token 页与 06 §10 的材质 / 深度 / 切换三页
- [x] Better Auth：owner 由 `pnpm xz create-owner` 创建；邀请链接 → 注册 → 登录；2FA 可开
- [x] `can()` 角色矩阵测试全绿
- [x] 一篇 Entry 在两个浏览器协同编辑、离线后同步、快照生成
- [x] `events` → 一条 in_app + SSE 通知到达
- [x] Mailpit 收到邀请邮件
- [x] `pnpm build` 过预算；`pnpm e2e` 主流程绿
- [x] `docker compose -f infra/docker-compose.prod.yml up` 本机可起；`/api/health` 200
- [x] `pnpm xz backup` 产出 `.dump.age` 并可用离站私钥恢复到 `xz_verify`（`pnpm xz export` 产出 zip 属 Phase 1 验收，REQ-EXPORT-002）
- [ ] 持续项：每季度 `xz_verify` 恢复演练记入 `debug/`（REQ-OPS-011，手工）
- [x] CLAUDE.md ≤ 80 行，仅含坐标、命令、不变量指针
