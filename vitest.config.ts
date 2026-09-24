import { defineConfig } from 'vitest/config'

/**
 * 测试（05 §5）：单元 + API 集成 + 协同钩子共用 xz_test 库（首次自动建库并迁移）。
 * 测试专用密钥不是真实密钥；真实 .env 由 XZ_SKIP_DOTENV=1 跳过。
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    reporters: ['default', './scripts/vitest-req-reporter.ts'],
    environment: 'node',
    fileParallelism: false, // 共用一个测试库，按文件串行；每文件 beforeAll 清库
    globalSetup: ['./src/server/__tests__/global-setup.ts'],
    setupFiles: ['./src/server/__tests__/setup-env.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      XZ_SKIP_DOTENV: '1',
      DATABASE_URL: process.env.XZ_TEST_DATABASE_URL ?? 'postgres://xz:xz@localhost:5433/xz_test',
      APP_URL: 'http://localhost:3010',
      BETTER_AUTH_URL: 'http://localhost:3010',
      BETTER_AUTH_SECRET: 'test-only-secret-not-for-production-0123456789',
      COLLAB_TOKEN_SECRET: 'test-only-collab-secret-not-for-production-0123',
      LOG_LEVEL: 'silent',
      DATA_DIR: './data/test',
    },
  },
})
