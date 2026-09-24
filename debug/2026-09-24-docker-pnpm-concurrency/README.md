# 镜像内 pnpm install 大量 tarball 下载失败（error 23）

- 日期：2026-09-24
- 影响范围：infra（生产镜像构建）
- 严重度：high（镜像构建不出来）
- 相关：T0-028

## 症状
`docker build -f infra/Dockerfile` 在 `pnpm install --frozen-lockfile` 阶段反复 `GET https://registry.npmmirror.com/... error (23). Will retry`，最终退出码 1。宿主机同一命令正常。

## 复现
在 `node:24-alpine` 容器里对完整 lockfile 执行 `pnpm install`（默认网络并发）。

## 根因
不是 MTU（宿主 / docker0 均为 1500，`--network host` 同样失败），也不是磁盘。容器内 `wget` 单个 tarball 正常，`pnpm add … --network-concurrency=4` 正常：npmmirror 对容器内高并发下载大量中断。

## 修复
`infra/Dockerfile` 两处安装改为 `--network-concurrency=4 --fetch-retries=5`，并用 BuildKit 缓存挂载 pnpm store（`id=gi-pnpm-store`）让重复构建基本不再联网。

## 验证
`docker build --network host -f infra/Dockerfile -t growing-interlude:local .` 成功（见 T0-028 进度记录）。
