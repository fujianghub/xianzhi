# ADR-0005 翡翠重音、燕印枝线与动态氛围

> 状态：已采纳 · 2026-09-24 · 部分取代 ADR-0002 §决定 3（品牌色不变）与 §后果末条（动态光晕不做），以及 `04` §1 克制原则、`06` §1「克制的辉光」、§3.1「光晕不加动画」、§3.4 `primary-gradient` 定义、REQ-UI-020 的 `glow-primary ≤ 3`。ADR-0002 其余决定（玻璃只用于 chrome、只有日场 / 夜场、blur 预算、token 挂 `:root`、禁 `!important`）不变。

## 背景

2026-09-24 用户要求参考简斋的前端样式、配色、交互、动效与特效优化衔枝。对照结论：衔枝的 token 与机器闸门比简斋干净，差距在品牌层（Logo 仍是旧音符、品牌字体未加载、代码块无高亮）、氛围层（静态光晕、无指针光效、页头平）与动效层（Motion 只在两处、无路由转场与里程碑）。

用户裁定四项：
1. 主色改用简斋翡翠 `#02B377`；
2. 不做多主题与环境画布，仍只有日场 / 夜场；
3. 四类特效都做：路由转场 + 共享元素、指针光斑 + 边缘光、背景光晕漂移、成巢粒子 / 里程碑；
4. 装饰语言用「燕印 + 枝线」，不用简斋的「簡」字方印与古籍金线。

## 候选方案（主色）

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 保留苔绿，只借质感与动效 | 与简斋辨识度拉开；对比度零改动 | 用户明确要翡翠 |
| **B. 翡翠作填充色，另设文字用深翡翠** | 满足用户；两产品成家族；对比度可控 | `#02B377` 在纸面上仅 2.63:1、白字 2.72:1，必须拆 token |
| C. 翡翠同时当填充与文字 | token 最少 | 链接、图标、选中文字全部低于 3:1，a11y 不过 |

## 决定

采用 B，并配套以下规则。

### 1. 色彩

| token | 日场 | 夜场 | 用于 |
|---|---|---|---|
| `--xz-primary` | `#02B377` | `#2EE79C` | **填充与品牌**：主按钮、勾选、燕印、选中条、进度、辉光 |
| `--xz-primary-bright` | `#19D191` | `#62EFB6` | 主色渐变终点 |
| `--xz-primary-fg` | `#04231B` | `#04231B` | 主色填充上的文字（深墨，6.1:1 / 10.3:1；白字不达标） |
| `--xz-primary-text` | `#0D7953` | `#2EE79C` | **主色当文字 / 图标**：链接、激活图标、选中文字、`ring` |
| `--xz-primary-soft` | 重算为翡翠淡底 | 同 | 主色淡底 |
| `--xz-danger-fg` | `#FFFFFF` | `#1A0F0E` | 实心 danger 底上的文字（原先借用 `primary-fg`） |

- `--xz-primary-gradient` 改为 `linear-gradient(135deg, primary, primary-bright)`，不再混琥珀（翡翠 + 琥珀会发浑）。
- 强调色琥珀、语义色、8 色板不变；光晕 `glow-1` 改为翡翠色。
- `check-contrast` 增加：`primary-text` 在最坏玻璃底与纸面上 ≥ 4.5，`danger-fg` 在 `danger` 上 ≥ 4.5，代码高亮 token 在代码底上 ≥ 4.5；`primary` 作「图标」项改由 `primary-text` 承担。
- 业务代码里 `text-primary / ring-primary` 一律改 `text-primary-text / ring-primary-text`；`bg-primary` 与渐变照旧。

### 2. 装饰语言：燕印 + 枝线

