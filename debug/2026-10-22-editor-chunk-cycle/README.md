# 生产环境：任务预览「打开详情」崩溃 `Cannot read properties of undefined (reading 'create')`，编辑也失败

- 日期：2026-10-22
- 影响范围：client 生产构建（`vite build` 分包）；dev 不复现
- 严重度：high（生产上任务详情、任务描述、记录正文编辑器都打不开）
- 相关：`vite.config.ts` `codeSplitting.groups.editor`（`includeDependenciesRecursively: false`，自初始提交 eac1453 起）、`scripts/check-budget.ts`、REQ-UI-015

## 症状

用户：「生产服务器出错：任务预览"详情"打开失败，提示 Something went wrong! … Cannot read properties of undefined (reading 'create')，而且编辑也失败」。`pnpm dev`（3010）一切正常。

## 复现

在 a456af8 上 `pnpm exec vite build`，用 `vite preview` + 验证环境 API 起一套实例（`CLIENT_PORT=3061 API_PORT=8062 COLLAB_PORT=8063 scripts/verify-env.sh concurrently "tsx src/server/index.ts" "tsx src/collab/server.ts" "vite preview"`），打开 `/spaces/<slug>/tasks/<id>`：

```
TypeError: Cannot read properties of undefined (reading 'create')
    at assets/upload-*.js:1:7264        ← src/client/editor/nodes.ts 的 Node.create({ name: 'entryLink' … })
```

记录页同样：编辑器不渲染（`.ProseMirror` 数量 0）。

## 根因

`editor` 分组只收正则匹配的模块（`includeDependenciesRecursively: false`，为了不把 react 吸进编辑器包）。组内包的第三方依赖若没列进正则，就留给 Rolldown 按引用关系分配：

- `fast-equals`（`@tiptap/react` 的 `useEditorState` 用）被分进业务 chunk `upload-*.js`（`editor/nodes.ts` · `upload.ts` · `floating.ts` …）；
- `@lifeomic/attempt`（`@hocuspocus/provider` 用）被分进 `EntryEditor-*.js`。

于是 `editor → upload → editor`、`editor → EntryEditor → … → editor` 形成 chunk 静态导入环（manifest 里 5 条）。ESM 环的求值顺序由谁先被加载决定：先加载 editor 时，它先去求值 `upload`，此刻 editor 自己的导出（`@tiptap/core` 的 `Node`）还没初始化，`upload` 顶层的 `Node.create(...)` 读到 undefined。dev 不分包，所以只在生产出现。

## 修复

1. `vite.config.ts`：`editor` 分组正则补上 `fast-equals`、`@lifeomic/attempt`，环消失（编辑器 chunk 298 KB gzip，首屏 244.8 KB 不变）。
2. `scripts/check-budget.ts`（`pnpm build` 的一步）：沿 manifest `imports` 做 DFS，发现 chunk 静态导入环即失败并打印环路径——以后组内包新增依赖再漏列，构建直接拦下。对旧产物验证能报出全部 5 条环。
3. 顺带：修复后记录页出现一次 React #520（并发渲染出错后同步重渲染恢复），原因是编辑器重建时 `LinkBubble` 拿着已销毁的旧实例读 `editor.schema.nodes`（Tiptap `destroy()` 后 `schema = null`）；改为 `editor.schema?.nodes`，选择器跳过 `isDestroyed`。

## 验证

- 生产构建 + 3061 实例：任务详情正常打开、描述编辑失焦后落库；记录页编辑器渲染、无 pageerror。
- `XZ_E2E_BASE=http://localhost:3061` 跑 `skins` · `tasks-groups` · `task-detail` 三个 spec 全绿（生产构建）。
- `pnpm exec tsx scripts/check-budget.ts`：修复前报 5 条环，修复后通过。
