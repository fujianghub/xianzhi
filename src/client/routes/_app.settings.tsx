/** 设置布局（08 §2.13、T1-033 · T1-043）：左侧二级导航（个人 / 通知 / 安全 / API Key / 模板 / 类型（ADR-0016 · 0017）/ 标签；admin 多出工作区 / 成员 / 审计；owner 再多用户管理，ADR-0010）。 */
import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import {
  Bell,
  Building2,
  KeyRound,
  LayoutTemplate,
  type LucideIcon,
  ScrollText,
  Shapes,
  ShieldCheck,
  Tags,
  UserCog,
  UserRound,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { isAdmin, isOwner, type Me } from '../hooks/useMe.ts'

export const Route = createFileRoute('/_app/settings')({ component: SettingsLayout })

const link =
  'group flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm text-fg-muted transition-colors duration-(--xz-dur-fast) hover:bg-hover hover:text-fg [&.active]:bg-selected [&.active]:font-medium [&.active]:text-primary-text'

function Item({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <>
      <Icon className="size-4 shrink-0 opacity-80 group-[.active]:opacity-100" strokeWidth={1.75} />
      {children}
    </>
  )
}

function SettingsLayout() {
  const { t } = useTranslation()
  const { me } = Route.useRouteContext() as { me: Me }
  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <nav
        aria-label={t('ui.page.settings')}
        className="flex gap-1 overflow-x-auto lg:sticky lg:top-4 lg:flex-col lg:self-start"
        data-testid="settings-nav"
      >
        <Link to="/settings" activeOptions={{ exact: true }} className={link}>
          <Item icon={UserRound}>{t('settings.nav.profile')}</Item>
        </Link>
        <Link to="/settings/notifications" className={link}>
          <Item icon={Bell}>{t('settings.nav.notifications')}</Item>
        </Link>
        <Link to="/settings/security" className={link}>
          <Item icon={ShieldCheck}>{t('settings.nav.security')}</Item>
        </Link>
        <Link to="/settings/api-keys" className={link}>
          <Item icon={KeyRound}>{t('settings.nav.apiKeys')}</Item>
        </Link>
        <Link to="/settings/templates" className={link} data-testid="nav-templates">
          <Item icon={LayoutTemplate}>{t('settings.nav.templates')}</Item>
        </Link>
        <Link to="/settings/types" className={link} data-testid="nav-types">
          <Item icon={Shapes}>{t('settings.nav.types')}</Item>
        </Link>
        <Link to="/settings/tags" className={link} data-testid="nav-tags">
          <Item icon={Tags}>{t('settings.nav.tags')}</Item>
        </Link>
        {isAdmin(me) ? (
          <>
            <span className="mt-4 mb-1 hidden px-3 text-[11px] text-fg-muted tracking-[.16em] lg:block">
              {t('settings.nav.workspaceGroup')}
            </span>
            <Link to="/settings/workspace" activeOptions={{ exact: true }} className={link}>
              <Item icon={Building2}>{t('settings.nav.workspace')}</Item>
            </Link>
            <Link to="/settings/workspace/members" className={link}>
              <Item icon={Users}>{t('settings.nav.members')}</Item>
            </Link>
            {isOwner(me) ? (
              <Link to="/settings/workspace/users" className={link} data-testid="nav-users">
                <Item icon={UserCog}>{t('settings.nav.users')}</Item>
              </Link>
            ) : null}
            <Link to="/settings/workspace/audit" className={link}>
              <Item icon={ScrollText}>{t('settings.nav.audit')}</Item>
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
