/**
 * API Key（08 §2.13、T1-033 · T1-043、REQ-AUTH-010）：列表（只显示前缀）、新建（名称 / scope / 过期）后明文只显示一次并可复制、撤销。
 * scope 不超过持有者角色（admin scope 仅 owner/admin 可选；服务端同样拦截）；每 Key 300/min（02 §2）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Copy, KeyRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { KeyView } from '../../server/services/me.ts'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog } from '../components/ui/confirm-dialog.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { EmptyState } from '../components/ui/empty-state.tsx'
import { Input } from '../components/ui/input.tsx'
import { RelativeTime } from '../components/ui/relative-time.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { isAdmin, type Me } from '../hooks/useMe.ts'
import { api, unwrap } from '../lib/api.ts'

export const Route = createFileRoute('/_app/settings/api-keys')({ component: ApiKeys })

type Scope = 'read' | 'write' | 'admin'

function ApiKeys() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { me } = Route.useRouteContext() as { me: Me }
  const q = useQuery({
    queryKey: ['me', 'keys'],
    queryFn: () => unwrap<{ items: KeyView[] }>(api.me.keys.$get()),
  })
  const [name, setName] = useState('')
  const [scope, setScope] = useState<Scope>('read')
  const [expires, setExpires] = useState('')
  const [plain, setPlain] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<KeyView | null>(null)
  const create = useMutation({
    mutationFn: () =>
      unwrap<KeyView & { key: string }>(
        api.me.keys.$post({
          json: {
            name: name.trim(),
            scope,
            ...(expires ? { expiresAt: new Date(`${expires}T23:59:59`).toISOString() } : {}),
          } as never,
        }),
      ),
    onSuccess: (r) => {
      setPlain(r.key)
      setName('')
      void qc.invalidateQueries({ queryKey: ['me', 'keys'] })
    },
    onError: () => toast.error(t('task.saveFailed')),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) create.mutate()
  }
  const items = q.data?.items ?? []
  return (
    <section className="max-w-3xl" data-testid="settings-api-keys">
      <h1 className="mb-2 font-semibold text-2xl">{t('settings.nav.apiKeys')}</h1>
      <p className="mb-6 text-fg-muted text-sm">{t('settings.keys.hint')}</p>
      <form
        onSubmit={submit}
        className="paper mb-6 grid gap-3 rounded-lg border border-divider p-4 sm:grid-cols-[1fr_8rem_10rem_auto] sm:items-end"
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-muted text-xs">{t('settings.keys.name')}</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            data-testid="key-name"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-muted text-xs">{t('settings.keys.scope')}</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            className="h-10 rounded-md border border-border bg-surface px-3"
            data-testid="key-scope"
          >
            <option value="read">{t('settings.keys.scopes.read')}</option>
            <option value="write">{t('settings.keys.scopes.write')}</option>
            <option value="admin" disabled={!isAdmin(me)}>
              {t('settings.keys.scopes.admin')}
            </option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-muted text-xs">{t('settings.keys.expires')}</span>
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          disabled={!name.trim()}
          data-testid="key-create"
        >
          {t('settings.keys.create')}
        </Button>
      </form>
      {q.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : !items.length ? (
        <EmptyState illustration="inbox" title={t('settings.keys.empty')} />
      ) : (
        <ul className="paper divide-y divide-divider overflow-hidden rounded-lg border border-divider">
          {items.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              data-testid="key-row"
            >
              <KeyRound className="size-4 text-fg-muted" />
              <span className="font-medium">{k.name ?? '—'}</span>
              <code className="text-fg-muted text-xs">{k.start ? `${k.start}…` : ''}</code>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                {t(`settings.keys.scopes.${k.scope}`)}
              </span>
              <span className="ml-auto text-fg-muted text-xs">
                {k.lastUsedAt ? (
                  <>
                    {t('settings.keys.lastUsed')} <RelativeTime date={k.lastUsedAt} />
                  </>
                ) : (
                  t('settings.keys.neverUsed')
                )}
                {k.expiresAt
                  ? ` · ${t('settings.keys.expiresAt', { date: new Date(k.expiresAt).toLocaleDateString() })}`
                  : ''}
              </span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setRevoking(k)}
                data-testid="key-revoke"
              >
                {t('settings.keys.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!plain} onOpenChange={(v) => !v && setPlain(null)}>
        <DialogContent className="w-[min(92vw,32rem)]" data-testid="key-plain-dialog">
          <DialogTitle>{t('settings.keys.createdTitle')}</DialogTitle>
          <DialogDescription className="mt-2 text-fg-muted text-sm">
            {t('settings.keys.onceHint')}
          </DialogDescription>
          <div className="mt-4 flex items-center gap-2">
            <code
              className="min-w-0 flex-1 break-all rounded-md bg-surface-2 px-3 py-2 text-sm"
              data-testid="key-plain"
            >
              {plain}
            </code>
            <Button
              variant="ghost"
              aria-label={t('ui.action.copy')}
              onClick={() => {
                if (plain)
                  void navigator.clipboard
                    ?.writeText(plain)
                    .then(() => toast.success(t('ui.action.copied')))
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="primary" onClick={() => setPlain(null)} data-testid="key-plain-done">
              {t('settings.keys.saved')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(v) => !v && setRevoking(null)}
        title={t('settings.keys.revokeTitle')}
        description={t('settings.keys.revokeHint', { name: revoking?.name ?? '' })}
        confirmLabel={t('settings.keys.revoke')}
        onConfirm={async () => {
          if (!revoking) return
          await unwrap(api.me.keys[':id'].$delete({ param: { id: revoking.id } }))
          await qc.invalidateQueries({ queryKey: ['me', 'keys'] })
          toast.success(t('settings.keys.revoked'))
        }}
      />
    </section>
  )
}
