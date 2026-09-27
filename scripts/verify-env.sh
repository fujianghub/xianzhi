#!/usr/bin/env bash
# 验证实例 / e2e 的环境（05 §3 `pnpm dev:verify`）：端口默认 3011/8012/8013、库 xz_e2e、独立 Vite 缓存；测试专用密钥，不读 .env。
export XZ_SKIP_DOTENV=1 XZ_VERIFY=1 NODE_ENV=${NODE_ENV:-development}
export DATABASE_URL=${DATABASE_URL:-postgres://xz:xz@localhost:5433/xz_e2e}
# 端口可覆盖：worktree 里另起一套而不动常驻的 3011 时
# `CLIENT_PORT=3031 API_PORT=8032 COLLAB_PORT=8033 pnpm dev:verify`，再用 `XZ_E2E_BASE=http://localhost:3031` 跑用例。
# Vite 缓存 node_modules/.vite-verify 按检出目录隔离：同一目录只起一套验证实例。
export CLIENT_PORT=${CLIENT_PORT:-3011} API_PORT=${API_PORT:-8012} COLLAB_PORT=${COLLAB_PORT:-8013}
# APP_URL 可覆盖：从局域网 IP 访问验证实例时 `APP_URL=http://<ip>:3011 pnpm dev:verify`（Better Auth 校验 Origin 必须一致）
export APP_URL=${APP_URL:-http://localhost:$CLIENT_PORT}
export BETTER_AUTH_URL=${BETTER_AUTH_URL:-$APP_URL}
export BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-e2e-only-secret-not-for-production-0123456789}
export COLLAB_TOKEN_SECRET=${COLLAB_TOKEN_SECRET:-e2e-only-collab-secret-not-for-production-01}
export SMTP_HOST=${SMTP_HOST:-127.0.0.1} SMTP_PORT=${SMTP_PORT:-1025} MAIL_FROM="Xianzhi <no-reply@xz.local>"
# 附件目录固定为主仓的 data/e2e（绝对路径）：库 xz_e2e 是各检出目录（主仓 / worktree）共用的，
# 相对路径会让文件落在各自目录下，换目录起实例后去重命中的附件就成了「文件缺失」
MAIN_ROOT=$(cd "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo .git)/.." && pwd)
export DATA_DIR=${DATA_DIR:-$MAIN_ROOT/data/e2e} LOG_LEVEL=${LOG_LEVEL:-warn}
# 拼图答案回显（ADR-0006）：e2e 走真实拖拽流程；production 下服务端强制忽略
export XZ_CAPTCHA_DEBUG=1
exec "$@"
