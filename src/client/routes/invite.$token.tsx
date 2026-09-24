/** 接受邀请（08 §2.2、REQ-AUTH-003 · 004）：读公开邀请信息 → 设显示名与密码 → 自动登录 → /today。 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { FieldError, Label } from '../components/ui/label.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { authClient } from '../lib/auth-client.ts'
import { useLoginBody } from './login.tsx'

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
  useLoginBody()
  const q = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      unwrap<PublicInvitation>(api.workspace.invitations[':id'].$get({ param: { id: token } })),
    retry: false,
  })
  const [form, setForm] = useState({ email: '', name: '', password: '' })
  const accept = useMutation({
    mutationFn: async () => {
      await unwrap(
        api.workspace.invitations[':id'].accept.$post({ param: { id: token }, json: form }),
      )
      const r = await authClient.signIn.email({ email: form.email, password: form.password })
      if (r.error) throw new ApiError({ status: r.error.status ?? 401, code: 'UNAUTHENTICATED' })
    },
    onSuccess: () => window.location.assign('/today'),
  })
  const err = (e: unknown) => (e instanceof ApiError ? e : null)
  const loadErr = err(q.error)
  const acceptErr = err(accept.error)
  const gone = loadErr?.status === 410 || acceptErr?.status === 410
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div
        className="glass-thick w-full max-w-sm rounded-xl p-8 [--xz-edge:var(--xz-edge-login)]"
        data-testid="invite"
      >
        <h1 className="mb-4 text-center font-semibold text-xl">{t('auth.invitation.title')}</h1>
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
                minLength={10}
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
    </main>
  )
}
