/**
 * 用户管理（ADR-0010、REQ-WS-018 ~ 021；仅 owner）：账号层操作——直建用户、改显示名 / 用户名 / 邮箱、
 * 重置密码、强制下线、删除账号（匿名化）。角色、停用、注册审批与邀请仍在「成员」页（owner + admin）。
 * 页面门禁只是 UI：服务端一律 can('user.manage')。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { KeyRound, LogOut, Pencil, Trash2, UserPlus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { UserAdminView } from '../../server/services/users.ts'
import { PASSWORD_MIN } from '../../shared/schemas/workspace.ts'
import { Avatar } from '../components/ui/avatar.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog } from '../components/ui/confirm-dialog.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { Input } from '../components/ui/input.tsx'
import { FieldError, Label } from '../components/ui/label.tsx'
import { RelativeTime } from '../components/ui/relative-time.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { Tooltip } from '../components/ui/tooltip.tsx'
import { isOwner, type Me } from '../hooks/useMe.ts'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { newId } from '../lib/uuid.ts'

export const Route = createFileRoute('/_app/settings/workspace/users')({
  beforeLoad: ({ context }) => {
    if (!isOwner((context as { me?: Me }).me)) throw notFound()
  },
  component: Users,
})

type Role = 'admin' | 'member' | 'guest'
type Modal =
  | { kind: 'create' }
  | { kind: 'edit' | 'password' | 'signOut' | 'delete'; u: UserAdminView }
  | null

const nameOf = (u: Pick<UserAdminView, 'displayName' | 'name'>) => u.displayName || u.name

/** 字段错误按 path 拆开；无字段错误时返回 null 由调用方 toast。 */
const fieldErrors = (err: unknown): Record<string, string> | null => {
  const list = err instanceof ApiError ? err.problem.errors : undefined
  if (!list?.length) return null
  return Object.fromEntries(list.map((e) => [e.path, e.message]))
}

/** 随机初始密码：12 位，去掉易混字符。 */
const randomPassword = () => {
  const cs = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const b = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(b, (n) => cs[n % cs.length]).join('')
}

