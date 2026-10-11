import { Moon, PaletteIcon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SKIN_NONE } from '../../../shared/skins.ts'
import { setAppearance, useAppearance } from '../../lib/appearance.ts'
import { currentTheme } from '../../lib/theme.ts'
import { Button } from '../ui/button.tsx'
import { Tooltip } from '../ui/tooltip.tsx'

export function ThemeToggle() {
  const { t } = useTranslation()
  // ADR-0059：皮肤锁定日夜场，生效时这里变成「退出皮肤」（显式 none，盖过工作区默认皮肤）
  const skin = useAppearance((s) => s.mounted)
  const label = skin ? t('ui.skin.exit') : t('ui.theme.toggle')
  return (
    <Tooltip content={label}>
      <Button
        variant="icon"
        aria-label={label}
        data-testid="theme-toggle"
        data-skin-active={skin ? '' : undefined}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
          // ADR-0049：已登录切换主题随账号保存
          if (skin) setAppearance({ skin: SKIN_NONE }, origin)
          else setAppearance({ theme: currentTheme() === 'dark' ? 'light' : 'dark' }, origin)
        }}
      >
        {skin ? (
          <PaletteIcon className="size-5" />
        ) : (
          <>
            <Sun className="hidden size-5 dark:block" />
            <Moon className="size-5 dark:hidden" />
          </>
        )}
      </Button>
    </Tooltip>
  )
}
