/**
 * 模板管理（ADR-0011 §2 · ADR-0023、REQ-TPL-004 · 010）：内置（开发 / 学习）只读，可预览、「用此模板新建」、「复制到我的」；
 * 我的 / 工作区共享模板可预览、编辑（/settings/templates/:id）、重命名、共享 / 取消共享（服务端 canShare 决定是否显示）、删除；
 * 他人共享的模板显示作者，可「复制到我的」。`?preview=<id>` 直接打开预览（「复制链接」分享给同工作区成员）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Copy, Eye, FilePlus2, Link2, Pencil, Plus, SquarePen, Trash2 } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { KindBadge } from '../components/domain/KindIcon.tsx'
import { buttonVariants } from '../components/ui/button.tsx'
import { Checkbox } from '../components/ui/checkbox.tsx'
import { ConfirmDialog } from '../components/ui/confirm-dialog.tsx'
import { Input } from '../components/ui/input.tsx'
import { PageHeader } from '../components/ui/page-header.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { api, unwrap } from '../lib/api.ts'
import { copyText } from '../lib/clipboard.ts'
import { cn } from '../lib/cn.ts'
import { useNewEntry } from '../lib/stores.ts'
import {
  copyTemplate,
  invalidateTemplates,
  invalidateTemplatesAndSpaces,
  optTemplateId,
  patchTemplate,
  type Template,
  type TemplatePatch,
  templateListQuery,
  templateSaveError,
} from '../lib/template-queries.ts'

const TemplatePreview = lazy(() => import('../editor/TemplatePreview.tsx'))

type Search = { preview?: string }

export const Route = createFileRoute('/_app/settings/templates')({
  validateSearch: (s: Record<string, unknown>): Search => ({ preview: optTemplateId(s.preview) }),
  component: TemplatesPage,
})

/** 作者显示名：账号已删为空串。 */
export function useOwnerLabel() {
  const { t } = useTranslation()
  return (tpl: Pick<Template, 'ownerName'>) => tpl.ownerName || t('template.deletedUser')
}

