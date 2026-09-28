/**
 * 新建 / 编辑模板（ADR-0023、REQ-TPL-010）：名称 · 描述 · 记录类型（内置）· 适用空间 · 共享给工作区成员（服务端 canShare）· 正文编辑器。
 * 编辑时只提交改动过的字段并带 ifUpdatedAt（409 → 提示刷新）；不可管理的模板只读，可「复制到我的」。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { lazy, Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  type BuiltinEntryKind,
  SPACE_KINDS,
  type SpaceKind,
} from '../../../shared/schemas/enums.ts'
import type { PmNode } from '../../../shared/schemas/pm.ts'
import type { TemplateEditorHandle } from '../../editor/TemplateEditor.tsx'
import { api, unwrap } from '../../lib/api.ts'
import { useKindOptions } from '../../lib/entry-types.ts'
import {
  copyTemplate,
  invalidateTemplates,
  invalidateTemplatesAndSpaces,
  patchTemplate,
  type Template,
  type TemplateDetail,
  type TemplatePatch,
  templateListQuery,
  templateSaveError,
} from '../../lib/template-queries.ts'
import { newId } from '../../lib/uuid.ts'
import { Button } from '../ui/button.tsx'
import { Checkbox } from '../ui/checkbox.tsx'
import { Input } from '../ui/input.tsx'
import { Label } from '../ui/label.tsx'
import { PageHeader } from '../ui/page-header.tsx'
import { Skeleton } from '../ui/skeleton.tsx'

const TemplateEditor = lazy(() => import('../../editor/TemplateEditor.tsx'))

const EMPTY_DOC: PmNode = { type: 'doc', content: [{ type: 'paragraph' }] }
const select = 'h-9 rounded-md border border-border bg-surface px-2 text-sm'

export function TemplateForm({ tpl }: { tpl?: TemplateDetail }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const nav = useNavigate()
  const list = useQuery(templateListQuery)
  const canShare = list.data?.canShare ?? false
  // 新建：列表未到前先按可编辑渲染，避免成员看到禁用闪烁；guest（canShare=false）只读
  const editable = tpl ? tpl.canManage : (list.data?.canShare ?? true)
  const kindOptions = useKindOptions().filter((k) => k.kind !== 'custom')
  const [name, setName] = useState(tpl?.name ?? '')
  const [description, setDescription] = useState(tpl?.description ?? '')
  const [kind, setKind] = useState<BuiltinEntryKind>((tpl?.kind as BuiltinEntryKind) ?? 'note')
  const [spaceKind, setSpaceKind] = useState<SpaceKind | ''>(tpl?.spaceKinds[0] ?? '')
  const [shared, setShared] = useState(tpl?.source === 'workspace')
  const editorRef = useRef<TemplateEditorHandle | null>(null)
  const back = () => void nav({ to: '/settings/templates' })
  // 当前类型已被删除时仍列出，避免下拉框空值
  const kinds = kindOptions.some((k) => k.kind === kind)
    ? kindOptions
    : [{ kind, label: t(`entry.kind.${kind}`) }, ...kindOptions]

  const save = useMutation({
    mutationFn: async () => {
      const body = editorRef.current?.getBody() ?? tpl?.body ?? EMPTY_DOC
      const scope = shared ? ('workspace' as const) : ('personal' as const)
      if (!tpl)
        return unwrap<Template>(
          api.templates.$post(
            {
              json: {
                name: name.trim(),
                description: description.trim(),
                kind,
                spaceKind: spaceKind || null,
                scope,
                body: body as never,
              },
            },
            { headers: { 'idempotency-key': newId() } },
          ),
        )
      const patch: TemplatePatch = {}
      if (name.trim() !== tpl.name) patch.name = name.trim()
      if (description.trim() !== tpl.description) patch.description = description.trim()
      if (kind !== tpl.kind) patch.kind = kind
      if ((spaceKind || null) !== (tpl.spaceKinds[0] ?? null)) patch.spaceKind = spaceKind || null
      if (scope !== tpl.source) patch.scope = scope
      if (JSON.stringify(body) !== JSON.stringify(tpl.body)) patch.body = body
      if (!Object.keys(patch).length) return null
      return patchTemplate(tpl, patch)
    },
    onSuccess: (r) => {
      if (r)
        toast.success(tpl ? t('template.savedTemplate') : t('template.created', { name: r.name }))
      void (tpl && tpl.source !== (shared ? 'workspace' : 'personal')
        ? invalidateTemplatesAndSpaces(qc)
        : invalidateTemplates(qc))
      back()
    },
    onError: templateSaveError(qc, t),
  })
  const submit = () => {
    if (editable && name.trim() && !save.isPending) save.mutate()
  }
  const copy = useMutation({
    mutationFn: () =>
      copyTemplate(tpl?.id ?? '', t('template.copyName', { name: tpl?.name ?? '' }).slice(0, 60)),
    onSuccess: (r) => {
      toast.success(t('template.copied', { name: r.name }))
      void invalidateTemplates(qc)
      void nav({ to: '/settings/templates/$templateId', params: { templateId: r.id } })
    },
    onError: () => toast.error(t('task.saveFailed')),
  })

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="template-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Link
        to="/settings/templates"
        className="inline-flex w-fit items-center gap-1 text-fg-muted text-xs hover:text-fg"
      >
        <ArrowLeft className="size-3.5" />
        {t('template.backToList')}
      </Link>
      <PageHeader
        title={tpl ? t('template.editTitle') : t('template.newTitle')}
        className="mb-0"
        actions={
          editable ? (
            <>
              <Button type="button" size="sm" variant="ghost" onClick={back}>
                {t('ui.action.cancel')}
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                loading={save.isPending}
                disabled={!name.trim()}
                data-testid="template-save"
              >
                {t('template.save')}
              </Button>
            </>
          ) : tpl && canShare ? (
            <Button
              type="button"
              size="sm"
              variant="primary"
              loading={copy.isPending}
              onClick={() => copy.mutate()}
              data-testid="template-copy"
            >
              {t('template.copyToMine')}
            </Button>
          ) : null
        }
      />
      {!editable ? (
        <p
          className="rounded-md bg-surface-2 px-3 py-2 text-fg-muted text-sm"
          data-testid="template-readonly"
        >
          {t('template.readOnly')}
        </p>
      ) : null}
      <fieldset disabled={!editable} className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-name">{t('template.name')}</Label>
          <Input
            id="tpl-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!tpl}
            data-testid="template-name"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-desc">{t('template.description')}</Label>
          <Input
            id="tpl-desc"
            value={description}
            maxLength={200}
            placeholder={t('template.descriptionPlaceholder')}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="template-description"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-kind">{t('template.kind')}</Label>
          <select
            id="tpl-kind"
            className={select}
            value={kind}
            onChange={(e) => setKind(e.target.value as BuiltinEntryKind)}
            data-testid="template-kind"
          >
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tpl-space-kind">{t('template.spaceKind')}</Label>
          <select
            id="tpl-space-kind"
            className={select}
            value={spaceKind}
            onChange={(e) => setSpaceKind(e.target.value as SpaceKind | '')}
            data-testid="template-space-kind"
          >
            <option value="">{t('template.spaceKindAny')}</option>
            {SPACE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`space.kind.${k}`)}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      {editable && canShare ? (
        <div className="flex flex-col gap-1">
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={shared}
              onCheckedChange={(v) => setShared(v === true)}
              data-testid="template-form-share"
            />
            {t('template.share')}
          </label>
          <p className="ps-7 text-fg-muted text-xs">
            {t('template.shareHint')}
            {tpl && !shared && tpl.source === 'workspace' && tpl.spaceDefaults > 0
              ? ` ${t('template.defaultsWarning', { count: tpl.spaceDefaults })}`
              : ''}
          </p>
        </div>
      ) : null}
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <TemplateEditor
          initial={tpl?.body ?? EMPTY_DOC}
          editable={editable}
          onSave={submit}
          handleRef={editorRef}
        />
      </Suspense>
    </form>
  )
}

/** 编辑页加载中的占位。 */
export function TemplateFormSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
