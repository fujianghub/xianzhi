/**
 * 记录页 fields 表单（08 §2.9）：改动 600ms 后自动 PATCH；422 `fields.*` 就地显示，其余走 useEntryActions 的 Toast。
 * 下方「流转」（ADR-0033、REQ-BUG-006）：状态 / 优先级 / 严重度的变化记录，默认收起。
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, api, unwrap } from '../../lib/api.ts'
import type { Entry } from '../../lib/entry-queries.ts'
import { Disclosure } from '../ui/disclosure.tsx'
import { RelativeTime } from '../ui/relative-time.tsx'
import { EntryFieldsForm, fieldErrors } from './EntryFieldsForm.tsx'

export default function EntryFieldsPanel({
  entry,
  disabled,
}: {
  entry: Entry
  disabled?: boolean
}) {
  const qc = useQueryClient()
  const [value, setValue] = useState<Record<string, unknown>>(entry.fields)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const dirty = useRef(false)
  const latest = useRef(entry)
  latest.current = entry

  useEffect(() => {
    if (!dirty.current) setValue(entry.fields)
  }, [entry.fields])

  useEffect(() => {
    if (!dirty.current) return
    const h = setTimeout(async () => {
      try {
        const r = await unwrap<Entry>(
          api.entries[':id'].$patch({
            param: { id: latest.current.id },
            json: { fields: value, ifUpdatedAt: latest.current.updatedAt } as never,
          }),
        )
        dirty.current = false
        setErrors({})
        qc.setQueryData(['entry', r.id], r)
        void qc.invalidateQueries({ queryKey: ['entry', r.id, 'changes'] })
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 409) {
            dirty.current = false
            void qc.invalidateQueries({ queryKey: ['entry', latest.current.id] })
          }
          setErrors(fieldErrors(err.problem.errors))
        }
      }
    }, 600)
    return () => clearTimeout(h)
  }, [value, qc])

  return (
    <>
      <EntryFieldsForm
        kind={entry.kind}
        typeId={entry.typeId}
        value={value}
        disabled={disabled}
        errors={errors}
        onChange={(v) => {
          dirty.current = true
          setValue(v)
        }}
      />
      {'status' in entry.fields ? <FieldChanges entryId={entry.id} /> : null}
    </>
  )
}

interface FieldChange {
  id: string
  field: string
  from: string | null
  to: string | null
  actor: { id: string | null; displayName: string }
  createdAt: string
}

function FieldChanges({ entryId }: { entryId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['entry', entryId, 'changes'],
    queryFn: () =>
      unwrap<{ items: FieldChange[] }>(
        api.entries[':id']['field-changes'].$get({ param: { id: entryId } }),
      ).then((r) => r.items),
    enabled: open,
    staleTime: 10_000,
  })
  const val = (v: string | null) =>
    v === null ? '—' : t(`entry.fieldValue.${v}`, { defaultValue: v })
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-fg-muted text-xs hover:text-fg"
        data-testid="entry-changes-toggle"
      >
        <Disclosure open={open} />
        {t('entry.changes.label')}
      </button>
      {open ? (
        <ol
          className="mt-2 flex flex-col gap-1 border-divider border-l ps-3"
          data-testid="entry-changes"
        >
          {(data ?? [])
            .slice()
            .reverse()
            .map((c) => (
              <li key={c.id} className="text-xs" data-field={c.field}>
                <span className="text-fg-muted">
                  <RelativeTime date={c.createdAt} /> · {c.actor.displayName} ·{' '}
                </span>
                {t(`entry.field.${c.field}`)}：{val(c.from)} → {val(c.to)}
              </li>
            ))}
          {data && !data.length ? (
            <li className="text-fg-faint text-xs">{t('entry.changes.empty')}</li>
          ) : null}
        </ol>
      ) : null}
    </div>
  )
}
