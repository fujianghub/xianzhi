# 03 编辑器内核

> 状态：已采纳 · 版本：v3 · 更新：2026-09-23 · 最后对照代码：2026-09-24（Phase 1：§3 schema、§11 交互、§11.3–11.5 注） · 依据 ADR-0001 §2。覆盖 Tiptap schema、Yjs 落库、快照、模板、导入导出、性能与已知陷阱。

---

## 1. 原则

1. **`entries.ydoc` 是唯一可写真源。** `pm_json / plain / tsv` 只由服务端从 ydoc 派生，前端永远不直接 PATCH 这些列。
2. **正文不经 Markdown 往返。** Markdown 只是导出格式与导入来源，导入一次性转 ProseMirror，导出有损且明示。
3. **Schema 即安全边界。** 渲染只读内容用同一 schema 的 `generateHTML`，不接受任意 HTML；不需要 DOMPurify。
4. **一个 Tiptap 扩展集合，两种装配。** `fullKit`（Entry 正文，含协同）与 `liteKit`（任务描述、评论，无协同），共用自定义节点，避免 schema 分叉。

---

## 2. 依赖与许可

安装前以 https://tiptap.dev 当前许可页核对；下表为 2026-09-23 认知。

| 包 | 用途 | 许可 |
|---|---|---|
| `@tiptap/core` `@tiptap/react` `@tiptap/pm` `@tiptap/starter-kit` | 内核 | MIT |
| `@tiptap/extension-table*` `-task-list` `-task-item` `-link` `-image` `-placeholder` `-code-block-lowlight` `-highlight` `-underline` `-text-align` `-subscript/superscript` | 基础节点 | MIT |
| `@tiptap/extension-collaboration` `@tiptap/extension-collaboration-caret`（v3 中 CollaborationCursor 更名，安装时核对） | Yjs 绑定与远端光标 | MIT |
| `@tiptap/extension-drag-handle-react` `-table-of-contents` `-details*` `-mathematics` | 2025-06 由 Pro 转 MIT | MIT（核对） |
| `@tiptap/suggestion` | @提及、斜杠菜单 | MIT |
| `yjs` `y-prosemirror` `y-indexeddb` `@hocuspocus/provider` `@hocuspocus/server` | 协同 | MIT |
| `lowlight` `katex` `mermaid` | 渲染 | MIT |
| **不用**：`@tiptap-pro/*`（Comments/Snapshots/AI 绑定云服务）、`@tiptap/extension-file-handler`（Pro） | | |

`@tiptap/pm` 是 ProseMirror 的唯一入口；`vite.config` 加 `resolve.dedupe: ['prosemirror-state','prosemirror-view','prosemirror-model','yjs']`（简斋多实例 state 崩溃的根治）。

---

## 3. Schema

### 3.1 节点与标记清单

| 类别 | 名称 | 说明 |
|---|---|---|
| 块 | doc, paragraph, heading(1–4), blockquote, bulletList, orderedList, listItem, taskList, taskItem, codeBlock(lowlight), horizontalRule, table/tableRow/tableCell/tableHeader, image, details/detailsSummary/detailsContent, mathBlock | 来自 starter-kit 与官方扩展 |
| 块（自定义） | **callout**(`kind: info\|tip\|warn\|danger`) · **mermaid**(`source`) · **entryCard**(`entryId`) · **attachment**(`attachmentId`) · **toc** | 见 §3.2 |
| 行内 | text, hardBreak, mathInline, **mention**(`userId`) , **entryLink**(`entryId`, `mode: inline\|title`) , emoji（原生 unicode，不引扩展） | |
| 标记 | bold, italic, underline, strike, code, highlight, link(`href`, 协议白名单 `http https mailto xz:`), subscript, superscript, textAlign（属性）, **comment**(`threadId`) | |

不做：字体家族/字号/颜色标记（设计体系统一排版，见 04）；多列布局；内嵌 iframe（安全）。

### 3.2 自定义节点规格

