# ADR-0025 编辑器对齐简斋：吸顶工具栏 · 插入面板 · 块编辑 · 颜色标记 · 图表公式

> 状态：已采纳 · 2026-09-28 · 修订 03 §3.1「不做颜色标记」（只放开 9 色板文字色 / 背景色）；实现 REQ-EDITOR-007 · 008；补充 03 §11.1、06 材质表、08 §2.9。参考简斋（jianzhai）RichTextEditor 工具栏、QuickInsertMenu、BlockHoverMenu、TableOverlay、CodeBlockView、CalloutView、阅读胶囊。

## 背景

衔枝编辑器只有斜杠菜单与选区气泡条：表格没有增删行列界面、代码块无复制、提示块不能换类型也不分色、Mermaid / 公式只显示源码；阅读设置（ADR-0024）是一个「Aa」弹层。用户要求编辑器功能与样式以简斋为基准，阅读与写作设置的排版也和简斋统一放在文档上方，并增加更多插入选项。

## 决定（用户 2026-09-28 选定四项：只加色板颜色 · 本轮做 Mermaid + KaTeX · 不加分栏 / 标签页 / 视频 / 表情 · 工具栏吸顶）

1. **文档上方吸顶工具栏**（REQ-EDITOR-024 · REQ-READ-007）：`EditorToolbar` 在正文上方，`sticky top: var(--xz-topbar-h)`（专注模式贴顶并让出右上角退出按钮）；纸面实底（随纸张，宣纸 / 牛皮纸取对应底色）不 blur（06 纸面规则）。编辑组：+ 插入 | 撤销 重做 清除格式 | 段落格式▾（正文 / 标题 1–4）| 加粗 斜体 下划线 删除线 更多▾（行内代码 / 上标 / 下标）| 文字色▾ 背景色▾ | 无序 有序 任务 引用 | 对齐▾ | 链接；右侧：**阅读胶囊**（字体 / 纸张 / 排版 / 目录，各一个弹层，替代 ADR-0024 的「Aa」）· 专注 · Markdown 源码 · 字数（与服务端 word_count 同一算法，移到 `shared/editor/word-count.ts`）。只读者只有右侧；< lg 编辑组隐藏（MobileToolbar 负责）。「清除格式」不去掉评论锚点（comment mark）。
2. **插入面板与斜杠菜单共用注册表**（REQ-EDITOR-025 · 026）：`SLASH_ITEMS` + `insert-meta.tsx`（图标、9 色板色块、面板分区）。「+」面板：搜索 + 分区（基础 / 文本 / 列表 / 布局 / 公式 / 图表 / 关联）；表格点开 8×8 尺寸网格（斜杠 `/表格` 仍 3×3）；新增项：链接（光标处无选区也能插入，工具栏链接弹层）、行内公式、Mermaid 预设（流程图 / 时序图 / 类图 / 状态图 / 甘特图）。斜杠菜单：空查询按分组列出全部（分组标题、可滚动、键盘跟随）；有查询扁平排序最多 8 条（REQ-EDITOR-002 加注）。
3. **块手柄菜单**（REQ-EDITOR-027）：拖动把手单击打开：转换为（正文 / 标题 1–4 / 三种列表 / 引用 / 代码块，仅文本块）、包裹为（四种提示块 / 折叠块 / 引用）、操作（复制此块——去掉评论锚点；删除此块）。打开时对目标块拍快照并 `setMeta('lockDragHandle')`。
4. **表格**（REQ-EDITOR-028）：列宽可拖（`resizable: true`）；光标在表格内浮出表格工具条（第二个 BubbleMenu，glass-thick）：上 / 下插入行、左 / 右插入列、删除行 / 列、合并 / 拆分、表头行开关、删除表格。样式：外框圆角、表头底色 + 加粗下边线、斑马纹、选中格、列宽拖柄。
5. **代码块头部**（REQ-EDITOR-029）：语言 · 行数 · 复制（`copyText`，局域网 HTTP 可用）。
6. **提示块**（REQ-EDITOR-030）：四种 kind 分色（info / success / warning / danger token）+ 左色条 + 图标；编辑态悬停出「切换类型 / 取消提示块」。kind 仍 4 种，schema 不变。折叠块加边框与展开箭头。
7. **颜色标记**（REQ-EDITOR-031，修订 03 §3.1）：新 mark `textColor { color }` 与 highlight 的 `color` 属性，**只存 9 色板 key**，渲染 `data-text-color` / `data-color`，CSS 映射 `--xz-palette-*-fg / -bg`（夜场自动）；解析只认色板 key（外部粘贴的 style 色值仍被剥掉）；不用官方 multicolor（会写 style 色值）。`FULL_MARKS` +textColor；HTML 导出按色板查表（未知 key 丢弃，导出色表与 tokens 日场值有防漂移单测）；Markdown 导出丢弃并在源码对话框提示有损。字号 / 字体仍不进正文（由 ADR-0024 阅读偏好统一）。check-contrast 加 9 色板文字在纸面 / 宣纸 / 牛皮纸上 ≥ 4.5。
8. **Mermaid / KaTeX**（REQ-EDITOR-007 · 008 实现）：`import('mermaid')` / `import('katex')`（含 katex.css）只在节点视图里动态加载，CodeMirror 源码编辑器 `lazy()`，均不进编辑器首包（构建后核验 EntryEditor / editor chunk 不含三者）。Mermaid：`securityLevel:'strict'`、`htmlLabels:false`、`suppressErrorRendering`、先 parse 显示错误行、主题随日 / 夜场重渲、idle 渲染、note 列表 U+2060 规避；点击进入 CM6 编辑 + 实时预览（不做简斋的三栏切换）。公式：块级 textarea + 实时预览，行内小输入框。源码**失焦或停顿 800ms 才写回属性**（ydoc gc:false，逐键写会让文档膨胀）；并发编辑同一图 / 公式源码为整串后写覆盖。刚插入（节点被整块选中或光标紧随其后）直接进入编辑。
9. **正文样式对齐简斋（全部 token）**：h1 / h2 下分隔线、引用块主色左条 + 浅底、链接主色 + 下划线、分割线、任务完成项置灰删除线、复选框主色、标记圆角。
10. **气泡条**：只在文字选区出现（节点 / 单元格选区交给各自工具条）；加文字色 / 背景色（色块行内联在气泡里，不弹 portal）；以所在纸面为 shift 边界，不压到侧栏。

