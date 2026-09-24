# 服务端邮件模板 React is not defined（仅 tsx 运行时出现，vitest 不出现）

- 日期：2026-09-24
- 影响范围：server（邮件）
- 严重度：high（dev 下创建邀请 500）
- 相关：T0-010

## 症状
`POST /api/v1/workspace/invitations` 在 `pnpm dev` / `dev:verify` 下 500：`ReferenceError: React is not defined at WorkspaceInvitationEmail`。单测全绿。

## 复现
不带根 `tsconfig.json` 时用 `tsx src/server/index.ts` 启动，创建邀请。

## 根因
`tsx` 只读取根目录 `tsconfig.json` 的 `jsx`；此前根目录没有该文件（改用逐项目 `tsc -p`），tsx 回落为经典运行时 `React.createElement`。vitest 走 Vite 默认的自动运行时，所以测试没暴露。

## 修复
模板文件头加 `/** @jsxRuntime automatic @jsxImportSource react */`；补根 `tsconfig.json`（`extends ./tsconfig.server.json`）供 tsx 与编辑器读取。

## 验证
dev:verify 下创建邀请 201；e2e REQ-AUTH-003 · REQ-NOTIF-009 绿。