function Users() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { me } = Route.useRouteContext() as { me: Me }
  const [modal, setModal] = useState<Modal>(null)
  const users = useQuery({
    queryKey: ['workspace', 'users'],
    queryFn: () =>
      unwrap<{ items: UserAdminView[] }>(api.workspace.users.$get()).then((r) => r.items),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['workspace'] })
  const close = () => setModal(null)

  return (
    <section className="max-w-4xl" data-testid="settings-users">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="font-semibold text-2xl tracking-tight">{t('settings.users.title')}</h1>
        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          onClick={() => setModal({ kind: 'create' })}
          data-testid="user-create"
        >
          <UserPlus />
          {t('settings.users.create')}
        </Button>
      </div>
      <p className="mb-6 text-fg-muted text-sm">{t('settings.users.hint')}</p>

      {users.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <ul className="paper divide-y divide-divider overflow-hidden rounded-lg border border-divider">
          {(users.data ?? []).map((u) => {
            const self = u.userId === me.id
            return (
              <li
                key={u.userId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm"
                data-testid="user-row"
                data-user={u.userId}
              >
                <Avatar id={u.userId} name={nameOf(u)} src={u.image} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{nameOf(u)}</span>
                    {self ? (
                      <span className="text-fg-muted text-xs">（{t('settings.users.you')}）</span>
                    ) : null}
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-fg-muted text-xs">
                      {t(`settings.members.roles.${u.role}`)}
                    </span>
                    {u.status === 'suspended' ? (
                      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs">
                        {t('settings.members.suspended')}
                      </span>
                    ) : null}
                    {u.twoFactorEnabled ? (
                      <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs">
                        {t('settings.users.twoFactor')}
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-fg-muted text-xs">
                    {u.username ? `@${u.username}` : t('settings.users.noUsername')} · {u.email}
                  </div>
                </div>
                <div className="flex flex-col items-end text-fg-muted text-xs">
                  <span>
                    {t('settings.users.lastActive')}{' '}
                    {u.lastActiveAt ? (
                      <RelativeTime date={u.lastActiveAt} />
                    ) : (
                      t('settings.users.never')
                    )}
                  </span>
                  {u.sessions > 0 ? (
                    <span>{t('settings.users.sessions', { count: u.sessions })}</span>
                  ) : null}
                </div>
                {self ? (
                  <span className="w-[9.5rem]" aria-hidden />
                ) : (
                  <div className="flex items-center gap-0.5">
                    <Tooltip content={t('settings.users.edit')}>
                      <Button
                        variant="icon"
                        aria-label={t('settings.users.edit')}
                        onClick={() => setModal({ kind: 'edit', u })}
                        data-testid="user-edit"
                      >
                        <Pencil />
                      </Button>
                    </Tooltip>
                    <Tooltip content={t('settings.users.resetPassword')}>
                      <Button
                        variant="icon"
                        aria-label={t('settings.users.resetPassword')}
                        onClick={() => setModal({ kind: 'password', u })}
                        data-testid="user-password"
                      >
                        <KeyRound />
                      </Button>
                    </Tooltip>
                    <Tooltip content={t('settings.users.signOut')}>
                      <Button
                        variant="icon"
                        aria-label={t('settings.users.signOut')}
                        disabled={u.sessions === 0}
                        onClick={() => setModal({ kind: 'signOut', u })}
                        data-testid="user-signout"
                      >
                        <LogOut />
                      </Button>
                    </Tooltip>
                    <Tooltip content={t('settings.users.delete')}>
                      <Button
                        variant="icon"
                        aria-label={t('settings.users.delete')}
                        disabled={u.role === 'owner'}
                        className="hover:text-danger"
                        onClick={() => setModal({ kind: 'delete', u })}
                        data-testid="user-delete"
                      >
                        <Trash2 />
                      </Button>
                    </Tooltip>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <CreateUserDialog open={modal?.kind === 'create'} onClose={close} onDone={refresh} />
      {modal && modal.kind === 'edit' ? (
        <EditUserDialog u={modal.u} onClose={close} onDone={refresh} />
      ) : null}
      {modal && modal.kind === 'password' ? (
        <ResetPasswordDialog u={modal.u} onClose={close} onDone={refresh} />
      ) : null}
      <ConfirmDialog
        open={modal?.kind === 'signOut'}
        onOpenChange={(v) => !v && close()}
        title={t('settings.users.confirm.signOut.title')}
        description={
          modal && modal.kind === 'signOut'
            ? t('settings.users.confirm.signOut.body', { name: nameOf(modal.u) })
            : ''
        }
        confirmLabel={t('settings.users.signOut')}
        onConfirm={async () => {
          if (modal?.kind !== 'signOut') return
          try {
            const r = await unwrap<{ sessions: number }>(
              api.workspace.members[':userId']['revoke-sessions'].$post({
                param: { userId: modal.u.userId },
              }),
            )
            toast.success(t('settings.users.signedOut', { count: r.sessions }))
            await refresh()
          } catch {
            toast.error(t('task.saveFailed'))
          }
          close()
        }}
      />
      <ConfirmDialog
        open={modal?.kind === 'delete'}
        onOpenChange={(v) => !v && close()}
        title={t('settings.users.confirm.delete.title')}
        description={
          modal && modal.kind === 'delete'
            ? t('settings.users.confirm.delete.body', { name: nameOf(modal.u) })
            : ''
        }
        confirmLabel={t('settings.users.delete')}
        onConfirm={async () => {
          if (modal?.kind !== 'delete') return
          try {
            await unwrap(
              api.workspace.members[':userId'].$delete({
                param: { userId: modal.u.userId },
                query: { purge: '1' },
              }),
            )
            toast.success(t('settings.users.deleted'))
            await refresh()
          } catch {
            toast.error(t('task.saveFailed'))
          }
          close()
        }}
      />
    </section>
  )
}

function CreateUserDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => unknown
}) {
  const { t } = useTranslation()
  const empty = { email: '', username: '', name: '', password: '', role: 'member' as Role }
  const [f, setF] = useState(empty)
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) =>
    setF((v) => ({ ...v, [k]: e.target.value }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrs({})
    try {
      await unwrap(
        api.workspace.users.$post(
          {
            json: { ...f, email: f.email.trim(), username: f.username.trim(), name: f.name.trim() },
          },
          { headers: { 'idempotency-key': newId() } },
        ),
      )
      toast.success(t('settings.users.created', { name: f.name.trim() }))
      setF(empty)
      await onDone()
      onClose()
    } catch (err) {
      const fe = fieldErrors(err)
      if (fe) setErrs(fe)
      else toast.error(t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="user-create-dialog">
        <DialogTitle>{t('settings.users.createTitle')}</DialogTitle>
        <DialogDescription className="mt-1 text-fg-muted text-sm">
          {t('settings.users.createHint')}
        </DialogDescription>
        <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <Field id="cu-name" label={t('settings.users.name')} err={errs.name}>
            <Input id="cu-name" value={f.name} onChange={set('name')} required maxLength={80} />
          </Field>
          <Field id="cu-username" label={t('settings.users.username')} err={errs.username}>
            <Input
              id="cu-username"
              value={f.username}
              onChange={set('username')}
              required
              autoComplete="off"
            />
          </Field>
          <Field id="cu-email" label={t('settings.users.email')} err={errs.email}>
            <Input
              id="cu-email"
              type="email"
              value={f.email}
              onChange={set('email')}
              required
              autoComplete="off"
            />
          </Field>
          <Field id="cu-role" label={t('settings.users.role')}>
            <select
              id="cu-role"
              value={f.role}
              onChange={set('role')}
              className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
            >
              {(['admin', 'member', 'guest'] as const).map((r) => (
                <option key={r} value={r}>
                  {t(`settings.members.roles.${r}`)}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field
              id="cu-password"
              label={t('settings.users.password', { n: PASSWORD_MIN })}
              err={errs.password}
            >
              <div className="flex gap-2">
                <Input
                  id="cu-password"
                  value={f.password}
                  onChange={set('password')}
                  required
                  minLength={PASSWORD_MIN}
                  autoComplete="new-password"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setF((v) => ({ ...v, password: randomPassword() }))}
                >
                  {t('settings.users.generate')}
                </Button>
              </div>
            </Field>
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('ui.action.cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={busy} data-testid="user-create-ok">
              {t('settings.users.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({
  u,
  onClose,
  onDone,
}: {
  u: UserAdminView
  onClose: () => void
  onDone: () => unknown
}) {
  const { t } = useTranslation()
  const [f, setF] = useState({
    displayName: nameOf(u),
    username: u.username ?? '',
    email: u.email,
  })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // 只提交改动过的字段
    const json: { displayName?: string; username?: string; email?: string } = {}
    if (f.displayName.trim() && f.displayName.trim() !== nameOf(u))
      json.displayName = f.displayName.trim()
    if (f.username.trim() && f.username.trim() !== (u.username ?? ''))
      json.username = f.username.trim()
    if (f.email.trim() && f.email.trim().toLowerCase() !== u.email) json.email = f.email.trim()
    if (Object.keys(json).length === 0) return onClose()
    setBusy(true)
    setErrs({})
    try {
      await unwrap(api.workspace.users[':userId'].$patch({ param: { userId: u.userId }, json }))
      toast.success(t('settings.users.saved'))
      await onDone()
      onClose()
    } catch (err) {
      const fe = fieldErrors(err)
      if (fe) setErrs(fe)
      else toast.error(t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="user-edit-dialog">
        <DialogTitle>{t('settings.users.editTitle', { name: nameOf(u) })}</DialogTitle>
        <DialogDescription className="sr-only">{t('settings.users.edit')}</DialogDescription>
        <form className="mt-5 flex flex-col gap-3" onSubmit={submit}>
          <Field id="eu-name" label={t('settings.users.name')} err={errs.displayName}>
            <Input
              id="eu-name"
              value={f.displayName}
              onChange={(e) => setF((v) => ({ ...v, displayName: e.target.value }))}
              maxLength={80}
            />
          </Field>
          <Field id="eu-username" label={t('settings.users.username')} err={errs.username}>
            <Input
              id="eu-username"
              value={f.username}
              onChange={(e) => setF((v) => ({ ...v, username: e.target.value }))}
              autoComplete="off"
            />
          </Field>
          <Field id="eu-email" label={t('settings.users.email')} err={errs.email}>
            <Input
              id="eu-email"
              type="email"
              value={f.email}
              onChange={(e) => setF((v) => ({ ...v, email: e.target.value }))}
              autoComplete="off"
            />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('ui.action.cancel')}
            </Button>
            <Button type="submit" variant="primary" loading={busy} data-testid="user-edit-ok">
              {t('settings.profile.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({
  u,
  onClose,
  onDone,
}: {
  u: UserAdminView
  onClose: () => void
  onDone: () => unknown
}) {
  const { t } = useTranslation()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const r = await unwrap<{ sessions: number }>(
        api.workspace.users[':userId'].password.$post({
          param: { userId: u.userId },
          json: { password: pw },
        }),
      )
      toast.success(t('settings.users.resetDone', { count: r.sessions }))
      await onDone()
      onClose()
    } catch (e2) {
      const fe = fieldErrors(e2)
      if (fe) setErr(fe.password ?? Object.values(fe)[0] ?? null)
      else toast.error(t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="user-password-dialog">
        <DialogTitle>{t('settings.users.resetTitle', { name: nameOf(u) })}</DialogTitle>
        <DialogDescription className="mt-1 text-fg-muted text-sm">
          {t('settings.users.resetHint')}
        </DialogDescription>
        <form className="mt-5 flex flex-col gap-3" onSubmit={submit}>
          <Field
            id="rp-password"
            label={t('settings.users.newPassword', { n: PASSWORD_MIN })}
            err={err}
          >
            <div className="flex gap-2">
              <Input
                id="rp-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                required
                minLength={PASSWORD_MIN}
                autoComplete="new-password"
                className="font-mono"
              />
              <Button type="button" variant="secondary" onClick={() => setPw(randomPassword())}>
                {t('settings.users.generate')}
              </Button>
            </div>
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('ui.action.cancel')}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              loading={busy}
              data-testid="user-password-ok"
            >
              {t('settings.users.resetPassword')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  id,
  label,
  err,
  children,
}: {
  id: string
  label: string
  err?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <FieldError>{err}</FieldError>
    </div>
  )
}