- **callout**：`<div data-callout="warn">`，内容 `block+`；斜杠菜单 `/提示 /警告`；快捷输入 `:::warn` 转换。
- **mermaid**：atom 节点存 `source`；视图 = 只读预览 + 点击进入 CodeMirror 6（`@codemirror/lang-*` 懒加载）源码编辑；渲染在 `requestIdleCallback` 中，失败显示错误而非空白；沿用简斋 `htmlLabels:false` 与 note 列表 U+2060 规避（见 debug/ 迁移条目）；`securityLevel: 'strict'`（mermaid 内置 DOMPurify）不得放宽。
- **entryLink / entryCard**：三形态（行内链接 / 标题链接 / 卡片），与简斋一致；卡片数据由 `GET /entries/:id/preview` 提供，客户端 Query 缓存；落库时同步 `links(kind=mentions)`。
- **mention**：`@` 触发 `suggestion`，候选来自当前 space 可见成员；落库时服务端从 pm_json 抽取写 `mentions` 表并发事件。
- **attachment**：非图片文件卡片（名称/大小/下载）；图片仍用 `image` 节点，`src` **只接受** `xz:attachment/<id>`（schema 层校验，外域 URL 拒绝），渲染时解析为 `/api/v1/attachments/<id>/md`（同源 Cookie 鉴权，02 §7；不做签名 URL）；粘贴或导入的外域图片一律先下载为附件（§11.3，07 §2.5）。
- **comment 标记**：仅存 `threadId`；评论正文在 `comments` 表；标记被删除时线程保留并标 `orphaned`（侧栏仍可见）。
- **toc**：atom，渲染时由 `table-of-contents` 扩展的实时数据填充；导出时展开为列表。

> 注 2026-09-24（T1-014 实现口径）：
> - `entryLink` 属性沿用 Phase 0 的 `id / title`，服务端 links 抽取也读 `id`；`mode`（行内 / 标题）与卡片切换随 REQ-EDITOR-011（Phase 2）一起补。
> - `mermaid` 属性名沿用 `code`，与 seed、导出一致，未改为 `source`。
> - callout 渲染为 `<aside data-callout>`，不是 `<div>`，解析规则只认 `data-callout`。
> - toc 自绘节点视图，实时读当前文档标题，没有引入 `table-of-contents` 扩展；Aside 大纲共用同一份数据（`useOutline`）。

### 3.3 Schema 版本

`entries.editor_schema_version` 列（01 §3.4；应用侧常量 `EDITOR_SCHEMA_VERSION`），不放进 `fields`（会撞 kind 的严格 Zod schema）。改节点结构时：新增节点向后兼容直接加；改属性名/删节点须写 `src/shared/editor/migrations/<n>.ts`，在 `onLoadDocument` 时对 Y.Doc 做迁移并 bump。**未知节点不得静默丢弃**：解析失败节点渲染为 `unknownBlock` 保留原 JSON。

> 注 2026-09-24（REQ-EDITOR-016）：y-tiptap 解析失败时会**删除** Y 元素（debug/2026-09-24-ytiptap-unknown-node-delete），所以不能在编辑器绑定前再替换。实现方式是在 `onBeforeCreate` 包装 `schema.node`，未知类型直接建成 `unknownBlock{raw}`；collab 派生 pm_json 时用 `unwrapUnknownPm` 还原。

---

## 4. Yjs 与 Hocuspocus

### 4.1 拓扑

```
浏览器 Tiptap ──Y.Doc──┬─ y-indexeddb（本地持久，离线可写）
                       └─ HocuspocusProvider ──wss /collab──▶ Hocuspocus(8011) ──▶ PG entries.ydoc
```

- 文档名：`entry:<uuid>`。Y.Doc 中正文在 fragment `default`；`meta` map 预留（不存业务字段，业务字段走 API）。
- 一个 Entry 页面 = 一个 provider；离开页面 `provider.destroy()`；同一浏览器多标签共享 IndexedDB，由 Yjs 合并。

### 4.2 服务端钩子（`src/collab/server.ts`）

