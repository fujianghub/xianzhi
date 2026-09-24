# 06 视觉风格：Apple 玻璃 · 日场 / 夜场

> 状态：已采纳 · 版本：v4 · 更新：2026-09-24 · 最后对照代码：2026-09-24（ADR-0005 翡翠、侧栏改版、reduced-transparency） · 依据 ADR-0002（推翻 ADR-0001 §9.3 与 `04` §1 的「不复制简斋玻璃态」）。
> 本文定义**材质与光影层**：背景、玻璃面板、深度、光效、主题切换。语义色阶、字体、间距、动效档位、布局、组件层次仍以 `04-design-system.md` 为准；两文冲突处以本文 §3 的 token 值为准（§3 明确列出覆盖项）。
> 来源：简斋 `frontend/src/styles/tokens.css` / `theme.css` 的 `.jz-glass` 体系（2026-09 版）。本文取其配方与踩坑，去掉其古风、六主题、AntD 覆盖层，只保留**两种主题：日场（light）/ 夜场（dark）**。

---

## 1. 风格定义

**一句话**：macOS / iOS 式的分层毛玻璃工作台——一块安静的有色底板，上面浮着几层半透明磨砂面板，面板边缘有一道极细的高光棱线，主色以渐变与辉光出现，一切过渡像镜头溶解而不是弹窗。

四条原则：

| 原则 | 含义 | 反例（不做） |
|---|---|---|
| **层即材质** | 界面只有三层：底板（Backdrop）· 玻璃（Glass，最多两级嵌套）· 内容（Content，纸面）。每层材质固定，不按页面临时发明 | 卡片里再套卡片再套玻璃 |
| **光从上来** | 所有玻璃顶缘有 1px 高光、底部有柔阴影；光晕固定在视口四角，不随滚动 | 四面等宽描边、无方向阴影 |
| **正文是纸** | 阅读与编辑区永远是不透明纸面，玻璃只用于 chrome（顶栏、侧栏、浮层、面板） | 长文压在模糊背景上 |
| **克制的辉光** | （注 2026-09-24：ADR-0005 §4 放宽为 ≤ 6 处）主色辉光只出现在焦点、主按钮 hover、里程碑三处；日常界面里主色是「一条线、一枚点」 | 全屏绿色渐变、发光边框到处都是 |

与简斋的差异：无朱砂/水墨/楹联；无星空/深海/春水/冬雪；无「随时辰」；无 `!important`（shadcn 组件源码归自己，不需要压 AntD）；所有 token 挂 `:root`，不做 `.jz-glass` 类作用域（简斋 portal 拿不到作用域变量的坑，见 §9）。

---

## 2. 层模型

```
z 轴（由远到近）
┌ Backdrop  底板：--xz-bg 实色 + 三处固定径向光晕（brand 苔绿 / 琥珀 / 靛）
│           background-attachment: fixed；永远不透明；永远不动
├ Glass L1  一级玻璃：Sidebar · Topbar · Aside · 底部导航（移动端）
│           --xz-glass（regular）· blur 20–24 · 贴视口边，与底板直接接触
├ Content   纸面：编辑器正文、列表行、看板卡片、表格
│           --xz-surface-solid 不透明；**不用 backdrop-filter**
├ Glass L2  二级玻璃：Popover · Dropdown · Command(⌘K) · Dialog · Sheet · Toast · 浮动工具条
│           --xz-glass-thick · blur 24–28 · 永远 portal 到 body
└ Scrim     遮罩：Dialog/Sheet 下的暗化层，自带 blur 6
```

硬规则：
- **玻璃不套玻璃**：L2 浮层出现在 L1 之上是允许的（它们 portal 到 body，与 L1 是兄弟），但一个 DOM 子树内不得出现两层 `backdrop-filter`。子层会对父层已模糊的输出再模糊，成本翻倍且出现灰边。
- **纸面不透明**：列表行、卡片、表格单元格、编辑器用 `--xz-surface-solid`（预合成实色）。它们的「玻璃感」来自边框、棱线和阴影，不来自模糊。原因：虚拟列表里几十张卡片同时 `backdrop-filter` 会把移动端帧率打到 20 以下；简斋的冻结表头透底 artifact 也源于此（§9）。
- `backdrop-filter` 元素会成为其内部 `position: fixed` 子元素的包含块——任何需要 fixed 的东西（弹层、拖拽幽灵）一律 portal 到 body。

---

## 3. Token（`src/client/styles/tokens.css`）

