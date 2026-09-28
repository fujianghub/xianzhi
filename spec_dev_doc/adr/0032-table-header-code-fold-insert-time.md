# ADR-0032 表头行 / 表头列 · 代码块折叠 · 插入时间

> 状态：已采纳 · 2026-09-29 · 补充 ADR-0025 §2 · §4 · §5、ADR-0024（阅读偏好新增 `codeFold`）。

## 背景

用户需求：① 表格支持表头行和表头列；② 代码块支持折叠，并可设置默认行为（展开 / 折叠）；③ 插入选项支持插入时间。

## 决定

1. **表头行 / 表头列**（REQ-EDITOR-033）：表格工具条「表头行」旁加「表头列」（`toggleHeaderColumn`）；两个开关的按下状态按**整表**判断（首行全为 th = 表头行；除首行外各行首格都是 th = 表头列），不再看光标所在格。样式：首行 th 加粗下边线；表头列 th 右侧加深竖线、同表头底色，不画横向粗线。
2. **代码块折叠**（REQ-EDITOR-034）：头部条最左加折叠开关；折叠时仍露出前 3 行、下沿渐隐，底部「展开全部 N 行」；≤ 3 行不可折叠。**折叠只影响本人视图、不写正文**（不同步给协作者）。默认行为是阅读偏好 `codeFold`：`expanded` 默认展开（默认值，保持原外观）/ `collapsed` 默认折叠 / `auto` 超过 15 行自动折叠；在「排版」面板设置，偏好改变时各代码块重置为新默认。
3. **插入时间**（REQ-EDITOR-035）：斜杠菜单与「+」面板新增「时间」分组：今天日期 `YYYY-MM-DD`、当前时间 `HH:mm`、日期时间 `YYYY-MM-DD HH:mm`，本地时间，插入为普通文字（不新增节点）。

## 候选与否决

- **折叠状态写进 ydoc（`collapsed` 属性）**：会同步给所有协作者、并在 gc:false 下留历史；阅读习惯因人而异，选视图态 + 个人偏好。
- **插入为动态时间节点（自动刷新）**：多数场景需要记录「写下时的时间」，普通文字更符合预期，也无需改 schema / 导出。

## 后果

- 00：+REQ-EDITOR-033 ~ 035。01 `user_preferences.reading` 说明加 `codeFold`（jsonb 无 schema 漂移）。CHANGELOG。
- 代码：`TableMenu.tsx`、`editor-blocks.css`（表头列、代码块折叠）、`views.tsx` CodeBlockView、`preferences.ts`、`ReadingPanel.tsx`、`slash.tsx`（`nowText`、时间项）、`insert-meta.tsx`、`zh-CN.ts`。
- 测试：`editor-kit.test.ts` REQ-EDITOR-035；e2e `editor-extras.spec.ts`（REQ-EDITOR-033 · 034 · 035）。
