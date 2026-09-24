/**
 * 未登录页的主题选择（REQ-UI-001，2026-09-24 用户裁定：登录页默认跟随系统，未登录也能切换）：
 * 右上角玻璃胶囊，展开「跟随系统 / 日场 / 夜场」；切换沿用圆形揭幕（06 §6），选择写 `xz:theme`。
 */
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import { setTheme, storedChoice, type ThemeChoice } from '../../lib/theme.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'

const ICON = { system: Monitor, light: Sun, dark: Moon } as const

export function ThemeMenu({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [choice, setChoice] = useState<ThemeChoice>(() => storedChoice())
  const [open, setOpen] = useState(false)
  const Current = ICON[choice]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          'glass-thick-flat inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-fg-muted text-sm shadow-none hover:text-fg',
          className,
        )}
        aria-label={t('ui.theme.toggle')}
        data-testid="theme-menu"
      >
        <Current className="size-4" strokeWidth={1.75} />
        {t(`ui.theme.${choice}`)}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1.5">
        <div role="menu" aria-label={t('ui.theme.toggle')} className="flex flex-col gap-0.5">
          {(['system', 'light', 'dark'] as const).map((v) => {
            const Icon = ICON[v]
            return (
              <button
                key={v}
                type="button"
                role="menuitemradio"
                aria-checked={choice === v}
                data-testid={`theme-menu-${v}`}
                className="flex h-9 items-center gap-2 rounded-md px-2.5 text-left text-sm hover:bg-hover"
                onClick={(e) => {
                  setChoice(v)
                  setOpen(false)
                  void setTheme(v, { x: e.clientX, y: e.clientY })
                }}
              >
                <Icon className="size-4 text-fg-muted" strokeWidth={1.75} />
                <span className="flex-1">{t(`ui.theme.${v}`)}</span>
                {choice === v ? <Check className="size-4 text-primary-text" /> : null}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
