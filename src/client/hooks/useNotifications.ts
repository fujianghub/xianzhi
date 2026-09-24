/** 通知读取与标记（02 §9、REQ-NOTIF-005）：点击 = 标已读 + 跳深链；全部已读；归档。写后失效 ['notifications']。 */
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api, unwrap } from '../lib/api.ts'

export interface Notification {
  id: string
  kind: string
  title: string
  body: string | null
  url: string
  readAt: string | null
  archivedAt: string | null
  createdAt: string
  count: number
}
export interface NotificationPage {
  items: Notification[]
  nextCursor: string | null
  unreadCount: number
}

export function useNotificationActions() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] })
  const open = async (n: Notification) => {
    if (!n.readAt)
      await unwrap<void>(api.notifications[':id'].read.$post({ param: { id: n.id } })).catch(
        () => undefined,
      )
    void invalidate()
    // 深链为站内路径（01 §4.1），永不带 token（不变量 9）
    if (n.url.startsWith('/')) void nav({ to: n.url })
  }
  const readAll = async () => {
    await unwrap<{ updated: number }>(api.notifications['read-all'].$post())
    await invalidate()
  }
  const archive = async (n: Notification) => {
    await unwrap<void>(api.notifications[':id'].archive.$post({ param: { id: n.id } }))
    await invalidate()
  }
  return { open, readAll, archive }
}
