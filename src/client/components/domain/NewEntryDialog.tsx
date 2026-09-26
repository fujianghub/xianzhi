/**
 * 新记录（08 §3.2、REQ-ENTRY-001 · REQ-TPL-003）：选模板（可选）+ kind + 标题 + 该 kind 的 fields → `POST /entries` → 跳编辑页。
 * 模板：「按类型默认」= 首次打开按 kind 注入骨架；选具体模板 → 带出 kind / fields，正文以模板初始化；
 * 当前空间类型（如「学习」）推荐的模板排在前面。改 kind 与所选模板不符时回到「按类型默认」。
 * 422 的 `fields.*` 错误就地显示在对应字段下；其余错误 Toast。按需懒加载（带 zod）。
 * 类型（ADR-0016）：未隐藏的内置类型 + 自定义类型；自定义类型的状态默认取其第一项（服务端补）。
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { defaultEntryFields } from '../../../shared/schemas/entryFields.ts'
import type { SpaceKind } from '../../../shared/schemas/enums.ts'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import type { EntryKind } from '../../lib/entry-queries.ts'
import { kindKey, useKindOptions } from '../../lib/entry-types.ts'
import { spacesQuery } from '../../lib/space-queries.ts'
import { useNewEntry } from '../../lib/stores.ts'
import { sortTemplates, type Template, templatesQuery } from '../../lib/template-queries.ts'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'
import { EntryFieldsForm, fieldErrors } from './EntryFieldsForm.tsx'

export default function NewEntryDialog() {
  const { t } = useTranslation()
  const { open, setOpen, defaults } = useNewEntry()
  const actions = useEntryActions()
  const nav = useNavigate()
  const [kind, setKind] = useState<EntryKind>(defaults.kind ?? 'note')
  const [typeId, setTypeId] = useState<string | undefined>(defaults.typeId)
  const kindOptions = useKindOptions()
  const [title, setTitle] = useState('')
  const [fields, setFields] = useState<Record<string, unknown>>(defaultEntryFields[kind])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const templates = useQuery({ ...templatesQuery, enabled: open })
  const spaces = useQuery({ ...spacesQuery(), enabled: open })
  const spaceKind = spaces.data?.find((s) => s.id === defaults.spaceId)?.kind as
    | SpaceKind
    | undefined
  const sorted = useMemo(
    () => sortTemplates(templates.data ?? [], spaceKind),
    [templates.data, spaceKind],
  )

  const applyTemplate = (tpl: Template | null) => {
    setTemplateId(tpl?.id ?? null)
    setErrors({})
    if (!tpl) return
    setKind(tpl.kind)
    setTypeId(undefined)
    setFields({ ...defaultEntryFields[tpl.kind], ...tpl.fields })
  }

  useEffect(() => {
    if (!open) return
    const k = defaults.kind === 'custom' && !defaults.typeId ? 'note' : (defaults.kind ?? 'note')
    setKind(k)
    setTypeId(k === 'custom' ? defaults.typeId : undefined)
    setFields({ ...defaultEntryFields[k] })
    setErrors({})
    setTemplateId(null)
  }, [open, defaults.kind, defaults.typeId])
  // 外部预选（模板管理页「用此模板新建」）：列表到位后带出 kind / fields
  useEffect(() => {
    if (!open || !defaults.templateId) return
    const tpl = templates.data?.find((x) => x.id === defaults.templateId)
    if (!tpl) return
    setTemplateId(tpl.id)
    setKind(tpl.kind)
    setTypeId(undefined)
    setFields({ ...defaultEntryFields[tpl.kind], ...tpl.fields })
  }, [open, defaults.templateId, templates.data])

  const pickKind = (k: EntryKind, tid?: string) => {
    setKind(k)
    setTypeId(tid)
    setFields({ ...defaultEntryFields[k] })
    setErrors({})
    const cur = templates.data?.find((x) => x.id === templateId)
    if (cur && cur.kind !== k) setTemplateId(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = title.trim()
    if (!v) return
    setBusy(true)
    setErrors({})
    try {
      const r = await actions.create({
        kind,
        ...(kind === 'custom' && typeId ? { typeId } : {}),
        title: v,
        fields,
        spaceId: defaults.spaceId,
        ...(templateId ? { templateId } : {}),
        ...(defaults.parentId !== undefined ? { parentId: defaults.parentId } : {}),
      })
      setTitle('')
      setOpen(false)
      void nav({ to: '/entries/$entryId', params: { entryId: r.id } })
    } catch (err) {
      const fe = err instanceof ApiError ? fieldErrors(err.problem.errors) : {}
      if (Object.keys(fe).length) setErrors(fe)
      else {
        // 非 ApiError = 请求没发出去（客户端异常）；留痕便于定位
        if (!(err instanceof ApiError)) console.error('[entry.create]', err)
        toast.error(t('task.saveFailed'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => setOpen(v)}>
      <DialogContent className="w-[min(92vw,36rem)]" data-testid="new-entry-dialog">
        <DialogTitle>{t('entry.new')}</DialogTitle>
        <DialogDescription className="sr-only">{t('entry.newHint')}</DialogDescription>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-fg-muted text-xs">{t('template.pick')}</legend>
            <div
              role="radiogroup"
              aria-label={t('template.pick')}
              className="grid max-h-44 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2"
              data-testid="template-picker"
            >
              <TemplateOption
                active={!templateId}
                id="default"
                name={t('template.byKind')}
                description={t('template.byKindHint')}
                onPick={() => applyTemplate(null)}
              />
              {sorted.map((tpl) => (
                <TemplateOption
                  key={tpl.id}
                  active={templateId === tpl.id}
                  id={tpl.id}
                  name={tpl.name}
                  description={tpl.description || t(`entry.kind.${tpl.kind}`)}
                  badge={t(`template.source.${tpl.group ?? tpl.source}`)}
                  recommended={!!spaceKind && tpl.spaceKinds.includes(spaceKind)}
                  onPick={() => applyTemplate(tpl)}
                />
              ))}
            </div>
          </fieldset>
          <div
            role="radiogroup"
            aria-label={t('entry.props.kind')}
            className="flex flex-wrap gap-1.5"
          >
            {kindOptions.map((o) => {
              const on = kind === o.kind && (o.kind !== 'custom' || typeId === o.typeId)
              return (
                // biome-ignore lint/a11y/useSemanticElements: 胶囊式单选，保持按钮外观
                <button
                  key={kindKey(o)}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-kind={kindKey(o)}
                  onClick={() => pickKind(o.kind, o.typeId ?? undefined)}
                  className={cn(
                    'h-8 rounded-full border border-border px-3 text-sm transition-colors duration-(--xz-dur-fast) hover:bg-hover',
                    on && 'border-transparent bg-selected font-medium text-primary-text',
                  )}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('entry.titlePlaceholder')}
            aria-label={t('entry.title')}
            autoFocus
            data-testid="new-entry-title"
          />
          <EntryFieldsForm
            kind={kind}
            typeId={typeId}
            value={fields}
            onChange={setFields}
            errors={errors}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!title.trim()}
              data-testid="new-entry-submit"
            >
              {t('space.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TemplateOption({
  active,
  id,
  name,
  description,
  badge,
  recommended,
  onPick,
}: {
  active: boolean
  id: string
  name: string
  description: string
  badge?: string
  recommended?: boolean
  onPick: () => void
}) {
  const { t } = useTranslation()
  return (
    // biome-ignore lint/a11y/useSemanticElements: 卡片式单选，保持按钮外观
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-template-id={id}
      onClick={onPick}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-md border border-border px-3 py-2 text-left transition-colors duration-(--xz-dur-fast) hover:bg-hover',
        active && 'border-selected-border bg-selected',
      )}
    >
      <span className="flex w-full items-center gap-1.5 text-sm">
        <span className={cn('truncate', active && 'font-medium text-primary-text')}>{name}</span>
        {recommended ? (
          <span className="shrink-0 rounded-full bg-primary-soft px-1.5 text-[11px] text-primary-text">
            {t('template.recommended')}
          </span>
        ) : null}
        {badge ? <span className="ms-auto shrink-0 text-fg-faint text-[11px]">{badge}</span> : null}
      </span>
      <span className="line-clamp-1 text-fg-muted text-xs">{description}</span>
    </button>
  )
}
