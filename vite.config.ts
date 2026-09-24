/**
 * Vite 8（05 §1 §3）：React Compiler、TanStack Router 文件式路由、Tailwind v4；dev 代理 /api → API、/collab → collab（WebSocket）。
 * 验证实例（`pnpm dev:verify` / `pnpm e2e`）用 XZ_VERIFY=1：端口 3011/8012/8013、cacheDir node_modules/.vite-verify（简斋教训：勿与主 dev 共享 .vite）。
 */

import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url))

const verify = process.env.XZ_VERIFY === '1'
const clientPort = Number(process.env.CLIENT_PORT ?? (verify ? 3011 : 3010))
const apiPort = Number(process.env.API_PORT ?? (verify ? 8012 : 8010))
const collabPort = Number(process.env.COLLAB_PORT ?? (verify ? 8013 : 8011))

export default defineConfig({
  root: 'src/client',
  publicDir: 'public',
  cacheDir: verify ? '../../node_modules/.vite-verify' : '../../node_modules/.vite',
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: abs('./src/client/routes'),
      generatedRouteTree: abs('./src/client/routeTree.gen.ts'),
    }),
    react({ compiler: true }),
    tailwindcss(),
  ],
  // 预扫描全部路由与组件的依赖：避免懒加载路由在 dev 下发现新依赖触发整页重载（e2e 不稳定的来源）
  optimizeDeps: { entries: ['./**/*.tsx'] },
  resolve: {
    // Tiptap / ProseMirror / Yjs 多实例会崩（简斋教训，03 §12）
    dedupe: [
      'yjs',
      'y-prosemirror',
      'y-protocols',
      'prosemirror-model',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-transform',
      '@tiptap/core',
      '@tiptap/pm',
      'react',
      'react-dom',
    ],
  },
  server: {
    port: clientPort,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      '/collab': { target: `ws://127.0.0.1:${collabPort}`, ws: true, changeOrigin: false },
    },
  },
  preview: { port: clientPort, strictPort: true },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2023',
    rolldownOptions: {
      output: {
        codeSplitting: {
          // 只收组内匹配的模块，不把 react 等共享依赖一并吸进编辑器 chunk（否则首屏会预加载整包编辑器）
          includeDependenciesRecursively: false,
          groups: [
            {
              name: 'editor',
              test: /node_modules[\\/](@tiptap|prosemirror-|y-prosemirror|yjs|y-indexeddb|y-protocols|@hocuspocus|lib0|linkifyjs|orderedmap|rope-sequence|w3c-keyname|lowlight|highlight\.js|markdown-it|mdurl|uc\.micro|linkify-it|entities|punycode|devlop|hast-util-|unist-util-)/,
            },
          ],
        },
      },
    },
  },
})
