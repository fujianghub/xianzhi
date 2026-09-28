# 历史面板显示旧快照列表（文档栏同 key 预取 + 全局 staleTime）

## 症状

记录页打开后，在别处（另一标签页 / 协作者 / API / 自动留版）产生的新版本，30 秒内打开右侧「历史」看不到，仍显示「还没有历史版本」。e2e REQ-COLLAB-008 稳定失败：`waiting for getByTestId('history-item').filter({ hasText: '第一版' })` 超时。此前一直被当作「两套验证实例共用 xz_e2e」的环境问题，单实例下也 100% 复现。

## 复现

1. 打开任一记录 `/entries/:id`（文档栏立即请求 `GET /entries/:id/snapshots`，得到空列表）
2. 30 秒内经 API `POST /entries/:id/snapshots {label}` 打标记
3. 点右侧「历史」→ 列表为空

## 根因

ADR-0029 文档栏（`EditorToolbar.tsx` DocBar「上次保存」）与历史面板（`EntryAside.tsx` History）共用 query key `['entry', id, 'snapshots']`；`main.tsx` 全局 `staleTime: 30_000`。历史面板挂载时数据仍算新鲜，不重新请求，直接渲染文档栏预取的旧列表。ADR-0029 之前没有别的组件预取这个 key，所以打开历史总是首次请求。

## 修复

History 的 `useQuery` 加 `refetchOnMount: 'always'`：打开历史面板总拿最新列表；文档栏保留缓存（「上次保存」由本页保存版本 / 打标记的 invalidate 刷新）。

## 验证

`pnpm exec playwright test e2e/editor.spec.ts -g REQ-COLLAB-008 --project=setup --project=desktop` 单实例：修复前 60s 超时，修复后 12.3s 通过。
