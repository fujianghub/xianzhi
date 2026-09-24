# 生产镜像（05 §7、T0-028）：多阶段；运行层 USER node，data/ 属 node；app 与 collab 共用本镜像。
# 构建：docker build -f infra/Dockerfile -t xianzhi:<tag> .
# 镜像内拉包限 4 并发：npmmirror 在容器内高并发下载会大量失败（debug/2026-09-24-docker-pnpm-concurrency）
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN npm i -g pnpm@11.1.2 --registry=https://registry.npmmirror.com && pnpm -v
WORKDIR /app

# ---- 全量依赖（构建用） ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=xz-pnpm-store,target=/pnpm/store pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile --network-concurrency=4 --fetch-retries=5

# ---- 构建：vite build + tsc（server/collab/shared）+ 预算检查 ----
FROM deps AS build
COPY . .
RUN pnpm build

# ---- 生产依赖 ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=xz-pnpm-store,target=/pnpm/store pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile --prod --network-concurrency=4 --fetch-retries=5

# ---- 运行层 ----
FROM ${NODE_IMAGE} AS runtime
# pg_dump / pg_restore（备份与恢复演练，05 §8）；wget 用于健康检查
RUN apk add --no-cache postgresql16-client tini
ENV NODE_ENV=production DATA_DIR=/app/data
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY drizzle ./drizzle
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8010 8011
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 CMD wget -qO- http://127.0.0.1:${API_PORT:-8010}/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# app：migrate → api + worker（05 §3 `pnpm start`）；collab 容器覆盖为 node dist/collab/server.js
CMD ["node", "dist/server/start.js"]
