# 任务描述插图：失焦保存回来后图片丢失、不再保存

## 症状

`e2e/tasks-page.spec.ts` REQ-TASK-025 ~ 028：在任务详情描述里输入文字，再点「插图片」。编辑器里先出现了图（上传占位里的 blob 预览），但服务端 `descriptionPm` 只有文字，图片最终也没有落进正文。网络里只有一次 PATCH（失焦保存文字），附件 POST 返回 201。

## 复现

验证实例上单独跑这条用例，稳定失败（2026-10-02，ADR-0046 那轮全量回归时发现）。

## 根因

`LiteEditor` 的 `useEffect([editor, value])` 在编辑器失焦时用 `value` 整篇 `setContent`：

1. 点「插图片」时编辑器失焦，触发保存，发出 PATCH。
2. PATCH 返回后任务缓存更新，`value` 变成服务端版本。服务端存的是 jsonb，键序和本地不同，所以字符串比较不相等，引用也已经换了，effect 照常执行 `setContent`。
3. 整篇替换让上传占位（装饰）跟着消失。上传完成时 `phPos` 返回 null，函数直接 return：不插入图片，也不调用 `onInserted`，于是不会发出第二次保存。

谁先完成取决于 PATCH 和上传的先后，属于时序竞态。

## 修复

1. 在 `LiteEditor` 里，只有当前文档和 `value` 实际不同（忽略键序比较）时才 `setContent`。服务端回来的内容与本地一致时不再替换，上传占位能保留下来。
2. 修完 1 后，第二次保存能发出了，但会撞 409：它在第一次 PATCH 返回前发出，带的还是旧的 `ifUpdatedAt`。`TaskDetailSheet` 的 `save` 因此改成排队执行，每次等上一次结束，再从 `['task', id]` 缓存里取最新的 `updatedAt`。

## 验证

单独重跑 tasks / tasks-page / tasks-manage 三组共 19 项通过，随后全量 e2e 回归。
