#!/usr/bin/env bash
# 发布（05 §7）：本地构建镜像 → rsync 仓库与镜像 tar → 服务器 compose up → 健康检查 → 记录到 debug/deploys.md。
# 用法：XZ_HOST=user@server XZ_DIR=/srv/xianzhi infra/deploy.sh [tag]
# 注意：会连接远程服务器并替换运行中的容器，执行前确认 .env.prod 已在服务器上。
set -euo pipefail
TAG=${1:-$(date +%Y%m%d-%H%M%S)}
: "${XZ_HOST:?需要 XZ_HOST=user@server}"
: "${XZ_DIR:?需要 XZ_DIR=/srv/xianzhi}"
IMAGE=xianzhi:$TAG

pnpm build
docker build -f infra/Dockerfile -t "$IMAGE" -t xianzhi:latest .
docker save "$IMAGE" | gzip > "/tmp/xz-$TAG.tar.gz"
rsync -az --delete --exclude .env.prod --exclude data/ --exclude .git --exclude node_modules ./ "$XZ_HOST:$XZ_DIR/"
rsync -az "/tmp/xz-$TAG.tar.gz" "$XZ_HOST:/tmp/"
ssh "$XZ_HOST" "set -e; gunzip -c /tmp/xz-$TAG.tar.gz | docker load; cd $XZ_DIR; XZ_IMAGE=$IMAGE XZ_ENV_FILE=$XZ_DIR/.env.prod docker compose -f infra/docker-compose.prod.yml --env-file $XZ_DIR/.env.prod up -d xz-pg xz-app xz-collab"
# 迁移失败时 xz-app 新容器会退出（REQ-OPS-002），compose 不会把 collab 切过去
for i in $(seq 1 30); do
  if ssh "$XZ_HOST" "wget -qO- http://127.0.0.1:18010/api/health && wget -qO- http://127.0.0.1:18011/collab/health" >/dev/null 2>&1; then
    echo "$(date -Iseconds) · $IMAGE · migrations=$(ls drizzle/*.sql | wc -l)" >> debug/deploys.md
    echo "deploy ok: $IMAGE"
    exit 0
  fi
  sleep 3
done
echo "健康检查未通过，请检查 xz-app 日志（docker compose logs xz-app）" >&2
exit 1
