/** 已登录布局（08 §1）：beforeLoad 取 /me，401 → /login?redirect=；挂 AppShell 与 SSE。 */
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useCallback } from 'react'
import { AppShell } from '../components/layout/AppShell.tsx'
import { TooltipProvider } from '../components/ui/tooltip.tsx'
import { type Me, meQuery } from '../hooks/useMe.ts'
import { type RealtimeStatus, useRealtime } from '../hooks/useRealtime.ts'
import { ApiError } from '../lib/api.ts'
import { useAsideSlot } from '../lib/stores.ts'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    try {
      const me = await context.queryClient.ensureQueryData(meQuery)
      return { me }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401)
        throw redirect({ to: '/login', search: { redirect: location.href } })
      throw err
    }
  },
  component: AppLayout,
})

function AppLayout() {
  const { me } = Route.useRouteContext() as { me: Me }
  const onStatus = useCallback((_s: RealtimeStatus) => undefined, [])
  useRealtime(true, onStatus)
  const aside = useAsideSlot((s) => s.node)
  return (
    // TooltipProvider 只挂在已登录布局：放 main.tsx 会把 Radix Tooltip + floating-ui 拉进登录页首屏（REQ-UI-015）
    <TooltipProvider>
      <AppShell me={me} aside={aside ?? undefined}>
        <Outlet />
      </AppShell>
    </TooltipProvider>
  )
}