全部以 `--xz-` 前缀定义在 `:root`（日场）与 `[data-theme="dark"]`（夜场），无第三处。`color-scheme` 同步设置。以下覆盖 `04` §2.1 中同名 token 的值（`--xz-bg / surface / surface-2 / border / fg / fg-muted`，并新增 `fg-faint`），其余语义色（primary / accent / success…）沿用 `04`。`scripts/check-contrast.ts` 只读本文 §3 的值。

### 3.1 底板与光晕

| token | 日场 | 夜场 | 说明 |
|---|---|---|---|
| `--xz-bg` | `#F4F4F1` | `#0A0C0B` | 底板实色。日场取 Apple `#F5F5F7` 略暖；夜场取近黑带一丝苔绿，让光晕有对比 |
| `--xz-glow-1` | `rgba(63,125,90,.16)` | `rgba(111,181,140,.20)` | 苔绿光晕，左上 |
| `--xz-glow-2` | `rgba(201,138,46,.12)` | `rgba(226,169,79,.14)` | 琥珀光晕，右上 |
| `--xz-glow-3` | `rgba(99,102,241,.10)` | `rgba(129,140,248,.16)` | 靛光晕，右下；冷色平衡两枚暖色 |

```css
body {
  background-color: var(--xz-bg);
  background-image:
    radial-gradient(ellipse 70% 50% at 0% 0%,     var(--xz-glow-1) 0%, transparent 60%),
    radial-gradient(ellipse 60% 50% at 100% 0%,   var(--xz-glow-2) 0%, transparent 60%),
    radial-gradient(ellipse 80% 60% at 100% 100%, var(--xz-glow-3) 0%, transparent 60%);
  background-attachment: fixed;
}
```

光晕是全站唯一的「氛围」，位置与椭圆参数两主题相同，只换颜色；不加噪点、不加动画、不加 canvas。

> 注 2026-09-24（ADR-0005 §1 · §3）：`glow-1` 改为翡翠色（日场 `rgba(2,179,119,.17)`、夜场 `rgba(46,231,156,.15)`）；光晕移到 `body::before` 独立 fixed 层（Dialog 打开时下移 4px、透明度 .94），为 P2 的分钟级漂移（只动 `transform`）预留；「不加动画」由 ADR-0005 取代，仍不加噪点与 canvas。

### 3.2 玻璃材质（四级）

| token | 日场 | 夜场 | blur / saturate | 用于 |
|---|---|---|---|---|
| `--xz-glass-thin` | `rgba(255,255,255,.45)` | `rgba(255,255,255,.035)` | 12px / 160% | 看板列底、分组头、悬浮时的提示背景 |
| `--xz-glass` | `rgba(255,255,255,.62)` | `rgba(255,255,255,.055)` | 20px / 180% | Sidebar · Topbar · Aside · 底部导航 |
| `--xz-glass-thick` | `rgba(255,255,255,.82)` | `rgba(255,255,255,.085)` | 24px / 180% | Popover · Dropdown · Dialog · Sheet · Toast · ⌘K（28px） |
| `--xz-glass-opaque` | `rgba(255,255,255,.98)` | `#161917` | 无 | 玻璃不可用时的替身：`prefers-reduced-transparency`、不支持 `backdrop-filter`、打印 |

配套：

| token | 日场 | 夜场 | 说明 |
|---|---|---|---|
| `--xz-surface-solid` | `#FBFBFA` | `#131513` | 纸面：`--xz-glass` 预合成到 `--xz-bg` 上的实色。**改 bg 或 glass 必须重算** |
| `--xz-surface-solid-2` | `#F2F2EF` | `#191C19` | 纸面次级：表头、hover 行、代码块底 |
| `--xz-surface` | `var(--xz-surface-solid)` | 同 | **别名**，保持 `04` 与 shadcn 映射（`--color-card`）可用；新代码直接用 `surface-solid` |
| `--xz-surface-2` | `var(--xz-surface-solid-2)` | 同 | 别名，同上（`--color-muted`） |
| `--xz-blur-thin / -regular / -thick` | `12px / 20px / 24px` | 同 | 玻璃模糊半径；`@media (width < 64rem)` 下统一降为 `8px / 12px / 12px`（§8） |
| `--xz-border` | `rgba(60,60,67,.13)` | `rgba(255,255,255,.08)` | Apple 分隔线灰；所有玻璃与纸面的 1px 边 |
| `--xz-divider` | `rgba(60,60,67,.07)` | `rgba(255,255,255,.045)` | 面板内部分隔 |
| `--xz-edge` | `rgba(255,255,255,.65)` | `rgba(255,255,255,.09)` | 顶缘棱线，用 `inset 0 1px 0` 画，不是 border |
| `--xz-refract` | `color-mix(in srgb, #fff 40%, var(--xz-glow-1))` | `color-mix(in srgb, #fff 14%, var(--xz-glow-1))` | **折射环**：L2 玻璃四周 1.5px `inset 0 0 0 1.5px`，颜色带一点底板光晕色，模拟玻璃厚度 |
| `--xz-sheen` | `rgba(255,255,255,.55)` | `rgba(255,255,255,.10)` | **左上高光**：`radial-gradient(120% 80% at 0% 0%, var(--xz-sheen) 0%, transparent 32%)` 叠在 L2 玻璃背景最上层，只覆盖左上约 30% |
| `--xz-fg` | `#1D211C` | `#ECEAE3` | 正文；在玻璃与纸面上都 ≥ 7:1 |
| `--xz-fg-muted` | `#5E655A` | `#9AA094` | 次要；比 `04` 原值加深一档，因为玻璃底比纯白暗 |
| `--xz-fg-faint` | `#8A9086` | `#6F766B` | 占位符、禁用；≥ 3:1 |

