# 1 万行列表滚动掉帧：虚拟器选项引用不稳定，每次滚动重算全部行尺寸

- 日期：2026-09-24
- 影响范围：client（`src/client/components/domain/TaskList.tsx`）；e2e 测量方法（REQ-UI-017）
- 严重度：high（行数越多越卡；1 万行时每个 scroll 事件约 20ms）
- 相关：REQ-UI-017 · REQ-UI-016 · `e2e/tasks.spec.ts` · T1-006 · T1-035

## 症状
「1 万行列表滚动 rAF 帧间隔 P95 ≤ 20ms」从 G7 起偶发失败，G8 起稳定失败，测得 33.3ms（两个 vsync），P50 仍为 16.7ms。
单独运行有时能过，有时不过，一度被误判为环境噪声。

## 复现
`playwright test e2e/tasks.spec.ts --grep REQ-UI-017`；或在任意 1 万行的列表视图中快速滚动。

## 根因
Chrome trace（devtools.timeline）汇总：滚动 6s 内 `EventDispatch(scroll)` 共 5.5s，全部落在 `@tanstack/react-virtual` 的滚动处理函数上，每次约 20ms。
原因是 `useWindowVirtualizer({ estimateSize: rowH, getItemKey: (i) => … })` 每次渲染都传入新的函数引用。虚拟器依赖它们缓存测量结果，引用一变就重算全部 1 万行的尺寸；而 `rowH` 每次还要读 `getComputedStyle(documentElement)`。于是每个 scroll 事件都要读 1 万次样式。行越多越慢，G7 / G8 增加的其他开销只是让它越过了 vsync。

修复这一项后，主线程在 3s 内总耗时不到 1s，但 P95 仍有波动。第二个因素是：验证机没有 GPU，固定侧栏和顶栏的 `glass`（大半径 backdrop-filter）在滚动时每帧都要用软件光栅重新模糊，发生在合成 / 光栅线程，与列表无关。注入 `*{backdrop-filter:none}` 后 P95 稳定在 16.8ms。

排查中的误判（已撤回）：
- 并发：`workers` 本来就是 1。
- 浏览器进程残留、React 开发模式、机器负载：都做过对照实验，均不成立。其中「dev 与生产包对照」那次生产包测到 16.8ms，只是赶上机器空闲。
- 相关的临时改动都已撤回：第二个 webServer（生产包 preview）、多窗口取最小值。

## 修复
- TaskList：行高只在密度变化时读取一次（`useMemo([density])`），`estimateSize` / `getItemKey` 用 `useCallback` 保持稳定引用。
- TaskRow 改为 `memo`，TaskList 传给行的回调改成稳定引用，滚动时只渲染新进入视口的行。
- REQ-UI-017 测量时关闭 `backdrop-filter`，只测列表本身；毛玻璃代价由 REQ-UI-016（同屏 blur ≤ 6）与 Lighthouse（生产栈 infra e2e）约束。

## 验证
修复后 trace：虚拟器滚动处理 6s 内合计 328ms（原 5.5s）；全量 `pnpm e2e` 绿（见 G8 回归）。
约定：传给 `useVirtualizer / useWindowVirtualizer` 的函数选项一律用 `useCallback`。