- **燕印** `.xz-seal`：借简斋方印形制——翡翠渐变底、深墨色衔枝燕剪影、`--xz-shadow-seal` 翡翠投影与 1px 内高光；尺寸 28 / 42 / 56；hover `rotate(-6deg) scale(1.05)` 走 `ease-spring`，减弱档静止。用于 Sidebar 品牌位、登录页、favicon。
- **枝线**：顶栏滚动 > 8px 后下沿出现一条 1px 翡翠细线 + `shadow-soft`（取代简斋「书口」金线）。
- **展示字**：品牌位、登录标题、页头题记用 `--xz-font-display`（LXGW WenKai Screen，只有 400，禁伪加粗）；英文品牌字 `--xz-font-brand-en`（Cormorant Garamond italic）。
- `04` §1 克制原则改为：隐喻只出现在**命名、空状态、里程碑动效、品牌位（Logo / 登录 / 页头题记）、顶栏枝线**五处；日常操作界面仍不做主题化装饰。不引入简斋的水墨、楹联、朱砂。

### 3. 动效与氛围

- **光晕漂移**：放开「光晕不加动画」。实现为 `body::before` 独立 fixed 层承载三枚光晕，用 `transform` 做分钟级（64s）漂移，只走合成层，**不用** `@property` 驱动 `background-position`（简斋做法，每帧重绘整个视口）。减弱档静止。
- **指针光斑 + 边缘光**：纸面卡片（记录卡、看板卡、空间卡）内一枚随指针的主色光斑与一段沿 1px 边框游走的光；只在 `(hover:hover) and (pointer:fine)`，全局一个委托 + rAF 节流；不用 `backdrop-filter`，不计入 §8 blur 预算。
- **成巢粒子**：任务完成迸发一次翡翠 / 琥珀粒子（≤ 12 枚，≤ 750ms，DOM 节点用完即删）；里程碑加强。
- **路由转场与共享元素**：按 `04` §2.4 与 REQ-UI-021 落地。
- 动效档位沿用 `04` §2.4 三档（减弱 / 标准 / 丰富），设置页可选：标准含上述四项；丰富额外加拖拽倾斜增强与完整「成巢」1.2s；减弱全部关闭。
- 进入 ≤ 320ms、退出 ≤ 200ms、同屏同时动 ≤ 3 组、可中断，这些规则不变；光晕漂移与指针光效属于环境层，不计入「同时动」。

### 4. 辉光

`glow-primary` 使用点上限由 3 改为 6，允许位置：主按钮 hover、燕印、侧栏当前项、登录输入聚焦、成巢、里程碑。焦点环仍用 `outline`，不用辉光。

### 5. 字体落地

`04` §2.2 早已规定的自托管字体本次实现：`misans`（UI）、`lxgw-wenkai-screen-webfont`（展示）、`@fontsource/jetbrains-mono`（代码）、`@fontsource/cormorant-garamond`（英文品牌字）。全部 npm 包 + `unicode-range` 分片、`font-display: swap`，无外部 CDN；字体文件不计入 JS 首屏预算。

## 后果

- `04` §1、§2.1、§2.2、§2.4，`06` §1、§3.1、§3.4、§4、§5.6 加「注」指向本 ADR；新增 REQ-UI-024 ~ 027（P0 阶段），P1 / P2 阶段的 REQ 随实现补。
- REQ-UI-020 验收改为 `glow-primary` 引用点 ≤ 6；`scripts/check-css.ts` 上限同步。
- 视觉回归 7 张基线须在用户看过新样式后重拍。
- 浏览器首访多下载字体分片（按需，典型页面 < 300 KB woff2）；Lighthouse 需复测（Phase 1 已是 90，余量薄）。
- 衔枝与简斋主色相同，辨识度靠燕印、筑巢隐喻与字体组合区分。

## 参考

- 简斋 `frontend/src/styles/tokens.css`、`theme.css`（`.jz-seal`、`PointerSpotlight`、`jz-bg-breathe`、`inkBurst`、`routeTransition`）、`styles/fonts.css`
- 对比截图与盘点：2026-09-24 会话（简斋登录页四主题、衔枝 /design 与 /today）
