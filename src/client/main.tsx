import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n/index.ts'
import './styles/app.css'
import { ApiError } from './lib/api.ts'
import { effectiveMotion } from './lib/motion.ts'
import { parseSearch, stringifySearch } from './lib/search.ts'
import { applyDensity, useLayout } from './lib/stores.ts'
import { watchSystemTheme } from './lib/theme.ts'
import { NotFound } from './routes/-components/NotFound.tsx'
import { routeTree } from './routeTree.gen.ts'

// 字体 @font-face 约 300 条：动态 import 拆成独立 CSS 异步插入，不阻塞首帧（REQ-UI-015 · 025）
void import('./styles/fonts.css')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (n, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
})

/**
 * 路由转场（04 §2.4、REQ-UI-029）：只在支持 view-transition types 的浏览器开启——转场带 `route` 类型，
 * 与主题切换（无类型，06 §6）的揭幕 / 溶解样式分开；仅路径变化才转场，减弱档不转场。
 */
const routeTransitions =
  typeof CSS !== 'undefined' && !!CSS.supports?.('selector(:active-view-transition-type(a))')

const router = createRouter({
  routeTree,
  context: { queryClient },
  parseSearch,
  stringifySearch,
  defaultPreload: 'intent',
  defaultNotFoundComponent: NotFound,
  scrollRestoration: true,
  defaultViewTransition: routeTransitions && {
    types: ({ fromLocation, pathChanged }) =>
      fromLocation && pathChanged && effectiveMotion() !== 'reduce' ? ['route'] : false,
  },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

watchSystemTheme()
applyDensity(useLayout.getState().density)

const el = document.getElementById('root')
if (el)
  createRoot(el).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
