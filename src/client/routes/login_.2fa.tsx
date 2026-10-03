/** 两步验证（08 §1 `/login/2fa`、REQ-AUTH-006）：TOTP 或恢复码；外壳与小燕见 `AuthShell`（ADR-0034）。 */
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthShell, birdPause, useBirdFlash } from '../components/auth/AuthShell.tsx'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { FieldError, Label } from '../components/ui/label.tsx'
import { Seal } from '../components/ui/seal.tsx'
import { loadAuthClient } from '../lib/auth-client-lazy.ts'
import { optString } from '../lib/search.ts'
import { safeRedirect } from './login.tsx'

export const Route = createFileRoute('/login_/2fa')({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: optString(s.redirect),
  }),
  component: TwoFactor,
})

function TwoFactor() {
  const { t } = useTranslation()
  const { redirect } = Route.useSearch()
  const [code, setCode] = useState('')
  const [backup, setBackup] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [flash, fire] = useBirdFlash()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true)
    const r = backup
      ? await (await loadAuthClient()).twoFactor.verifyBackupCode({ code: code.trim() })
      : await (await loadAuthClient()).twoFactor.verifyTotp({ code: code.trim() })
    if (r.error) {
      setPending(false)
      fire('error')
      return setError(t('auth.twoFactor.invalid'))
    }
    fire('success')
    await birdPause()
    window.location.assign(safeRedirect(redirect))
  }
  return (
    <AuthShell greeting={t('auth.bird.hello.twoFactor')} flash={flash}>
      <form onSubmit={submit} data-testid="twofa-form">
        <div className="xz-seal-host mb-6 flex flex-col items-center gap-3">
          <Seal size="md" />
          <h1 className="font-display text-[26px] leading-none tracking-[.2em]">
            {t('auth.twoFactor.title')}
          </h1>
        </div>
        <Label htmlFor="code">
          {backup ? t('auth.twoFactor.backupCode') : t('auth.twoFactor.code')}
        </Label>
        <Input
          id="code"
          className="mt-1"
          autoComplete="one-time-code"
          inputMode={backup ? 'text' : 'numeric'}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onGlass
          autoFocus
        />
        <FieldError>{error}</FieldError>
        <Button
          type="submit"
          variant="primary"
          className="mt-4 w-full"
          loading={pending}
          data-testid="twofa-submit"
        >
          {t('auth.twoFactor.verify')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() => setBackup((v) => !v)}
        >
          {t('auth.twoFactor.useBackup')}
        </Button>
      </form>
    </AuthShell>
  )
}
