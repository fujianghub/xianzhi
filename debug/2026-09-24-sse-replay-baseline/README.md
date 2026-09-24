# SSE：一帧未收到就断线的客户端，重连时无法补发期间的事件

- 日期：2026-09-24
- 影响范围：server / client
- 严重度：medium（断线期间的通知与列表失效丢失，直到下次手动刷新）
- 相关：REQ-NOTIF-003 · `src/server/lib/sse-hub.ts` · `src/client/hooks/useRealtime.ts` · `e2e/realtime.spec.ts`

## 症状
e2e：页面打开后未收到任何帧即断线，断线期间发生事件，重连后 `window.__gi.realtime.frames` 仍为 0，铃铛不变。

## 复现
打开 `/today` → `window.__gi.realtime.close()` → 另一会话触发通知 → `reconnect()`。

## 根因
补发依赖客户端带 `lastEventId`；它只能从收到的数据帧 `id:` 学到。首连后一帧未收到的客户端没有基线，重连不带 `lastEventId`，服务端按「新连接」处理，不补发。另：`lastEventId > seq`（seq 为进程内计数，API 重启后归零）被当作「已覆盖」，同样静默丢帧。

## 修复
- 首连（无 `lastEventId`）立即发 `hello` 帧，`id` = 当前 seq、`data: null`；前端把它计入 lastEventId。
- `lastEventId > seq` 视为进程重启 → 发 `reset`，前端整体重取。
- 规范 02 §6 补 `hello` / `reset` / `evicted` 三种帧。

## 验证
`stream.test.ts`「REQ-NOTIF-003 首连发 hello 帧…lastEventId > seq → reset」；`e2e/realtime.spec.ts` 第 4 个标签页挤掉第 1 个且被挤页不重连、断线重连补发期间的帧。
