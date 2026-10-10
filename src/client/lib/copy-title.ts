/**
 * 复制标题（ADR-0058、REQ-UI-055）：任务 / 记录的标题复制到剪贴板。⌘K 命令、全局热键与行菜单 / 记录菜单共用。
 * 热键 Mod+Shift+C（与 Google 文档「字数统计」同类做法：浏览器不保留该组合，页面可接管；编辑器无此键位），
 * 编辑器 / 输入框内也生效。
 */
import i18n from 'i18next'
import { toast } from 'sonner'
import { copyText } from './clipboard.ts'

export const COPY_TITLE_HOTKEY = 'mod+shift+c'

export async function copyTitle(title: string): Promise<void> {
  const ok = await copyText(title).catch(() => false)
  if (ok) toast.success(i18n.t('cmd.titleCopied', { title }))
  else toast.error(i18n.t('taskMenu.copyFailed'))
}