| 钩子 | 行为 |
|---|---|
| `onAuthenticate` | 校验 `Origin` 为 `APP_URL`；校验 `token` 参数：由 `POST /api/v1/collab/token { entryId }` 签发的 5 分钟 HMAC 票据，载荷 `{ userId, entryId, jti, exp }`，`entryId` 必须等于连接的文档名、`jti` 不得重复（02 §9、07 §2.3；会话 Cookie 是 HttpOnly，前端拿不到，且 WebSocket 不做 Cookie 鉴权以免 CSRF）。前端每打开一篇记录取一次票据，过期由 provider `onAuthenticationFailed` 重取重连。随后 `can(user,'entry.read', entry)` 否则拒绝；无 `entry.write` 则 `connection.readOnly = true`；每用户并发连接 ≤ 10（07 §5）。**权限变更联动**（唯一机制，无定时复核）：收到 `user.revoked(userId)` 广播时以 4403 断开该用户全部连接；收到 `entry.access_changed(entryId)` 广播（记录可见性 / 空间成员 / 空间归档变更时由 service 发出）时对该文档所有连接重跑 `can()`，无 `entry.read` 者 4403 断开、失去 `entry.write` 者切 `readOnly` |
| `onLoadDocument` | 从 PG 读 `ydoc` → `Y.applyUpdate`；空则用模板初始化（§6）；执行 schema 迁移 |
| `onStoreDocument` | **防抖 2s、最长 10s** 落库：`ydoc`、`ydoc_version+1`、派生 `pm_json`（`yDocToProsemirrorJSON`）、`plain`（自定义序列化，图片/mermaid/公式给占位）、`word_count`、`tsv`（jieba）、同步 `links`、`mentions`；事务内写 `events(entry.updated)`，**合并机制**：同 `entryId` 同 `actorId` 5 分钟内已有 `processed_at IS NULL` 的 `entry.updated` 行则 `UPDATE payload`（刷新 `ydocVersion / wordCount / summary`），不新增；actor 取最近一次 update 的 awareness 用户，多人同时编辑各自一行 |
| `afterUnloadDocument` | 触发快照策略检查（§5） |
| `onDisconnect` | awareness 清理（内置） |

- 单实例，内存持有活跃文档；`debounce` 与 `maxDebounce` 用 Hocuspocus 内置配置。
- 派生失败不阻塞 ydoc 落库：先写 ydoc，派生列在同事务里 try/catch，失败写 `entries.derived_error`（错误摘要）~~与 `derived_at`~~（01 §3.4）并入队 `derive.retry`；成功时清空 `derived_error`。注（2026-09-24）：`derived_at` 只记最后一次**成功**派生（01 §3.4 定义、REQ-COLLAB-009 验收），失败不改；collab 进程用只发不收的 pg-boss 入队，`derive.retry` 定时任务兜底。

**WebSocket 关闭码**（`onAuthenticate` 与运行期统一）：

> 注（2026-09-23，T0-014）：Hocuspocus 4 在一条 socket 上多路复用多个文档，服务端关闭单个文档连接时客户端只收到 `reason`（`code` 恒为 1000），鉴权失败也只回 permission-denied 消息。故下表的码统一编码为 **`reason = "<码>:<原因>"`**（如 `4401:expired`、`4409:replay`、`4403:revoked`、`4413:update-too-large`、`4429:too-many-connections`），前端按前缀解析；语义不变。

| 码 | 含义 | 前端行为 |
|---|---|---|
| 4401 | 无票据 / 票据签名错 / 已过期 | `POST /collab/token` 重取后重连 |
| 4403 | 无 `entry.read`，或权限变更后失去读权 | 停止重连，显示「无权访问」并退回列表 |
| 4409 | `jti` 重放，或 `entryId` 与文档名不符 | 重取票据重连一次，再失败按 4403 处理 |
| 4413 | 单条 update > 2 MB 或文档达硬限 20 MB | 编辑器只读，提示拆分 |
| 4429 | 每用户并发连接超过 10 | 提示关闭其他标签页，30s 后重试 |

### 4.3 客户端

- `useEditor({ extensions: fullKit({ ydoc, provider, user }), immediatelyRender: false })`；协同模式下**禁用** starter-kit 自带 `undoRedo`（改用 Collaboration 的 Yjs 撤销栈）。
- awareness 用户：`{ name, color(从 04 的 8 色协作色板按 userId 哈希), avatar }`。
- 连接状态 UI：`synced / connecting / offline(local only) / readOnly`；离线时可编辑，顶栏提示「本地已保存，联网后同步」。
- 首屏：先从 y-indexeddb 恢复渲染，再等 provider `synced`，避免白屏等待网络。

---

## 5. 快照与历史

- Y.Doc **`gc: false`**（服务端与客户端一致），否则快照无法还原历史状态。
- 触发：每 50 次 `onStoreDocument` 或 距上次 ≥ 30 分钟 或 用户手动「标记版本」（带 label）。
- 存储：`entry_snapshots.snapshot = Y.encodeSnapshot(Y.snapshot(doc))`，附 `ydoc_version`。
- 保留：未标记快照保留最近 100 个 + 每天最后一个保留 90 天；标记快照永久。
- 前端历史面板：选择两个快照 → `y-prosemirror` 的 `ySyncPluginKey` snapshot 模式渲染 diff（增删着色）；「恢复到此版本」= 在当前文档上应用反向变更（**不是**覆盖 ydoc，历史仍连续）。

---

