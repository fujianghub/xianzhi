# ADR-0062 生产部署改为独立服务器、自带 Caddy

> 状态：已采纳 · 2026-10-15 · 取代 ADR-0001 §8 决定 5（与简斋同机、复用 Caddy）与 05 §7 的同机部分；Compose 三服务、镜像、迁移、健康检查、备份流程不变。无迁移。

## 背景

2026-10-15 用户提供衔枝**独立**的腾讯云服务器（62.234.70.53，Rocky Linux 10.2，2 核 / 1.9 GiB，40 GB），域名 `www.xianzhi.host`；简斋在另一台生产机上。05 §7 原方案假定与简斋同机、把 `Caddyfile.snippet` 追加进简斋的 Caddy，在新机器上没有可复用的反代与证书。

实测（2026-10-15）：80 公网可达、域名未被备案拦截；443 被腾讯云安全组拦截（需在控制台放行）；服务器拉 Docker Hub 不可靠；裸域 `xianzhi.host` 无 A 记录。

## 候选方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 宿主机装 Caddy（dnf / 二进制） | 不占 Compose | Rocky 10 无官方包，升级、配置与仓库脱节 |
| B. Compose 叠加 Caddy 容器（host 网络） | 配置进仓库；与 snippet 同口径反代 127.0.0.1:18010/18011；证书存卷 | 多一个叠加文件 |
| C. Nginx + certbot | 常见 | 需另写续期；与现有 Caddy 片段 / infra e2e 不一致 |

## 决定

1. **方案 B**：`infra/docker-compose.caddy.yml` 叠加在 `docker-compose.prod.yml` 之上，`xz-caddy`（`caddy:2-alpine`，`network_mode: host`）占宿主 80/443；配置 `infra/Caddyfile`，站点名取 `.env.prod` 的 `XZ_DOMAIN`，路由与 `Caddyfile.snippet` 一致（改一处须同步另一处）；HSTS / CSP 仍由 xz-app `secureHeaders` 下发，Caddy 不重复加。证书由 Caddy 自动向 Let's Encrypt 申请（HTTP-01）与续期，存卷 `xz_caddy_data`。
2. **只签 `XZ_DOMAIN` 一个域名**：裸域加 A 记录后再在 Caddyfile 追加跳转块，避免 ACME 对无解析域名反复失败。
3. **镜像全部本机构建 / 导出后传输**：`xianzhi:<tag>` 由 `infra/deploy.sh` 构建并 rsync；`pgvector/pgvector:pg16`、`caddy:2-alpine` 首次部署时 `docker save` 传过去。服务器 2 GiB 内存不做构建；加 2 GiB swap。
4. **`deploy.sh` 参数化**：`XZ_COMPOSE_EXTRA="-f infra/docker-compose.caddy.yml"` 叠加 Caddy；`XZ_SSH` 指定 ssh 命令（rsync `-e` 同用）；去掉与镜像内重复的本地 `pnpm build`；健康检查改用 `curl`（宿主无 wget）。
5. **密钥**：`/srv/xianzhi/.env.prod`（600）只在服务器；age 私钥离站保存，不上服务器；生产 secret 独立生成，不复用开发环境。
6. **首次数据**：开发库 `xz` 一次性 `pg_dump -Fc` 恢复到生产，`DATA_DIR` 的 `uploads/`、`skins/` 拷入 `xz_data` 卷；之后两边独立演进，不做持续同步。开发期会话（`session`）与一次性令牌（`verification`）恢复后清空。

## 后果

- 发布：`XZ_HOST=root@<ip> XZ_DIR=/srv/xianzhi XZ_COMPOSE_EXTRA="-f infra/docker-compose.caddy.yml" infra/deploy.sh`。
- 安全组需放行 TCP 80 / 443；PG、18010 / 18011 不对外。
- `.host` 域名未做 ICP 备案，腾讯云境内机器后续可能被拦截，届时需备案或换境外机。
- 未配置 SMTP：魔法链接、邮件通知不可用，邮箱 / 用户名 + 密码登录不受影响。
- 顺带修正 `infra/backup.sh` 卷名遗留（`xianzhi_gi_data` → `xianzhi_xz_data`，品牌更名漏改）。

## 参考

- 05 §7 / §8；ADR-0001 §8；`infra/Caddyfile.snippet`；`e2e/infra.spec.ts`
