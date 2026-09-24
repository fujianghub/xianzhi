# 04 设计体系

> 状态：已采纳 · 版本：v3 · 更新：2026-09-23 · 最后对照代码：2026-09-24（Phase 1：§6 交互与快捷键） · 依据 ADR-0001 §9.3、ADR-0002。组件只消费本文定义的 token；新增视觉决定先改本文再改代码。品牌视觉细节（插画、Logo）在进入 UI 阶段时用设计画布定稿后回填 §2。

---

## 1. 品牌与隐喻

**衔枝 · Xianzhi**：燕子衔枝筑巢，一点一点搭建自己的东西（ADR-0004）。

| 产品对象 | 隐喻 | 在界面中的用法 |
|---|---|---|
| 周期 Cycle | 程 Trip（一趟衔枝往返） | 周期页头用「第 N 程」副标；季度 = 长程 |
| 周复盘 | 回望 Look-back（停在枝头回望） | 复盘页的空状态与完成态文案；品牌动效「成巢」只在这里出现 |
| 任务 | 枝 Twig | 空状态「这里还没有衔来的枝」；看板列头进度用枝节式刻度，不用百分比条 |
| 空间 | 巢 Nest | 只在空状态与引导语里出现；界面命名保持中性「空间」 |

克制原则：隐喻只出现在**命名、空状态、里程碑动效**三处；日常操作界面是安静的工具，不做主题化装饰。**不复制简斋的水墨与古风；材质层采用 Apple 玻璃，见 `06-visual-style.md`（ADR-0002 取代了此处原「不复制玻璃态」的规定）。**

---

## 2. Token（`src/client/styles/tokens.css`，Tailwind v4 `@theme` 映射）

所有 token 以 `--xz-` 前缀定义为 CSS 变量；Tailwind 通过 `@theme inline` 引用，组件用 Tailwind 类，**禁止在组件里写裸色值**。

### 2.1 色彩

品牌主色：**苔绿**（生长）；强调色：**琥珀**（归巢的暖光）；中性色：暖灰（纸感，不用纯灰）。

> `--xz-bg / --xz-surface / --xz-surface-2 / --xz-border / --xz-fg / --xz-fg-muted` 的值已由 `06-visual-style.md` §3 覆盖（玻璃材质与预合成纸面）；下表这六行仅作语义说明，实际值以 `06` 为准。

| token | Light | Dark | 用途 |
|---|---|---|---|
| `--xz-bg` | → 06 §3.1 | → 06 §3.1 | 页面底板（实色 + 光晕） |
| `--xz-surface` | → 06 §3.2（别名 `surface-solid`） | 同 | 纸面：卡片、列表行 |
| `--xz-surface-2` | → 06 §3.2（别名 `surface-solid-2`） | 同 | 纸面次级：表头、hover |
| `--xz-border` | → 06 §3.2 | 同 | 分隔 |
| `--xz-fg` | → 06 §3.2 | 同 | 正文 |
| `--xz-fg-muted` | → 06 §3.2 | 同 | 次要文字（06 另有 `--xz-fg-faint` 占位/禁用） |
| `--xz-primary` | `#3F7D5A` | `#6FB58C` | 主操作、选中、链接 |
| `--xz-primary-fg` | `#FFFFFF` | `#0F1A13` | 主色上的文字 |
| `--xz-primary-soft` | `#E4F0E8` | `#1F3428` | 主色淡底 |
| `--xz-accent` | ~~`#C98A2E`~~ `#C2852C`（注 2026-09-23：作图标对比度 2.83 → 3.02，06 §3 注） | `#E2A94F` | 强调、里程碑、周期 |
| `--xz-accent-soft` | `#F7ECD9` | `#3A2D17` | |
| `--xz-success` / `-warning` / `-danger` / `-info` | `#2F8F5B` / `#C9822E` / `#C0483F` / `#3B6FB6` | 提亮 15% | 语义色，各配 `-soft` |

主色与强调色各提供 50–900 十一级色阶（由 OKLCH 生成，脚本 `scripts/gen-palette.ts`），只在数据可视化与标签色用色阶，其余用语义 token。