> 注（2026-09-23，T0-017）：`scripts/check-contrast.ts` 按 §7 最坏合成底实测，本表两处原值不达标，按「刚好达标」最小修正：`--xz-fg-faint` 日场 ~~`#8A9086`~~ → `#888E84`（2.93 → 3.01）、夜场 ~~`#6F766B`~~ → `#787F75`（2.66 → 3.02）。04 §2.1 同步修正日场 `--xz-accent` ~~`#C98A2E`~~ → `#C2852C`（作图标 2.83 → 3.02）与 `--xz-danger-soft` → `#FCF2F1`（danger 字 4.05 → 4.51）。

Tailwind 映射（`@theme inline`）只暴露 `--color-*` 与 `--radius-*`；玻璃用 `@utility` 封装，组件不手写 `backdrop-filter`：

```css
@utility glass       { background: var(--xz-glass);       backdrop-filter: blur(var(--xz-blur-regular)) saturate(180%); border: 1px solid var(--xz-border); box-shadow: inset 0 1px 0 var(--xz-edge), var(--xz-shadow-soft); }
@utility glass-thin  { background: var(--xz-glass-thin);  backdrop-filter: blur(var(--xz-blur-thin)) saturate(160%); border: 1px solid var(--xz-divider); }
@utility glass-thick {
  background:
    radial-gradient(120% 80% at 0% 0%, var(--xz-sheen) 0%, transparent 32%),
    var(--xz-glass-thick);
  backdrop-filter: blur(var(--xz-blur-thick)) saturate(180%);
  border: 1px solid var(--xz-border);
  box-shadow: inset 0 0 0 1.5px var(--xz-refract), inset 0 1px 0 var(--xz-edge), var(--xz-shadow-float);
}
/* 光标跟随高光：只给 ⌘K 与 Dialog；--mx/--my 由 pointermove 写在元素上，rAF 节流 */
@utility glass-cursor-sheen {
  background-image:
    radial-gradient(240px circle at var(--mx, 50%) var(--my, 0%), color-mix(in srgb, var(--xz-sheen) 60%, transparent) 0%, transparent 70%),
    radial-gradient(120% 80% at 0% 0%, var(--xz-sheen) 0%, transparent 32%);
}
@utility paper       { background: var(--xz-surface-solid); border: 1px solid var(--xz-border); box-shadow: inset 0 1px 0 var(--xz-edge); }

@media (prefers-reduced-transparency: reduce), print {
  :root { --xz-glass-thin: var(--xz-glass-opaque); --xz-glass: var(--xz-glass-opaque); --xz-glass-thick: var(--xz-glass-opaque); }
  .glass, .glass-thin, .glass-thick { backdrop-filter: none; }
}
@supports not (backdrop-filter: blur(1px)) {
  :root { --xz-glass-thin: var(--xz-glass-opaque); --xz-glass: var(--xz-glass-opaque); --xz-glass-thick: var(--xz-glass-opaque); }
}
```

Tailwind v4 的 `backdrop-blur-*` 会同时输出 `-webkit-backdrop-filter`；自写 CSS 时也必须带前缀（Safari 16 仍需要）。

### 3.3 深度（阴影）

本表**取代** `04` §2.3 的 `sm / md / lg` 阴影命名（`04` 已加指向）。

| token | 日场 | 夜场 | 用于 |
|---|---|---|---|
| `--xz-shadow-soft` | `0 2px 10px rgba(0,0,0,.05)` | `0 4px 14px rgba(0,0,0,.35)` | L1 玻璃、静止的纸面卡片 |
| `--xz-shadow-card` | `0 8px 24px rgba(0,0,0,.06), 0 2px 6px rgba(0,0,0,.04)` | `0 8px 28px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.05)` | 卡片 hover、拖拽中 |
| `--xz-shadow-float` | `0 14px 40px rgba(0,0,0,.10), 0 2px 6px rgba(0,0,0,.06)` | `0 20px 60px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.40)` | L2 浮层、⌘K、Dialog |
| `--xz-glow-primary` | `0 0 0 4px color-mix(in srgb, var(--xz-primary) 22%, transparent)` | 同式，`primary` 换夜场值 | 主按钮 hover、里程碑（焦点环不用它，见 §3.4 `--xz-focus-outline`） |

