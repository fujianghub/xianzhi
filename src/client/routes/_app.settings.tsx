/** 设置布局（08 §2.13、T1-033 · T1-043）：左侧二级导航（个人 / 通知 / 安全 / API Key；admin 多出工作区 / 成员 / 审计）。 */
import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { isAdmin, type Me } from '../hooks/useMe.ts'

export const Route = createFileRoute('/_app/settings')({ component: SettingsLayout })

const link =
  'block rounded-full px-3 py-1.5 text-sm text-fg-muted hover:bg-hover hover:text-fg [&.active]:bg-selected [&.active]:font-medium [&.active]:text-fg'

function SettingsLayout() {
  const { t } = useTranslation()
  const { me } = Route.useRouteContext() as { me: Me }
  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[12rem_1fr]">
      <nav
        aria-label={t('ui.page.settings')}
        className="flex gap-1 overflow-x-auto lg:flex-col"
        data-testid="settings-nav"
      >
        <Link to="/settings" activeOptions={{ exact: true }} className={link}>
          {t('settings.nav.profile')}
        </Link>
        <Link to="/settings/notifications" className={link}>
          {t('settings.nav.notifications')}
        </Link>
        <Link to="/settings/security" className={link}>
          {t('settings.nav.security')}
        </Link>
        <Link to="/settings/api-keys" className={link}>
          {t('settings.nav.apiKeys')}
        </Link>
        {isAdmin(me) ? (
          <>
            <span className="mt-3 hidden px-3 text-fg-muted text-xs lg:block">
              {t('settings.nav.workspaceGroup')}
            </span>
            <Link to="/settings/workspace" activeOptions={{ exact: true }} className={link}>
              {t('settings.nav.workspace')}
            </Link>
            <Link to="/settings/workspace/members" className={link}>
              {t('settings.nav.members')}
            </Link>
            <Link to="/settings/workspace/audit" className={link}>
              {t('settings.nav.audit')}
            </Link>
          </>
        ) : null}
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
