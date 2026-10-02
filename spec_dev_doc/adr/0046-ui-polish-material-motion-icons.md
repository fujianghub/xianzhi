# ADR-0046 界面精修：材质层级修正 · 浮层退出动效 · 图标描边统一 · 空状态补齐

> 状态：已采纳 · 2026-10-02 · 修订 06 §4（批量栏 / 图片工具条 / Tooltip / EmptyState 行注）、06 §5.1（按钮按压）、04 §2.4（退出动效、弹簧预设）。无迁移。需求区 00：REQ-UI-045 ~ 048。

## 背景

用户（2026-10-02）：「优化前端页面（玻璃质感、UI 交互、动效、图标等），整体布局保持现状」。三路审计（材质 / 交互动效 / 图标与组件）在现有规范下找出的是**实现缺陷与不一致**，不是方向问题：

1. **材质类被覆盖类反压**：`glass / paper / glass-thick-flat / glass-opaque` 用 `@utility` 声明，Tailwind v4 把它们与普通 utility 按名排序，排在 `shadow-* / border-x-0 / bg-*` 之后——同元素上的覆盖类静默失效：顶栏 `border-x-0 border-t-0` 失效与侧栏右线叠成双线；记录页纸面 `shadow-card` 丢失；secondary 按钮的 `shadow-none` 失效，每个默认按钮都带 `shadow-float`；看板卡静止阴影失效。
2. **居中浮层入场偏位**：v4 的 `-translate-x-1/2` 走独立 `translate` 属性，`xz-pop-in` 关键帧又写 `transform: translate(var(--tw-translate-*)) scale(.97)`，居中 Dialog / ⌘K 首帧多偏半个自身。
3. **没有任何退出动画**（04 §2.4 写明退出 ≤ 200ms）；Tooltip、⌘K、Sheet 遮罩入场硬切；Popover 从中心而非触发点长出。
4. **减弱档漏网**：18 处裸 `transition-*` 走 Tailwind 默认 150ms（不随 token 归零）；骨架微光、勾线描画只认系统媒体查询，用户在设置里选「减弱」不生效。
5. **按钮内图标尺寸失效**：`[&_svg]:size-5`（0,1,1）压过子图标 `size-4`（0,1,0），约 34 处写了 16px 的图标实际 20px。
6. **图标描边五种**（1.5 / 1.75 / 2 / 2.25 与 Lucide 默认 2）同屏混用；空状态约一半页面手写、无插画；06 §4 规定的空状态背后光晕未实现。

## 决定

### A. 材质层级（REQ-UI-047）

1. 材质类改放 `@layer components`（恒在 utilities 之前），组件可以用 `shadow-* / border-* / bg-*` 覆盖材质默认值；`@utility` 只留真正的单一用途工具（`focus-ring` `skeleton-shimmer` `hover-veil`）。
2. `hover-veil`：悬停 / 按下在材质上**叠**一层 `hover-bg` / `active-bg`（`background-image` 叠加），不再把玻璃底 / 实底换成 6% 透明色。材质自带高光放 `--xz-mat-img`（`@property` 不继承，子元素悬停不串父级高光）。secondary 按钮改用它。
3. secondary 按钮按 06 §5.1 原意「外观同 glass-thick、不 blur」且无浮影：材质外投影是可替换层 `--xz-mat-drop`（默认 `shadow-float`，`@property` 不继承），按钮置 `0 0 transparent`——**不用 `shadow-none`**（挪层后它会连折射环与顶缘棱线一起清掉）。
3a. 挪层后同元素覆盖类开始生效，逐个核对规范意图：纸面上多余的 `border border-divider`（22 处）删掉，边仍取 `--xz-border`（06 §3「所有玻璃与纸面的 1px 边」，避免挪层后整体变淡）；顶栏改 `border-0`（只靠 `.xz-topbar` 内阴影分隔，否则底部双线）；记录页 / 阅读设置预览纸面写 `shadow-[inset 棱线, shadow-card]`，保留顶缘棱线；Entry / Space 批量栏去掉多余的 `border` 与 `shadow-card`。
4. 饱和度 token 化：`--xz-glass-sat-thin / -sat / -sat-sidebar` = 160% / 180% / 186%（值不变）。
5. 夜场光感：`--xz-sheen` .10 → .14、`--xz-edge` .09 → .12（只作高光，不承载文字，对比度矩阵不受影响）。
6. `glass-opaque`（Tooltip）补顶缘 inset 棱线；减透明模拟（`html[data-transparency=reduce]`）同时作用于嵌套 `[data-theme]` 容器（设计画廊 theme=both）。
7. 同类表面统一：任务批量栏 `glass-thick-flat` → `glass`，与 Entry / Space 批量栏同为 L1（夜场 flat 底 8.5% 白且不 blur，透字；不用 L2 是因为批量栏自己的弹出菜单 + 确认 Dialog 会让 L2 超 2 个）；图片工具条 → `glass-thick-flat`（纸面内，不 blur）；BugStats 悬浮提示 → `glass-opaque`（同 Tooltip，不计预算）。

### B. 动效（REQ-UI-045）

