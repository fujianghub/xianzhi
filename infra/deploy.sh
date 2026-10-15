#!/usr/bin/env bash
# 发布（05 §7）：本地构建镜像 → rsync 仓库与镜像 tar → 服务器 compose up → 健康检查 → 记录到 debug/deploys.md。
# 用法：XZ_HOST=user@server XZ_DIR=/srv/xianzhi infra/deploy.sh [tag]
#   独立服务器（自带 Caddy，ADR-0062）：XZ_COMPOSE_EXTRA="-f infra/docker-compose.caddy.yml"
#   自定义 ssh（如密码登录的复用连接）：XZ_SSH=/path/to/ssh-wrapper（rsync -e 同用）
# 注意：会连接远程服务器并替换运行中的容器，执行前确认 .env.prod 已在服务器上。
set -euo pipefail
TAG=${1:-$(date +%Y%m%d-%H%M%S)}
: "${XZ_HOST:?需要 XZ_HOST=user@server}"
: "${XZ_DIR:?需要 XZ_DIR=/srv/xianzhi}"
SSH=${XZ_SSH:-ssh}
EXTRA=${XZ_COMPOSE_EXTRA:-}
IMAGE=xianzhi:$TAG
TAR="${TMPDIR:-/tmp}/xz-$TAG.tar.gz"

# 镜像内已跑 pnpm build（含预算检查），本地不再重复
docker build -f infra/Dockerfile -t "$IMAGE" -t xianzhi:latest .
docker save "$IMAGE" | gzip > "$TAR"
rsync -az --delete -e "$SSH" --exclude .env.prod --exclude data/ --exclude .git --exclude node_modules --exclude .claude ./ "$XZ_HOST:$XZ_DIR/"
rsync -az -e "$SSH" "$TAR" "$XZ_HOST:/tmp/"
$SSH "$XZ_HOST" "set -e; gunzip -c /tmp/xz-$TAG.tar.gz | docker load; rm -f /tmp/xz-$TAG.tar.gz; cd $XZ_DIR; XZ_IMAGE=$IMAGE XZ_ENV_FILE=$XZ_DIR/.env.prod docker compose -f infra/docker-compose.prod.yml $EXTRA --env-file $XZ_DIR/.env.prod up -d"
rm -f "$TAR"
# 迁移失败时 xz-app 新容器会退出（REQ-OPS-002），compose 不会把 collab 切过去
for i in $(seq 1 30); do
  if $SSH "$XZ_HOST" "curl -fsS http://127.0.0.1:18010/api/health && curl -fsS http://127.0.0.1:18011/collab/health" >/dev/null 2>&1; then
    echo "$(date -Iseconds) · $IMAGE · migrations=$(ls drizzle/*.sql | wc -l)" >> debug/deploys.md
    echo "deploy ok: $IMAGE"
    exit 0
  fi
  sleep 3
done
echo "健康检查未通过，请检查 xz-app 日志（docker compose logs xz-app）" >&2
exit 1
