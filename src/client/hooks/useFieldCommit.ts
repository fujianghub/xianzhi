/**
 * 单个元数据字段的就地提交（ADR-0035、REQ-ENTRY-024 · 026）：属性面板与表格单元格共用。
 * - 串行：同一页内的提交排队，每次取缓存里最新的 updatedAt 作 ifUpdatedAt，连点不自撞 409；
 * - 乐观：先改详情缓存与已加载列表里的该行，服务端返回后以其为准（服务端会补 resolvedAt 等）；
 * - 409：提示并刷新；422：返回 `fields.*` 错误给调用方就地显示，并刷新类型与模板元数据（字段定义可能已变，ADR-0036 · 0039）。
 */
import { type InfiniteData, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { fieldErrors } from '../components/domain/EntryFieldsForm.tsx'
import { ApiError, api, unwrap } from '../lib/api.ts'
import type { Entry, EntryPage } from '../lib/entry-queries.ts'
import { templateFieldsQuery } from '../lib/template-queries.ts'

export type CommitResult =
  | { ok: true; entry: Entry }
  | { ok: false; errors: Record<string, string> }

export function useFieldCommit() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const chain = useRef<Promise<unknown>>(Promise.resolve())

  const putRow = useCallback(
    (id: string, map: (e: Entry) => Entry) => {
      qc.setQueryData<Entry>(['entry', id], (d) => (d ? map(d) : d))
      qc.setQueriesData<InfiniteData<EntryPage>>({ queryKey: ['entries'] }, (d) =>
        d && Array.isArray((d as InfiniteData<EntryPage>).pages)
          ? {
              ...d,
              pages: d.pages.map((p) => ({
                ...p,
                items: p.items.map((e) => (e.id === id ? map(e) : e)),
              })),
            }
          : d,
      )
    },
    [qc],
  )

  /** 缓存里最新的这一行（详情优先，其次已加载列表里 updatedAt 最新的一份） */
  const latest = useCallback(
    (entry: Entry): Entry => {
      let best = qc.getQueryData<Entry>(['entry', entry.id]) ?? entry
      for (const [, d] of qc.getQueriesData<InfiniteData<EntryPage>>({ queryKey: ['entries'] }))
        for (const p of Array.isArray(d?.pages) ? d.pages : [])
          for (const e of p.items)
            if (e.id === entry.id && e.updatedAt > best.updatedAt) best = { ...best, ...e }
      return best
    },
    [qc],
  )

  return useCallback(
    (entry: Entry, name: string, value: unknown): Promise<CommitResult> => {
      const run = async (): Promise<CommitResult> => {
        const cur = latest(entry)
        const fields = { ...cur.fields }
        if (value === undefined) delete fields[name]
        else fields[name] = value
        const before = cur
        putRow(entry.id, (e) => ({ ...e, fields }))
        try {
          const r = await unwrap<Entry>(
            api.entries[':id'].$patch({
              param: { id: entry.id },
              json: { fields, ifUpdatedAt: cur.updatedAt } as never,
            }),
          )
          putRow(entry.id, (e) => ({ ...e, fields: r.fields, updatedAt: r.updatedAt }))
          qc.setQueryData(['entry', r.id], (d: Entry | undefined) => (d ? { ...d, ...r } : d))
          void qc.invalidateQueries({ queryKey: ['entry', r.id, 'changes'] })
          void qc.invalidateQueries({ queryKey: ['entries'] })
          return { ok: true, entry: r }
        } catch (err) {
          putRow(entry.id, (e) => ({ ...e, fields: before.fields, updatedAt: before.updatedAt }))
          if (err instanceof ApiError && err.status === 409) {
            toast.error(t('task.conflict'))
            void qc.invalidateQueries({ queryKey: ['entry', entry.id] })
            void qc.invalidateQueries({ queryKey: ['entries'] })
            return { ok: false, errors: {} }
          }
          if (err instanceof ApiError && err.status === 422) {
            void qc.invalidateQueries({ queryKey: ['entry-types'] })
            void qc.invalidateQueries({ queryKey: templateFieldsQuery.queryKey })
            const errors = fieldErrors(err.problem.errors)
            toast.error(Object.values(errors)[0] ?? t('task.saveFailed'))
            return { ok: false, errors }
          }
          toast.error(t('task.saveFailed'))
          return { ok: false, errors: {} }
        }
      }
      const p = chain.current.then(run, run)
      chain.current = p
      return p
    },
    [qc, t, putRow, latest],
  )
}