规则：阴影永远偏冷且无色（不用带色阴影）；夜场靠 `inset 1px` 白棱线补层次，阴影本身在黑底上几乎不可见，这是简斋验证过的做法。

### 3.4 主色在玻璃上的用法

主色 `--xz-primary`（苔绿）与强调色 `--xz-accent`（琥珀）值沿用 `04`。新增派生（一律 `color-mix`，不新增手调色）：

| token | 定义 | 用于 |
|---|---|---|
| `--xz-primary-gradient` | ~~`linear-gradient(135deg, var(--xz-primary) 0%, color-mix(in srgb, var(--xz-primary) 70%, var(--xz-accent)) 100%)`~~ `linear-gradient(135deg, var(--xz-primary), var(--xz-primary-bright))`（ADR-0005） | 主按钮、选中态胶囊、进度 |
| `--xz-primary-fg` | ~~日场 `#FFFFFF`（4.9:1）· 夜场 `#0F1A13`~~ 两主题 `#04231B`（6.1 / 10.3:1，ADR-0005） | 主色渐变上的文字。翡翠上白字只有 2.7:1 |
| `--xz-primary-text` | 日场 `#0D7953` · 夜场 `#2EE79C` | 主色当文字 / 图标（ADR-0005；翡翠本色在纸面上仅 2.6:1） |
| `--xz-branch-line` | `color-mix(in srgb, var(--xz-primary) 42%, transparent)` | 顶栏枝线（ADR-0005 §2） |
| `--xz-hover-bg` | `color-mix(in srgb, var(--xz-fg) 6%, transparent)` | 所有无色 hover |
| `--xz-active-bg` | `color-mix(in srgb, var(--xz-fg) 11%, transparent)` | 按下 |
| `--xz-selected-bg` | `color-mix(in srgb, var(--xz-primary) 12%, transparent)` | 侧栏当前项、列表选中行 |
| `--xz-selected-border` | `color-mix(in srgb, var(--xz-primary) 40%, var(--xz-border))` | 选中卡片描边 |
| `--xz-focus-outline` | `2px solid color-mix(in srgb, var(--xz-primary) 70%, transparent)` + `outline-offset: 2px` | 焦点环。用 `outline` 而非 `box-shadow`：forced-colors 下仍可见（§7），且不受 `overflow: hidden` 裁剪；`04` §6「焦点环 2px primary」即此 |
| `--xz-code-inline-fg` | `color-mix(in srgb, var(--xz-primary) 54%, var(--xz-fg))` | 行内代码前景；日场自动加深、夜场自动提亮，免逐主题调色 |
| `--xz-code-inline-bg` | `color-mix(in srgb, var(--xz-primary) 8%, transparent)` | |

---

## 4. 组件材质表

每个组件只允许一种材质；改材质先改本表。

