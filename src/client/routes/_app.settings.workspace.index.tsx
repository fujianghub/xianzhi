/** 工作区（08 §2.13、T1-043、REQ-WS-001）：名称可改（owner/admin），slug 只读；Logo 属后续版本。默认外观（ADR-0049、REQ-WS-024）：成员没单独选过的项跟随它。 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  APPEARANCE_DENSITIES,
  APPEARANCE_GLASS,
  APPEARANCE_MOTIONS,
  APPEARANCE_THEMES,
  type AppearanceKey,
  type AppearancePrefs,
  BUILTIN_APPEARANCE,
  normalizeAppearance,
} from '../../shared/schemas/preferences.ts'
import { Input } from '../components/ui/input.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { api, unwrap } from '../lib/api.ts'
import { setWorkspaceAppearance } from '../lib/appearance.ts'
import { requireAdmin } from './-components/admin-gate.ts'

export const Route = createFileRoute('/_app/settings/workspace/')({
  beforeLoad: requireAdmin,
  component: Workspace,
})

interface Ws {
  id: string
  name: string
  slug: string
  memberCount?: number
  createdAt: string
  settings?: Record<string, unknown>
}

function Workspace() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['workspace'], queryFn: () => unwrap<Ws>(api.workspace.$get()) })
  const [name, setName] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  if (q.isPending) return <Skeleton className="h-40 w-full max-w-3xl" />
  const ws = q.data
  if (!ws) return null
  const save = async () => {
    const v = (name ?? '').trim()
    if (!v || v === ws.name) return
    try {
      await unwrap(api.workspace.$patch({ json: { name: v } }))
      await qc.invalidateQueries({ queryKey: ['workspace'] })
      setSaved(true)
    } catch {
      toast.error(t('task.saveFailed'))
    }
  }
  return (
    <section className="max-w-3xl" data-testid="settings-workspace">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="font-semibold text-2xl tracking-tight">{t('settings.nav.workspace')}</h1>
        {saved ? (
          <span className="text-fg-muted text-xs" role="status">
            {t('task.savedJustNow')}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-muted text-xs">{t('settings.workspace.name')}</span>
          <Input
            value={name ?? ws.name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void save()}
            maxLength={80}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-muted text-xs">{t('settings.workspace.slug')}</span>
          <Input value={ws.slug} disabled />
        </label>
        <p className="text-fg-muted text-xs">{t('settings.workspace.logoLater')}</p>
      </div>
      <DefaultAppearance
        value={normalizeAppearance(ws.settings?.appearance)}
        onSaved={() => setSaved(true)}
      />
    </section>
  )
}

/** 工作区默认外观：整份保存（缺的键跟随内置默认）；保存后本人生效值随之重算，其他成员下次加载生效。 */
function DefaultAppearance({
  value,
  onSaved,
}: {
  value: Partial<AppearancePrefs>
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const current = { ...BUILTIN_APPEARANCE, ...value }
  const save = async (key: AppearanceKey, v: string) => {
    const next = { ...value, [key]: v }
    try {
      await unwrap(api.workspace.$patch({ json: { settings: { appearance: next } } as never }))
      await qc.invalidateQueries({ queryKey: ['workspace'] })
      await qc.invalidateQueries({ queryKey: ['me', 'preferences'] })
      setWorkspaceAppearance(next)
      onSaved()
    } catch {
      toast.error(t('task.saveFailed'))
    }
  }
  const rows: [AppearanceKey, string, readonly string[], (v: string) => string][] = [
    ['theme', t('ui.theme.toggle'), APPEARANCE_THEMES, (v) => t(`ui.theme.${v}`)],
    [
      'density',
      t('settings.profile.density'),
      APPEARANCE_DENSITIES,
      (v) => t(`settings.profile.${v}`),
    ],
    [
      'motion',
      t('settings.profile.motion'),
      APPEARANCE_MOTIONS,
      (v) => t(`settings.profile.motionLevel.${v}`),
    ],
    [
      'glass',
      t('settings.profile.glass'),
      APPEARANCE_GLASS,
      (v) => t(`settings.profile.glassLevel.${v}`),
    ],
  ]
  return (
    <div className="mt-8 flex flex-col gap-3" data-testid="workspace-appearance">
      <h2 className="font-semibold text-base">{t('settings.workspace.appearance')}</h2>
      <p className="text-fg-muted text-xs">{t('settings.workspace.appearanceHint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map(([key, text, values, name]) => (
          <label key={key} className="flex flex-col gap-1.5 text-sm">
            <span className="text-fg-muted text-xs">{text}</span>
            <select
              className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
              value={current[key]}
              onChange={(e) => void save(key, e.target.value)}
              data-testid={`workspace-appearance-${key}`}
            >
              {values.map((v) => (
                <option key={v} value={v}>
                  {name(v)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  )
}
