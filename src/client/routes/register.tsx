/**
 * 申请注册（ADR-0008、08 §2.1b、REQ-AUTH-017）：邮箱 + 用户名 + 显示名 + 密码 + 拼图 → 提交后待 owner/admin 审批。
 * 字段级 409（邮箱 / 用户名已占用）与 422 就地显示；成功后切到「已提交」状态卡，引导回登录。
 */
import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { AtSign, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PASSWORD_MIN, USERNAME_RE } from '../../shared/schemas/workspace.ts'
import { ThemeMenu } from '../components/layout/ThemeMenu.tsx'
import { Button } from '../components/ui/button.tsx'
import { IconField } from '../components/ui/icon-field.tsx'
import { FieldError } from '../components/ui/label.tsx'
import { Seal } from '../components/ui/seal.tsx'
import { SliderCaptcha } from '../components/ui/slider-captcha.tsx'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { useLoginBody } from './login.tsx'

export const Route = createFileRoute('/register')({ component: Register })

type Field = 'email' | 'username' | 'name' | 'password'

function Register() {
  const { t } = useTranslation()
  useLoginBody()
  const [form, setForm] = useState({ email: '', username: '', name: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [captchaFailed, setCaptchaFailed] = useState(false)
  const [fieldErr, setFieldErr] = useState<Partial<Record<Field, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setFieldErr((f) => ({ ...f, [k]: undefined }))
  }

  const submit = useMutation({
    mutationFn: () =>
      unwrap<{ status: 'pending' }>(
        api.workspace['join-requests'].$post(
          { json: form },
          { headers: { 'x-captcha': captcha ?? '' } },
        ),
      ),
    onError: (err) => {
      setCaptchaKey((k) => k + 1)
      if (!(err instanceof ApiError)) return setError(t('errors.NETWORK'))
      if (err.code === 'CAPTCHA_INVALID') {
        setCaptchaFailed(true)
        return setError(t('auth.captcha.failed'))
      }
      if (err.status === 429) return setError(err.problem.detail ?? t('auth.register.busy'))
      const errs = err.problem.errors ?? []
      if (errs.length) {
        setFieldErr(Object.fromEntries(errs.map((e) => [e.path, e.message])))
        return setError(null)
      }
      setError(err.problem.detail ?? t('auth.register.failed'))
    },
  })

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Partial<Record<Field, string>> = {}
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = t('auth.register.emailInvalid')
    if (!USERNAME_RE.test(form.username.trim().toLowerCase()))
      errs.username = t('auth.register.usernameRule')
    if (!form.name.trim()) errs.name = t('auth.register.nameRequired')
    if (form.password.length < PASSWORD_MIN)
      errs.password = t('auth.register.passwordRule', { n: PASSWORD_MIN })
    setFieldErr(errs)
    if (Object.keys(errs).length) return
    if (!captcha) return setError(t('auth.captcha.required'))
    setError(null)
    setCaptchaFailed(false)
    submit.mutate()
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <ThemeMenu className="fixed top-4 right-4 z-(--xz-z-sticky)" />
      <div
        className="glass-thick w-full max-w-[28rem] rounded-2xl px-6 pt-8 pb-6 sm:px-9 [--xz-edge:var(--xz-edge-login)]"
        data-testid="register"
      >
        <div className="xz-seal-host mb-6 flex flex-col items-center gap-3">
          <Seal size="md" />
          <h1 className="font-display text-[26px] leading-none tracking-[.2em]">
            {t('auth.register.title')}
          </h1>
          <p className="text-center text-fg-muted text-sm">{t('auth.register.intro')}</p>
        </div>
        {submit.isSuccess ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center" role="status">
            <CheckCircle2 className="size-12 text-primary-text" strokeWidth={1.5} />
            <p className="font-medium text-lg">{t('auth.register.doneTitle')}</p>
            <p className="text-fg-muted text-sm">{t('auth.register.doneBody')}</p>
            <Link
              to="/login"
              className="mt-2 font-medium text-primary-text underline-offset-4 hover:underline"
            >
              {t('auth.register.backToLogin')}
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
            <div>
              <IconField
                id="reg-email"
                label={t('auth.email')}
                icon={Mail}
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={set('email')}
                aria-invalid={!!fieldErr.email}
              />
              <FieldError>{fieldErr.email}</FieldError>
            </div>
            <div>
              <IconField
                id="reg-username"
                label={t('auth.register.username')}
                icon={AtSign}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={form.username}
                onChange={set('username')}
                aria-invalid={!!fieldErr.username}
                aria-describedby="reg-username-hint"
              />
              {fieldErr.username ? (
                <FieldError>{fieldErr.username}</FieldError>
              ) : (
                <p id="reg-username-hint" className="mt-1 text-fg-muted text-xs">
                  {t('auth.register.usernameRule')}
                </p>
              )}
            </div>
            <div>
              <IconField
                id="reg-name"
                label={t('auth.register.name')}
                icon={UserRound}
                autoComplete="nickname"
                value={form.name}
                onChange={set('name')}
                aria-invalid={!!fieldErr.name}
              />
              <FieldError>{fieldErr.name}</FieldError>
            </div>
            <div>
              <IconField
                id="reg-password"
                label={t('auth.register.password', { n: PASSWORD_MIN })}
                icon={LockKeyhole}
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.password}
                onChange={set('password')}
                aria-invalid={!!fieldErr.password}
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
              <FieldError>{fieldErr.password}</FieldError>
            </div>
            <SliderCaptcha onChange={setCaptcha} resetKey={captchaKey} failed={captchaFailed} />
            <FieldError>{error}</FieldError>
            <Button
              type="submit"
              variant="primary"
              loading={submit.isPending}
              disabled={!captcha}
              className="h-12 text-[15px] tracking-[.2em]"
              data-testid="register-submit"
            >
              {t('auth.register.submit')}
            </Button>
            <p className="pt-1 text-center text-fg-muted text-sm">
              {t('auth.register.haveAccount')}{' '}
              <Link
                to="/login"
                className="font-medium text-primary-text underline-offset-4 hover:underline"
              >
                {t('auth.signIn')}
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  )
}
