/** 快捷键面板（04 §6、REQ-UI-006：`?` 打开）：与 ⌘K 共用命令注册表，只列有热键的命令，另附列表 / 编辑器内按键。 */
import { useTranslation } from 'react-i18next'
import { hotkeyParts, useCommands } from '../../hooks/useCommands.ts'
import { usePalette } from '../../lib/stores.ts'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { KeyHint } from '../ui/key-hint.tsx'

const LIST_KEYS: [string, string[]][] = [
  ['cmd.keys.move', ['J', 'K']],
  ['cmd.keys.complete', ['Space']],
  ['cmd.keys.select', ['X']],
  ['cmd.keys.open', ['Enter']],
  ['cmd.keys.peek', ['P']],
  ['cmd.keys.slash', ['/']],
]

export default function ShortcutsDialog() {
  const { t } = useTranslation()
  const { help, setHelp } = usePalette()
  const { commands } = useCommands()
  const withKeys = commands.filter((c) => c.hotkey && c.group !== 'context')
  return (
    <Dialog open={help} onOpenChange={setHelp}>
      <DialogContent className="w-[min(92vw,34rem)]" data-testid="shortcuts-dialog">
        <DialogTitle>{t('cmd.help')}</DialogTitle>
        <DialogDescription className="sr-only">{t('cmd.helpHint')}</DialogDescription>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <ul className="flex flex-col gap-2 text-sm">
            {withKeys.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span className="truncate">{c.label}</span>
                <KeyHint keys={hotkeyParts(c.hotkey as string)} />
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-2 text-sm">
            {LIST_KEYS.map(([k, keys]) => (
              <li key={k} className="flex items-center justify-between gap-3">
                <span className="truncate">{t(k)}</span>
                <KeyHint keys={keys} />
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}
