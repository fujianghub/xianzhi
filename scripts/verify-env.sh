#!/usr/bin/env bash
# 验证实例 / e2e 的环境（05 §3 `pnpm dev:verify`）：端口 3011/8012/8013、库 xz_e2e、独立 Vite 缓存；测试专用密钥，不读 .env。
export XZ_SKIP_DOTENV=1 XZ_VERIFY=1 NODE_ENV=${NODE_ENV:-development}
export DATABASE_URL=${DATABASE_URL:-postgres://xz:xz@localhost:5433/xz_e2e}
# APP_URL 可覆盖：从局域网 IP 访问验证实例时 `APP_URL=http://<ip>:3011 pnpm dev:verify`（Better Auth 校验 Origin 必须一致）
export APP_URL=${APP_URL:-http://localhost:3011}
export BETTER_AUTH_URL=${BETTER_AUTH_URL:-$APP_URL}
export CLIENT_PORT=3011 API_PORT=8012 COLLAB_PORT=8013
export BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-e2e-only-secret-not-for-production-0123456789}
export COLLAB_TOKEN_SECRET=${COLLAB_TOKEN_SECRET:-e2e-only-collab-secret-not-for-production-01}
export SMTP_HOST=${SMTP_HOST:-127.0.0.1} SMTP_PORT=${SMTP_PORT:-1025} MAIL_FROM="Xianzhi <no-reply@xz.local>"
export DATA_DIR=${DATA_DIR:-./data/e2e} LOG_LEVEL=${LOG_LEVEL:-warn}
exec "$@"
