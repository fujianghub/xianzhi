/**
 * 新建 / 编辑模板（ADR-0023、REQ-TPL-010）：名称 · 描述 · 记录类型 · 适用空间 · 共享给工作区成员（服务端 canShare）· 正文编辑器。
 * 编辑时只提交改动过的字段并带 ifUpdatedAt（409 → 提示刷新）；不可管理的模板只读，可「复制到我的」。
 * ADR-0036（REQ-TPL-011）：类型可选内置 / 空间类型 / 本人个人类型（工作区模板不能绑个人类型）；
 * 「字段预填」按所绑类型的字段（含自定义字段）预置值；可就地编辑该类型的字段定义（有权限时，影响该类型全部记录）。
 * ADR-0038（REQ-TPL-013 · 015）：所有者可直接编辑代码内置模板（只能用内置类型、不能改共享范围，可「恢复默认」），
 * 新建时可「设为内置模板」（全员可见、仅所有者可改）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { lazy, Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { defaultEntryFields } from '../../../shared/schemas/entryFields.ts'
import {
  type BuiltinEntryKind,
  type EntryKind,
  SPACE_KINDS,
  type SpaceKind,
  type TemplateScope,
} from '../../../shared/schemas/enums.ts'
import type { PmNode } from '../../../shared/schemas/pm.ts'
import type { TemplateEditorHandle } from '../../editor/TemplateEditor.tsx'
import { api, unwrap } from '../../lib/api.ts'
import { entryTypesQuery, kindKey, useKindLabel, useKindOptions } from '../../lib/entry-types.ts'
import {
  copyTemplate,
  invalidateTemplates,
  invalidateTemplatesAndSpaces,
  isCodeBuiltin,
  patchTemplate,
  resetBuiltin,
  type Template,
  type TemplateDetail,
  type TemplatePatch,
  templateListQuery,
  templateSaveError,
} from '../../lib/template-queries.ts'
import { newId } from '../../lib/uuid.ts'
import { Button } from '../ui/button.tsx'
import { Checkbox } from '../ui/checkbox.tsx'
import { Disclosure } from '../ui/disclosure.tsx'
import { Input } from '../ui/input.tsx'
import { Label } from '../ui/label.tsx'
import { PageHeader } from '../ui/page-header.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { TypeFieldsSection } from './FieldDefsEditor.tsx'
import { FieldEditor, FieldValue, fieldIcon, useFieldSpecs } from './FieldValue.tsx'

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
  const types = useQuery(entryTypesQuery)
  const kindOf = useKindLabel()
  const [name, setName] = useState(tpl?.name ?? '')
  const [description, setDescription] = useState(tpl?.description ?? '')
  const [kind, setKind] = useState<EntryKind>(tpl?.kind ?? 'note')
  const [typeId, setTypeId] = useState<string | null>(tpl?.typeId ?? null)
  const [fields, setFields] = useState<Record<string, unknown>>(tpl?.fields ?? {})
  const [spaceKind, setSpaceKind] = useState<SpaceKind | ''>(tpl?.spaceKinds[0] ?? '')
  // 共享范围：个人 / 工作区 / 内置（ADR-0038：内置仅所有者；代码内置模板不能改范围）
  const [scope, setScope] = useState<TemplateScope>(tpl?.source ?? 'personal')
  const shared = scope !== 'personal'
  const codeBuiltin = !!tpl && isCodeBuiltin(tpl)
  // 能否设为内置模板：与维护内置类型同一判定（服务端 can()：所有者）
  const canBuiltin = !!types.data?.canManageBuiltin
  const editorRef = useRef<TemplateEditorHandle | null>(null)
  const back = () => void nav({ to: '/settings/templates' })
  // 可绑的类型：内置 + 本人可用的空间类型 + 本人个人类型（工作区模板排除个人类型，别人用不了）；当前值总保留
  const isPersonalType = (id: string | null) =>
    !!types.data?.items.find((x) => x.id === id && !x.spaceId)
  const kinds = useKindOptions(null, { keep: { kind, typeId } }).filter(
    (o) =>
      !(shared && o.kind === 'custom' && isPersonalType(o.typeId) && o.typeId !== typeId) &&
      // 代码内置模板全员共用：只能用内置类型
      !(codeBuiltin && o.kind === 'custom'),
  )
  const curKey = kindKey({ kind, typeId })
  const pickKind = (key: string) => {
    const m = kinds.find((o) => kindKey(o) === key)
    if (!m) return
    setKind(m.kind)
    setTypeId(m.typeId)
    setFields(m.kind === 'custom' ? {} : { ...defaultEntryFields[m.kind] })
  }
  const bindsPersonal = kind === 'custom' && isPersonalType(typeId)

  const save = useMutation({
    mutationFn: async () => {
      const body = editorRef.current?.getBody() ?? tpl?.body ?? EMPTY_DOC
      if (!tpl)
        return unwrap<Template>(
          api.templates.$post(
            {
              json: {
                name: name.trim(),
                description: description.trim(),
                kind,
                ...(kind === 'custom' && typeId ? { typeId } : {}),
                fields,
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
      if (kind !== tpl.kind || typeId !== (tpl.typeId ?? null)) {
        patch.kind = kind
        if (kind === 'custom' && typeId) patch.typeId = typeId
      }
      if (JSON.stringify(fields) !== JSON.stringify(tpl.fields)) patch.fields = fields
      if ((spaceKind || null) !== (tpl.spaceKinds[0] ?? null)) patch.spaceKind = spaceKind || null
      if (!codeBuiltin && scope !== tpl.source) patch.scope = scope
      if (JSON.stringify(body) !== JSON.stringify(tpl.body)) patch.body = body
      if (!Object.keys(patch).length) return null
      return patchTemplate(tpl, patch)
    },
    onSuccess: (r) => {
      if (r)
        toast.success(tpl ? t('template.savedTemplate') : t('template.created', { name: r.name }))
      void (tpl && tpl.source !== scope
        ? invalidateTemplatesAndSpaces(qc)
        : invalidateTemplates(qc))
      back()
    },
    onError: templateSaveError(qc, t),
  })
  const submit = () => {
    if (editable && name.trim() && !save.isPending) save.mutate()
  }
  const reset = useMutation({
    mutationFn: () => resetBuiltin(tpl?.id ?? ''),
    onSuccess: () => {
      toast.success(t('template.resetDone'))
      void invalidateTemplates(qc)
      back()
    },
    onError: () => toast.error(t('task.saveFailed')),
  })
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
              {codeBuiltin && tpl?.customized ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  loading={reset.isPending}
                  onClick={() => reset.mutate()}
                  data-testid="template-form-reset"
                >
                  <RotateCcw className="size-4" />
                  {t('template.resetDefault')}
                </Button>
              ) : null}
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
            value={curKey}
            onChange={(e) => pickKind(e.target.value)}
            data-testid="template-kind"
          >
            {kinds.map((k) => (
              <option key={kindKey(k)} value={kindKey(k)}>
                {k.label}
              </option>
            ))}
          </select>
          {bindsPersonal && shared ? (
            <p className="text-danger text-xs" data-testid="template-kind-personal">
              {t('template.personalTypeShared')}
            </p>
          ) : null}
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
      <TemplateFieldPresets
        kind={kind}
        typeId={typeId}
        value={fields}
        onChange={setFields}
        editable={editable}
        canManageType={
          kind === 'custom'
            ? !!types.data?.items.find((x) => x.id === typeId)?.canManage
            : !!types.data?.canManageBuiltin
        }
        typeLabel={kindOf(kind, typeId).label}
      />
      {editable && canShare && !codeBuiltin && scope !== 'builtin' ? (
        <div className="flex flex-col gap-1">
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={shared}
              onCheckedChange={(v) => setScope(v === true ? 'workspace' : 'personal')}
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
      {editable && canBuiltin && !codeBuiltin && (!tpl || tpl.source === 'builtin') ? (
        <div className="flex flex-col gap-1">
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={scope === 'builtin'}
              onCheckedChange={(v) => setScope(v === true ? 'builtin' : 'personal')}
              data-testid="template-form-builtin"
            />
            {t('template.scopeBuiltin')}
          </label>
          <p className="ps-7 text-fg-muted text-xs">{t('template.scopeBuiltinHint')}</p>
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

/**
 * 字段预填（REQ-TPL-011）：按所绑类型的字段逐个预置值（与记录页属性面板同一套彩色值 / 编辑器）；
 * 下方可折叠「编辑该类型的字段」。模板不带日期类 Bug 字段（服务端剔除）。
 */
