# ADR-0059 皮肤：安装 codexthemes.ai 主题包 · 按人切换

> 状态：已采纳 · 2026-10-11 · 修订 ADR-0049（外观偏好加第五个键 `skin`）、不变量 5 的适用范围（皮肤 token 为安装生成的数据，见 §3）。无迁移（`user_preferences.appearance` / 工作区 `settings.appearance` 均为 jsonb / JSON，按键扩展）。需求区 00：REQ-UI-056 ~ 061。

> 注 2026-10-12（ADR-0060）：界面上「皮肤」改称「主题」、日场 / 夜场改称「明暗模式」；入口移到「设置 → 主题」；§19「认证页不套皮肤」改为套工作区默认主题。代码标识符不变。

## 背景

用户（2026-10-11）：「参考 codex 的相关换肤教程，生成本系统的换肤功能，主题切换功能」，并给出要装的 16 个 codexthemes.ai 主题（星轨晕环、不知火 · 流焰、普鲸 · DeepSeek、alpine、八尾狐、Cyber Earth、Blue Hour Silhouette、宫园薰·樱夜奏鸣、Misty Morning、Zhangjie Sky、初音、QQ 2007 Revival、AI孙燕姿泪海、Ligurian Afterglow、GPT看板娘、Miku Codex）。

调研（codexthemes.ai `SKILL.md`、`theme-schema.md`、`/api/themes`）：

- `.codex-theme` 是一个 UTF-8 JSON：`manifest`（`mode`、13 色 `palette`、`design.artFocalPoint` 等）+ `css` + `art`（背景图 base64）+ `preview`（Codex 工作区截图）。
- 包里的 CSS 是给 **Codex 桌面端** 写的：选择器针对其 DOM（`main.main-surface`、`[data-codexthemes-page]`），变量是 `--color-token-*`，大量 `!important`。**不能用于衔枝**，也不该执行第三方 CSS。可复用的只有 mode / palette / 背景图 / 焦点。
- 16 个名字里：Cyber Earth 是 `kind: skin`（只有设计参考，下载 404）；「八尾狐」有两份内容相同的包；「初音」「Miku Codex」各有多个版本；QQ 2007 Revival 没有背景图。

用户拍板（2026-10-11）：**安装器、图片不进 git**（仓库公开，包内有版权角色 / 真人 AI 形象 / 品牌元素）；**皮肤锁定自带的日场 / 夜场**；Miku 四个版本都收；Cyber Earth 先跳过。共 17 个。

## 决定

### 1. 术语

「皮肤 / Skin」= 一套背景图 + 配色，挂在衔枝原生界面之上。glossary 里「主题」仍只指日场 / 夜场两种，不混用。

### 2. 安装只走运维 CLI（REQ-UI-056）

1. `pnpm xz skin search <关键词>` · `skin install <主题id | https 链接 | 文件.codex-theme> [--id] [--name] [--no-art]` · `skin list` · `skin remove <id>`（生产：`node dist/server/cli.js skin …`）。只读写 `DATA_DIR/skins`，不连库、不要求鉴权密钥。
2. 下载走 `safeFetch`（ADR-0054 §D：逐跳地址校验、钉住解析、限时 180 s、限量 30 MB，超限即拒）。主题 id → `https://codexthemes.ai/api/themes/<id>/download`；404 提示「该主题没有可下载的主题包（可能只是设计参考）」。
3. 校验与规范化（07 §2）：`format === 'codex-theme'`；只校验要用的字段，自由文本不限长、用时截断，焦点等解析不了回落默认，不一票否决；palette 只收 `#rgb / #rrggbb`（`native unchanged` 等丢弃，回落衔枝原值）；mode 不是 light / dark 时按 canvas 明度推断；id `^[a-z0-9][a-z0-9-]{0,63}$`，`none` 保留；**包内 CSS 一律丢弃**。
4. 图片按魔数只收 PNG / JPEG / WebP，sharp 重编码（剥离元数据）：背景图 ≤ 2560×1600 webp q78，缩略图 640×400 按焦点裁；没有背景图的取 preview 作缩略图。`--no-art` 只用配色（有的包 art 本身是界面截图，如两个 Miku Codex）。
5. 落盘 `DATA_DIR/skins/<id>/{skin.json, art.webp, thumb.webp}`：先写临时目录再整体换入；重装保留安装时间（画廊顺序不变）。版本 = 包版本 + 内容哈希 8 位。**不进 git、不进备份**（可重装）；生产在 `xz_data` 卷里装一次。

### 3. palette → token（REQ-UI-061）