**任务优先级色**：无 = `fg-muted`，低 = `info`，中 = `primary`，高 = `warning`，紧急 = `danger`。
**空间/标签色板**（用户可选，8 色）：苔 / 琥珀 / 靛 / 赭 / 青 / 梅 / 灰 / 松；每色定义 `-bg/-fg` 保证 AA。代码标识符与 token 名（2026-09-23 注）：`moss amber indigo ochre teal plum gray pine` → `--xz-palette-<name>-bg/-fg`，见 glossary。
**协作光标色板**：同 8 色，按 userId 哈希。

对比度：正文 ≥ 7:1，次要文字 ≥ 4.5:1，图标与边框 ≥ 3:1；CI 用脚本校验 token 表。

### 2.2 字体

| token | 值 | 说明 |
|---|---|---|
| `--xz-font-sans` | `"MiSans", "Inter", system-ui, "PingFang SC", "Noto Sans SC", sans-serif` | UI 与正文；MiSans 自托管子集化（简斋已用，免费商用） |
| `--xz-font-serif` | `"LXGW WenKai Screen", "Noto Serif SC", serif` | 仅 journal 阅读态可选 |
| `--xz-font-mono` | `"JetBrains Mono", "MiSans", monospace` | 代码；回退到 MiSans 保证中文注释 |

字号（rem，基准 16px）：`xs 0.75 · sm 0.875 · base 1 · lg 1.125 · xl 1.25 · 2xl 1.5 · 3xl 1.875`。
行高：UI 1.5；正文阅读 1.75；标题 1.25。
中文排版：`text-wrap: pretty`；标点挤压不做；中英文间不自动加空格（内容层由用户决定）。
字体加载：`font-display: swap` + 预加载 UI 字重 400/500/600；子集按 `unicode-range` 分块（fontsource 方案）。

### 2.3 间距、圆角、阴影、层级

- 间距：4px 网格；语义 token `--xz-space-1..12`（4,8,12,16,20,24,32,40,48,64,80,96）。
- 圆角：`sm 4 · md 8 · lg 12 · xl 16 · full`；卡片 lg，按钮/输入 md，标签 full。
- 阴影：三级，命名与值以 `06-visual-style.md` §3.3 为准（`--xz-shadow-soft / card / float`），本行原 `sm/md/lg` 命名作废；夜场下阴影减弱、以棱线与边框补层次。
- z-index：`base 0 · sticky 10 · dropdown 20 · peek 25 · overlay 30 · scrim 39 · sheet 40 · modal 40 · toast 50 · cmdk 60`（Peek 低于 modal 且不带 Scrim；Sheet 与 Dialog 同层，各自的 Scrim 在 39）。
- 断点：`sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`；≥ lg 显示侧栏，< lg 底部导航。

### 2.4 动效

三档位（用户设置，默认「标准」；`prefers-reduced-motion` 强制「减弱」）：

| token | 减弱 | 标准 | 丰富 |
|---|---|---|---|
| `--xz-dur-fast / base / slow / stage / theme` | 0 / 0 / 0 / 0 / 0 | 120 / 200 / 320 / 480 / 650 ms | 同标准 |
| 主题切换（06 §6） | 瞬切 | 圆形揭幕 `dur-theme`；整页溶解 `dur-stage` | 同标准 |
| 布局动画（列表重排、看板拖拽） | 无 | Motion `layout` 弹簧 `{stiffness 420, damping 34}` | 同标准 + 拖拽倾斜 |
| 路由切换 | 无 | View Transitions 淡入 200ms；**卡片 → 详情 / Peek 用共享元素**（`view-transition-name` 只给当前被点的一张卡片，动态赋名、结束即清，避免同名冲突）320ms `ease-out` | 同标准 + 详情页头随卡片形变 |
| 里程碑（周期完成、任务清空） | 无 | 一次性 600ms 粒子 | 完整「成巢」动画 1.2s |

缓动：`--xz-ease-out: cubic-bezier(.22,1,.36,1)`，`--xz-ease-in-out: cubic-bezier(.65,0,.35,1)`，`--xz-ease-spring`（CSS 微交互专用：按钮按下、勾选、胶囊切换；`cubic-bezier(.34,1.56,.64,1)` 兜底，`@supports (transition-timing-function: linear(0,1))` 下换成简斋验证过的阻尼振荡 `linear()` 采样）。布局动画、拖拽、共享元素仍统一走 Motion 弹簧预设，不手写 keyframes 弹簧。
规则：所有动效可中断；进入 ≤ 320ms，退出 ≤ 200ms；同屏同时动的元素 ≤ 3 组。

