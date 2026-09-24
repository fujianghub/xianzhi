# y-tiptap 遇到 schema 不认识的节点会直接删除 Y 元素

- 日期：2026-09-24
- 影响范围：client（记录正文编辑器）、数据完整性
- 严重度：high（新旧客户端混跑或导入未知节点时，旧客户端一打开就把节点从 Y 文档里永久删除）
- 相关：REQ-EDITOR-016 · 03 §3.3 · `src/client/editor/extensions.ts`（`guardUnknownNodes`）· `src/client/__tests__/editor-kit.test.ts`

## 症状
设计 `unknownBlock` 时原计划「在编辑器绑定前把未知元素换成占位」。读源码发现来不及：y-tiptap（`@tiptap/y-tiptap` 3.0.9，y-prosemirror 1.3.7 同理）的 `createNodeFromYElement` 在 `schema.node()` 抛错时，会在 `catch` 里 `el._item.delete(transaction)`，注释写的是「可能是并发操作导致」。远端同步过来的未知节点会在观察者回调里被删，其他任何钩子都拦不住。

## 复现
Y 文档 `default` 片段里放一个 `Y.XmlElement('future')`，用不含 `future` 的 schema 调 `yXmlFragmentToProseMirrorRootNode(frag, schema)`，结果节点消失，`frag.length` 减 1。

## 根因
y-prosemirror 把「schema 建不出节点」统一视为并发产生的非法结构并删除，没有保留未知节点的扩展点。

## 修复
`UnknownGuard` 扩展在 `onBeforeCreate`（此时 schema 已建好，协同插件尚未绑定）包装 `schema.node`：类型名不在 schema 里时，改建 `unknownBlock{ raw }`，其中 raw 是原节点的 JSON（类型、属性、子节点）。y-tiptap 拿到的是合法节点，不再删除；之后编辑到附近时，y-tiptap 会发现节点名不同，把 Y 元素替换为带 raw 的 `unknownBlock`；服务端派生 pm_json 时 `unwrapUnknownPm` 再还原成原节点，导出、搜索、升级后的客户端都能拿到原 JSON。
遗留：新版客户端（认识该节点）打开被旧客户端改写过的文档，看到的仍是占位块，需要时在迁移里把 `unknownBlock` 还原为真实节点（03 §3.3 migrations）。

## 验证
`editor-kit.test.ts`「REQ-EDITOR-016 未知节点保留原 JSON」：future 节点解析为 unknownBlock、raw 含原属性，`frag.length` 仍为 2 且 Y 元素名仍是 `future`。`editor-shared.test.ts` 覆盖 pm_json 层 wrap / unwrap 往返。