function TemplateFieldPresets({
  kind,
  typeId,
  value,
  onChange,
  editable,
  canManageType,
  typeLabel,
}: {
  kind: EntryKind
  typeId: string | null
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
  editable: boolean
  canManageType: boolean
  typeLabel: string
}) {
  const { t } = useTranslation()
  const specs = useFieldSpecs()(kind, typeId).filter(
    (f) => !(kind === 'bug' && (f.name === 'foundAt' || f.name === 'resolvedAt')),
  )
  const meta = useKindLabel()(kind, typeId)
  const [open, setOpen] = useState(false)
  const set = (name: string, v: unknown) => {
    const next = { ...value }
    if (v === undefined) delete next[name]
    else next[name] = v
    onChange(next)
  }
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-divider p-3"
      data-testid="template-fields"
    >
      <h3 className="font-medium text-sm">{t('template.fieldsPreset')}</h3>
      {specs.length ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {specs.map((f) => {
            const Icon = fieldIcon(f)
            const shown = (
              <FieldValue
                spec={f}
                value={value[f.name]}
                fields={value}
                empty={<span className="text-fg-faint text-sm">{t('field.empty')}</span>}
              />
            )
            return (
              <div key={f.name} className="xz-prop-row" data-field={f.name}>
                <dt className="xz-prop-label">
                  <Icon className="size-3.5" aria-hidden />
                  <span className="truncate">{f.label}</span>
                </dt>
                <dd className="min-w-0">
                  {editable ? (
                    <FieldEditor
                      spec={f}
                      value={value[f.name]}
                      onCommit={(v) => set(f.name, v)}
                      trigger={
                        <button
                          type="button"
                          className="xz-prop-value"
                          data-testid={`template-field-${f.name}`}
                        >
                          {shown}
                        </button>
                      }
                    />
                  ) : (
                    <span className="inline-flex min-h-8 items-center">{shown}</span>
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      ) : (
        <p className="text-fg-muted text-sm">{t('template.noFields')}</p>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex w-fit items-center gap-1 text-fg-muted text-xs hover:text-fg"
        data-testid="template-type-fields-toggle"
      >
        <Disclosure open={open} />
        {t('template.editTypeFields', { type: typeLabel })}
      </button>
      {open ? (
        <div className="flex flex-col gap-2">
          <p className="text-fg-muted text-xs">{t('template.editTypeFieldsHint')}</p>
          <TypeFieldsSection
            typeId={kind === 'custom' ? (typeId ?? undefined) : undefined}
            kind={kind === 'custom' ? undefined : (kind as BuiltinEntryKind)}
            defs={meta.fieldDefs}
            canManage={canManageType}
            compact
          />
        </div>
      ) : null}
    </section>
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