---

## 3. 主题机制

- 根元素 `data-theme="light|dark"`，未设置时跟随 `prefers-color-scheme`；切换用 View Transitions 圆形揭幕（简斋已验证的实现思路，去掉分层错峰）。具体时序与代码骨架见 `06-visual-style.md` §6。
- 所有颜色只在 `tokens.css` 的 `:root` 与 `[data-theme=dark]` 两处定义；`color-scheme` 随之设置。
- 禁止 `!important`；禁止组件私有主题变量；第三方（Tiptap 内容、KaTeX、Mermaid、cmdk）通过映射 token 覆盖其变量。
- Mermaid 用 `theme: 'base'` + `themeVariables` 从 token 生成，随主题重渲染。

---

## 4. 布局骨架

```
┌─────────────────────────────────────────────────────┐
│ Topbar: 面包屑 · 搜索/⌘K · 通知铃 · 头像             │ 56px
├──────────┬──────────────────────────────┬───────────┤
│ Sidebar  │ Main                          │ Aside     │
│ 240px    │ (列表/看板/编辑器)             │ 320px 可折 │
│ 空间树   │                               │ 大纲/反链/  │
│ 我的视图 │                               │ 评论/属性  │
└──────────┴──────────────────────────────┴───────────┘
< lg：Sidebar 抽屉、Aside 底部 sheet、底部导航（今日 / 收件箱 / 搜索 / 通知 / 我）
```

- 内容最大宽：编辑器正文 760px 居中（可切「宽屏」1080）；列表/看板全宽。
- 密度：`comfortable`（默认）/ `compact`（行高 -20%），用户设置。

---

## 5. 组件层次

| 层 | 来源 | 示例 |
|---|---|---|
| 原语 | shadcn/ui（Radix） | Button, Input, Select, Dialog, Sheet, Popover, Tooltip, Tabs, Command, Toast(Sonner), Calendar, Checkbox, Badge, Avatar, Skeleton |
| 复合 | 本项目 `components/ui-x/` | DataTable(TanStack)、DatePickerZh、TagPicker、UserPicker、EmojiPicker、KeyHint、EmptyState、InlineEdit |
| 领域 | `components/domain/` | TaskRow, TaskKanbanCard, TaskDetailSheet, **PeekPanel**, EntryCard, EntryEditor, CycleHeader, GoalList, CommentThread, NotificationItem, ActivityRow, SpaceSwitcher, **StatusPill**（Topbar 状态胶囊，Toast 从此形变） |
| 页面 | `routes/` | 今日、收件箱、空间看板、记录列表、记录编辑、周期、搜索、通知中心、设置、/design |

规则：领域组件不含数据获取（由路由 loader / hooks 注入）；原语不改源码（shadcn 生成后允许改，但改动记入 `/design` 画廊说明）。

---

## 6. 交互规范

- **命令面板 ⌘K / Ctrl+K**：**上下文优先**。面板第一组命令由当前焦点对象决定（`CommandContext`：`task | entry | cycle | space | none`）：焦点在任务上 → 改状态 / 指派 / 设截止 / 移到周期 / 打开；在记录上 → 标记版本 / 导出 / 移动空间 / 固定；在空间上 → 新建任务 / 邀请成员。第二组是全局：跳转（空间、页面）、创建（任务 `t`、记录 `e`、周期）、切换主题 / 密度、搜索直达。候选带 KeyHint；输入即切到搜索。命令注册走同一注册表 `commands.ts`，快捷键面板与 ⌘K 共用。
- **全局快捷键**（`?` 查看）：`g t` 今日、`g i` 收件箱、`g s` 搜索、`c` 新任务（唯一含义，列表内也不改绑）、`e` 新记录、`n` 通知、`[`/`]` 折叠侧栏/Aside；编辑器内快捷键归 Tiptap，全局键在编辑器聚焦时禁用。
  - 注 2026-09-24（T1-029 实现）：未引入 react-hotkeys-hook，沿用自有 `useHotkeys`（加了序列键 `g t` 与 `defaultPrevented` 跳过，编辑器内 Mod+K 为链接）；命令注册表为 `hooks/useCommands.ts`（⌘K、`?` 面板、全局热键三处共用）。「移到周期」为二期能力，⌘K 中显示为置灰项。Peek 的 Enter 升级在 window 捕获阶段处理（悬停打开时焦点行可能不是被预览对象）。
