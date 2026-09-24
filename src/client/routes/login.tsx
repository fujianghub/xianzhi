/** 登录（08 §2.1、06 §5.6、REQ-AUTH-001 · 012 · REQ-UI-024）：燕印 + 展示字品牌区，glass-thick 卡片居中，光晕放大；401 统一文案，429 显示剩余秒数。 */
import { createFileRoute } from '@tanstack/react-router'
import { KeyRound, Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { FieldError, Label } from '../components/ui/label.tsx'
import { Seal } from '../components/ui/seal.tsx'
import { authClient } from '../lib/auth-client.ts'
import { optString } from '../lib/search.ts'

const search = (s: Record<string, unknown>): { redirect?: string } => ({
  redirect: optString(s.redirect),
})
/** 只允许站内相对路径（08 §2.1）。 */
export const safeRedirect = (r: string | undefined) =>
  r?.startsWith('/') && !r.startsWith('//') ? r : '/today'

export const Route = createFileRoute('/login')({ validateSearch: search, component: Login })

export function useLoginBody() {
  useEffect(() => {
    document.body.classList.add('xz-login')
    return () => document.body.classList.remove('xz-login')
  }, [])
}

function Login() {
  const { t } = useTranslation()
  const { redirect } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useLoginBody()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await authClient.signIn.email({ email, password }, { onError: () => undefined })
    setPending(false)
    if (res.error) {
      const status = res.error.status
      if (status === 429) setError(t('auth.rateLimited', { seconds: 60 }))
      else if (status === 403) setError(t('auth.locked'))
      else setError(t('auth.invalid'))
      return
    }
    // 需要 2FA 时 twoFactorClient 的 onTwoFactorRedirect 已整页跳到 /login/2fa（保留 search），这里不再二次导航
    if ((res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return
    window.location.assign(safeRedirect(redirect))
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="glass-thick w-full max-w-sm rounded-xl p-8 [--xz-edge:var(--xz-edge-login)]"
        data-testid="login-form"
        noValidate
      >
        <div className="xz-seal-host mb-7 flex flex-col items-center gap-3">
          <Seal size="lg" />
          <h1 className="font-display text-[26px] leading-none tracking-[.12em]">
            {t('app.name')}
          </h1>
          <p className="font-brand-en text-fg-faint text-sm italic tracking-[.18em]">
            {t('app.subtitle')}
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              className="mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onGlass
              required
            />
          </div>
          <div>
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              className="mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onGlass
              required
            />
            <FieldError>{error}</FieldError>
          </div>
          <Button type="submit" variant="primary" loading={pending} data-testid="login-submit">
            {t('auth.submit')}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={async () => {
                const r = await authClient.signIn.passkey()
                if (!r?.error) window.location.assign(safeRedirect(redirect))
              }}
            >
              <KeyRound />
              {t('auth.passkey')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex-1"
              disabled={!email}
              onClick={async () => {
                await authClient.signIn.magicLink({ email, callbackURL: safeRedirect(redirect) })
                setInfo(t('auth.magicLinkSent'))
              }}
            >
              <Mail />
              {t('auth.magicLink')}
            </Button>
          </div>
          {info ? (
            <p className="text-center text-fg-muted text-xs" role="status">
              {info}
            </p>
          ) : null}
        </div>
      </form>
    </main>
  )
}