## 候选与否决

- **照搬简斋的字号 / 字体 / 任意色标记**：与阅读偏好、夜场、导出冲突；只放开色板颜色。
- **分栏 / 标签页 / 嵌入视频 / 表情**：用户选择不加（03 §3.1 多列布局与 iframe 仍不做）。
- **工具栏跟随正文滚走**：长文要回到顶部才能用；选吸顶。
- **工具栏毛玻璃**：纸面上不 blur（06），且同屏 blur 预算已由顶栏 / 侧栏 / Aside 占用。
- **Mermaid 三栏（图表 / 源码 / 分栏）切换**：预览 + 点击编辑并实时预览已覆盖，减少状态。
- **斜杠「最近使用」**：本机状态收益小，延后。

## 后果

- 00：REQ-EDITOR-001 · 002 · 007 · 008、REQ-READ-002 加注；+REQ-EDITOR-024 ~ 031、REQ-READ-007。03 §3.1 · §11.1 注。06 材质表 +编辑工具栏 / 阅读胶囊 / 表格工具条 / 块菜单。08 §2.9 注。glossary +吸顶工具栏、阅读胶囊、插入面板、表格工具条、块手柄菜单、文字色 / 背景色。
- 依赖：`mermaid@12`、`katex@0.16`（与 mermaid 自带版本去重）。`vite.config.ts` 字体不内联（生产 CSP 无 font-src data:）。
- 踩坑：`debug/2026-09-28-katex-text-wrap-pretty-crash`（body `text-wrap: pretty` 叠加 KaTeX 块级公式使 Chromium 整页崩溃，公式区域改 `wrap`）；`debug/2026-09-28-button-aschild-slot`。
- 测试：`editor-kit.test.ts`（颜色标记、斜杠分组）、`export-palette.test.ts`、`diagram-utils.test.ts`；e2e `editor-toolbar.spec.ts`、`editor-blocks.spec.ts`、`editor-diagrams.spec.ts`、`reading-prefs.spec.ts`（胶囊）。
