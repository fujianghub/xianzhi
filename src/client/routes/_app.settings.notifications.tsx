/**
 * 通知偏好（08 §2.13、T1-027、REQ-NOTIF-006）：按事件种类 × 通道 × 摘要档；缺行显示默认表（01 §4），
 * 任一改动即 PUT 整体覆盖（02 §9），显示「已保存 · 刚刚」。站内 = in_app + sse（铃铛与实时提示一起开关）；WebPush 属 Phase 2。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '../components/ui/checkbox.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { api, unwrap } from '../lib/api.ts'

export const Route = createFileRoute('/_app/settings/notifications')({
  component: NotificationPrefs,
})

interface Pref {
  eventKind: string
  channels: string[]
  digest: 'instant' | 'daily'
  isDefault: boolean
}
type Col = 'site' | 'email' | 'webpush'
const has = (p: Pref, c: Col) =>
  c === 'site' ? p.channels.includes('in_app') : p.channels.includes(c)
const toggle = (p: Pref, c: Col, on: boolean): string[] => {
  const set = new Set(p.channels)
  const keys = c === 'site' ? ['in_app', 'sse'] : [c]
  for (const k of keys) on ? set.add(k) : set.delete(k)
  return [...set]
}

function NotificationPrefs() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [saved, setSaved] = useState(false)
  const q = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => unwrap<{ items: Pref[] }>(api.notifications.preferences.$get()),
  })
  const save = useMutation({
    mutationFn: (items: Pref[]) =>
      unwrap<{ items: Pref[] }>(
        api.notifications.preferences.$put({
          json: {
            items: items.map(({ eventKind, channels, digest }) => ({
              eventKind,
              channels,
              digest,
            })),
          } as never,
        }),
      ),
    onSuccess: (r) => {
      qc.setQueryData(['notifications', 'preferences'], r)
      setSaved(true)
    },
  })
  const update = (kind: string, patch: Partial<Pref>) => {
    const items = (q.data?.items ?? []).map((p) => (p.eventKind === kind ? { ...p, ...patch } : p))
    qc.setQueryData(['notifications', 'preferences'], { items })
    save.mutate(items)
  }
  return (
    <section className="mx-auto max-w-3xl" data-testid="notif-prefs">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="font-semibold text-2xl">{t('notif.prefs.title')}</h1>
        {saved && !save.isPending ? (
          <span className="text-fg-muted text-xs" role="status">
            {t('task.savedJustNow')}
          </span>
        ) : null}
      </div>
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="paper overflow-x-auto rounded-lg border border-divider">
          <table className="w-full text-sm">
            <thead className="text-fg-muted text-xs">
              <tr className="border-divider border-b">
                <th className="px-4 py-2 text-left font-normal">{t('notif.prefs.kind')}</th>
                {(['site', 'email', 'webpush'] as const).map((c) => (
                  <th key={c} className="px-3 py-2 font-normal">
                    {t(`notif.prefs.channel.${c}`)}
                  </th>
                ))}
                <th className="px-3 py-2 font-normal">{t('notif.prefs.digest')}</th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.items ?? []).map((p) => (
                <tr
                  key={p.eventKind}
                  className="border-divider border-b last:border-0"
                  data-kind={p.eventKind}
                >
                  <td className="px-4 py-2">
                    {t(`notif.kind.${p.eventKind}`, { defaultValue: p.eventKind })}
                    {p.isDefault ? (
                      <span className="ml-2 text-fg-muted text-xs">{t('notif.prefs.default')}</span>
                    ) : null}
                  </td>
                  {(['site', 'email', 'webpush'] as const).map((c) => (
                    <td key={c} className="px-3 py-2 text-center">
                      <Checkbox
                        checked={has(p, c)}
                        disabled={c === 'webpush'}
                        aria-label={`${t(`notif.kind.${p.eventKind}`, { defaultValue: p.eventKind })} · ${t(`notif.prefs.channel.${c}`)}`}
                        data-testid={`pref-${p.eventKind}-${c}`}
                        onCheckedChange={(v) =>
                          update(p.eventKind, { channels: toggle(p, c, v === true) })
                        }
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center">
                    <select
                      value={p.digest}
                      onChange={(e) =>
                        update(p.eventKind, { digest: e.target.value as Pref['digest'] })
                      }
                      className="h-8 rounded-md border border-border bg-surface px-2"
                      aria-label={t('notif.prefs.digest')}
                    >
                      <option value="instant">{t('notif.prefs.instant')}</option>
                      <option value="daily">{t('notif.prefs.daily')}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