| 组件 | 材质 | 圆角 | 阴影 | 备注 |
|---|---|---|---|---|
| Topbar | `glass` blur 20 | 0 | `inset 0 -1px 0 divider` | sticky；滚动 > 8px 后加 `shadow-soft` + 枝线（注 2026-09-24：`.xz-topbar[data-scrolled]`，ADR-0005） |
| Sidebar | ~~`glass` blur 24~~ `.xz-sidebar`：`glass-thick` 底色 + blur-thick（注 2026-09-24 侧栏改版，REQ-UI-032） | 0 | 右侧 1px border + 内侧棱线 + 右向柔阴影 | ~~当前项 `selected-bg` 胶囊 `radius-full`，左侧 3px 主色竖条~~ 当前项翡翠渐变胶囊（18% → 6%）+ 1px inset 描边 + 柔光，圆角 10，无竖条；图标专属色 `--xz-icon-*`；reduced-transparency 覆盖须写在 `.xz-sidebar` 之后（debug/2026-09-24-reduced-transparency-unlayered-order） |
| Aside（大纲/反链/评论/属性） | `glass` blur 20 | `xl` 左侧两角 | `shadow-soft` | 折叠时向右滑出 |
| 底部导航（< lg） | `glass` blur 20 | `xl` 顶部两角 | 顶部 1px border | 加 `env(safe-area-inset-bottom)` |
| 页面容器（列表/看板页） | 透明 | — | — | 直接露出底板光晕 |
| 编辑器页 | `paper` | `xl` | `shadow-card` | 正文 760px 居中；纸面外露出光晕；**不 blur** |
| 任务行 / 记录行 | `paper`（行内无 border，组容器有） | 组 `lg` | 组 `shadow-soft` | hover `hover-bg`，选中 `selected-bg` |
| 看板列 | `glass-thin` blur 12 | `xl` | 无 | 一列一个 `backdrop-filter`，列数 ≤ 8 |
| 看板卡片 | `paper` | `lg` | 静止 `shadow-soft`，hover `shadow-card` | 拖拽：`scale 1.02 · rotate 1.5deg · shadow-float` |
| 周期页头（程） | `paper` + `--xz-primary-gradient` 6% 蒙层 | `xl` | `shadow-card` | 唯一允许大面积主色渐变的地方 |
| Popover / Dropdown / Select | `glass-thick` blur 24 | `lg` | `shadow-float` | portal |
| Tooltip | `glass-opaque` | `md` | `shadow-soft` | portal；小且需清晰，不 blur、不计入 §8 计数 |
| Tabs | 透明；选中项 `selected-bg` 胶囊 `full` | — | 无 | 下划线式用 2px 主色条 |
| Checkbox / Radio / Switch | `surface-solid` 底 + `border`；选中 `primary-gradient` | `sm` / `full` | 无 | 勾选动画见 §5.3 |
| Avatar | 继承宿主；1px `border` 环 | `full` | 无 | 协作光标头像外加同色 2px 环 |
| KeyHint | `glass-thin`（无 blur，`backdrop-filter: none`）+ `border` | `sm` | 无 | 只在 ⌘K 与快捷键面板内 |
| EmptyState | 透明；插画背后静态 `glow-1` 模糊圆 | — | 无 | §5.5 |
| InlineEdit | 静止透明；hover `hover-bg`；编辑态同输入框 | `md` | 无 | §5.2 |
| NotificationItem | `paper` 行（组容器有 border）；未读左侧 3px 主色条 | 组 `lg` | 组 `shadow-soft` | 与任务行同规则 |
| SpaceSwitcher（侧栏空间树） | 透明；当前项 `selected-bg` 胶囊 | `full` | 无 | Sidebar 行已定 |
| 未列组件 | 透明 / 继承宿主材质 | 继承 | 无 | 需要新材质先加本表 |
| Command ⌘K | `glass-thick` blur 28 + `glass-cursor-sheen` | `xl` | `shadow-float` | 宽 640；顶部搜索框无边框，仅 divider；第一组为上下文命令（04 §6） |
| Dialog / Sheet | `glass-thick` blur 24 + `glass-cursor-sheen` + Scrim | `xl` / Sheet 内侧两角 | `shadow-float` | Scrim：日场 `rgba(0,0,0,.28)`、夜场 `rgba(0,0,0,.55)`，`backdrop-filter: blur(6px)`（**计入 §8 L2 计数**）；打开时 Aside 自动折叠（关闭复原），保证同屏 blur 不超预算；Dialog 出现时底板光晕下移 4px 并暗 6%（「被压住」的重量感），关闭复原 |
| Toast（状态胶囊变体） | `glass-thick` blur 24 | `full` → 展开后 `lg` | `shadow-float` | **不用 Sonner 的 Toaster 容器**，只复用其 `toast()` 队列；容器自建在 Topbar 内，与 StatusPill 同一 Motion `LayoutGroup`（`layoutId` 共享），从胶囊形变生长（弹簧 `{260, 26}`），完成后缩回；错误 Toast 左侧 3px `danger` 条，仍从胶囊出，不从屏幕边滑入（04 §6）。这是唯一不 portal 到 body 的浮层（它在 Topbar 的 L1 玻璃之内，因此 Toast 自身**不加 backdrop-filter**，只用 `--xz-glass-thick` 底色 + 折射环，避免玻璃套玻璃） |
| PeekPanel（悬停 / `p` 预览） | `glass-thick` blur 24 | `xl` 左侧两角 | `shadow-float` | Radix Dialog `modal={false}`：无 Scrim、不锁滚动、不抢焦点，z-index `peek 25`（04 §2.3）；右侧贴边宽 480；打开时源卡片作共享元素飞入面板头（04 §2.4）；内容区是 `paper` 纸面，玻璃只在外壳 |
| 浮动工具条（编辑器 bubble menu） | `glass-thick` blur 24 | `full` | `shadow-float` | 与 Tiptap 内容用同一 token |
| 表格（DataTable） | `paper`；**冻结表头/首列用 `surface-solid-2` 实色** | `lg` | `shadow-soft` | 透明表头会透出滚动内容，简斋实发 |
| 代码块 | ~~`surface-solid-2`（两主题都偏暗）~~ `--xz-code-bg` 深底（两主题同值，注 2026-09-24）| `md` | 无 | 代码高亮主题：One Dark 变体，`--xz-code-*` 九色 ≥ 4.5:1（注释 `#9199A6`、标签 `#E5737B` 为提亮修正） |
| Badge / Tag | `color-mix(tagColor 12%, transparent)` + 同色 1px 边 | `full` | 无 | 8 色板见 `04` §2.1 |
| Skeleton | `surface-solid-2` + 微光扫过 | 同宿主 | 无 | 微光 `linear-gradient(90deg, transparent, var(--xz-edge), transparent)` 1.4s |

