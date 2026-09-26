/** 记录页 fields 表单（08 §2.9）：改动 600ms 后自动 PATCH；422 `fields.*` 就地显示，其余走 useEntryActions 的 Toast。 */

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api, unwrap } from '../../lib/api.ts'
import type { Entry } from '../../lib/entry-queries.ts'
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
  )
}
