import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n/index.ts'
import './styles/app.css'
import { ApiError } from './lib/api.ts'
import { parseSearch, stringifySearch } from './lib/search.ts'
import { applyDensity, useLayout } from './lib/stores.ts'
import { watchSystemTheme } from './lib/theme.ts'
import { NotFound } from './routes/-components/NotFound.tsx'
import { routeTree } from './routeTree.gen.ts'

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

const router = createRouter({
  routeTree,
  context: { queryClient },
  parseSearch,
  stringifySearch,
  defaultPreload: 'intent',
  defaultNotFoundComponent: NotFound,
  scrollRestoration: true,
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