---

## 5. 控件细节（深度美化清单）

### 5.1 按钮

| 变体 | 静止 | hover | active | 说明 |
|---|---|---|---|---|
| primary | `primary-gradient` + `primary-fg`，`inset 0 1px 0 rgba(255,255,255,.25)` 棱线 | `translateY(-1px)` + `glow-primary` | `scale(.985)`，去棱线 | 一页最多一个；焦点态叠 `focus-outline` |
| secondary | `glass-thick` 材质（注 2026-09-23：外观同 glass-thick 但**不加 backdrop-filter**——按钮小且成排出现，逐个 blur 会让组件页同屏超 §8 预算；与 Toast 同法） | `hover-bg` 叠加 | `active-bg` | 默认按钮 |
| ghost | 透明 | `hover-bg` | `active-bg` | 工具条、行内操作 |
| destructive | `danger-soft` 底 + `danger` 字 | 底加深 | | 确认弹层内才允许实心红 |
| icon | ghost，36×36，`radius-md` | 同 ghost | | 图标 20px `stroke 1.75` |

时序：颜色 `dur-fast(120)`，位移 `dur-base(200)` + `--xz-ease-spring`（`04` §2.4）。禁止 `transition: all`。

### 5.2 输入

- 静止：`surface-solid` 底 + `border`；玻璃上（⌘K、Dialog）改用 `glass-thin` 底。
- focus：`focus-outline` + border 变 `selected-border`；不改高度、不加阴影。
- 错误：border `danger`，下方 12px 说明，不摇晃。
- 搜索框（Topbar）：`radius-full`，左侧图标，右侧 KeyHint 胶囊「⌘K」。

### 5.3 选择态与勾选

- Checkbox 勾选：方框 → 主色填充 `ease-spring 200ms`，勾线 `stroke-dashoffset` 描画 160ms；任务完成时整行文字 `fg-muted` + 删除线渐入 200ms，再 400ms 后（可撤销窗口内）行高折叠移出。
- 列表选中行：左侧 3px 主色条（不是整行描边）+ `selected-bg`。
- 看板卡片选中：`selected-border` + `shadow-card`。

### 5.4 滚动条与选区

```css
* { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--xz-fg) 22%, transparent) transparent; }
::selection { background: color-mix(in srgb, var(--xz-primary) 28%, transparent); }
```
玻璃面板内滚动条 hover 前隐藏（`scrollbar-gutter: stable`）。

### 5.5 空状态与里程碑

- 空状态插画用 `currentColor` 取 `fg-faint`，下方一句话与一个 primary 按钮；插画背后一枚 `glow-1` 色的模糊圆（`filter: blur(40px)`，静态）。
- 里程碑（周期完成）：`04` §2.4 的「成巢」动画在此叠加一次主色辉光呼吸（`glow-primary` 0 → 1 → 0，1.2s）。这是主色辉光的第三个也是最后一个出现位置。

### 5.6 品牌位

- （注 2026-09-24：Logo 为燕印 `Seal size=sm`；「衔枝」改用 `--xz-font-display` 17px，副标 `Xianzhi` 改用 `--xz-font-brand-en` italic 12px；登录页燕印 `lg` + 展示字 26px，ADR-0005）
- Sidebar 顶部：Logo（衔枝燕）+ 「衔枝」用 `--xz-font-serif`（`04` §2.2，LXGW WenKai Screen，与简斋品牌位同一字体）`font-weight 400 · letter-spacing .06em`；副标 `Xianzhi` 用 `--xz-font-sans · fg-faint · 11px · letter-spacing .18em`。
- 登录页：底板光晕放大 1.4 倍 + 一张 `glass-thick` 卡片居中，卡片顶缘棱线加亮到 `rgba(255,255,255,.9)`（日场）。这是唯一允许调高棱线的地方。

---

## 6. 主题切换

