# ADR-0011 历史版本恢复、Markdown 源码编辑与识别、附件类型扩展、记录模板

> 状态：已采纳 · 2026-09-25 · 不改不变量 1（正文真源仍为 `entries.ydoc`）；对 03 §5 恢复实现、§6 模板、§8 Markdown 定位加注；新增 REQ-COLLAB-008 实现、REQ-EDITOR-019 ~ 022、REQ-ATTACH-012 · 013、REQ-TPL-001 ~ 005、REQ-UI-036；迁移 0008（`audit_log_action_ck` +`entry.restored`）、0009（`entry_templates` + `entries_kind_ck`）。

## 背景

用户需求（2026-09-25）：
1. 「记录」无法创建（bug）；
2. 支持历史版本；
3. 支持多种格式编辑（参考简斋的 MD 编辑器与富文本），自动识别 Markdown（参考语雀），支持图片与多种文件插入；
4. 模板：面向开发的「产品 Bug 修复与迭代」「产品优化」，面向学习计划的模板。

调研结论：
- bug 根因：局域网 IP + HTTP 不是安全上下文，`crypto.randomUUID` 不存在，创建请求在 `fetch` 前抛错（debug/2026-09-25-randomuuid-insecure-context）。
- 快照后端（T0-015）已有，缺预览 / 对比 / 恢复（REQ-COLLAB-008）。
- 简斋正文就是 Markdown 字符串，MD / 富文本切换 = 换编辑器重解析同一串，且其 CLAUDE.md 记录了反复往返导致的逐次损坏；与本项目不变量 1 冲突，不能照搬。
- 模板目前按 kind 硬编码、首次打开注入，无选择器与自定义。

## 决定

经提问，用户裁定（2026-09-25）：

### 1. Markdown：富文本 + Markdown 语法 + 源码对话框（不做每篇可选的 MD 格式）

