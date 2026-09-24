/**
 * 新记录（08 §3.2、REQ-ENTRY-001）：选 kind + 标题 + 该 kind 的 fields → `POST /entries` → 跳编辑页。
 * 422 的 `fields.*` 错误就地显示在对应字段下；其余错误 Toast。按需懒加载（带 zod）。
 */
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { defaultEntryFields } from '../../../shared/schemas/entryFields.ts'
import { useEntryActions } from '../../hooks/useEntries.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { ENTRY_KINDS, type EntryKind } from '../../lib/entry-queries.ts'
import { useNewEntry } from '../../lib/stores.ts'
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
  const [title, setTitle] = useState('')
  const [fields, setFields] = useState<Record<string, unknown>>(defaultEntryFields[kind])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      const k = defaults.kind ?? 'note'
      setKind(k)
      setFields({ ...defaultEntryFields[k] })
      setErrors({})
    }
  }, [open, defaults.kind])

  const pickKind = (k: EntryKind) => {
    setKind(k)
    setFields({ ...defaultEntryFields[k] })
    setErrors({})
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = title.trim()
    if (!v) return
    setBusy(true)
    setErrors({})
    try {
      const r = await actions.create({ kind, title: v, fields, spaceId: defaults.spaceId })
      setTitle('')
      setOpen(false)
      void nav({ to: '/entries/$entryId', params: { entryId: r.id } })
    } catch (err) {
      const fe = err instanceof ApiError ? fieldErrors(err.problem.errors) : {}
      if (Object.keys(fe).length) setErrors(fe)
      else toast.error(t('task.saveFailed'))
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
            role="radiogroup"
            aria-label={t('entry.props.kind')}
            className="flex flex-wrap gap-1.5"
          >
            {ENTRY_KINDS.map((k) => (
              // biome-ignore lint/a11y/useSemanticElements: 胶囊式单选，保持按钮外观
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                data-kind={k}
                onClick={() => pickKind(k)}
                className={cn(
                  'h-8 rounded-full border border-border px-3 text-sm transition-colors duration-(--xz-dur-fast) hover:bg-hover',
                  kind === k && 'border-transparent bg-selected font-medium text-primary',
                )}
              >
                {t(`entry.kind.${k}`)}
              </button>
            ))}
          </div>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('entry.titlePlaceholder')}
            aria-label={t('entry.title')}
            autoFocus
            data-testid="new-entry-title"
          />
          <EntryFieldsForm kind={kind} value={fields} onChange={setFields} errors={errors} />
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
