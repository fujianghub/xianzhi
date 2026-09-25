/**
 * 成员（08 §2.13、T1-043 · T1-039、REQ-WS-002 · 003 · 004 · 014、REQ-AUTH-018 · 019）：`?tab=members|requests|invitations`；
 * 改角色（owner 只能转让）、停用 / 恢复、移除（确认）；注册审批（选角色批准 / 驳回删号，ADR-0008）；
 * 邀请（邮箱 + 角色）与撤销；owner 可转让所有权。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { InvitationView } from '../../server/services/invitations.ts'
import type { JoinRequestView } from '../../server/services/join-requests.ts'
import { Avatar } from '../components/ui/avatar.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog } from '../components/ui/confirm-dialog.tsx'
import { Input } from '../components/ui/input.tsx'
import { RelativeTime } from '../components/ui/relative-time.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import type { Me } from '../hooks/useMe.ts'
import { type Member, memberName, membersQuery } from '../hooks/useMembers.ts'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { optOneOf } from '../lib/search.ts'
import { requireAdmin } from './-components/admin-gate.ts'

const TABS = ['members', 'requests', 'invitations'] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute('/_app/settings/workspace/members')({
  beforeLoad: requireAdmin,
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({ tab: optOneOf(TABS)(s.tab) }),
  component: Members,
})

type Confirm =
  | { kind: 'remove' | 'suspend' | 'transfer'; m: Member }
  | { kind: 'reject'; r: JoinRequestView }
  | null

function Members() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { me } = Route.useRouteContext() as { me: Me }
  const { tab = 'members' } = Route.useSearch()
  const nav = useNavigate({ from: '/settings/workspace/members' })
  const members = useQuery(membersQuery)
  const invitations = useQuery({
    queryKey: ['workspace', 'invitations'],
    queryFn: () =>
      unwrap<{ items: InvitationView[] }>(api.workspace.invitations.$get()).then((r) => r.items),
    enabled: tab === 'invitations',
  })
  // 待审批数常驻（tab 徽标）
  const requests = useQuery({
    queryKey: ['workspace', 'join-requests'],
    queryFn: () =>
      unwrap<{ items: JoinRequestView[] }>(api.workspace['join-requests'].$get()).then(
        (r) => r.items,
      ),
  })
  const [approveRole, setApproveRole] = useState<Record<string, 'member' | 'admin' | 'guest'>>({})
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'admin' | 'guest'>('member')
  const refresh = () => qc.invalidateQueries({ queryKey: ['workspace'] })
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      await refresh()
      toast.success(ok)
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'CONFLICT_LAST_OWNER'
          ? t('settings.members.lastOwner')
          : t('task.saveFailed'),
      )
    }
  }
  const invite = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    await act(
      () =>
        unwrap(api.workspace.invitations.$post({ json: { email: email.trim(), role } as never })),
      t('settings.members.invited', { email: email.trim() }),
    )
    setEmail('')
  }
  const tabBtn = (k: Tab) => (
    <button
      key={k}
      type="button"
      role="tab"
      aria-selected={tab === k}
      onClick={() => void nav({ search: { tab: k === 'members' ? undefined : k }, replace: true })}
      className={cn(
        'h-8 rounded-full px-3 text-sm',
        tab === k ? 'bg-selected font-medium' : 'text-fg-muted hover:text-fg',
      )}
    >
      {t(`settings.members.tab.${k}`)}
      {k === 'requests' && requests.data?.length ? (
        <span
          className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-medium text-[11px] text-primary-fg"
          data-testid="requests-badge"
        >
          {requests.data.length}
        </span>
      ) : null}
    </button>
  )
  const owner = me.workspaceRole === 'owner'
  return (
    <section className="max-w-5xl" data-testid="settings-members">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-semibold text-2xl tracking-tight">{t('settings.nav.members')}</h1>
        <div
          role="tablist"
          aria-label={t('settings.nav.members')}
          className="flex rounded-full border border-border p-0.5"
        >
          {TABS.map(tabBtn)}
        </div>
      </div>
      <form
        onSubmit={invite}
        className="paper mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-divider p-4"
      >
        <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-sm">
          <span className="text-fg-muted text-xs">{t('settings.members.inviteEmail')}</span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="invite-email"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-muted text-xs">{t('settings.members.role')}</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="h-10 rounded-md border border-border bg-surface px-3"
          >
            {(['member', 'admin', 'guest'] as const).map((r) => (
              <option key={r} value={r}>
                {t(`settings.members.roles.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={!email.trim()}
          data-testid="invite-submit"
        >
          {t('settings.members.invite')}
        </Button>
      </form>

      {tab === 'members' ? (
        members.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <ul className="paper divide-y divide-divider overflow-hidden rounded-lg border border-divider">
            {(members.data ?? []).map((m) => {
              const self = m.userId === me.id
              const isOwner = m.role === 'owner'
              return (
                <li
                  key={m.userId}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                  data-testid="member-row"
                  data-user={m.userId}
                >
                  <Avatar id={m.userId} name={memberName(m)} src={m.image} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {memberName(m)}
                      {m.status === 'suspended' ? (
                        <span
                          className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-xs"
                          data-testid="suspended-badge"
                        >
                          {t('settings.members.suspended')}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-fg-muted text-xs">{m.email}</span>
                  </span>
                  {isOwner ? (
                    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs">
                      {t('settings.members.roles.owner')}
                    </span>
                  ) : (
                    <select
                      value={m.role}
                      disabled={self}
                      aria-label={t('settings.members.role')}
                      onChange={(e) =>
                        void act(
                          () =>
                            unwrap(
                              api.workspace.members[':userId'].$patch({
                                param: { userId: m.userId },
                                json: { role: e.target.value as 'member' },
                              }),
                            ),
                          t('settings.members.roleChanged'),
                        )
                      }
                      className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
                    >
                      {(['admin', 'member', 'guest'] as const).map((r) => (
                        <option key={r} value={r}>
                          {t(`settings.members.roles.${r}`)}
                        </option>
                      ))}
                    </select>
                  )}
                  {!self && !isOwner ? (
                    <>
                      {m.status === 'suspended' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void act(
                              () =>
                                unwrap(
                                  api.workspace.members[':userId'].unsuspend.$post({
                                    param: { userId: m.userId },
                                  }),
                                ),
                              t('settings.members.unsuspended'),
                            )
                          }
                        >
                          {t('settings.members.unsuspend')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirm({ kind: 'suspend', m })}
                          data-testid="member-suspend"
                        >
                          {t('settings.members.suspend')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setConfirm({ kind: 'remove', m })}
                      >
                        {t('settings.members.remove')}
                      </Button>
                    </>
                  ) : null}
                  {owner && !self && m.status === 'active' && !isOwner && m.role !== 'guest' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirm({ kind: 'transfer', m })}
                    >
                      {t('settings.members.transfer')}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )
      ) : tab === 'requests' ? (
        requests.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <ul
            className="paper divide-y divide-divider overflow-hidden rounded-lg border border-divider"
            data-testid="join-requests"
          >
            {(requests.data ?? []).length ? (
              (requests.data ?? []).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                  data-testid="join-request-row"
                >
                  <Avatar id={r.userId} name={r.name} src={null} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {r.name}
                      {r.username ? (
                        <span className="ml-2 font-normal text-fg-muted">@{r.username}</span>
                      ) : null}
                    </span>
                    <span className="block truncate text-fg-muted text-xs">
                      {r.email} · {t('settings.members.requestedAt')}{' '}
                      <RelativeTime date={r.createdAt} />
                    </span>
                  </span>
                  <select
                    value={approveRole[r.id] ?? 'member'}
                    aria-label={t('settings.members.role')}
                    onChange={(e) =>
                      setApproveRole((m) => ({ ...m, [r.id]: e.target.value as 'member' }))
                    }
                    className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    {(['member', 'admin', 'guest'] as const).map((x) => (
                      <option key={x} value={x}>
                        {t(`settings.members.roles.${x}`)}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="primary"
                    data-testid="join-approve"
                    onClick={() =>
                      void act(
                        () =>
                          unwrap(
                            api.workspace['join-requests'][':id'].approve.$post({
                              param: { id: r.id },
                              json: { role: approveRole[r.id] ?? 'member' },
                            }),
                          ),
                        t('settings.members.approved', { name: r.name }),
                      )
                    }
                  >
                    {t('settings.members.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    data-testid="join-reject"
                    onClick={() => setConfirm({ kind: 'reject', r })}
                  >
                    {t('settings.members.reject')}
                  </Button>
                </li>
              ))
            ) : (
              <li className="px-4 py-6 text-center text-fg-muted text-sm">
                {t('settings.members.noRequests')}
              </li>
            )}
          </ul>
        )
      ) : invitations.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <ul className="paper divide-y divide-divider overflow-hidden rounded-lg border border-divider">
          {(invitations.data ?? []).length ? (
            (invitations.data ?? []).map((iv) => (
              <li
                key={iv.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                data-testid="invitation-row"
              >
                <span className="min-w-0 flex-1 truncate">{iv.email}</span>
                <span className="text-fg-muted text-xs">
                  {t(`settings.members.roles.${iv.role}`, { defaultValue: iv.role })}
                </span>
                <span className="text-fg-muted text-xs">
                  {t(`settings.members.inviteStatus.${iv.status}`, { defaultValue: iv.status })}
                </span>
                <span className="text-fg-muted text-xs">
                  {t('settings.members.expires')} <RelativeTime date={iv.expiresAt} />
                </span>
                {iv.status === 'pending' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void act(
                        () =>
                          unwrap(
                            api.workspace.invitations[':id'].$delete({ param: { id: iv.id } }),
                          ),
                        t('settings.members.inviteRevoked'),
                      )
                    }
                  >
                    {t('settings.members.revokeInvite')}
                  </Button>
                ) : null}
              </li>
            ))
          ) : (
            <li className="px-4 py-6 text-center text-fg-muted text-sm">
              {t('settings.members.noInvites')}
            </li>
          )}
        </ul>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm ? t(`settings.members.confirm.${confirm.kind}.title`) : ''}
        description={
          confirm
            ? t(`settings.members.confirm.${confirm.kind}.body`, {
                name: confirm.kind === 'reject' ? confirm.r.name : memberName(confirm.m),
              })
            : ''
        }
        confirmLabel={confirm ? t(`settings.members.${confirm.kind}`) : ''}
        onConfirm={() => {
          if (!confirm) return
          if (confirm.kind === 'reject') {
            const rid = confirm.r.id
            return act(
              () =>
                unwrap(api.workspace['join-requests'][':id'].reject.$post({ param: { id: rid } })),
              t('settings.members.rejected'),
            )
          }
          const id = confirm.m.userId
          if (confirm.kind === 'remove')
            return act(
              () =>
                unwrap(
                  api.workspace.members[':userId'].$delete({ param: { userId: id }, query: {} }),
                ),
              t('settings.members.removed'),
            )
          if (confirm.kind === 'suspend')
            return act(
              () =>
                unwrap(api.workspace.members[':userId'].suspend.$post({ param: { userId: id } })),
              t('settings.members.suspendedToast'),
            )
          return act(
            () => unwrap(api.workspace['owner-transfer'].$post({ json: { toUserId: id } })),
            t('settings.members.transferred'),
          )
        }}
      />
    </section>
  )
}
