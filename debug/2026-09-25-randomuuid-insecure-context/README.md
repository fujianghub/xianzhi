# 按局域网 IP 访问时「记录 / 任务」无法创建：crypto.randomUUID 不存在

- 日期：2026-09-25
- 影响范围：client
- 严重度：high
- 相关：REQ-UI-036

## 症状
按 `http://172.16.12.51:3010` 打开，新建记录点「创建」只弹「保存失败」，无网络请求；新建任务、日程、标签、评论、上传附件同样失败。
验证实例日志 `debug/perf/verify-3011.log` 可见 `TypeError: crypto.randomUUID is not a function`。
服务端 `idempotency_keys` 为 0 行——创建请求从未到达。

## 复现
1. `APP_URL=http://<局域网 IP>:3010 pnpm dev`，从另一台机器用该 IP 打开。
2. 按 `e` 新建记录 → 提交 → 「保存失败」。
e2e 等价：`page.addInitScript` 把 `Crypto.prototype.randomUUID` 置空后新建（`e2e/entries.spec.ts` REQ-UI-036）。

## 根因
`crypto.randomUUID()` 只在安全上下文（HTTPS、`localhost`、`127.0.0.1`）暴露；HTTP + 非回环地址下为 `undefined`。
客户端 10 处用它生成 `Idempotency-Key` / 客户端 id（如 `src/client/hooks/useEntries.ts` 的 `create`），调用在 `fetch` 前抛出；
`NewEntryDialog` 的 catch 对非 `ApiError` 只 toast，不留痕。测试与 e2e 都跑在 localhost，故一直绿。
同类：`navigator.clipboard` 也只在安全上下文存在（API Key 复制按钮静默失效）。

## 修复
- `src/client/lib/uuid.ts` `newId()`（`uuid` 包 v4，基于 `getRandomValues`，任何上下文可用），替换全部调用点。
- `src/client/lib/clipboard.ts` `copyText()`：无 `navigator.clipboard` 时退回 `execCommand('copy')`。
- 新建记录 / 任务对话框：非 `ApiError` 时 `console.error`。
- `scripts/check-css.ts` 增加规则：`src/client` 禁止 `crypto.randomUUID`。
不选「局域网也上 HTTPS」作修复：那是部署层改进，passkey / WebPush 仍需要，但不应让基础写操作依赖它。

## 验证
- `pnpm lint`（check-css 规则）· `pnpm exec tsc -p tsconfig.client.json --noEmit`
- e2e `REQ-UI-036 非安全上下文…新建记录与任务仍成功`
- 残余：passkey、WebPush、Service Worker 在 HTTP 局域网下仍不可用，属浏览器限制。
