/**
 * 登录（08 §2.1、06 §5.6、REQ-AUTH-001 · 012 · 016 · 020 · REQ-UI-024）：燕印 + 展示字品牌区；
 * 「邮箱或用户名」+ 密码（可显隐）——含 @ 走邮箱登录，否则走用户名登录（ADR-0008）；
 * 服务端拼图滑块（ADR-0006，未解开不可提交，任何失败换新题）；401 统一文案，429 显示剩余秒数，
 * 403 REGISTRATION_PENDING 提示待审批；底部「申请注册」；右上角主题选择。
 * 外壳与小燕见 `AuthShell`（ADR-0034）：失败时小燕垂头摇头，成功时衔枝欢跳后再跳转。
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { Eye, EyeOff, KeyRound, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthShell, birdPause, useBirdFlash } from '../components/auth/AuthShell.tsx'
import { Button } from '../components/ui/button.tsx'
import { IconField } from '../components/ui/icon-field.tsx'
import { FieldError } from '../components/ui/label.tsx'
import { Seal } from '../components/ui/seal.tsx'
import { SliderCaptcha } from '../components/ui/slider-captcha.tsx'
import { loadAuthClient } from '../lib/auth-client-lazy.ts'
import { optString } from '../lib/search.ts'

const search = (s: Record<string, unknown>): { redirect?: string } => ({
  redirect: optString(s.redirect),
})
/** 只允许站内相对路径（08 §2.1）。 */
export const safeRedirect = (r: string | undefined) =>
  r?.startsWith('/') && !r.startsWith('//') ? r : '/today'

export const Route = createFileRoute('/login')({ validateSearch: search, component: Login })

function Login() {
  const { t } = useTranslation()
  const { redirect } = Route.useSearch()
  const [identifier, setIdentifier] = useState('')
  const isEmail = identifier.includes('@')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [captchaFailed, setCaptchaFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [flash, fire] = useBirdFlash()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!captcha) {
      setError(t('auth.captcha.required'))
      return
    }
    setPending(true)
    setError(null)
    setCaptchaFailed(false)
    const opts = { headers: { 'x-captcha': captcha }, onError: () => undefined }
    const id = identifier.trim()
    const res = isEmail
      ? await (await loadAuthClient()).signIn.email({ email: id, password }, opts)
      : await (await loadAuthClient()).signIn.username({ username: id, password }, opts)
    if (res.error) {
      setPending(false)
      const status = res.error.status
      const code = (res.error as { code?: string }).code
      // 旧题已被服务端消费：任何失败都换新题（ADR-0006）
      setCaptchaKey((k) => k + 1)
      fire('error')
      if (code === 'CAPTCHA_INVALID') {
        setCaptchaFailed(true)
        setError(t('auth.captcha.failed'))
      } else if (status === 429) setError(t('auth.rateLimited', { seconds: 60 }))
      else if (code === 'REGISTRATION_PENDING') setError(t('auth.pending'))
      else if (status === 403) setError(t('auth.locked'))
      else setError(t('auth.invalid'))
      return
    }
    // 需要 2FA 时 twoFactorClient 的 onTwoFactorRedirect 已整页跳到 /login/2fa（保留 search），这里不再二次导航
    if ((res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return
    fire('success')
    await birdPause()
    window.location.assign(safeRedirect(redirect))
  }

  return (
    <AuthShell greeting={t('auth.bird.hello.login')} flash={flash}>
      <form onSubmit={submit} data-testid="login-form" noValidate>
        <div className="xz-seal-host mb-7 flex flex-col items-center gap-3">
          <Seal size="lg" />
          <h1 className="font-display text-[30px] leading-none tracking-[.2em]">{t('app.name')}</h1>
          <p className="font-display text-[14px] text-fg-muted tracking-[.4em]">
            {t('app.tagline')}
          </p>
        </div>
        <div className="flex flex-col gap-3.5">
          <IconField
            id="email"
            label={t('auth.identifier')}
            icon={isEmail ? Mail : UserRound}
            type="text"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
          <IconField
            id="password"
            label={t('auth.password')}
            icon={LockKeyhole}
            type={showPw ? 'text' : 'password'}
            autoComplete="current-password"
            data-secret
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            trailing={
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t('auth.hidePassword') : t('auth.showPassword')}
                aria-pressed={showPw}
                className="inline-flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
              >
                {showPw ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
              </button>
            }
          />
          <SliderCaptcha onChange={setCaptcha} resetKey={captchaKey} failed={captchaFailed} />
          <FieldError>{error}</FieldError>
          <Button
            type="submit"
            variant="primary"
            loading={pending}
            disabled={!captcha}
            className="h-12 text-[15px] tracking-[.3em]"
            data-testid="login-submit"
          >
            {t('auth.submit')}
          </Button>
          <div className="flex items-center gap-3 text-fg-muted text-xs" aria-hidden>
            <span className="h-px flex-1 bg-divider" />
            {t('auth.or')}
            <span className="h-px flex-1 bg-divider" />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex-1"
              onClick={async () => {
                const r = await (await loadAuthClient()).signIn.passkey()
                if (r?.error) return // 取消 / 不支持不算出错，小燕不闹
                fire('success')
                await birdPause()
                window.location.assign(safeRedirect(redirect))
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
              disabled={!isEmail}
              title={isEmail ? undefined : t('auth.magicLinkNeedsEmail')}
              onClick={async () => {
                await (await loadAuthClient()).signIn.magicLink({
                  email: identifier.trim(),
                  callbackURL: safeRedirect(redirect),
                })
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
          <p className="pt-1 text-center text-fg-muted text-sm">
            {t('auth.noAccount')}{' '}
            <Link
              to="/register"
              className="font-medium text-primary-text underline-offset-4 hover:underline"
              data-testid="go-register"
            >
              {t('auth.register.link')}
            </Link>
          </p>
        </div>
      </form>
    </AuthShell>
  )
}