## 6. 按 kind 的正文模板（`src/shared/editor/templates.ts`）

`onLoadDocument` 发现 fragment 为空时按 kind 注入：

| kind | 模板（二级标题骨架 + 占位提示） |
|---|---|
| decision | 背景 / 候选方案（表格：方案·优点·缺点）/ 决定 / 后果 / 参考 |
| bug | 症状 / 复现步骤（有序列表）/ 根因 / 修复 / 验证 —— 与 `debug/` 目录 README 五段一致 |
| iteration | 目标 / 已完成（任务列表）/ 未完成 / 下一步 / 备注 |
| changelog | 新增 / 变更 / 修复 / 移除 |
| review | 亮点 / 问题 / 教训 / 下期重点 / 数据（callout: 本周期完成任务数由服务端填入） |
| journal / note | 空文档 + placeholder |

模板文本用 i18n key，注入时按用户 locale 取值。

---

## 7. liteKit（任务描述、评论）

- 无 Collaboration；内容以 `pm_json` 直接保存（`PATCH /tasks/:id { descriptionPm, ifUpdatedAt }`）。
- 节点子集：paragraph, heading(2–3), lists, taskList, codeBlock, link, image(attachment), mention, entryLink, callout；无表格、无 mermaid。
- 评论：同 liteKit 再去掉 heading/callout/image；单行回车提交、Shift+Enter 换行。

---

## 8. 导入 / 导出