- **键盘可达**：所有列表/看板支持 `j/k` 与方向键移动、Enter 打开、`Space` 勾选 / 完成（唯一含义）、`x` 多选、`e` 就地编辑、`p` Peek；焦点环 2px `primary`（06 `--xz-focus-outline`），永不隐藏。快捷键注册表 `commands.ts` 保证同一上下文内一键一义。
- **Peek 预览**：列表 / 看板 / 反链 / 搜索结果中的任务与记录，悬停 600ms 或焦点行按 `p` 在右侧弹出只读 `PeekPanel`（非 modal Sheet 变体，宽 480，不抢焦点、无 Scrim、不锁滚动，`Esc` 或移开关闭，`Enter` 升级为完整详情）；数据来自 `GET /entries/:id/preview` 与任务详情的 Query 缓存；Peek 打开不改 URL，升级为详情才改。
- **反馈**：写操作乐观更新；失败 Toast + 自动回滚；> 400ms 的请求显示骨架屏而非 spinner；破坏性操作用确认弹层，删除后行内一条 8s 细进度线可撤销（软删），不用 Toast 承载撤销。
- **状态胶囊 Toast**：只复用 Sonner 的 `toast()` 队列 API，**不用其 Toaster 容器**；渲染容器自建在 Topbar 内，与 StatusPill 同一 Motion `LayoutGroup`，Toast 从常驻「状态胶囊」（同步状态 / 离线 / 后台作业）**形变生长**出来，完成后缩回胶囊（`layoutId` 共享）；不从屏幕边缘滑入。用于：任务完成、导出完成、同步恢复、离线提示。错误仍走普通 Toast（红色条）。
- **空状态**：每个列表页有插画 + 一句话 + 主操作按钮；文案可带隐喻（「这里还没有衔来的枝」）。
- **表单**：react-hook-form + Zod；错误就地显示；自动保存的表单显示「已保存 · 刚刚」。
- **通知**：铃铛未读数；面板分「全部 / 提及 / 未读」；点击跳转并标已读；Toast 仅用于当前操作结果，不用于他人事件（他人事件走铃铛 + 可选桌面 Push）。
- **移动端**：底部导航；任务行左滑完成、右滑改期；编辑器工具条固定底部随键盘上移；长按进入多选。

---

## 7. 可访问性与国际化

- WCAG 2.2 AA；Radix 提供 ARIA；自定义组件必须过 `axe` 检查（Playwright 集成）。
- 图标必带 `aria-label` 或伴随文字；仅色不传达状态（优先级同时有图标）。
- 文案全部 i18next key（`zh-CN` 一期唯一资源）；日期用 dayjs 按用户 locale/timezone；数字千分位按 locale。
- 相对时间：24h 内显示「x 分钟前」，否则显示日期；悬停显示绝对时间。

---

## 8. `/design` 组件画廊

- 路由 `/design`，仅 admin 可见，生产可访问（用于对照线上样式）。
- 每个原语/复合/领域组件一页：所有 variant × size × state（默认/hover/focus/disabled/loading/error）矩阵，深浅色并排。
- token 页：色板（含对比度值）、字体、间距、动效示例（可切档位）。
- 视觉回归：Playwright 对 `/design` 每页截图，比对基线（`e2e/__screenshots__/`），阈值 0.1%。

---

## 9. 资产

- Logo：一只衔枝的燕子（待设计画布定稿）；提供 SVG 单色/彩色、favicon、PWA 图标 192/512、maskable。
- 插画：空状态 6 张（今日/收件箱/空间/记录/周期/搜索），线稿风格，用 `currentColor` 随主题。
- 图标：Lucide，`stroke-width 1.75`，尺寸 16/20/24。
