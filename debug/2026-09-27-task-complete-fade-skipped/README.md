# 任务勾选完成后行直接消失，「变灰 → 400ms 后折叠」动画被跳过

- 日期：2026-09-27
- 影响范围：client
- 严重度：low（交互细节；e2e REQ-TASK-021 因此时好时坏）
- 相关：REQ-TASK-021、`src/client/components/domain/TaskList.tsx`

## 症状

e2e `REQ-TASK-021` 不稳定（main 上 3 次挂 2 次）：`toHaveClass(/line-through/)` 一直等不到标题按钮，10s 超时。实际使用中，勾选完成的任务往往一闪就没了，看不到设计里的「变灰 + 删除线 → 400ms 后折叠移出」。

## 复现

埋点用例（MutationObserver 记录行是否在 DOM、标题是否带 `line-through`，同时记录网络请求），对 3011 连跑 5 次：

```
点击后 ~70ms   row=true  line-through=true    （乐观更新 + completing）
点击后 ~5ms    GET /tasks?spaceId=…&status=inbox,todo,doing,blocked   （列表重取）
点击后 ~110ms  row=false                      （重取结果不含 done → 行被移出）
```

断言只有在那约 50ms 的窗口里做第一次检查才能通过。

## 根因

列表视图的查询按状态过滤、不含 `done`。勾选后列表会被重取（完成请求返回、SSE 失效），服务端快时几十毫秒就回来，新数据里已没有这条任务，`visible` 随之去掉它——远早于 `FADE_MS`（400ms）+ 折叠（200ms）。原实现只靠 `hidden` 在 600ms 后隐藏行，默认行在这期间一直在数据里，这个假设在服务端快时不成立。

## 修复

`TaskList` 增加 `leaving`：勾选时记下任务快照（存为已完成态）与所在位置；计算 `visible` 时，若数据里已没有它，就按原位置插回，直到折叠结束（加入 `hidden` 时移除）；请求失败时同样移除。快照必须存已完成态：请求返回后 `completing` 会清掉，存原状态的话删除线会在 ~120ms 时消失。

## 验证

- 同一埋点：删除线 ~63ms 出现并保持，~460ms 开始折叠，~660ms 行移出。
- `REQ-TASK-021` 连跑 10 次全过（修前 3 次挂 2 次）；`tasks.spec` / `mobile.spec`（desktop + mobile 项目）全过。
