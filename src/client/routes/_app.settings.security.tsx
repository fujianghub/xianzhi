/** 安全设置（08 §2.13、REQ-AUTH-006 · 007 · 009 · 021）：改密码、2FA（TOTP + 10 个恢复码）、通行密钥、会话列表。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PASSWORD_MIN } from '../../shared/schemas/workspace.ts'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { FieldError, Label } from '../components/ui/label.tsx'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { authClient } from '../lib/auth-client.ts'

export const Route = createFileRoute('/_app/settings/security')({ component: Security })

interface SessionRow {
  id: string
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  current: boolean
}

function Security() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const session = authClient.useSession()
  const enabled = !!(session.data?.user as { twoFactorEnabled?: boolean } | undefined)
    ?.twoFactorEnabled
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null)
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [verified, setVerified] = useState(false)

  const sessions = useQuery({
    queryKey: ['me', 'sessions'],
    queryFn: () => unwrap<{ items: SessionRow[] }>(api.me.sessions.$get()),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(api.me.sessions[':id'].$delete({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'sessions'] }),
  })
  const passkeys = useQuery({
    queryKey: ['passkeys'],
    queryFn: async () => (await authClient.passkey.listUserPasskeys()).data ?? [],
  })
  const secret = setup
    ? new URL(setup.totpURI.replace('otpauth://', 'https://')).searchParams.get('secret')
    : null

  return (
    <div className="flex max-w-3xl flex-col gap-6" data-testid="security">
      <h1 className="font-semibold text-2xl tracking-tight">{t('settings.security.title')}</h1>

      <ChangePassword onDone={() => qc.invalidateQueries({ queryKey: ['me', 'sessions'] })} />

      <section className="paper rounded-xl p-5" data-testid="twofa">
        <h2 className="font-medium">
          {t('settings.security.twoFactor')} ·{' '}
          <span className={enabled ? 'text-success' : 'text-fg-muted'}>
            {enabled ? t('settings.security.twoFactorOn') : t('settings.security.twoFactorOff')}
          </span>
        </h2>
        {!setup ? (
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault()
              setErr(null)
              if (enabled) {
                const r = await authClient.twoFactor.disable({ password })
                if (r.error) return setErr(t('auth.invalid'))
                await session.refetch()
                return
              }
              const r = await authClient.twoFactor.enable({ password })
              if (r.error || !r.data) return setErr(t('auth.invalid'))
              setSetup(r.data as { totpURI: string; backupCodes: string[] })
            }}
          >
            <div className="flex-1">
              <Label htmlFor="pw">{t('settings.security.confirmPassword')}</Label>
              <Input
                id="pw"
                type="password"
                className="mt-1"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <FieldError>{err}</FieldError>
            </div>
            <Button
              type="submit"
              variant={enabled ? 'destructive' : 'primary'}
              data-testid="twofa-toggle"
            >
              {enabled ? t('settings.security.disable') : t('settings.security.enable')}
            </Button>
          </form>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-fg-muted text-sm">{t('settings.security.scanHint')}</p>
            <code
              className="break-all rounded-md bg-surface-2 p-2 font-mono text-xs"
              data-testid="totp-uri"
            >
              {setup.totpURI}
            </code>
            {secret ? (
              <code className="font-mono text-sm" data-testid="totp-secret">
                {secret}
              </code>
            ) : null}
            {!verified ? (
              <form
                className="flex items-end gap-3"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const r = await authClient.twoFactor.verifyTotp({ code })
                  if (r.error) return setErr(t('auth.twoFactor.invalid'))
                  setVerified(true)
                  await session.refetch()
                }}
              >
                <div className="flex-1">
                  <Label htmlFor="totp">{t('auth.twoFactor.code')}</Label>
                  <Input
                    id="totp"
                    inputMode="numeric"
                    className="mt-1"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <FieldError>{err}</FieldError>
                </div>
                <Button type="submit" variant="primary" data-testid="totp-verify">
                  {t('settings.security.verify')}
                </Button>
              </form>
            ) : (
              <div>
                <p className="mb-2 font-medium text-sm">{t('settings.security.backupCodes')}</p>
                <ul className="grid grid-cols-2 gap-1 font-mono text-sm" data-testid="backup-codes">
                  {setup.backupCodes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <Button className="mt-3" onClick={() => setSetup(null)}>
                  {t('settings.security.backupSaved')}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="paper rounded-xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{t('settings.security.passkeys')}</h2>
          <Button
            size="sm"
            onClick={async () => {
              await authClient.passkey.addPasskey()
              await passkeys.refetch()
            }}
          >
            {t('settings.security.addPasskey')}
          </Button>
        </div>
        <ul className="mt-3 text-sm">
          {passkeys.data?.length ? (
            passkeys.data.map((p) => <li key={p.id}>{p.name ?? p.id}</li>)
          ) : (
            <li className="text-fg-muted">{t('settings.security.noPasskeys')}</li>
          )}
        </ul>
      </section>

      <section className="paper rounded-xl p-5" data-testid="sessions">
        <h2 className="font-medium">{t('settings.security.sessions')}</h2>
        <ul className="mt-3 flex flex-col divide-y divide-divider">
          {sessions.data?.items.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 text-sm">
              <span className="min-w-0 truncate">
                {s.userAgent ?? t('settings.security.unknownDevice')} · {s.ipAddress ?? '—'}{' '}
                {s.current ? (
                  <strong className="ml-1 text-primary-text">
                    {t('settings.security.current')}
                  </strong>
                ) : null}
              </span>
              {s.current ? null : (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                  {t('settings.security.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** 改密码（REQ-AUTH-021）：当前密码 + 新密码两次；成功后其他会话被退出、当前会话保留。 */
