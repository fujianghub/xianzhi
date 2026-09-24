# pnpm 11 把「被忽略的构建脚本」当错误，所有 `pnpm run` 都失败

- 日期：2026-09-23
- 影响范围：infra（工程脚手架）
- 严重度：medium
- 相关：T0-002 · T0-003

## 症状
`pnpm run db:up` 等任何脚本报 `ERR_PNPM_IGNORED_BUILDS Ignored build scripts: esbuild@…`，随后 `Command failed with exit code 1: … pnpm install`；容器根本没起。

## 复现
pnpm 11.1.2，`package.json` 含 `tsx`（依赖 esbuild），不写任何构建批准配置，执行 `pnpm i && pnpm run <任意脚本>`。

## 根因
pnpm 11 在每次 `pnpm run` 前做 `verify-deps-before-run`，而未批准的 postinstall 脚本被视为依赖状态不一致。pnpm 10 的 `pnpm.onlyBuiltDependencies`（package.json）在 11 中不再识别；新键是 `allowBuilds`，且要写在 `pnpm-workspace.yaml`（单包项目也用它做配置文件）。另外 `npx` 会对 `.npmrc` 的 `minimum-release-age` 报 unknown config（那是 pnpm 键），用 `pnpm dlx` / `pnpm exec` 代替。

## 修复
`pnpm-workspace.yaml`：
```yaml
allowBuilds:
  esbuild: true
```
不批准 `better-sqlite3` / `@prisma/client`（它们来自旧版 `@better-auth/cli`，已从 devDependencies 移除，改 `pnpm dlx` 按需运行）。

## 验证
`pnpm i` 输出 `esbuild postinstall: Done`；`pnpm run db:up` 退出码 0。回归风险：升级 pnpm 大版本时再查一次配置键名。
