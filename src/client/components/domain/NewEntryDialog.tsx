/**
 * 新记录（08 §3.2、REQ-ENTRY-001 · REQ-TPL-003）：选模板（可选）+ kind + 标题 + 该 kind 的 fields → `POST /entries` → 跳编辑页。
 * 模板：「按类型默认」= 首次打开按 kind 注入骨架；选具体模板 → 带出 kind / fields，正文以模板初始化；
 * 当前空间类型（如「学习」）推荐的模板排在前面。改 kind 与所选模板不符时回到「按类型默认」。
 * 422 的 `fields.*` 错误就地显示在对应字段下；其余错误 Toast。按需懒加载（带 zod）。
 * 类型（ADR-0016）：未隐藏的内置类型 + 自定义类型；自定义类型的状态默认取其第一项（服务端补）。
 * 位置（ADR-0018、REQ-ENTRY-021）：顶部一行显示并可改「建在哪」——空间（可写的空间，含个人空间）+ 目录位置
 * （目录顶层 / 某页之下 / 不放进目录）；默认值来自打开时冻结的上下文（空间页 → 目录根，记录页 → 同级）。
 * 新建并关联（REQ-LINK-006）：带 linkFrom 时显示「关联到《A》· 类型」，可移除；服务端同事务建关联。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Link2, MapPin, X } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { defaultEntryFields } from '../../../shared/schemas/entryFields.ts'
import type { SpaceKind } from '../../../shared/schemas/enums.ts'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { type EntryKind, treeQuery } from '../../lib/entry-queries.ts'
import { kindKey, useKindOptions } from '../../lib/entry-types.ts'
import { spacesQuery } from '../../lib/space-queries.ts'
import { type NewEntryDefaults, useNewEntry } from '../../lib/stores.ts'
import { sortTemplates, type Template, templatesQuery } from '../../lib/template-queries.ts'
import { flatten } from '../../lib/tree.ts'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'
import { EntryFieldsForm, fieldErrors, QUICK_FIELDS } from './EntryFieldsForm.tsx'

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
  const qc = useQueryClient()
  // 位置：空间（'' = 个人空间）+ 目录位置（'root' 顶层 / 'none' 不进目录 / 父页 id）
  const [spaceId, setSpaceId] = useState('')
  const [where, setWhere] = useState<string>('none')
  const [linkFrom, setLinkFrom] = useState<NewEntryDefaults['linkFrom'] | null>(null)
  const writable = (spaces.data ?? []).filter(
    (s) => s.isPersonal || s.myRole === 'admin' || s.myRole === 'member',
  )
  const personalId = writable.find((s) => s.isPersonal)?.id ?? ''
  const targetSpace = spaceId || personalId
  const tree = useQuery({ ...treeQuery(targetSpace), enabled: open && !!targetSpace })
  const treeItems = useMemo(() => flatten(tree.data ?? []), [tree.data])
  const spaceKind = spaces.data?.find((s) => s.id === targetSpace)?.kind as SpaceKind | undefined
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

  // 打开即按冻结的默认值初始化（打开期间页面上下文变化不影响表单）
  useEffect(() => {
    if (!open) return
    const k = defaults.kind === 'custom' && !defaults.typeId ? 'note' : (defaults.kind ?? 'note')
    setKind(k)
    setTypeId(k === 'custom' ? defaults.typeId : undefined)
    setFields({ ...defaultEntryFields[k] })
    setErrors({})
    setTemplateId(null)
    setTitle('')
    setSpaceId(defaults.spaceId ?? '')
    setWhere(
      defaults.parentId === undefined
        ? 'none'
        : defaults.parentId === null
          ? 'root'
          : defaults.parentId,
    )
    setLinkFrom(defaults.linkFrom ?? null)
  }, [open, defaults])
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

  // 空间默认类型 / 模板（ADR-0019、REQ-KB-010）：打开时与换空间时，按目标空间预选；
  // 调用方显式给了类型 / 模板则不覆盖。已删除的内置类型不在可选项里 → 不预选（退回随笔）。
  const explicit = defaults.kind !== undefined || defaults.templateId !== undefined
  const appliedFor = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只随打开 / 目标空间 / 数据到位触发
  useEffect(() => {
    if (!open) {
      appliedFor.current = null
      return
    }
    if (explicit || !targetSpace || appliedFor.current === targetSpace) return
    const sp = spaces.data?.find((x) => x.id === targetSpace)
    if (!sp) return
    if (sp.defaultTemplateId) {
      if (!templates.data) return // 模板列表到位后再套
      const tpl = templates.data.find((x) => x.id === sp.defaultTemplateId)
      appliedFor.current = targetSpace
      if (tpl) return applyTemplate(tpl)
    }
    appliedFor.current = targetSpace
    const k = sp.defaultKind as EntryKind | null
    if (k && kindOptions.some((o) => o.kind === k)) pickKind(k)
  }, [open, explicit, targetSpace, spaces.data, templates.data])

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
        ...(targetSpace ? { spaceId: targetSpace } : {}),
        ...(templateId ? { templateId } : {}),
        ...(where === 'none' ? {} : { parentId: where === 'root' ? null : where }),
        ...(linkFrom ? { linkFrom: { entryId: linkFrom.entryId, kind: linkFrom.kind } } : {}),
      })
      if (linkFrom) void qc.invalidateQueries({ queryKey: ['links'] })
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
          <div
            className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-sm"
            data-testid="new-entry-location"
          >
            <MapPin className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <span className="sr-only">{t('entry.location.label')}</span>
            <select
              value={targetSpace}
              onChange={(e) => {
                setSpaceId(e.target.value)
                setWhere('root') // 换空间：放到新空间目录顶层
              }}
              aria-label={t('entry.location.space')}
              className="h-8 min-w-0 max-w-[45%] rounded-md border border-border bg-surface px-2"
              data-testid="new-entry-space"
            >
              {writable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.isPersonal ? t('space.personal') : s.name}
                </option>
              ))}
            </select>
            <span className="text-fg-faint" aria-hidden>
              ›
            </span>
            <select
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              aria-label={t('entry.location.where')}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2"
              data-testid="new-entry-where"
            >
              <option value="root">{t('entry.location.root')}</option>
              <option value="none">{t('entry.location.none')}</option>
              {treeItems.length ? (
                <optgroup label={t('entry.location.under')}>
                  {treeItems.map((n) => (
                    <option key={n.id} value={n.id}>
                      {`${'\u3000'.repeat(n.depth)}${n.title || t('entry.untitled')}`}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
          {linkFrom ? (
            <div
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
              data-testid="new-entry-link"
            >
              <Link2 className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {t('entry.location.linkFrom', {
                  title: linkFrom.title || t('entry.untitled'),
                  kind: t(`link.kind.${linkFrom.kind}`),
                })}
              </span>
              <button
                type="button"
                onClick={() => setLinkFrom(null)}
                aria-label={t('entry.location.unlink')}
                className="grid size-6 place-items-center rounded-md text-fg-muted hover:bg-hover"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}
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
            only={QUICK_FIELDS[kind]}
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
