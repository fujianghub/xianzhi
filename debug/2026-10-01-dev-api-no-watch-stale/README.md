# 合并后 3010 的 API 没重启：点模板报 Cannot read properties of undefined (reading 'map')

- 日期：2026-10-01
- 影响范围：infra（本机开发实例）· client
- 严重度：medium（设置 · 模板页整页崩溃）
- 相关：ADR-0039 · 0040 合并（115fc04 / fd29a8e）

## 症状

在 3010 上点模板，页面变成错误页：

```
Something went wrong!
Cannot read properties of undefined (reading 'map')
```

3011 与 e2e 都正常。

## 复现

1. 3010 以 `concurrently … "tsx src/server/index.ts" …` 起（API **不带 watch**）。
2. 合并一个同时改了前端与接口返回的分支（这里是 ADR-0039：模板视图新增 `fieldDefs` / `hiddenFields`）。
3. Vite 把前端热更新到新代码，API 进程仍是旧代码。打开「设置 · 模板」即崩。

## 根因

前后端版本不一致：新前端按新契约直接用 `tpl.fieldDefs.map(…)`（如 `routes/_app.settings.templates.tsx` 的模板行、`TemplateForm`），旧 API 返回的模板里没有这个字段 → `undefined.map`。

3010 的 API 进程启动于 9-30 20:10，早于两次合并。合并后汇报里写了「3010 带 watch，已自动加载新代码」，但没有核实——实际它的父进程是 `tsx src/server/index.ts`，不是 `tsx watch`。只有 `pnpm dev` 脚本带 watch；3010 这套是按记忆里的命令手工起的。

## 修复

按原参数（`data/dev.env` + `APP_URL` / `BETTER_AUTH_URL=http://172.16.12.51:3010`、`DATA_DIR=./data/dev`）重启 3010 整组（vite / API / collab），日志 `data/dev.log`。

随后（同日，用户要求「在 3010 启动最新环境」）改为用 `pnpm dev` 起 3010——API / collab 都是 `tsx watch`，之后合并服务端改动会自动重载；CLAUDE.md 命令区与 05 §3 同步写明。

没有在前端给这些字段加 `?? []` 兜底：生产里 app 容器前后端一起发布，不会出现这种错配；兜底只会掩盖真正没重启的问题。

## 验证

- 重启后 API 进程的启动时间晚于合并提交。
- `e2e/templates*.spec.ts`、`e2e/template-fields.spec.ts` 覆盖了点模板行 / 预览 / 编辑 / 用模板新建。
- 教训：合并含服务端改动的分支后，3010 与 3011 的 API **都要重启**；判断有没有 watch 看进程的命令行（`ps -o cmd`），不要凭记忆。