- 两种主题：`light`（日场）· `dark`（夜场）。默认跟随系统 `prefers-color-scheme`；用户在设置或 ⌘K 手动选择后持久化（`localStorage: xz:theme`），再选「跟随系统」即清除。
- 根元素 `data-theme="light|dark"`；同时设 `style.colorScheme`，让原生控件与滚动条跟随。
- 切换动效（View Transitions，简斋验证过的实现，去掉分层错峰与随时辰）：
  - **从点击处圆形揭幕**（有触发坐标时，`--xz-dur-theme`（650ms）`ease-out`）：新快照用 `radial-gradient` mask 从点击点扫开，边缘 90px 羽化；旧快照 `brightness(.9) saturate(.92)` 微退。
  - **整页溶解**（无坐标、系统切换时，`--xz-dur-stage`（480ms））：旧层 `opacity 1→0 + blur 0→5px`，新层淡入。
  - 过渡期间给根加 `.vt-live`，关闭 `body` 自身的 `background-color transition`，否则溶解里会叠一次二次动画。
  - `prefers-reduced-motion` 或无 API：瞬切。
- 编辑器内的 Mermaid / KaTeX / 代码高亮随主题重渲染（`03`）。

```ts
// src/client/lib/theme.ts（骨架）
export function setTheme(next: 'light' | 'dark' | 'system', origin?: { x: number; y: number }) {
  const resolved = next === 'system' ? systemTheme() : next
  const commit = () => { document.documentElement.dataset.theme = resolved; document.documentElement.style.colorScheme = resolved; persist(next) }
  if (!document.startViewTransition || reducedMotion()) return commit()
  const root = document.documentElement
  root.classList.add('vt-live')
  if (origin) { root.style.setProperty('--vt-x', `${origin.x}px`); root.style.setProperty('--vt-y', `${origin.y}px`); root.style.setProperty('--vt-r', `${farthestCorner(origin) + 90}px`); root.classList.add('vt-circle') }
  document.startViewTransition(commit).finished.finally(() => root.classList.remove('vt-live', 'vt-circle'))
}
```

---

## 7. 可访问性

- 对比度按**最坏合成底**计算：日场文字对比以 `glass-thin` 叠在 `glow-2` 峰值上的合成色为准；夜场以 `glass-thick` 叠 `glow-3` 为准。CI 脚本 `scripts/check-contrast.ts` 用 §3 的预合成值跑 `fg / fg-muted / fg-faint / primary-fg / 语义色` 全矩阵，正文 ≥ 7:1、次要 ≥ 4.5:1、图标与边框 ≥ 3:1。
- `prefers-reduced-transparency: reduce` → 所有玻璃变 `glass-opaque`，光晕保留（它不影响可读性）。
- `prefers-reduced-motion: reduce` → View Transitions、hover 位移、拖拽倾斜、微光、光标跟随高光、Toast 形变全部关闭（Toast 退化为淡入）；颜色过渡保留。
- `forced-colors: active` → 玻璃与阴影失效，依赖 border 划分区域；`box-shadow` 被移除，因此焦点环用 `--xz-focus-outline`（§3.4），不用 `box-shadow`。
- 玻璃上的可点击目标 ≥ 40×40；主色文字不单独用于传达状态（伴随图标）。
  - 注 2026-09-24（T1-034、REQ-MOBILE-007）：`< lg` 下小控件保持视觉尺寸，由 `app.css` base 层给 `button / [role=button|checkbox|tab|switch] / a[href]` 加 `::after` 扩出 ≥ 40×40 点击区（正文行内链接豁免），`select / input` 最小高 40px；放 base 层保证 `absolute` 等工具类与已有 `after:*` 优先。纸面（paper）上承载文字的地方不用 `fg-faint`（axe 对比度不达标），只用于图标与玻璃上的辅助文字。

---

## 8. 性能预算

| 项 | 预算 | 检查方式 |
|---|---|---|
| 同屏 `backdrop-filter` 元素 | ≤ 6 个（L1 最多 4 + L2 最多 2，**Scrim 计入 L2**；Tooltip、KeyHint、Toast 不 blur 故不计） | Playwright 在 `/design`、看板页、任务详情 Sheet 打开态数 `getComputedStyle(...).backdropFilter !== 'none'` 的可见元素；Dialog / Sheet 打开时 Aside 自动折叠（§4） |
| 光标跟随高光 | 仅 ⌘K 与 Dialog 两处；`pointermove` 用 rAF 节流，写 CSS 变量不触发布局 | 代码审查 |
| 单个 blur 半径 | ≤ 28px；< lg 断点 ≤ 12px（thin 8 / regular 12 / thick 12） | `--xz-blur-*` token 在 `@media (width < 64rem)` 下覆盖（§3.2） |
| 嵌套 blur | 0 | `scripts/check-css.ts`（05 §3 `pnpm lint` 内）：静态扫描组件树中 `glass*` 类嵌套；运行时 `/design` 测试再数一遍 |
| 光晕 | 3 个 `radial-gradient`，`background-attachment: fixed` | 移动 Safari 对 fixed attachment 会退化成 scroll，可接受 |
| 主题切换 VT | ≤ 700ms，期间不阻塞输入（`::view-transition { pointer-events: none }`） | |
| 首屏 LCP | 沿用 `04`：主 chunk ≤ 250 KB，Lighthouse ≥ 90 | |