- **语雀式识别**：剪贴板无 HTML，或 HTML 只是纯文本包装（无结构标签 / 含 VS Code、CodeMirror 标记）且文本像 Markdown（≥ 2 种标记）→ 按 Markdown 转换；Toast「撤销为纯文本」；`Shift+Mod+V` 强制纯文本。
- **快捷输入**：`$$ ` → 公式块、`$x$` → 行内公式（避开金额）、`[[` → 记录选择器。
- **源码对话框**（CodeMirror 6）：打开时按顶层块逐块序列化（`pmToMarkdown`，图片写成 `xz:attachment/<id>`），Markdown 表达不了的块（附件 / 记录卡片 / 目录 / 折叠 / 未知节点）以 `⟦xz-keep:N:type⟧` 占位行出现；保存时解析 → 逐块再序列化 → 与原块 LCS 配对，**配上的沿用原节点**（保留下划线、评论标注、图片尺寸等 Markdown 表达不了的属性），占位行还原为原块，其余用解析结果；以一次 `setContent` 写回，y-prosemirror 只改变化的块。保存前自动存「源码编辑前」标记快照；有其他协作者在线时禁用（整体写回会与并发编辑交错）。
- 这是**一次性导入**，不构成 Markdown 往返真源：正文仍只在 ydoc，派生仍只经 collab。
- markdown-it 管线与导出序列化对称：`:::kind` ↔ callout、```mermaid ↔ mermaid、`$$` ↔ 公式块、`[标题](xz://entry/<id>)` ↔ entryLink。

### 2. 模板：内置 + 用户自定义（`entry_templates` 表）

- 内置 6 个为代码常量（`src/shared/editor/builtin-templates.ts`，id `builtin:<key>`），不入表：开发「产品 Bug 修复与迭代」（bug）、「产品优化」（optimize）；学习「学习计划」（plan）、「学习笔记」（note）、「学习周复盘」（journal）、「读书笔记」（note）。
- 用户模板入表：`personal`（仅本人）/ `workspace`（全员可用，管理员创建）；创建者或管理员可改名 / 改范围 / 删除（`can('template.read|create|manage')`）。「另存为模板」取记录已落库 ydoc 即时派生的正文（只读，不写派生列）。
- 新建记录可带 `templateId`：模板 PM JSON（占位符 `{{date}}` `{{user}}` `{{space}}` 已替换）**只在创建时**写成初始 ydoc；`builtin:blank` 为明确空白；未选模板则沿用首次打开按 kind 注入（03 §6）。模板 body 是种子，不是第二份正文真源。
- 入口：新建对话框的模板选择（按当前空间类型推荐）、斜杠 `/模板`（在光标处插入）、设置 → 模板（预览 / 用此模板新建 / 管理）、记录「属性」→ 另存为模板。

### 3. 新增记录类型 `optimize`（优化）与 `plan`（学习计划）

- 「学习计划」本是空间类型（`spaces.kind = learning`），用户要求能按类型筛出学习计划与产品优化，故新增两个 kind；fields：`optimize {status, metric?, target?}`、`plan {status, startDate?, endDate?, progress?}`；色板 `optimize = pink`、`plan = gray`；默认骨架取对应内置模板。
- 「产品 Bug 修复与迭代」沿用 `bug`；「学习周复盘」用 `journal`（`review` 必须绑周期）。

### 4. 历史版本

- 预览：服务端以已落库 ydoc（gc:false）`Y.createDocFromSnapshot` 重建（`GET …/snapshots/:sid/content`），前端只读 schemaKit 渲染；**不**用在线编辑器的 y-prosemirror snapshot 模式（schema 无 `ychange` 标记，且会中断编辑）。
- 对比：「快照 ↔ 当前」顶层块 LCS（原规范「任选两个快照」改为此对——恢复前真正关心的是它）。
- 恢复：`POST …/restore`（202）→ 审计 `entry.restored` → 总线 `entry.restore`（PG NOTIFY 跨进程）→ collab `openDirectConnection`：先按在线状态打「恢复前自动保存」标记快照，再用同一 LCS 删 / 插顶层块（未变块保留 CRDT 身份，插入块从快照文档 `clone()`），disconnect 立即落库。

### 5. 附件类型

- 新增 docx / xlsx / pptx（zip 内 `[Content_Types].xml` + 主部件判定，改名的 zip 仍是 zip）与 csv；代码 / 日志等 UTF-8 文本按 `text/plain` 存。卡片按类别给图标，文本 / 代码 / JSON / csv / Markdown / docx 应用内预览（docx 经 mammoth，白名单净化），PDF 开新标签页。
- **音视频（上传与外链嵌入）本期不做**（用户 2026-09-25 取消），CSP 与不变量 9 不变。

### 6. 非安全上下文

客户端 id / `Idempotency-Key` 只经 `lib/uuid.ts` 的 `newId()`（lint 禁用 `crypto.randomUUID`），复制走 `lib/clipboard.ts` 降级。

## 候选与否决

- **每篇可选 Markdown 格式（CodeMirror + Y.Text，简斋式实时双模式）**：体验最接近简斋，但要改不变量 1、派生 / 搜索 / 导出 / 快照两套路径，工作量约 3 倍——用户否决。
- **只做语雀式识别、不给源码编辑**：改动最小，但用户要「MD 编辑」——否决。
- **源码对话框整篇 setContent 解析结果**：实现简单，但每次保存都会丢掉 Markdown 表达不了的格式——改为逐块 LCS 沿用原节点。
- **恢复在客户端做（在线编辑器 setContent 快照内容）**：不需跨进程，但要求打开编辑器且依赖客户端 schema；服务端 collab 直连对无人在线的文档同样有效——选服务端。
- **模板只做内置**：用户选「内置 + 自定义」。
- **不新增 kind，模板只挑默认 kind**：无迁移，但无法按「学习计划 / 优化」筛选——用户选新增 kind。
- **音视频上传 + 外链视频嵌入**：用户先选后取消；嵌入需放开 CSP `frame-src` 与 schema，留待以后。

## 后果

- 00：REQ-COLLAB-008 改写并实现；新增 REQ-EDITOR-019 ~ 022、REQ-ATTACH-012 · 013、§6b TPL（REQ-TPL-001 ~ 005）、REQ-UI-036；REQ-EDITOR-008 / 011 加注（输入规则 / `[[` 已做，KaTeX 渲染与三形态切换未做）。
- 01：entries.kind +2、§3.5 fields +2、新表 `entry_templates`、entry_snapshots 注。02 §9：+2 条快照路由、+5 条 `/templates`、`POST /entries` +`templateId`。03：§5 恢复实现注、§6 模板注、§8 / §11 源码对话框与识别注。07：附件类型与预览净化注。08：`/settings/templates`、新建对话框模板选择。glossary：模板、优化、学习计划、源码编辑、历史版本。
- 依赖：`@codemirror/{state,view,commands,language,lang-markdown}`、`@lezer/highlight`（源码对话框懒加载；`@codemirror/state|view` 加入 vite dedupe）、`mammoth`（docx 预览懒加载）。
- 迁移 0008 / 0009 可前滚；0009 回滚需先删 `optimize` / `plan` 记录。