function TemplatesPage() {
  const { t } = useTranslation()
  const { preview } = Route.useSearch()
  const nav = useNavigate({ from: '/settings/templates' })
  const q = useQuery(templateListQuery)
  const items = q.data?.items ?? []
  const canShare = q.data?.canShare ?? false
  const openNew = useNewEntry((s) => s.setOpen)
  const setPreview = (id: string | undefined) =>
    void nav({ search: (s) => ({ ...s, preview: id }), replace: true })
  const use = (tpl: Pick<Template, 'id' | 'kind' | 'typeId'>) => {
    setPreview(undefined)
    openNew(true, {
      kind: tpl.kind,
      ...(tpl.typeId ? { typeId: tpl.typeId } : {}),
      templateId: tpl.id,
    })
  }
  const previewing = preview ? items.find((x) => x.id === preview) : undefined
  const groups = [
    { key: 'builtin', items: items.filter((x) => x.source === 'builtin') },
    { key: 'personal', items: items.filter((x) => x.source === 'personal') },
    { key: 'workspace', items: items.filter((x) => x.source === 'workspace') },
  ] as const
  return (
    <div className="flex flex-col gap-6" data-testid="templates-page">
      <PageHeader
        title={t('template.title')}
        description={t('template.manageHint')}
        className="mb-0"
        actions={
          // canShare 与 template.create 同一判定（非 guest）：guest 不给新建 / 复制入口
          canShare ? (
            <Link
              to="/settings/templates/new"
              className={buttonVariants({ size: 'sm', variant: 'primary' })}
              data-testid="template-new"
            >
              <Plus className="size-4" />
              {t('template.newTemplate')}
            </Link>
          ) : null
        }
      />
      {q.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-2" data-testid={`templates-${g.key}`}>
          <h2 className="font-medium text-sm">{t(`template.groups.${g.key}`)}</h2>
          {g.items.length ? (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {g.items.map((tpl) => (
                <TemplateRow
                  key={tpl.id}
                  tpl={tpl}
                  canShare={canShare}
                  onPreview={() => setPreview(tpl.id)}
                  onUse={() => use(tpl)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-fg-muted text-sm">{t('template.empty')}</p>
          )}
        </section>
      ))}
      {preview && (previewing || !q.isPending) ? (
        <Suspense fallback={null}>
          <TemplatePreview
            id={preview}
            onClose={() => setPreview(undefined)}
            onUse={previewing ? () => use(previewing) : undefined}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

function TemplateRow({
  tpl,
  canShare,
  onPreview,
  onUse,
}: {
  tpl: Template
  canShare: boolean
  onPreview: () => void
  onUse: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const ownerLabel = useOwnerLabel()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(tpl.name)
  const [confirm, setConfirm] = useState<'delete' | 'unshare' | null>(null)
  const patch = useMutation({
    mutationFn: (body: TemplatePatch) => patchTemplate(tpl, body),
    onSuccess: (r, body) => {
      setEditing(false)
      if (body.scope)
        toast.success(t(body.scope === 'workspace' ? 'template.shared' : 'template.unshared'))
      void (body.scope ? invalidateTemplatesAndSpaces(qc) : invalidateTemplates(qc))
      return r
    },
    onError: templateSaveError(qc, t),
  })
  const copy = useMutation({
    mutationFn: () => copyTemplate(tpl.id, t('template.copyName', { name: tpl.name }).slice(0, 60)),
    onSuccess: (r) => {
      toast.success(t('template.copied', { name: r.name }))
      void invalidateTemplates(qc)
    },
    onError: () => toast.error(t('task.saveFailed')),
  })
  const remove = async () => {
    await unwrap(api.templates[':id'].$delete({ param: { id: tpl.id } }))
    toast.success(t('template.deleted'))
    void invalidateTemplatesAndSpaces(qc)
  }
  const copyLink = () =>
    void copyText(
      `${location.origin}/settings/templates?preview=${encodeURIComponent(tpl.id)}`,
    ).then((ok) => ok && toast.success(t('template.linkCopied')))
  const shared = tpl.source === 'workspace'
  const toggleShare = (next: boolean) => {
    if (!next && tpl.spaceDefaults > 0) setConfirm('unshare')
    else patch.mutate({ scope: next ? 'workspace' : 'personal' })
  }
  const defaultsNote =
    tpl.spaceDefaults > 0 ? ` ${t('template.defaultsWarning', { count: tpl.spaceDefaults })}` : ''
  const icon = 'grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover'
  return (
    <li
      className="paper flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5"
      data-testid="template-row"
      data-template-id={tpl.id}
    >
      <div className="flex items-center gap-1">
        {editing ? (
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) patch.mutate({ name: name.trim() })
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={t('template.rename')}
              maxLength={60}
              autoFocus
              onBlur={() => setEditing(false)}
              data-testid="template-rename-input"
            />
          </form>
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium text-sm">{tpl.name}</span>
        )}
        <span className="me-1 shrink-0">
          <KindBadge kind={tpl.kind} typeId={tpl.typeId} />
        </span>
        <button
          type="button"
          className={icon}
          aria-label={t('template.preview')}
          title={t('template.preview')}
          onClick={onPreview}
          data-testid="template-preview-open"
        >
          <Eye className="size-4" />
        </button>
        <button
          type="button"
          className={icon}
          aria-label={t('template.useIt')}
          title={t('template.useIt')}
          onClick={onUse}
          data-testid="template-use-row"
        >
          <FilePlus2 className="size-4" />
        </button>
        {tpl.canManage ? (
          <>
            <Link
              to="/settings/templates/$templateId"
              params={{ templateId: tpl.id }}
              className={icon}
              aria-label={t('template.edit')}
              title={t('template.edit')}
              data-testid="template-edit"
            >
              <SquarePen className="size-4" />
            </Link>
            <button
              type="button"
              className={icon}
              aria-label={t('template.rename')}
              title={t('template.rename')}
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" />
            </button>
          </>
        ) : null}
        {canShare && (tpl.source !== 'personal' || !tpl.canManage) ? (
          <button
            type="button"
            className={icon}
            aria-label={t('template.copyToMine')}
            title={t('template.copyToMine')}
            onClick={() => copy.mutate()}
            disabled={copy.isPending}
            data-testid="template-copy"
          >
            <Copy className="size-4" />
          </button>
        ) : null}
        {tpl.source !== 'personal' ? (
          <button
            type="button"
            className={icon}
            aria-label={t('template.copyLink')}
            title={t('template.copyLink')}
            onClick={copyLink}
            data-testid="template-copy-link"
          >
            <Link2 className="size-4" />
          </button>
        ) : null}
        {tpl.canManage ? (
          <button
            type="button"
            className={cn(icon, 'hover:text-danger')}
            aria-label={t('template.delete')}
            title={t('template.delete')}
            onClick={() => setConfirm('delete')}
            data-testid="template-delete"
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
      {tpl.description ? (
        <p className="line-clamp-2 text-fg-muted text-xs">{tpl.description}</p>
      ) : null}
      {shared ? (
        <p className="text-fg-faint text-xs" data-testid="template-owner">
          {t('template.sharedBy', { name: ownerLabel(tpl) })}
        </p>
      ) : null}
      {tpl.canManage && canShare ? (
        <label className="mt-1 flex w-fit cursor-pointer items-center gap-2 text-fg-muted text-xs">
          <Checkbox
            checked={shared}
            disabled={patch.isPending}
            onCheckedChange={(v) => toggleShare(v === true)}
            data-testid="template-share"
          />
          {t('template.share')}
        </label>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={t(confirm === 'unshare' ? 'template.unshare' : 'template.delete')}
        description={
          confirm === 'unshare'
            ? t('template.unshareConfirm', { name: tpl.name }) + defaultsNote
            : t('template.deleteConfirm', { name: tpl.name }) + defaultsNote
        }
        confirmLabel={t(confirm === 'unshare' ? 'template.unshare' : 'template.delete')}
        onConfirm={() =>
          confirm === 'unshare' ? patch.mutateAsync({ scope: 'personal' }) : remove()
        }
      />
    </li>
  )
}
