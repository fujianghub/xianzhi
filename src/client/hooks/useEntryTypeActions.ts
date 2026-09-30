/**
 * 类型写操作（ADR-0036）：空间类型对话框、模板表单、设置页的字段区共用。
 * 成功后失效类型列表与记录（字段定义变更会同步改记录里的值）。
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { BuiltinEntryKind, PaletteColor } from '../../shared/schemas/enums.ts'
import type { FieldDef } from '../../shared/schemas/fieldDefs.ts'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { type EntryType, type EntryTypesList, entryTypesQuery } from '../lib/entry-types.ts'
import { newId } from '../lib/uuid.ts'

/** 提交用的字段定义：新字段可无 key（服务端生成） */
export type FieldDefInput = Omit<FieldDef, 'key'> & { key?: string }
export type OptionRenames = Record<string, Record<string, string>>

export interface TypeCreateInput {
  name: string
  color: PaletteColor
  statuses?: string[]
  statusColors?: Record<string, PaletteColor>
  fieldDefs?: FieldDefInput[]
  spaceId?: string
}
export interface TypePatchInput {
  name?: string
  color?: PaletteColor
  statuses?: string[]
  renames?: Record<string, string>
  statusColors?: Record<string, PaletteColor>
  fieldDefs?: FieldDefInput[]
  optionRenames?: OptionRenames
}

export const apiErrorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.message) : fallback

export function useEntryTypeActions() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const done = () => {
    void qc.invalidateQueries({ queryKey: entryTypesQuery.queryKey })
    void qc.invalidateQueries({ queryKey: ['entries'] })
    void qc.invalidateQueries({ queryKey: ['entry'] })
    void qc.invalidateQueries({ queryKey: ['spaces'] })
    void qc.invalidateQueries({ queryKey: ['space'] })
  }
  const fail = (err: unknown) => toast.error(apiErrorMessage(err, t('task.saveFailed')))
  const create = useMutation({
    mutationFn: (v: TypeCreateInput) =>
      unwrap<EntryType>(
        api['entry-types'].$post({ json: v as never }, { headers: { 'idempotency-key': newId() } }),
      ),
    onSuccess: () => {
      toast.success(t('settings.types.created'))
      done()
    },
    onError: fail,
  })
  const patch = useMutation({
    mutationFn: ({ id, ...json }: TypePatchInput & { id: string }) =>
      unwrap<EntryType>(api['entry-types'][':id'].$patch({ param: { id }, json: json as never })),
    onSuccess: () => {
      toast.success(t('settings.types.saved'))
      done()
    },
    onError: fail,
  })
  const patchBuiltin = useMutation({
    mutationFn: ({
      kind,
      ...json
    }: {
      kind: BuiltinEntryKind
      fieldDefs?: FieldDefInput[]
      optionRenames?: OptionRenames
    }) =>
      unwrap<EntryTypesList>(
        api['entry-types'].builtin[':kind'].$patch({ param: { kind }, json: json as never }),
      ),
    onSuccess: () => {
      toast.success(t('settings.types.saved'))
      done()
    },
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (v: { id: string; moveTo?: string }) =>
      unwrap<void>(
        api['entry-types'][':id'].$delete({
          param: { id: v.id },
          query: v.moveTo ? { moveTo: v.moveTo } : {},
        }),
      ),
    onSuccess: () => {
      toast.success(t('settings.types.deleted'))
      done()
    },
    onError: fail,
  })
  return { create, patch, patchBuiltin, remove }
}
