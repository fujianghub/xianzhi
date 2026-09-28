# ADR-0024 阅读与写作偏好（字体 / 排版 / 纸张 / 目录格式 / 专注写作）

> 状态：已采纳 · 2026-09-28 · 参考简斋（jianzhai）阅读器与编辑器设置；补充 04 §2.2 · §6、06 §3、08 §2.9 · §2.13；不改 03 §3.1「不提供字体 / 字号 / 颜色标记」（那是正文内容标记，本 ADR 是读者的显示偏好）。

## 背景

记录页只有固定外观：MiSans 16px、行高 1.75、版心 760（`?wide=1` 才 1080，且没有按钮）。长文阅读 / 写作时想换衬线字、放大字号、加宽版心、换纸张、看章节编号、屏蔽界面专心写，都做不到。简斋已有一套成熟做法：阅读器工具条（字体 / 纸张 / 排版 / 专注）、目录偏好、章节编号、编辑器专注模式。

## 决定

1. **偏好按人存服务端**（用户 2026-09-28 选定）：新表 `user_preferences(user_id PK, reading jsonb, updated_at)`（迁移 0019），不往 Better Auth 的 `user` 表加列。`GET /me/preferences` 返回补齐默认值的 `{ reading }`；`PATCH /me/preferences { reading: Partial }` **按键合并**（`reading || $patch`），可交换、幂等，故不要求 `ifUpdatedAt`（02 §4 例外，与多标签页防抖写不冲突）；需 `write` scope。读取逐键校验，坏值 / 旧键回落默认，不整份作废。删号（purge）时删除该行（07 §3/§4）。
2. **偏好项与默认值**（默认 = 改版前外观，不设即不变）：

| 键 | 取值 | 默认 |
|---|---|---|
| font | `sans` MiSans / `wenkai` 文楷 / `song` 系统宋体 / `system` 系统无衬线 / `mono` 等宽 | sans |
| size | sm 15px / md 16px / lg 17.5px / xl 19px | md |
| lineHeight | compact 1.6 / standard 1.75 / loose 2 | standard |
| paragraph（段距） | compact 0.4em / standard 0.75em / loose 1.25em | standard |
| width（版心） | narrow 680 / standard 760 / wide 1080 / full 满栏（纸面外宽，含内边距） | standard |
| indent（首行缩进两字） / justify（两端对齐） | bool | false |
| paper（纸张） | plain 素纸 / rice 宣纸 / grid 方格 / lines 横线 / dots 点阵 / kraft 牛皮纸 | plain |
| headingNumbers（章节编号） | bool | false |
| tocDepth（目录深度） | 2 / 3 / 4 | 4 |

   不新增字体依赖：只用已自托管的 MiSans / 文楷 / JetBrains Mono 与系统字体栈（`--xz-font-song` `--xz-font-system`，本机没有则回落）。文楷只有 400，粗体为浏览器合成，接受。
3. **纸张按人**（用户选定）：纸张是读者偏好，不存在记录上，同一篇每人看到自己选的。色值只在 `tokens.css`（`--xz-paper-rice/-kraft/-rule/-dot`，日场 / 夜场各一套），`app.css` 只用 `var()` 组合渐变；宣纸 / 牛皮纸底色纳入 `check-contrast`（fg ≥ 7、fg-muted ≥ 4.5、fg-faint ≥ 3、primary-text ≥ 4.5）。
4. **生效方式**：记录页 `<article class="xz-reading" data-font data-size data-line-height data-width data-paragraph data-paper data-indent data-justify data-numbered>`，`app.css`「阅读偏好」段把属性映射为 `--xz-read-*`，`.xz-prose` 读变量（缺省 = 原值，评论 / 历史预览等其他正文不受影响）。标题字号从 rem 改 em，随字号缩放（16px 下不变）；补 h1 / h4 样式。`?wide=1` 保留，覆盖为 wide。
5. **章节编号与目录格式**：共享函数 `collectHeadings` / `numberHeadings`（`src/shared/editor/headings.ts`，跳级压缩：h1→h2→h4 = 1 / 1.1 / 1.1.1，从 h2 起也从 1 开始，回到中间层级续接计数）；正文用 ProseMirror 装饰写 `data-num`（显示层，不进正文 / ydoc），Aside 大纲与目录块用同一结果。目录深度按编号层级过滤，缩进也按编号层级。
6. **专注写作**：会话态，不持久；记录页「专注」按钮或 `⌘/Ctrl + Shift + Enter`（⌘K「进入专注写作」），隐藏侧栏 / 顶栏 / Aside / 底部导航与面包屑 / 元信息 / fields；右上角浮动「退出专注」，Esc 退出（弹层打开或编辑器已处理的 Esc 不算）；离开记录页自动退出。`useHotkeys` 支持 `mod+shift+<key>`（Shift 只在按住 mod 时编进组合）。
7. **入口**：记录页头「Aa」弹层（懒加载 `ReadingPanel`）；设置 → 阅读与写作（`/settings/reading`，同面板 + 示例文段实时预览）；⌘K「阅读与写作设置」。本机按用户缓存 `xz:reading:<userId>` 做首屏值，只在服务端返回 / 用户修改后写（不在挂载时写默认值）；修改乐观生效、600ms 防抖 PATCH，页面隐藏时 `keepalive` 冲刷。

## 候选与否决

- **只存本机 localStorage**（与主题 / 密度 / 动效一致）：换设备要重设；用户选择服务端。
- **纸张按记录（作者设、读者可覆盖）**：要给 entries 加列并协同同步；纸张更像个人习惯，按人即可。
- **CSS counters 做章节编号**：无法跳级压缩（文档从 h2 起会显示 0.1），且与大纲 / 目录块的编号对不上。
- **F9 / ⌘⇧F 作专注快捷键**：F9 在 Windows Firefox 是阅读视图、Mac 需 fn；Ctrl+Shift+F 在微软拼音 / 搜狗是简繁切换，⌘⇧F 在 Mac Chrome 是全屏工具栏。选 `mod+shift+enter`（Tiptap / 应用 / 浏览器都未占用）。
- **打字机模式、代码块主题、EPUB 分栏等简斋其他设置**：本轮不做，按需再开。
- **新增思源宋体等字体包**：npmmirror 大包风险（05 §2），先用系统宋体栈。

## 后果

- 00：+REQ-READ-001 ~ 006（新区 18c READ）；§0 非目标「字体家族 / 字号 / 颜色标记」加注（指正文标记，读者显示偏好见本 ADR）。01 §3.8 +`user_preferences`。02 §9 +`GET / PATCH /me/preferences`。04 §2.2 · §6、06 §3 注。07 §3 / §4 注。08 §1 路由表、§2.9 · §2.13 注。glossary +阅读偏好、版心、纸张、章节编号、专注写作。
- 代码：`services/preferences.ts`、`routes/me.ts`、`shared/schemas/preferences.ts`、`shared/editor/headings.ts`；前端 `lib/reading.ts`、`ReadingPanel`、`_app.settings.reading.tsx`、记录页、`AppShell`、`extensions.ts`（`HeadingNumbers`）、`useHotkeys` / `useCommands`、`tokens.css` / `app.css`、`check-contrast.ts`。
- 测试：`preferences.test.ts`（REQ-READ-001）、`headings.test.ts`（REQ-READ-004）、`e2e/reading-prefs.spec.ts`（REQ-READ-002 ~ 006）。
