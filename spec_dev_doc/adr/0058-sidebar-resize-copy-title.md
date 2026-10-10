# ADR-0058 侧栏可拖动调宽 · 复制标题快捷键 · 空间胶囊让出引导线

> 状态：已采纳 · 2026-10-10 · 修订 04 §4（侧栏固定 240px）、ADR-0015（侧栏大类分区的引导线与空间行的相对位置）。无迁移。需求区 00：REQ-UI-053、REQ-UI-054、REQ-UI-055。

## 背景

用户（2026-10-10）：「1、当我点击空间 xianzhi、jianzhai 时候，我发现动态的这个底色玻璃框似乎超出范围，导致框到了外面 2、边栏支持拖动 3、支持标题复制快捷键」

1. **胶囊压线**：侧栏大类分区里，空间行外包一层 `relative ps-3`，引导线 `inset-inline-start: 14px`（对齐分区展开指示的中心）。行从包裹层内容区起算 = 线左侧 2px，当前项的翡翠胶囊 / 悬停底的左缘落在引导线左边，看起来像框伸出了分区。个人空间行没有引导线，所以只有分区里的空间（如 xianzhi、jianzhai）有这个问题。目录树（`TreeGuides`）的线画在行内、属于设计，不在此列。
2. 侧栏宽度写死 240（`--xz-sidebar-w`），长空间名只能截断。
3. 任务行菜单有「复制标题」但没有快捷键；记录没有入口。

## 决定

### A. 空间行让出引导线（REQ-UI-053）

1. `SpaceSwitcher` 分区包裹层 `ps-3` → `ps-5`：行从线右侧 5px 起（线在 14 ~ 15px），胶囊、悬停底与行尾按钮都在线右侧。引导线位置不变（仍对齐展开指示）。

### B. 侧栏拖动调宽（REQ-UI-054）

2. ≥ lg 侧栏右缘一条 8px 热区（`SidebarResizer`，`role="separator"`，`.xz-resizer`），与详情坞把手（ADR-0054）同款：悬停 / 聚焦 / 拖动中显示 2px 主色线。
3. 宽度 200 ~ 400px，默认 240；拖动中逐帧（rAF 合帧）改 `<html>` 内联的 `--xz-sidebar-w`，侧栏、主区让位（`lg:pl-(--xz-sidebar-w)`）、抽屉宽度都读它；`html[data-xz-resizing]` 期间全局 `col-resize` 光标、禁止文本选择。
4. 松手才写本机 `localStorage xz:sidebar-w`；等于默认值或双击还原时删键（不写默认值）。`main.tsx` 首帧前应用。
5. 键盘：聚焦后 ← / → 每次 16px（Shift 48px），Home / End 到最窄 / 最宽；`aria-valuenow/min/max` 同步。
6. **只存本机、不随账号**：宽度取决于屏幕尺寸，与 `xz:sidebar`（折叠）、`xz:dock-w`（坞宽）一致；ADR-0049 的外观偏好（主题 / 密度 / 动效 / 玻璃）不扩充。

### C. 复制标题快捷键（REQ-UI-055）

7. 热键 **Mod+Shift+C**：当前上下文为任务（列表焦点行 / 详情坞 / 详情页）或记录（记录页）时，把标题复制到剪贴板并提示「已复制标题「…」」。编辑器 / 输入框里同样生效（mod 组合）；Tiptap 没有此键位。
8. 命令注册表：`task.copyTitle` / `entry.copyTitle`（context 组）+ 新字段 `Cmd.global`——context 组命令默认不注册全局热键（列表自己处理 `p` 等单键），`global: true` 的才注册。⌘K 里显示 KeyHint；快捷键面板右栏固定列出（无上下文时注册表里没有这条）。
9. 入口：任务行菜单「复制标题」与记录菜单（⋯）新增的「复制标题」都带 KeyHint；统一走 `lib/copy-title.ts` → `copyText`（局域网 HTTP 无 `navigator.clipboard` 时降级 `execCommand`，降级后把焦点还给原元素，不让编辑器失焦）。

## 候选与否决

- **热键 Mod+C（无选区时复制标题，Things / Linear 式）**：记录页光标常在编辑器里，Mod+C 归原生复制，等于大多数时候不生效；否决。
- **Mod+Shift+Y / U / L / O 等**：分别撞 macOS 便笺服务、Linux IBus Unicode 输入、浏览器书签管理等；Mod+. / Mod+, 受键盘布局影响且 Windows 中文输入法 Ctrl+. 切中英文标点。Mod+Shift+C 虽是 Chrome / Firefox 的「检查元素」，但浏览器不保留，页面 `preventDefault` 可接管（Google 文档用它做「字数统计」）。
- **Alt 组合**：macOS Option 会改变 `e.key`（Option+C = ç），`useHotkeys` 要改按 `e.code` 匹配，收益不抵改动。
- **侧栏宽度随账号存**：不同设备屏宽差异大，跨设备同步反而别扭；否决。
- **拖到最窄以下自动折叠（VS Code 式）**：已有 `[` 与折叠按钮，暂不做。

## 后果

- 00：+REQ-UI-053 · 054 · 055。04 §4 / §6 注。
- 详情坞挤压阈值（宽 < 1280 时侧栏让位，ADR-0054 §B）仍按 240 估算；侧栏调宽后坞开着时列表会更窄，必要时用户可折叠侧栏。
- 测试：unit `src/client/__tests__/sidebar-width.test.ts`；e2e `e2e/sidebar-copy-title.spec.ts`（REQ-UI-053 · 054 · 055）。
- 踩坑：`debug/2026-10-10-sidebar-space-pill-over-guide`。
