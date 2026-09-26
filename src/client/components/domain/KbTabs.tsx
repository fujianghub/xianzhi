/**
 * 空间页签（ADR-0012、08 §2.5b）：概览 · 目录 · 记录 · 任务，空间内各页共用；当前页为胶囊。
 * 路由各自平级（`/spaces/$slug/home|tree|entries`，任务页仍是 `/spaces/$slug`），不改原有任务 URL。
 */
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'

export type KbTab = 'home' | 'tree' | 'entries' | 'tasks'

export function KbTabs({ slug, active }: { slug: string; active: KbTab }) {
  const { t } = useTranslation()
  const cls = (k: KbTab) =>
    cn(
      'h-8 rounded-full px-3 text-sm leading-8',
      active === k ? 'bg-selected font-medium' : 'text-fg-muted hover:bg-hover hover:text-fg',
    )
  const params = { spaceSlug: slug }
  const cur = (k: KbTab) => (active === k ? ('page' as const) : undefined)
  return (
    <nav className="flex flex-wrap gap-1" aria-label={t('ui.nav.views')} data-testid="kb-tabs">
      <Link
        to="/spaces/$spaceSlug/home"
        params={params}
        className={cls('home')}
        aria-current={cur('home')}
        data-testid="kb-tab-home"
      >
        {t('kb.tab.home')}
      </Link>
      <Link
        to="/spaces/$spaceSlug/tree"
        params={params}
        className={cls('tree')}
        aria-current={cur('tree')}
        data-testid="kb-tab-tree"
      >
        {t('kb.tab.tree')}
      </Link>
      <Link
        to="/spaces/$spaceSlug/entries"
        params={params}
        search={{}}
        className={cls('entries')}
        aria-current={cur('entries')}
        data-testid="space-entries-link"
      >
        {t('ui.page.entries')}
      </Link>
      <Link
        to="/spaces/$spaceSlug"
        params={params}
        search={{}}
        className={cls('tasks')}
        aria-current={cur('tasks')}
        data-testid="kb-tab-tasks"
      >
        {t('task.tasks')}
      </Link>
    </nav>
  )
}
