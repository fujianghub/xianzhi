/** 旧画廊地址（ADR-0020、REQ-UI-039）：带原 search params 跳到 `/settings/design`，权限判定在目标路由。 */
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/design')({
  validateSearch: (s: Record<string, unknown>) => s,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/settings/design', search: search as never, replace: true })
  },
})
