/** 两步验证（08 §1 `/login/2fa`、REQ-AUTH-006）：TOTP 或恢复码。 */
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ThemeMenu } from '../components/layout/ThemeMenu.tsx'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { FieldError, Label } from '../components/ui/label.tsx'
import { authClient } from '../lib/auth-client.ts'
import { optString } from '../lib/search.ts'
import { safeRedirect, useLoginBody } from './login.tsx'

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
  useLoginBody()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true)
    const r = backup
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
      : await authClient.twoFactor.verifyTotp({ code: code.trim() })
    setPending(false)
    if (r.error) return setError(t('auth.twoFactor.invalid'))
    window.location.assign(safeRedirect(redirect))
  }
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <ThemeMenu className="fixed top-4 right-4 z-(--xz-z-sticky)" />
      <form
        onSubmit={submit}
        className="glass-thick w-full max-w-sm rounded-xl p-8 [--xz-edge:var(--xz-edge-login)]"
        data-testid="twofa-form"
      >
        <h1 className="mb-6 text-center font-semibold text-xl">{t('auth.twoFactor.title')}</h1>
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
    </main>
  )
}