| 方向 | 方法 | 契约 |
|---|---|---|
| Markdown 导出 | `prosemirror-markdown` 自定义 serializer：callout→`:::kind`、mermaid→```mermaid、entryLink→`[title](xz://entry/<id>)`、comment 标记丢弃、attachment→链接 | 有损，导出对话框明示 |
| 全量导出 | Entry → `<space>/<kind>/<yyyy-mm-dd>-<slug>.md` + YAML frontmatter（id/kind/fields/tags/links）；附件同目录 `assets/`；任务与周期 → JSON；打成 zip | Obsidian 可直接打开 |
| Markdown 导入 | markdown-it → 自定义 → ProseMirror JSON → 新建 Entry 并 `prosemirrorJSONToYDoc` | 一次性；不支持「同步」 |
| `debug/` 导入 | 解析五段标题映射到 bug 模板，截图入附件 | 二期 |
| HTML 导出 | `generateHTML` + 04 的排版 CSS 内联 | 用于邮件摘要与打印 |

---

## 9. 性能

- 编辑器整包（Tiptap + Yjs + lowlight 语言 + KaTeX）为独立懒加载 chunk，路由级 `lazy()`；mermaid 与 CodeMirror 再各自懒加载。
- lowlight 只注册 ~20 种常用语言，其余按需 `import()`。
- 组件订阅状态用 `useEditorState` 带 selector（简斋教训：整棵重渲染卡顿）。
- 图片：上传即 sharp 生成 `thumb(320)/md(1280)` 变体，正文默认加载 `md`，点击看原图；`loading="lazy"` + blurhash 占位。
- 长文（>5k 词）：正文容器不虚拟化（PM 不支持），但大纲/反链/评论侧栏虚拟化；KaTeX 与 mermaid 渲染在 idle 回调。
- 预算：编辑器 chunk gzip ≤ 400 KB；打开一篇 3k 词记录到可编辑 ≤ 800 ms（本机，缓存命中）。

---

## 10. 测试

- 单元：serializer/parser 往返用例集（每个自定义节点至少 1 例）；`plain` 序列化；模板注入；schema 迁移。
- 集成：Hocuspocus 钩子用真实 PG（`xz_test` 库，05 §5）；readOnly 连接不可写；派生列与 ydoc 一致。
- E2E（Playwright）：两个 `browserContext` 同时编辑同一 Entry 收敛一致；`context.setOffline(true)` 编辑后恢复同步；中文输入法用 CDP `Input.imeSetComposition` 验证 composition 期间不触发 inputRule；斜杠菜单、@提及、评论锚点。
- 性能：Playwright 采 `performance.measure` 写入 `debug/perf/editor-<date>.json`，CI 对比预算。

---

## 11. 编辑器交互规格

### 11.1 斜杠菜单（`/` 触发，`@tiptap/suggestion`）

| 分组 | 命令 | 触发词（zh / en） | 插入 |
|---|---|---|---|
| 基础 | 标题 1–4 | 标题1 / h1 … | `heading{level}` |
| 基础 | 正文 | 正文 / text | `paragraph` |
| 基础 | 引用 | 引用 / quote | `blockquote` |
| 基础 | 分割线 | 分割 / hr | `horizontalRule` |
| 列表 | 无序 / 有序 / 任务列表 | 列表 / bullet · 编号 / number · 待办 / todo | `bulletList` / `orderedList` / `taskList` |
| 代码 | 代码块 | 代码 / code | `codeBlock`（语言选择器） |
| 代码 | Mermaid | 图表 / mermaid | `mermaid`（空源码进入编辑态） |
| 数学 | 公式块 | 公式 / math | `mathBlock` |
| 结构 | 表格 | 表格 / table | `table` 3×3 |
| 结构 | 折叠 | 折叠 / toggle | `details` |
| 结构 | 提示 / 技巧 / 警告 / 危险 | 提示 / info · 技巧 / tip · 警告 / warn · 危险 / danger | `callout{kind}` |
| 结构 | 目录 | 目录 / toc | `toc`（每篇最多 1 个） |
| 媒体 | 图片 | 图片 / image | 打开文件选择 → §11.4 |
| 媒体 | 附件 | 附件 / file | `attachment` |
| 链接 | 记录卡片 | 卡片 / card | `entryCard`（先弹记录选择器） |
| 链接 | 记录链接 | 链接 / link | `entryLink`（同上，行内） |
| 模板 | 决策 / Bug / 迭代 / 复盘 段落 | 模板 / template | 插入 §6 对应模板的骨架（不替换已有内容） |

规则：菜单最多显示 8 条，模糊匹配触发词与命令名；`Esc` 关闭并保留 `/`；空文档首行的 placeholder 提示「输入 / 唤起命令」。

### 11.2 编辑器快捷键

`Mod` = macOS ⌘ / 其他 Ctrl。编辑器聚焦时 04 §6 的全局快捷键全部禁用（`useHotkeys` 的 `enableOnContentEditable: false`），`Esc` 先退出编辑器焦点再响应全局键。

| 快捷键 | 行为 |
|---|---|
| Mod+B / I / U / E | 加粗 / 斜体 / 下划线 / 行内代码 |
| Mod+K | 链接：有选区弹输入框；选区是 URL 直接成链 |
| Mod+Shift+1..4 | 标题 1–4；Mod+Shift+0 正文 |
| Mod+Shift+7 / 8 / 9 | 有序 / 无序 / 任务列表 |
| Mod+Alt+C | 代码块 |
| Mod+Shift+H | 高亮 |
| Tab / Shift+Tab | 列表缩进 / 反缩进；表格内移动单元格 |
| Mod+Z / Mod+Shift+Z | 撤销 / 重做（**Yjs 撤销栈**，只回退本人操作，§4.3） |
| Mod+Enter | 评论输入框提交；任务描述保存 |
| Mod+S | 无操作，吞掉（自动保存，显示「已同步」提示 1s） |
| `/` | 斜杠菜单 |
| `@` | 提及（§3.2） |
| `[[` | 双链选择器 → `entryLink` |
| `:::info` + 空格 | callout（也支持 tip / warn / danger） |
| `$$` + 空格 | 公式块；`$x$` 行内公式 |
| ```` ``` ```` + 语言 + 回车 | 代码块 |
| `- [ ]` + 空格 | 任务列表项 |
| Mod+Alt+↑ / ↓ | 块上移 / 下移 |

所有 inputRule 检查 `view.composing`（§12 IME 陷阱）。

### 11.3 粘贴规则

| 来源（`clipboardData`） | 处理 |
|---|---|
| 纯文本 | 按段落插入；多行保留换行为段落 |
| Markdown 文本（启发式：含 `#`、`-`、```` ``` ````、`[x](y)` 等 ≥ 2 种标记） | 用 §8 的 Markdown parser **一次性**转 ProseMirror 片段插入；不保留原文 |
| HTML（Word、网页、其他编辑器） | `transformPastedHTML` 经 schema 过滤：剥字体、颜色、字号、`style`、`class`；表格保留结构；图片 `src` 为 http(s) 时按 §11.4 转存为附件，`data:` 图片同样转存 |
| 图片文件 / 剪贴板位图 | §11.4 上传流程，光标处插入占位 |
| 非图片文件 | 上传为 `attachment` 节点 |
| 单个 URL，有选区 | 选区加 `link` |
| 单个 URL，空行 | `xz://entry/<id>` 或简斋域名 → `entryLink`（`mode: title`）；其他 URL → 纯 `link` 段落（不抓取网页元数据，SSRF 面见 07） |
| 来自本编辑器的复制 | 走 ProseMirror 原生 slice，节点属性完整保留 |

> 注 2026-09-24（T1-016 实现口径）：
> - 外域与 `data:` 图片在一期**不转存**，粘贴时 Toast 提示「外部图片未导入」，由 schema 丢弃。原因：服务端代抓取有 SSRF 面，浏览器抓取受 CORS 限制；转存留待二期导入（07 §2.5）一并实现。
> - 净化只保留 `class="language-*"`（代码块语言）；本编辑器复制出的片段（`data-pm-slice`）原样保留。
> - 单个 URL 转 `entryLink`（`xz://entry/<id>`）随 REQ-EDITOR-011。

### 11.4 图片上传流程

拖入 / 粘贴 / 斜杠三种入口同一流程：

1. 客户端校验 mime 与大小（02 §7 上限），失败 Toast 不插入。
2. 立即插入 `image` 节点，`src` 为本地 `blob:` URL，节点带 `uploading: true` 属性显示进度环（属性不落库）。
3. `POST /attachments`（`targetType: 'entry', targetId`，上传即带归属，02 §7）；并发 ≤ 3，超出排队。
4. 成功（响应**同步**含 `width / height / blurhash / variants`，服务端在请求内完成 sharp 处理）：替换 `src` 为 `xz:attachment/<id>`，写入 `width/height/blurhash`；无需再轮询或等通知。
5. 失败：节点保留占位与「重试 / 删除」按钮；离线时排队，恢复后自动重试；页面关闭前有未完成上传则 `beforeunload` 提示。
6. 协同：`uploading` 状态只在本地 awareness 中，远端用户看到 blurhash 占位。

> 注 2026-09-24（T1-016 实现口径）：占位用本地 Decoration（不落库，远端不可见），不插入 `blob:` 图片节点；失败时移除占位并 Toast，一期不做「重试 / 删除」按钮和离线队列（REQ-EDITOR-004 的验收不涉及）。软限 10MB 按 `Y.encodeStateAsUpdate` 大小判断；e2e 在验证实例里通过 `window.__GI_DOC_SOFT_LIMIT__` 调低阈值（仅 `import.meta.env.DEV` 生效）。

### 11.5 文档大小上限

| 项 | 上限 | 超限行为 |
|---|---|---|
| `ydoc` 二进制 | 软限 10 MB：顶栏提示「文档过大，建议拆分」并拒绝再插入附件节点；硬限 20 MB：collab 拒绝 update 并回 awareness `docTooLarge`，编辑器转只读 | 与 07 §5 一致 |
| 单条 Yjs update | 2 MB | 断开连接并记日志（07 §2.3） |
| 单篇图片数 | 200 张 | 插入第 201 张时 Toast 拒绝 |
| 单次粘贴 | 2 MB 文本 | 截断并提示 |

### 11.6 移动端工具条（04 §6）

固定底部，随键盘上移，`glass` 材质（06 §4 底部导航同款）。按钮从左到右：撤销 · 重做 · 加粗 · 斜体 · 标题（弹出 1–4）· 列表（弹出三种）· 任务项 · 引用 · 代码块 · 链接 · 图片 · 提及 · 更多（斜杠菜单）· 收起键盘。横向可滚动，当前块类型对应按钮高亮。

---

## 12. 从简斋带来的已知陷阱（必读）

| 陷阱 | 处理 |
|---|---|
| `useEditor` 1ms `scheduleDestroy` 竞速致首次点编辑 `null.commands` | 所有 effect 守卫 `editor?.isDestroyed`；不在 StrictMode 外复现也要守 |
| Vite 缓存 desync 致 `@codemirror/state` / prosemirror 多实例 | `resolve.dedupe` + `optimizeDeps.include`；验证实例用独立 `cacheDir` |
| IME composition 期间 inputRule 抢字 | 自定义 inputRule 一律检查 `view.composing`；Playwright 覆盖 |
| Tiptap v3 Link 协议白名单剥掉自定义协议 | `Link.configure({ protocols: ['xz'] })` |
| v3 组件读 editor 态须 `useEditorState`，否则不更新或整树重渲染 | 统一 hook `useEditorSelector` |
| Mermaid `note` 内列表折行整图不渲染（上游 bug） | 渲染前插 U+2060（沿用简斋 `neutralizeNoteListMarkers`） |
| Markdown 作真源的往返腐蚀 | 本文 §1.2 已从架构上排除 |
