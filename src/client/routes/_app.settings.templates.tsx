/**
 * 模板管理（ADR-0011 §2、REQ-TPL-004）：内置（开发 / 学习）只读，可预览与「用此模板新建」；
 * 我的 / 工作区模板可预览、重命名、切换范围（工作区需管理员，服务端 can('template.*') 判定）、删除。
 * 新建自定义模板的入口在记录「属性」页的「另存为模板」。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Eye, FilePlus2, Pencil, Trash2 } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '../components/ui/confirm-dialog.tsx'
import { Input } from '../components/ui/input.tsx'
import { PageHeader } from '../components/ui/page-header.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { isAdmin, type Me } from '../hooks/useMe.ts'
import { api, unwrap } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { useNewEntry } from '../lib/stores.ts'
import { invalidateTemplates, type Template, templatesQuery } from '../lib/template-queries.ts'

const TemplatePreview = lazy(() => import('../editor/TemplatePreview.tsx'))

export const Route = createFileRoute('/_app/settings/templates')({ component: TemplatesPage })

function TemplatesPage() {
  const { t } = useTranslation()
  const { me } = Route.useRouteContext() as { me: Me }
  const q = useQuery(templatesQuery)
  const [preview, setPreview] = useState<Template | null>(null)
  const openNew = useNewEntry((s) => s.setOpen)
  const use = (tpl: Template) => {
    setPreview(null)
    openNew(true, { kind: tpl.kind, templateId: tpl.id })
  }
  const groups = [
    { key: 'builtin', items: (q.data ?? []).filter((x) => x.source === 'builtin') },
    { key: 'personal', items: (q.data ?? []).filter((x) => x.source === 'personal') },
    { key: 'workspace', items: (q.data ?? []).filter((x) => x.source === 'workspace') },
  ] as const
  return (
    <div className="flex flex-col gap-6" data-testid="templates-page">
      <PageHeader title={t('template.title')} description={t('template.manageHint')} />
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
                  admin={isAdmin(me)}
                  onPreview={() => setPreview(tpl)}
                  onUse={() => use(tpl)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-fg-muted text-sm">{t('template.empty')}</p>
          )}
        </section>
      ))}
      {preview ? (
        <Suspense fallback={null}>
          <TemplatePreview
            id={preview.id}
            onClose={() => setPreview(null)}
            onUse={() => use(preview)}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

function TemplateRow({
  tpl,
  admin,
  onPreview,
  onUse,
}: {
  tpl: Template
  admin: boolean
  onPreview: () => void
  onUse: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(tpl.name)
  const [confirm, setConfirm] = useState(false)
  const patch = useMutation({
    mutationFn: (body: { name?: string; scope?: 'personal' | 'workspace' }) =>
      unwrap<Template>(api.templates[':id'].$patch({ param: { id: tpl.id }, json: body })),
    onSuccess: () => {
      setEditing(false)
      void invalidateTemplates(qc)
    },
    onError: () => toast.error(t('task.saveFailed')),
  })
  const remove = async () => {
    await unwrap(api.templates[':id'].$delete({ param: { id: tpl.id } }))
    toast.success(t('template.deleted'))
    void invalidateTemplates(qc)
  }
  const icon = 'grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover'
  return (
    <li
      className="paper flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5"
      data-testid="template-row"
      data-template-id={tpl.id}
    >
      <div className="flex items-center gap-2">
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
        <span className="shrink-0 text-fg-faint text-xs">{t(`entry.kind.${tpl.kind}`)}</span>
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
            <button
              type="button"
              className={icon}
              aria-label={t('template.rename')}
              title={t('template.rename')}
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              className={cn(icon, 'hover:text-danger')}
              aria-label={t('template.delete')}
              title={t('template.delete')}
              onClick={() => setConfirm(true)}
              data-testid="template-delete"
            >
              <Trash2 className="size-4" />
            </button>
          </>
        ) : null}
      </div>
      <p className="line-clamp-2 text-fg-muted text-xs">{tpl.description}</p>
      {tpl.canManage && admin ? (
        <label className="mt-1 flex items-center gap-2 text-fg-muted text-xs">
          {t('template.saveAsScope')}
          <select
            value={tpl.source === 'workspace' ? 'workspace' : 'personal'}
            onChange={(e) => patch.mutate({ scope: e.target.value as 'personal' | 'workspace' })}
            className="h-7 rounded-md border border-border bg-surface px-1.5"
          >
            <option value="personal">{t('template.scope.personal')}</option>
            <option value="workspace">{t('template.scope.workspace')}</option>
          </select>
        </label>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('template.delete')}
        description={t('template.deleteConfirm', { name: tpl.name })}
        confirmLabel={t('template.delete')}
        onConfirm={remove}
      />
    </li>
  )
}
