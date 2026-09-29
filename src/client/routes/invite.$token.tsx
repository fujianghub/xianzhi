/** 接受邀请（08 §2.2、REQ-AUTH-003 · 004）：读公开邀请信息 → 设显示名与密码 → 自动登录 → /today；外壳与小燕见 `AuthShell`（ADR-0034）。 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PASSWORD_MIN } from '../../shared/schemas/workspace.ts'
import { AuthShell, birdPause, useBirdFlash } from '../components/auth/AuthShell.tsx'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { FieldError, Label } from '../components/ui/label.tsx'
import { Seal } from '../components/ui/seal.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { authClient } from '../lib/auth-client.ts'

export const Route = createFileRoute('/invite/$token')({ component: Invite })

interface PublicInvitation {
  email: string
  role: 'admin' | 'member' | 'guest'
  workspaceName: string
  inviterName: string
}

function Invite() {
  const { t } = useTranslation()
  const { token } = Route.useParams()
  const [flash, fire] = useBirdFlash()
  const q = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      unwrap<PublicInvitation>(api.workspace.invitations[':id'].$get({ param: { id: token } })),
    retry: false,
  })
  const [form, setForm] = useState({ email: '', name: '', password: '' })
  const accept = useMutation({
    mutationFn: async () => {
      const accepted = await unwrap<{ captchaPass: string }>(
        api.workspace.invitations[':id'].accept.$post({ param: { id: token }, json: form }),
      )
      // 接受邀请即完成身份确认：用一次性通行证免拼图自动登录（ADR-0006）
      const r = await authClient.signIn.email(
        { email: form.email, password: form.password },
        { headers: { 'x-captcha': accepted.captchaPass } },
      )
      if (r.error) throw new ApiError({ status: r.error.status ?? 401, code: 'UNAUTHENTICATED' })
      fire('success')
      await birdPause()
    },
    onSuccess: () => window.location.assign('/today'),
    onError: () => fire('error'),
  })
  const err = (e: unknown) => (e instanceof ApiError ? e : null)
  const loadErr = err(q.error)
  const acceptErr = err(accept.error)
  const gone = loadErr?.status === 410 || acceptErr?.status === 410
  return (
    <AuthShell greeting={t('auth.bird.hello.invite')} flash={flash}>
      <div data-testid="invite">
        <div className="xz-seal-host mb-5 flex flex-col items-center gap-3">
          <Seal size="md" />
          <h1 className="font-display text-[26px] leading-none tracking-[.2em]">
            {t('auth.invitation.title')}
          </h1>
        </div>
        {q.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : gone || loadErr ? (
          <div className="text-center" data-testid="invite-error">
            <p className="text-fg-muted">
              {gone
                ? (loadErr ?? acceptErr)?.problem.reason === 'used'
                  ? t('auth.invitation.used')
                  : t('auth.invitation.expired')
                : t('auth.invitation.notFound')}
            </p>
            <Link to="/login" search={{}} className="mt-4 inline-block text-primary-text">
              {t('auth.invitation.goLogin')}
            </Link>
          </div>
        ) : q.data ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              accept.mutate()
            }}
          >
            <p className="text-center text-fg-muted text-sm">
              {t('auth.invitation.intro', {
                inviter: q.data.inviterName,
                role: t(`auth.role.${q.data.role}`),
                workspace: q.data.workspaceName,
              })}
            </p>
            <div>
              <Label htmlFor="inv-email">
                {t('auth.invitation.emailHint', { masked: q.data.email })}
              </Label>
              <Input
                id="inv-email"
                type="email"
                autoComplete="username"
                className="mt-1"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                onGlass
                required
              />
            </div>
            <div>
              <Label htmlFor="inv-name">{t('auth.invitation.name')}</Label>
              <Input
                id="inv-name"
                className="mt-1"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onGlass
                required
              />
            </div>
            <div>
              <Label htmlFor="inv-password">{t('auth.invitation.password')}</Label>
              <Input
                id="inv-password"
                type="password"
                autoComplete="new-password"
                data-secret
                minLength={PASSWORD_MIN}
                className="mt-1"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                onGlass
                required
              />
              <FieldError>
                {acceptErr
                  ? acceptErr.status === 403
                    ? t('auth.invitation.mismatch')
                    : t(`errors.${acceptErr.code}`, { defaultValue: t('errors.INTERNAL') })
                  : null}
              </FieldError>
            </div>
            <Button
              type="submit"
              variant="primary"
              loading={accept.isPending}
              data-testid="invite-accept"
            >
              {t('auth.invitation.accept')}
            </Button>
          </form>
        ) : null}
      </div>
    </AuthShell>
  )
}