实现约束：
- 玻璃面板加 `contain: paint`，缩小重绘区域；不加 `will-change`（常驻会占 GPU 内存）。
- 列表滚动时不触发玻璃重绘：L1 面板 `position: sticky/fixed`，与滚动容器隔离。
- 虚拟列表内禁止一切 `backdrop-filter`、`filter`、`mix-blend-mode`。

---

## 9. 已知陷阱（简斋实发，预防写进代码前）

| # | 症状 | 根因 | 本项目的规避 |
|---|---|---|---|
| 1 | portal 到 body 的菜单/建议面板拿不到玻璃变量，背景透出正文 | 变量定义在 `.jz-glass` 类作用域内，portal 元素不在其下 | 全部 token 只定义在 `:root` / `[data-theme]`，禁止类作用域 token（`04` §3 已规定） |
| 2 | 表格冻结表头透出下方滚动内容 | 表头用半透明 surface | 冻结表头/首列一律 `surface-solid-2`（§4） |
| 3 | iframe / 嵌套上下文里半透明底叠两层出现色差 | 半透明色在两个合成层各算一次 | 嵌入内容（EPUB/PDF 预览等）一律给实色 `surface-solid` |
| 4 | 夜场主按钮白字看不清 | 亮主色上白字 1.8–2.3:1 | `--xz-primary-fg` 按主题定，夜场用深墨绿（§3.4） |
| 5 | 主题切换时背景闪两次 | `body` 自身的 `transition: background-color` 与 View Transition 叠加 | 过渡期根加 `.vt-live` 关闭 body transition（§6） |
| 6 | 快速连点主题按钮叠帧 | 上一个 VT 未结束 | 新切换前 `skipTransition()` 上一个 |
| 7 | 浮层在 Sidebar 内 `position: fixed` 定位错 | `backdrop-filter` 元素成为 fixed 的包含块 | 所有浮层 portal 到 body（§2） |
| 8 | 玻璃面板上 `overflow: hidden` + 圆角在 Safari 出现直角/闪烁 | Safari 合成层裁剪 bug | 面板加 `isolation: isolate`；圆角裁剪交给 `clip-path: inset(0 round var(--radius))` |
| 9 | 焦点环在 Windows 高对比模式消失 | `box-shadow` 在 forced-colors 下被移除 | 焦点环用 `outline` + `outline-offset`（§7） |
| 10 | 六处按钮圆角、五种 hover 底色各写各的 | token 缺失，就地硬编码 | §3.4 的 hover/active/selected/focus 全部 token 化；`scripts/check-css.ts` 禁止裸 `rgba(`、`#` 色值与 `!important` 出现在 `src/client` 组件文件（`tokens.css` 除外） |

---

## 10. `/design` 画廊新增页

- **材质页**：四级玻璃 × 两主题，叠在三种底上（纯底板 / 带图片 / 带密集文字），每块标注实际 blur 与预合成对比度。
- **深度页**：三级阴影 + 棱线在两主题的并排；一个可拖拽卡片演示静止 → hover → 拖拽三态。
- **切换页**：按钮触发圆形揭幕 / 整页溶解，可勾选 `reduced-motion` / `reduced-transparency` 模拟。
- 视觉回归：以上三页纳入 Playwright 截图基线，阈值 0.1%。

---

## 11. 实施顺序（Phase 0 内）

1. `tokens.css`：§3 全部 token（两主题）+ `@utility glass/glass-thin/glass-thick/paper` + reduced-transparency / `@supports` 回退。
2. `body` 底板与光晕；`theme.ts` + View Transition CSS。
3. shadcn 组件生成后按 §4 逐个替换材质类；Popover/Dialog/Command/Toast 先做（它们决定「玻璃感」的第一印象）：折射环 + 左上高光随 `glass-thick` 自动生效，再加 ⌘K / Dialog 的光标高光、StatusPill 形变 Toast、PeekPanel 共享元素。
4. `/design` 三页 + `scripts/check-contrast.ts` + `scripts/check-css.ts` + backdrop-filter 计数测试。
5. Sidebar / Topbar / Aside 骨架接入；看板与列表用 `paper`。