6. `src/shared/skins.ts` 纯函数把 palette 换算成 **tokens.css 已有的 `--xz-*`**：底板 / 光晕 / 三档玻璃 / 纸面 / 前景三级 / 边线 / primary 族 / accent / success · warning · danger 族 / 燕印投影，外加皮肤专用的 `--xz-skin-art / -pos / -veil`。不引入组件私有变量。九色板、图标色、代码色、燕印等沿用该模式原值。
7. 达标：底板明度钳在本模式范围内（夜场 lum ≤ 0.035、日场 ≥ 0.72，九色板 / 图标色按原模式校过）；fg ≥ 7、muted ≥ 4.5、faint ≥ 3、primary-text ≥ 4.5（对最坏玻璃底 / 纸面 / 底板）、primary-fg 对 primary 与 bright ≥ 4.5、danger 对底板与淡底 ≥ 4.5，不达标按明度步进修正。17 个实测 palette 进单测。
8. 玻璃不透明度远高于原生（夜场 0.6 / 0.7 / 0.8，日场 0.58 / 0.68 / 0.8），背景图上压底色遮罩（夜场 0.55、日场 0.62）：直接压在图上的文字（如设置页标签）也能读。
9. **不变量 5 的受控例外**：皮肤 token 是安装生成的数据，由服务端按 palette 现算（生成器改进后无需重装），只覆盖已有变量；输出只由数值格式化而来（颜色先解析成数字）、id / 版本过正则，杜绝注入。生成器在 `src/shared`，不在 check-css 扫描范围。

### 4. 读取（REQ-UI-057）

10. `GET /api/v1/skins`（列表，不含 palette；`rev` = 样式表内容指纹）· `GET /skins/:id`（+ `css`）· `GET /skins/:id/art` · `/thumb`（`image/webp`，地址带 `?v=<version>`，`private, max-age=31536000, immutable` + ETag）。只要登录（`requireAuth`），不经 `can()`：皮肤是本机安装资源，不属于任何工作区数据（同 `/link-preview`）。Web 端只读。

### 5. 偏好（REQ-UI-058）

11. ADR-0049 的外观偏好加键 `skin`：已安装皮肤 id 或 `none`。内置默认 `none`；工作区默认外观同样可设（所有者 / 管理员）。生效值照旧 = 内置 ← 工作区 ← 本人；本人显式选 `none` 可盖过工作区默认皮肤。服务端不校验是否已安装（卸载后旧值仍合法），客户端按 none 生效并提示。

### 6. 生效（REQ-UI-059）

12. `html[data-skin="<id>"]` + `<style id="xz-skin">`（服务端生成的样式表）+ `data-theme` 锁定为皮肤自带模式 + **移除 `data-glass`**（皮肤自带材质；玻璃预设 `:root[data-glass][data-theme]` 特异度 (0,3,0) 会压过皮肤，移除属性比堆特异度干净）。减弱透明度（系统 / 手动档）时玻璃改实色、遮罩改不透明。
13. 背景图铺在 `body::before` 这张已有的 fixed 层里（光晕之下、遮罩之上），不新增合成层；流光档的漂移层随 `data-glass` 一起停用。
14. 首帧：本机 `xz:skin` 缓存 `{ id, mode, rev, css }`，`theme-init.js` 同步注入，不闪原生外观；`rev` 变了重新拉。切换走 View Transition 整页溶解（顶栏按钮带坐标则圆形揭幕）；连续切换以最后一次为准。
15. 皮肤生效时用户改主题 / 玻璃强度只记住选择、不改页面，退出皮肤后恢复。系统深浅色变化不影响皮肤。

### 7. 入口（REQ-UI-060）

16. 设置 → 个人：外观区新增皮肤画廊（首张「衔枝原生」，其余为缩略图 · 日 / 夜 · 作者；工作区默认那张标「默认」）；皮肤生效时主题 / 玻璃强度下拉禁用并标「（随皮肤）」；没装皮肤时给出安装命令；「恢复为工作区默认」同时清掉 skin。
17. 设置 → 工作区信息：默认外观加「皮肤」下拉（已安装 + 已卸载的旧值）。
18. 顶栏主题按钮：皮肤生效时变成「退出皮肤」（调色盘图标，设 `skin = none`）。
19. 认证页（登录 / 注册 / 邀请）不套皮肤：此时不知道是谁（同 ADR-0049 §5）；回到工作台由同步重新挂上。

## 影响

- 本机已安装 17 个（`data/skins`，3010 用）：orbital-halo · shiranui-amber · deepseek-whale · alpine · eight-tail-fox · blue-hour-silhouette · kaori-sakura-nocturne · misty-morning · zhangjie-sky · miku-aurora · miku-shuimo · qq-2007-revival · sun-yanzi-tears · ligurian-afterglow · gpt-muse · miku-codex-light · miku-codex-dark。两个 Miku Codex 的 art 是 Codex 界面截图（铺开会出现假界面），以 `--no-art` 安装为纯配色（缩略图仍取原图）。
- e2e：`resetAppearance` 一并复位 skin；`e2e/skins.spec.ts` 用 sharp 合成的主题包经 CLI 装进验证实例的 DATA_DIR（`XZ_E2E_DATA_DIR` 可覆盖，默认主仓 `data/e2e`）。仓库里不放任何主题包原图。
- 设计画廊里嵌套的 `[data-theme]` 容器重新定义 token，显示的是原生外观，符合画廊用途。
- 不做：Web 端安装 / 上传主题包（出站请求与第三方素材只在运维侧发生）；皮肤的日夜两套；按页面区分背景范围。
