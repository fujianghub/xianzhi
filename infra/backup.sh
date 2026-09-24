#!/usr/bin/env bash
# 备份（05 §8）：在 xz-app 容器内生成加密 dump（与 pg-boss backup.daily 同一实现），并把 uploads/ 增量同步到备份盘。
# 用法：XZ_BACKUP_TARGET=/mnt/backup/xz infra/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
docker compose -f docker-compose.prod.yml exec -T xz-app node dist/server/cli.js backup
if [ -n "${XZ_BACKUP_TARGET:-}" ]; then
  VOL=$(docker volume inspect -f '{{ .Mountpoint }}' xianzhi_gi_data)
  rsync -a "$VOL/uploads/" "$XZ_BACKUP_TARGET/uploads/"
  rsync -a "$VOL/backups/" "$XZ_BACKUP_TARGET/backups/"
fi