8. 浮层退出：Dialog / Popover（含全部 ⋯ 与右键菜单）/ Sheet / ⌘K / Tooltip 在 `data-state=closed` 播 `xz-fade-out / xz-pop-out / xz-slide-*-out`，时长 `dur-fast`（Sheet `dur-base`），`forwards` 停在终态等 Radix Presence 卸载。浮层带 `data-xz-exit` 标记，减弱档对其 `animation: none`——Presence 见无动画即同步卸载，不依赖 0ms 动画的 `animationend`。退场中的浮层 `pointer-events: none`（不误点正在消失的菜单项），e2e `countBlur` 不计退场中的浮层。
8a. 退场让卸载晚 `dur-fast`，Popover 关闭时的「焦点还给触发钮」随之推迟：若这期间焦点已被菜单项移到别处（行内改名输入框、新开的弹层），`PopoverContent` 不再抢回。
9. 入场补齐：Tooltip、⌘K 内容与遮罩、Sheet 遮罩；Popover / Tooltip 以 `--radix-*-content-transform-origin` 为原点，从触发点长出。`xz-pop-in / xz-pop-out` 改用独立 `scale` 属性，不再碰位移。
10. `@theme` 设 `--default-transition-duration: var(--xz-dur-fast)`、`--default-transition-timing-function: var(--xz-ease-out)`：裸 `transition-*` 一律走 token、随减弱档归零。骨架微光周期为 token `--xz-dur-shimmer`（1.4s），两种减弱来源下 `animation: none`；勾线描画时长改 `dur-fast`。
11. 按压反馈统一：Button 各档 `active` 轻缩（primary / secondary / ghost / destructive .985，icon .92）、侧栏导航项 .985；icon 档悬停时图标放大 1.06（同侧栏导航图标）。`scale` 不靠 transition 也会生效，减弱档对 `.xz-press / .xz-hover-lift / .xz-nav-item` 显式置 `scale: none`。Dialog / Sheet 关闭钮复用 Button icon 档。
12. 批量操作栏出现时自下浮起（`xz-rise`，`dur-base`）；任务行触屏滑动松手后弹回（拖动中仍跟手）。
13. Motion 弹簧预设收口到 `lib/motion.ts`：`SPRING`（420 / 34，04 §2.4 默认）、`SPRING_MORPH`（260 / 26，06 §4 Toast 形变）。

### C. 图标（REQ-UI-046）

14. 全站 Lucide 描边由 CSS 统一：默认 1.75（06 §5.1）；`size-3 / size-3.5` 小图标 2（细于 1px 发虚）；色块 `.xz-chip` 与类型徽章 2。个别例外用 `[--xz-icon-stroke:N]`，**不写 `strokeWidth` 属性**（CSS 会压过它）。
15. Button 只给**没写尺寸**的图标默认 20px（`svg:not([class*=size-])`）。
16. 转圈统一为 `components/ui/spinner.tsx`（Button 加载态与 StatusPill 共用）。

### D. 空状态（REQ-UI-048）

17. `EmptyState` 增 `size="sm"`（面板 / 设置页 / 目录树内）与插画 `spaces / tags / tree / calendar`（同一枝条 + 巢，枝头换物件）；插画背后按 06 §4 加静态 `glow-1` 径向光晕（不 blur）；整体 `xz-rise` 浮现。空间首页、看板、标签 / 类型设置、目录树的手写空状态改用它，原 testid 与文案不变。

## 不做

- 侧栏 / Aside 折叠动画（宽度变化触发重排，属布局改动）；Tabs 滑动指示条（需测量 DOM）；玻璃噪点（ADR-0005 不加噪点）。
- `glass-thick` 全量 `contain: paint`：会裁掉工具条内联弹出物，逐个评估后再说；⌘K 改 `clip-path`：会连同 `shadow-float` 一起裁掉。
- 图标按钮自动 Tooltip：TooltipProvider 只挂在已登录布局（REQ-UI-015），认证页的 icon 按钮会抛错。
- mention 弹层 z 改 dropdown：它会出现在 Sheet（z modal）里的评论编辑器中，降层会被遮住。
- 菜单图标统一 `size-4`：审计点名的 TaskRowMenu / EntryRowMenu `size-3.5` 是 `text-xs` 小节标题与行内小触发钮的配图，尺寸本就合适。
- Badge / Avatar 档位化：触及 27 处手写胶囊，超出本轮低风险范围。

## 影响

- 视觉：顶栏去掉左右与上边线；记录页纸面恢复 `shadow-card`；默认按钮去掉浮影；看板卡有静止阴影；按钮内若干图标 20 → 16px；全站图标描边略轻；夜场弹层高光略亮。视觉基线（design / feedback）更新。
- 预算：任务批量栏由无 blur 变为 L1 blur（任务页同屏 L1：侧栏 + 顶栏 + 批量栏，未超 06 §8 的 L1 ≤ 4）。
- 顺带：记录页正文 `.tiptap` 补 `role="textbox"`（只读时裸 div 带 `aria-label` 被 axe 判禁用属性）；a11y 全路由用例超时 240 → 600 s（main 基线同样超时，见 `debug/2026-10-02-a11y-axe-route-timeout`）。
- 回归中暴露、与退出动效相关：退场窗口内重新打开同一 Popover 时 Radix 不重跑 `onOpenAutoFocus`，`PopoverContent` 补跑（日历气泡打开即按 Delete）；e2e `openReading` 只认打开态弹层。
- 回归中暴露的既有竞态：任务描述插图后图片丢失 / 第二次保存 409——`LiteEditor` 内容相同不 `setContent`、`TaskDetailSheet` 保存排队（`debug/2026-10-02-task-image-upload-lost-on-save`）。
- 既有：perf 用例首屏 JS 279 KB > 250（main 基线 279.1 KB，本轮 +0.4 KB；`pnpm build` 的 check-budget 口径为 202.7 KB），未在本轮处理。
