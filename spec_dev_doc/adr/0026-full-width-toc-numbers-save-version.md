# ADR-0026 版心默认满栏 · 目录自动编号 · Ctrl+S 保存版本

> 状态：已采纳 · 2026-09-28 · 修订 ADR-0024 §2 版心默认值、03 §5（手动保存版本 / 打标记）与 §11.2（Mod+S）；补充 08 §2.9、07 §3。参考简斋 TocPanel（目录编号默认开）与编辑器「保存」。

## 背景

用户反馈：① 版心应默认满栏；满栏时工具栏的「对齐」等按钮被遮住大半。② 右侧目录需要像简斋一样自动编号。③ 需要 Ctrl+S 保存，以「年月日-时分秒」生成版本，可回退、可打标记。

排查 ①：1280 / 1440 宽时侧栏 240 + Aside 320 + 右侧阅读胶囊占位后，工具栏编辑组只剩 254 / 414px，而 `overflow-x:auto` + 隐藏滚动条把颜色 / 列表 / 对齐 / 链接裁掉（scrollWidth 727px）。

## 决定

1. **版心默认满栏**（REQ-READ-002 注）：`DEFAULT_READING.width = 'full'`（ADR-0024「默认 = 改版前外观」对版心作废）；只影响没改过版心的人（库里只存改过的键）。`?wide=1` 改为强制满栏（原 1080 已窄于默认）。极宽屏行长偏长，可在「排版」里选窄 / 标准 / 宽。
2. **工具栏不遮挡**（REQ-EDITOR-032）：`.xz-editor-toolbar` 与编辑组 `flex-wrap: wrap`，放不下时换行，不再横向裁切；「Markdown」文字只在 2xl 以上显示。
3. **目录自动编号**（REQ-READ-008）：新偏好 `tocNumbers`（默认 **开**，与正文章节编号 `headingNumbers` 分开；目录格式弹层可关）。右侧目录与目录块显示跳级压缩编号；按编号层级缩进 + 层级引导线；**当前标题高亮**（滚动 rAF 节流：顶栏 + 吸顶工具栏下沿以上的最后一个标题；滚到页底取最后一个；折叠块里隐藏的标题跳过），高亮项自动滚进 Aside 可视区。编辑器 `scrollMargin / scrollThreshold` 让跳转目标不被工具栏遮住。
4. **Ctrl+S 保存版本**（REQ-COLLAB-017）：
   - 记录页捕获阶段拦截 `Mod+S`（阻止浏览器另存为，先于编辑器 GiKeymap；对话框打开时不处理）；工具栏右侧「保存版本」按钮。
   - 客户端只在 provider **已连接且已同步**时，经 Hocuspocus **stateless 消息**（同一 WebSocket，之前的编辑按序先到）发 `{t:'save-version', id}`，按 id 等回执，10s 超时。重连中不发（离线编辑要等 SyncStep2 才到服务端）。
   - collab `onStateless`：整体 try/catch 只回执不抛（Hocuspocus 不 await 该钩子，抛错会使进程退出）；体积 ≤ 1KB + Zod 严格校验 → 只读连接拒绝 → 重跑 `can('entry.write')` → 同一用户同一记录 5s 节流 → 与**上一个手动 / 带标记快照**完全相同（`Y.equalSnapshots`，状态向量 + 删除集，只删字也算改动）回 `unchanged` → 否则在 `document.saveMutex` 内落库，并在**同一事务、同一份字节**里插入快照（`created_by` = 操作者，`label` 为空；该次跳过自动快照）。
   - **版本名不入库**：由快照 `createdAt` 按查看者本地时间格式化为 `YYYYMMDD-HHmmss`（年月日-时分秒），避免把某个客户端的时区写死进数据。
   - 手动保存的版本**永久保留**（gc 条件加 `created_by is null`；自动快照 `created_by` 为空）。
5. **回退**：沿用历史面板预览 / 对比 / 恢复（REQ-COLLAB-008，恢复前自动存一版）。
6. **打标记**（REQ-COLLAB-018）：复用既有「标记版本」（`entry_snapshots.label`，术语表），`PATCH /entries/:id/snapshots/:sid { label: string(1–80) | null }`，需 `entry.write`；快照无 `updated_at`、按值覆盖幂等，**不要求 ifUpdatedAt**（02 §4 例外，同 `/me/preferences`）。历史面板每项「打标记 / 改标记 / 清除」；带标记显示标记名、时间戳作副标题。

## 候选与否决

- **标签里写时间戳 + 另加 `tag` 列**：与术语表「标记版本 = label」冲突出两个「标记」；且 label 非空即永久保留。改为版本名只显示、打标记复用 label。
- **服务端 `POST /snapshots` 取已落库 ydoc**：落库节流 ≤ 10s，刚打的字会漏；stateless 走同一连接保证顺序。
- **在防抖落库之外直接调 storeDocument**：绕过 saveMutex，两个事务并发 `ydocVersion + 1`，旧编码可能后提交；改为 saveMutex 内执行。
- **横向滚动的工具栏（简斋做法）**：用户明确反馈被遮挡；改为换行。

## 后果

- 00：REQ-READ-002 注；+REQ-READ-008、REQ-EDITOR-032、REQ-COLLAB-017 · 018。02 §9 +`PATCH /entries/:id/snapshots/:sid`。03 §5 · §11.2 注。07 §3 手动保存版本永久。08 §2.9 注。glossary +保存版本。
- 代码：`shared/schemas/versions.ts`、`collab/server.ts`（`saveVersion` / `onStateless`、`storeDocument` 可选同事务快照）、`collab/snapshots.ts`（`latestManualSnapshot`、gc 条件）、`services/snapshots.ts`（`labelSnapshot`）、`EntryEditor`（Mod+S、回执）、`EditorToolbar`（保存按钮、换行）、`EntryAside`（目录编号 / 当前标题、历史项打标记）、`preferences.ts`（`width` 默认 full、`tocNumbers`）。
- 测试：`collab.test.ts` REQ-COLLAB-017、`snapshots.test.ts` REQ-COLLAB-018、e2e `versions.spec.ts`、`reading-prefs.spec.ts`（默认满栏）。
