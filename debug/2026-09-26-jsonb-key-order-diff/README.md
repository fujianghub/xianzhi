# 历史对比把未改动的段落标成「删除 + 新增」：jsonb 重排了键序

- 日期：2026-09-26
- 影响范围：client / collab（历史版本对比）
- 严重度：medium
- 相关：REQ-COLLAB-008、`src/shared/editor/diff.ts`

## 症状
历史预览点「对比当前」，没改过的段落「第一版正文」同时出现红色删除线与绿色新增（e2e `REQ-COLLAB-008` strict mode 命中 2 个 `[data-diff="del"]`）。

## 复现
快照侧：`yXmlFragmentToProsemirrorJSON` → `{"type":"text","text":"…"}`；
当前侧：`entries.pm_json`（jsonb）读回 → `{"text":"…","type":"text"}`。`JSON.stringify` 不相等。

## 根因
PostgreSQL jsonb 不保留对象键序（按键长、再按字节序存储）。对比用 `JSON.stringify(node)` 作块相等键，两侧来源不同即失配。

## 修复
`keyOf()` 改为键排序后的规范化序列化；collab 恢复与前端对比共用同一函数，保证「预览所见 = 恢复所得」。

## 验证
`src/collab/__tests__/history.test.ts`「diffBlocks」用例以 jsonb 键序构造当前侧；e2e `REQ-COLLAB-008` 通过。
凡是拿 jsonb 读回的 PM JSON 与内存 JSON 比较的地方都要用 `keyOf`。
