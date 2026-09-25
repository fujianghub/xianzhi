/** 工作区（08 §2.13、T1-043、REQ-WS-001）：名称可改（owner/admin），slug 只读；Logo 属后续版本。 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Input } from '../components/ui/input.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { api, unwrap } from '../lib/api.ts'
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
    </section>
  )
}
