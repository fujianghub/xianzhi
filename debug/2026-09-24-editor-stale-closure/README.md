# 粘贴图片上传成功但节点没插入：扩展闭包拿到已销毁的编辑器

- 日期：2026-09-24
- 影响范围：client（`EntryEditor.tsx` 传给 fullKit 的回调）
- 严重度：medium（粘贴 / 拖入图片静默失败：附件已上传，正文里却没有）
- 相关：REQ-EDITOR-004 · `e2e/editor.spec.ts` · 03 §12「useEditor 竞速」

## 症状
e2e 粘贴 PNG：`POST /attachments` 返回 201，但编辑器里既没有占位也没有图片，`/md` 请求一直不出现；控制台无报错。

## 复现
打开记录，等 StatusPill 变为 synced 后粘贴图片文件。

## 根因
`useEditor(options, [provider, ydoc])`：provider 在 effect 里创建，所以编辑器实际会被创建两次（先无 provider，再有 provider）。`onFiles` 回调写成 `(files, at) => editor && uploadFiles(editor, …)`，引用的是**创建这组扩展时那次渲染**的 `editor` 变量，也就是重建前的旧实例。粘贴由新编辑器的插件处理，上传却在旧编辑器（已销毁）上 dispatch 占位与插入，全部成了空操作。

## 修复
用 `editorRef.current = editor` 在每次渲染时同步当前实例，回调里取 ref，并判断 `isDestroyed`。斜杠菜单本来就经 `ctxRef` 取上下文，而且 Suggestion 回调会带上当前 editor，所以没有中招。
约定：传进扩展的回调一律经 ref 取编辑器或上下文，不直接闭包 `editor`。

## 验证
`e2e/editor.spec.ts`「REQ-EDITOR-004 粘贴 PNG」绿：201 → 节点 `data-src` 为 `gi:attachment/…` → 请求 `/md` → 服务端 pm_json 含 `gi:attachment/`。
