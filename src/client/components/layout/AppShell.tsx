/**
 * 布局骨架（04 §4、06 §4、REQ-UI-014 · REQ-MOBILE-001）：Topbar 56 / Sidebar 240 / Aside 320 可折；
 * < lg：Sidebar 抽屉（Sheet left）、底部导航（safe-area）。`[` / `]` 折叠侧栏 / Aside。
 * 同屏 blur：≥ lg 时 Topbar + Sidebar + Aside = 3（L1 ≤ 4）；底部导航 < lg 才显示。
 */
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Bell,
  CalendarDays,
  FileText,
  Inbox,
  LogOut,
  type LucideIcon,
  Menu,
  Palette,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  Sun,
  Trash2,
  User,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { lazy, Suspense, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { hotkeyParts, useCommands } from '../../hooks/useCommands.ts'
import { useHotkeys } from '../../hooks/useHotkeys.ts'
import { isAdmin, type Me } from '../../hooks/useMe.ts'
import { useScrolled } from '../../hooks/useScrolled.ts'
import { authClient } from '../../lib/auth-client.ts'
import { cn } from '../../lib/cn.ts'
import { useLayout, useNewEntry, usePalette, usePeek } from '../../lib/stores.ts'
import { CreateSpaceDialog } from '../domain/CreateSpaceDialog.tsx'
import { NewTaskDialog } from '../domain/NewTaskDialog.tsx'

const NewEntryDialog = lazy(() => import('../domain/NewEntryDialog.tsx'))
const CommandPalette = lazy(() => import('./CommandPalette.tsx'))
const ShortcutsDialog = lazy(() => import('./ShortcutsDialog.tsx'))
const PeekPanel = lazy(() => import('../domain/PeekPanel.tsx'))

import { SpaceSwitcher } from '../domain/SpaceSwitcher.tsx'
import { Avatar } from '../ui/avatar.tsx'
import { Button } from '../ui/button.tsx'
import { KeyHint } from '../ui/key-hint.tsx'
import { Seal } from '../ui/seal.tsx'
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet.tsx'
import { Tooltip } from '../ui/tooltip.tsx'
import { NotificationBell } from './NotificationBell.tsx'
import { StatusPill } from './StatusPill.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

function Brand() {
  const { t } = useTranslation()
  return (
    <Link
      to="/today"
      className="xz-brand xz-seal-host flex items-center gap-3 px-5 pt-5 pb-4"
      data-testid="brand"
    >
      <Seal size="md" />
      <div className="leading-tight">
        <div className="font-display text-[22px] tracking-[.14em]">{t('app.name')}</div>
        <div className="mt-1.5 font-display text-[12px] text-fg-muted tracking-[.2em]">
          {t('app.tagline')}
        </div>
      </div>
    </Link>
  )
}

type Hue = 'amber' | 'blue' | 'cyan' | 'violet' | 'rose' | 'emerald' | 'lime' | 'sky'
/** 导航图标专属色（--xz-icon-*，侧栏改版 REQ-UI-032）；经 CSS 变量 --xz-ico 交给 .xz-nav-icon */
export const hueStyle = (hue: Hue) => ({ '--xz-ico': `var(--xz-icon-${hue})` }) as CSSProperties

export function NavIcon({ icon: Icon, hue }: { icon: LucideIcon; hue?: Hue }) {
  return (
    <span className="xz-nav-icon" style={hue ? hueStyle(hue) : undefined} aria-hidden>
      <Icon />
    </span>
  )
}

function NavList({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const { t } = useTranslation()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const items: {
    to: '/today' | '/entries' | '/inbox' | '/calendar' | '/notifications' | '/trash'
    key: string
    label: string
    icon: LucideIcon
    hue: Hue
    disabled: boolean
  }[] = [
    {
      to: '/today',
      key: 'today',
      label: t('ui.page.today'),
      icon: Sun,
      hue: 'amber',
      disabled: false,
    },
    {
      to: '/entries',
      key: 'entries',
      label: t('ui.page.entries'),
      icon: FileText,
      hue: 'blue',
      disabled: false,
    },
    {
      to: '/inbox',
      key: 'inbox',
      label: t('ui.page.inbox'),
      icon: Inbox,
      hue: 'cyan',
      disabled: false,
    },
    {
      to: '/calendar',
      key: 'calendar',
      label: t('ui.page.calendar'),
      icon: CalendarDays,
      hue: 'emerald',
      disabled: false,
    },
    {
      to: '/notifications',
      key: 'notifications',
      label: t('ui.page.notifications'),
      icon: Bell,
      hue: 'violet',
      disabled: false,
    },
    {
      to: '/trash',
      key: 'trash',
      label: t('ui.page.trash'),
      icon: Trash2,
      hue: 'rose',
      disabled: false,
    },
  ]
  return (
    <nav aria-label={t('ui.nav.mainNav')} className="flex flex-col gap-1 px-3">
      <div className="xz-nav-label">{t('ui.nav.views')}</div>
      {items.map((it) =>
        it.disabled ? (
          <span key={it.key} className="xz-nav-item" aria-disabled="true">
            <NavIcon icon={it.icon} />
            {it.label}
          </span>
        ) : (
          <Link
            key={it.key}
            to={it.to}
            onClick={onNavigate}
            className="xz-nav-item"
            data-active={path.startsWith(it.to) || undefined}
            aria-current={path.startsWith(it.to) ? 'page' : undefined}
          >
            <NavIcon icon={it.icon} hue={it.hue} />
            {it.label}
          </Link>
        ),
      )}
      {isAdmin(me) ? (
        <Link
          to="/design"
          onClick={onNavigate}
          className="xz-nav-item mt-1"
          data-active={path.startsWith('/design') || undefined}
          aria-current={path.startsWith('/design') ? 'page' : undefined}
        >
          <NavIcon icon={Palette} hue="lime" />
          {t('ui.page.design')}
        </Link>
      ) : null}
      <Link
        to="/settings"
        onClick={onNavigate}
        className="xz-nav-item"
        data-active={path.startsWith('/settings') || undefined}
        aria-current={path.startsWith('/settings') ? 'page' : undefined}
      >
        <NavIcon icon={Settings} hue="sky" />
        {t('ui.page.settings')}
      </Link>
    </nav>
  )
}

export function AppShell({
  me,
  children,
  aside,
}: {
  me: Me
  children: ReactNode
  aside?: ReactNode
}) {
  const { t } = useTranslation()
  const { sidebarOpen, asideOpen, drawerOpen, toggleSidebar, toggleAside, setDrawer } = useLayout()
  const newEntryOpen = useNewEntry((s) => s.open)
  const paletteOpen = usePalette((s) => s.open)
  const helpOpen = usePalette((s) => s.help)
  const setPalette = usePalette((s) => s.setOpen)
  const peeking = usePeek((s) => !!s.target)
  // 全局热键与 ⌘K 共用命令注册表（REQ-UI-006）
  const { commands } = useCommands()
  const hotkeys = useMemo(
    () =>
      Object.fromEntries(
        commands
          .filter((c) => c.hotkey && c.run && c.group !== 'context')
          .map((c) => [c.hotkey, c.run]),
      ) as Record<string, () => void>,
    [commands],
  )
  useHotkeys(hotkeys)
  const name = me.displayName || me.name
  const scrolled = useScrolled()
  const signOut = async () => {
    await authClient.signOut()
    window.location.assign('/login')
  }
  return (
    <div className="min-h-dvh" data-testid="app-shell">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-(--xz-z-toast)"
      >
        {t('ui.nav.mainNav')}
      </a>
      {/* Sidebar ≥ lg */}
      <aside
        data-testid="sidebar"
        className={cn(
          'xz-sidebar fixed inset-y-0 left-0 z-(--xz-z-sticky) hidden w-(--xz-sidebar-w) flex-col lg:flex',
          !sidebarOpen && 'lg:hidden',
        )}
        aria-label={t('ui.nav.spaces')}
      >
        <Brand />
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <NavList me={me} />
          <SpaceSwitcher me={me} />
        </div>
      </aside>
      {/* Sidebar 抽屉 < lg */}
      <Sheet open={drawerOpen} onOpenChange={setDrawer}>
        <SheetContent side="left" className="p-0" data-testid="drawer">
          <SheetTitle className="sr-only">{t('ui.nav.spaces')}</SheetTitle>
          <Brand />
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            <NavList me={me} onNavigate={() => setDrawer(false)} />
            <SpaceSwitcher me={me} onNavigate={() => setDrawer(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div
        className={cn(
          'flex min-h-dvh flex-col',
          sidebarOpen && 'lg:pl-(--xz-sidebar-w)',
          aside && asideOpen && 'xl:pr-(--xz-aside-w)',
        )}
      >
        <header
          data-testid="topbar"
          data-scrolled={scrolled || undefined}
          className="glass xz-topbar sticky top-0 z-(--xz-z-sticky) flex h-(--xz-topbar-h) items-center gap-2 rounded-none border-x-0 border-t-0 px-3"
        >
          <Button
            variant="icon"
            className="lg:hidden"
            aria-label={t('ui.nav.openMenu')}
            onClick={() => setDrawer(true)}
            data-testid="open-drawer"
          >
            <Menu />
          </Button>
          <Tooltip content={sidebarOpen ? t('ui.nav.collapseSidebar') : t('ui.nav.expandSidebar')}>
            <Button
              variant="icon"
              className="hidden lg:inline-flex"
              aria-label={sidebarOpen ? t('ui.nav.collapseSidebar') : t('ui.nav.expandSidebar')}
              onClick={toggleSidebar}
            >
              <PanelLeft />
            </Button>
          </Tooltip>
          <button
            type="button"
            onClick={() => setPalette(true)}
            data-testid="open-palette"
            className="hidden h-9 min-w-0 max-w-sm flex-1 items-center gap-2 rounded-full border border-border bg-surface px-3 text-left text-fg-muted text-sm hover:bg-hover md:flex"
          >
            <Search className="size-4" />
            <span className="flex-1 truncate">{t('ui.search.placeholder')}</span>
            <KeyHint keys={hotkeyParts('mod+k')} />
          </button>
          <div className="ml-auto flex items-center gap-1">
            <StatusPill />
            <NotificationBell />
            <ThemeToggle />
            {aside ? (
              <Button
                variant="icon"
                className="hidden xl:inline-flex"
                aria-label={t('ui.nav.collapseAside')}
                onClick={toggleAside}
              >
                <PanelRight />
              </Button>
            ) : null}
            <Tooltip content={t('ui.action.signOut')}>
              <Button variant="icon" aria-label={t('ui.action.signOut')} onClick={signOut}>
                <LogOut />
              </Button>
            </Tooltip>
            <Avatar id={me.id} name={name} />
          </div>
        </header>
        <main
          id="main"
          className="xz-main flex-1 px-4 py-6 pb-[calc(var(--xz-bottomnav-h)+env(safe-area-inset-bottom)+1rem)] lg:px-10 lg:pt-8 lg:pb-10"
        >
          {children}
        </main>
      </div>

      {aside && asideOpen ? (
        <aside
          data-testid="aside"
          className="glass fixed top-(--xz-topbar-h) right-0 bottom-0 z-(--xz-z-sticky) hidden w-(--xz-aside-w) overflow-y-auto rounded-l-xl border-r-0 p-4 xl:block [html[data-dialog-open]_&]:hidden"
        >
          {aside}
        </aside>
      ) : null}

      <CreateSpaceDialog />
      <NewTaskDialog />
      {peeking ? (
        <Suspense fallback={null}>
          <PeekPanel />
        </Suspense>
      ) : null}
      {paletteOpen ? (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      ) : null}
      {helpOpen ? (
        <Suspense fallback={null}>
          <ShortcutsDialog />
        </Suspense>
      ) : null}
      {newEntryOpen ? (
        <Suspense fallback={null}>
          <NewEntryDialog />
        </Suspense>
      ) : null}

      {/* 底部导航 < lg（REQ-MOBILE-001） */}
      <nav
        data-testid="bottom-nav"
        aria-label={t('ui.nav.mainNav')}
        className="glass fixed inset-x-0 bottom-0 z-(--xz-z-sticky) grid h-[calc(var(--xz-bottomnav-h)+env(safe-area-inset-bottom))] grid-cols-5 rounded-t-xl border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <Link
          to="/today"
          className="flex flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted [&.active]:text-primary-text"
        >
          <Sun className="size-5" strokeWidth={1.75} />
          {t('ui.page.today')}
        </Link>
        <Link
          to="/inbox"
          className="flex flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted [&.active]:text-primary-text"
        >
          <Inbox className="size-5" strokeWidth={1.75} />
          {t('ui.page.inbox')}
        </Link>
        <Link
          to="/search"
          className="flex flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted [&.active]:text-primary-text"
        >
          <Search className="size-5" strokeWidth={1.75} />
          {t('ui.page.search')}
        </Link>
        <Link
          to="/notifications"
          className="flex flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted [&.active]:text-primary-text"
        >
          <Bell className="size-5" strokeWidth={1.75} />
          {t('ui.page.notifications')}
        </Link>
        <Link
          to="/settings"
          className="flex flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted [&.active]:text-primary-text"
        >
          <User className="size-5" strokeWidth={1.75} />
          {t('ui.nav.me')}
        </Link>
      </nav>
    </div>
  )
}
