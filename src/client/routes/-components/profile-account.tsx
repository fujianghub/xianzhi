/**
 * 个人资料 · 头像与账号（ADR-0010；REQ-WS-022 · 023、REQ-ATTACH-007）：
 * 头像上传（POST /me/avatar，附件管线方形裁切）/ 移除（DELETE /me/avatar）；
 * 用户名直接改；邮箱改动须当前密码（PATCH /me/account）。改完回写 ['me'] 并刷新成员缓存（头像 / 名字到处可见）。
 */
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { type FormEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Avatar } from '../../components/ui/avatar.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { FieldError, Label } from '../../components/ui/label.tsx'
import type { Me } from '../../hooks/useMe.ts'
import { ApiError, api, unwrap } from '../../lib/api.ts'

const fieldErr = (err: unknown, path: string) =>
  err instanceof ApiError
    ? (err.problem.errors?.find((e) => e.path === path)?.message ?? null)
    : null

export function ProfileAccount({ me }: { me: Me }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const router = useRouter()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'avatar' | 'username' | 'email' | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [errs, setErrs] = useState<Record<string, string | null>>({})
  const name = me.displayName || me.name

  const refresh = async (next?: Me) => {
    if (next) qc.setQueryData(['me'], next)
    else await qc.invalidateQueries({ queryKey: ['me'] })
    await qc.invalidateQueries({ queryKey: ['workspace', 'members'] })
    await router.invalidate()
  }

  const upload = async (f: File) => {
    setBusy('avatar')
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await fetch('/api/v1/me/avatar', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      })
      if (!r.ok) throw new Error(String(r.status))
      await refresh()
      toast.success(t('settings.profile.avatarUpdated'))
    } catch {
      toast.error(t('settings.profile.avatarFailed'))
    } finally {
      setBusy(null)
      if (file.current) file.current.value = ''
    }
  }
  const removeAvatar = async () => {
    setBusy('avatar')
    try {
      await unwrap(api.me.avatar.$delete())
      await refresh()
      toast.success(t('settings.profile.avatarRemoved'))
    } catch {
      toast.error(t('task.saveFailed'))
    } finally {
      setBusy(null)
    }
  }
  const saveUsername = async () => {
    if (username === null || username.trim() === (me.username ?? '')) return setUsername(null)
    setBusy('username')
    setErrs({})
    try {
      const r = await unwrap<Me>(api.me.account.$patch({ json: { username: username.trim() } }))
      await refresh(r)
      setUsername(null)
      toast.success(t('settings.profile.usernameChanged'))
    } catch (err) {
      setErrs({ username: fieldErr(err, 'username') ?? t('task.saveFailed') })
    } finally {
      setBusy(null)
    }
  }
  const saveEmail = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('email')
    setErrs({})
    try {
      const r = await unwrap<Me>(
        api.me.account.$patch({ json: { email: email.trim(), currentPassword: pw } }),
      )
      await refresh(r)
      setEmailOpen(false)
      setEmail('')
      setPw('')
      toast.success(t('settings.profile.emailChanged'))
    } catch (err) {
      setErrs({
        email: fieldErr(err, 'email'),
        currentPassword: fieldErr(err, 'currentPassword'),
      })
      if (!(err instanceof ApiError) || !err.problem.errors?.length)
        toast.error(t('task.saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="profile-account">
      <div className="flex items-center gap-4">
        <Avatar id={me.id} name={name} src={me.image} size={64} className="text-lg" />
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={busy === 'avatar'}
              onClick={() => file.current?.click()}
              data-testid="avatar-upload"
            >
              {me.image ? t('settings.profile.avatarChange') : t('settings.profile.avatarUpload')}
            </Button>
            {me.image ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === 'avatar'}
                onClick={() => void removeAvatar()}
                data-testid="avatar-remove"
              >
                {t('settings.profile.avatarRemove')}
              </Button>
            ) : null}
          </div>
          <span className="text-fg-muted text-xs">{t('settings.profile.avatarHint')}</span>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="hidden"
            data-testid="avatar-file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <Label htmlFor="profile-username" className="text-fg-muted text-xs">
          {t('settings.profile.username')}
        </Label>
        <div className="flex gap-2">
          <Input
            id="profile-username"
            value={username ?? me.username ?? ''}
            placeholder={t('settings.profile.usernameEmpty')}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveUsername()
            }}
            autoComplete="username"
            data-testid="profile-username"
          />
          {username !== null && username.trim() !== (me.username ?? '') ? (
            <Button
              variant="primary"
              loading={busy === 'username'}
              onClick={() => void saveUsername()}
              data-testid="profile-username-save"
            >
              {t('settings.profile.save')}
            </Button>
          ) : null}
        </div>
        <FieldError>{errs.username}</FieldError>
        <span className="text-fg-muted text-xs">{t('settings.profile.usernameHint')}</span>
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <Label htmlFor="profile-email" className="text-fg-muted text-xs">
          {t('settings.profile.email')}
        </Label>
        <div className="flex gap-2">
          <Input id="profile-email" value={me.email} disabled data-testid="profile-email" />
          {!emailOpen ? (
            <Button
              variant="secondary"
              onClick={() => {
                setEmailOpen(true)
                setEmail(me.email)
              }}
              data-testid="profile-email-edit"
            >
              {t('settings.profile.edit')}
            </Button>
          ) : null}
        </div>
        {emailOpen ? (
          <form
            className="paper mt-1 flex flex-col gap-3 rounded-lg p-4"
            onSubmit={saveEmail}
            data-testid="profile-email-form"
          >
            <div>
              <Label htmlFor="new-email">{t('settings.profile.newEmail')}</Label>
              <Input
                id="new-email"
                type="email"
                className="mt-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <FieldError>{errs.email}</FieldError>
            </div>
            <div>
              <Label htmlFor="email-pw">{t('settings.profile.currentPassword')}</Label>
              <Input
                id="email-pw"
                type="password"
                className="mt-1"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="current-password"
                required
              />
              <FieldError>{errs.currentPassword}</FieldError>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEmailOpen(false)
                  setErrs({})
                }}
              >
                {t('ui.action.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={busy === 'email'}
                data-testid="profile-email-save"
              >
                {t('settings.profile.changeEmail')}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  )
}