function ChangePassword({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [errs, setErrs] = useState<{ cur?: string | null; next?: string | null }>({})
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < PASSWORD_MIN)
      return setErrs({ next: t('settings.security.passwordTooShort', { n: PASSWORD_MIN }) })
    if (next !== again) return setErrs({ next: t('settings.security.passwordMismatch') })
    setBusy(true)
    setErrs({})
    try {
      const r = await unwrap<{ sessions: number }>(
        api.me.password.$post({ json: { currentPassword: cur, newPassword: next } }),
      )
      setCur('')
      setNext('')
      setAgain('')
      toast.success(t('settings.security.passwordChanged', { count: r.sessions }))
      onDone()
    } catch (err) {
      const fe = err instanceof ApiError ? err.problem.errors : undefined
      setErrs({
        cur: fe?.find((x) => x.path === 'currentPassword')?.message ?? null,
        next: fe?.find((x) => x.path === 'newPassword')?.message ?? null,
      })
      if (!fe?.length) toast.error(t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="paper rounded-xl p-5" data-testid="change-password">
      <h2 className="font-medium">{t('settings.security.password')}</h2>
      <p className="mt-1 text-fg-muted text-sm">{t('settings.security.passwordHint')}</p>
      <form className="mt-4 grid gap-3 sm:grid-cols-3 sm:items-start" onSubmit={submit}>
        {/* 隐藏的用户名字段：让密码管理器把新密码归到正确账号 */}
        <input type="text" autoComplete="username" className="hidden" readOnly />
        <div>
          <Label htmlFor="cur-pw">{t('settings.security.currentPassword')}</Label>
          <Input
            id="cur-pw"
            type="password"
            className="mt-1"
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            autoComplete="current-password"
            required
          />
          <FieldError>{errs.cur}</FieldError>
        </div>
        <div>
          <Label htmlFor="new-pw">{t('settings.security.newPassword', { n: PASSWORD_MIN })}</Label>
          <Input
            id="new-pw"
            type="password"
            className="mt-1"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
          />
          <FieldError>{errs.next}</FieldError>
        </div>
        <div>
          <Label htmlFor="new-pw2">{t('settings.security.confirmNewPassword')}</Label>
          <Input
            id="new-pw2"
            type="password"
            className="mt-1"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        <div className="sm:col-span-3">
          <Button type="submit" variant="primary" loading={busy} data-testid="change-password-save">
            {t('settings.security.changePassword')}
          </Button>
        </div>
      </form>
    </section>
  )
}
