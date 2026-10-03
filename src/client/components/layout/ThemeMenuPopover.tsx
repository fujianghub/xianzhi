/** 主题菜单的弹层部分（按需加载，见 ThemeMenu.tsx）：Radix Popover + floating-ui 约 22 KB gzip，不进认证页首屏。 */
import { Check } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setTheme, type ThemeChoice } from '../../lib/theme.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { THEME_ICON, ThemeMenuButton } from './ThemeMenu.tsx'

export default function ThemeMenuPopover({
  choice,
  onChoose,
  className,
}: {
  choice: ThemeChoice
  onChoose: (v: ThemeChoice) => void
  className?: string
}) {
  const { t } = useTranslation()
  // 首次点开即加载：挂载时就是展开态
  const [open, setOpen] = useState(true)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ThemeMenuButton choice={choice} className={className} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-1.5">
        <div role="menu" aria-label={t('ui.theme.toggle')} className="flex flex-col gap-0.5">
          {(['system', 'light', 'dark'] as const).map((v) => {
            const Icon = THEME_ICON[v]
            return (
              <button
                key={v}
                type="button"
                role="menuitemradio"
                aria-checked={choice === v}
                data-testid={`theme-menu-${v}`}
                className="flex h-9 items-center gap-2 rounded-md px-2.5 text-left text-sm hover:bg-hover"
                onClick={(e) => {
                  onChoose(v)
                  setOpen(false)
                  void setTheme(v, { x: e.clientX, y: e.clientY })
                }}
              >
                <Icon className="size-4 text-fg-muted" />
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
