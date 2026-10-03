/**
 * 未登录页的主题选择（REQ-UI-001，2026-09-24 用户裁定：登录页默认跟随系统，未登录也能切换）：
 * 右上角玻璃胶囊，展开「跟随系统 / 日场 / 夜场」；切换沿用圆形揭幕（06 §6），选择写 `xz:theme`。
 * 首屏只渲染按钮（REQ-UI-015 首屏 JS ≤ 250 KB）：悬停 / 聚焦时预取弹层，点击后挂载 ThemeMenuPopover 并直接展开。
 */
import { Monitor, Moon, Sun } from 'lucide-react'
import { type ComponentProps, lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import { storedChoice, type ThemeChoice } from '../../lib/theme.ts'

export const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const

const loadPopover = () => import('./ThemeMenuPopover.tsx')
const ThemeMenuPopover = lazy(loadPopover)

/** 胶囊按钮（首屏版与弹层版共用，外观一致；asChild 时由 PopoverTrigger 注入 ref / aria） */
export function ThemeMenuButton({
  choice,
  className,
  ...props
}: { choice: ThemeChoice } & ComponentProps<'button'>) {
  const { t } = useTranslation()
  const Current = THEME_ICON[choice]
  return (
    <button
      type="button"
      className={cn(
        'glass-thick-flat inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-fg-muted text-sm hover-veil [--xz-mat-drop:0_0_transparent] hover:text-fg',
        className,
      )}
      aria-label={t('ui.theme.toggle')}
      data-testid="theme-menu"
      {...props}
    >
      <Current className="size-4" />
      {t(`ui.theme.${choice}`)}
    </button>
  )
}

export function ThemeMenu({ className }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => storedChoice())
  const [armed, setArmed] = useState(false)
  const idle = (
    <ThemeMenuButton
      choice={choice}
      className={className}
      aria-haspopup="menu"
      onPointerEnter={() => void loadPopover()}
      onFocus={() => void loadPopover()}
      onClick={() => setArmed(true)}
    />
  )
  if (!armed) return idle
  return (
    <Suspense fallback={idle}>
      <ThemeMenuPopover choice={choice} onChoose={setChoice} className={className} />
    </Suspense>
  )
}
