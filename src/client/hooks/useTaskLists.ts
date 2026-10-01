/** 个人清单的增删改（ADR-0044）：成功后刷新清单与任务（归类展示 / 计数都依赖清单）。 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { PaletteColor, TaskListKind } from '../../shared/schemas/enums.ts'
import { ApiError, api, unwrap } from '../lib/api.ts'
import type { TaskList } from '../lib/task-list-queries.ts'
import { newId } from '../lib/uuid.ts'

export function useTaskListActions() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['task-lists'] })
    void qc.invalidateQueries({ queryKey: ['tasks'] })
    void qc.invalidateQueries({ queryKey: ['task'] })
  }
  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : t('task.saveFailed'))
  const create = useMutation({
    mutationFn: (v: {
      kind?: TaskListKind
      name: string
      color?: PaletteColor
      parentId?: string | null
    }) =>
      unwrap<TaskList>(
        api['task-lists'].$post({ json: v as never }, { headers: { 'idempotency-key': newId() } }),
      ),
    onSuccess: done,
    onError: fail,
  })
  const patch = useMutation({
    mutationFn: ({
      id,
      ...json
    }: {
      id: string
      name?: string
      color?: PaletteColor
      parentId?: string | null
      after?: string | null
    }) => unwrap<TaskList>(api['task-lists'][':id'].$patch({ param: { id }, json: json as never })),
    onSuccess: done,
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (id: string) => unwrap<void>(api['task-lists'][':id'].$delete({ param: { id } })),
    onSuccess: done,
    onError: fail,
  })
  return { create, patch, remove }
}
