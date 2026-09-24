import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { currentTheme, setTheme } from '../../lib/theme.ts'
import { Button } from '../ui/button.tsx'
import { Tooltip } from '../ui/tooltip.tsx'

export function ThemeToggle() {
  const { t } = useTranslation()
  return (
    <Tooltip content={t('ui.theme.toggle')}>
      <Button
        variant="icon"
        aria-label={t('ui.theme.toggle')}
        data-testid="theme-toggle"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          void setTheme(currentTheme() === 'dark' ? 'light' : 'dark', {
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
          })
        }}
      >
        <Sun className="hidden size-5 dark:block" />
        <Moon className="size-5 dark:hidden" />
      </Button>
    </Tooltip>
  )
}
