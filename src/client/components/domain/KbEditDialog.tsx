/** 编辑空间（ADR-0012、REQ-KB-002）：名称、简介、类型（决定概览形态）、大类；需 space admin（服务端 space.manage）。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { type Space, type SpaceKind, spaceGroupsQuery } from '../../hooks/useSpaces.ts'
import { api, unwrap } from '../../lib/api.ts'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'

const KINDS: SpaceKind[] = ['project', 'learning', 'work']

export function KbEditDialog({
  space,
  open,
  onOpenChange,
}: {
  space: Space
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const groups = useQuery({ ...spaceGroupsQuery, enabled: open })
  const [name, setName] = useState(space.name)
  const [description, setDescription] = useState(space.description ?? '')
  const [kind, setKind] = useState(space.kind as SpaceKind)
  const [groupId, setGroupId] = useState(space.groupId ?? '')
  useEffect(() => {
    if (!open) return
    setName(space.name)
    setDescription(space.description ?? '')
    setKind(space.kind as SpaceKind)
    setGroupId(space.groupId ?? '')
  }, [open, space])
  const save = useMutation({
    mutationFn: () =>
      unwrap<Space>(
        api.spaces[':id'].$patch({
          param: { id: space.id },
          json: {
            ...(space.isPersonal ? {} : { name: name.trim(), kind, groupId: groupId || null }),
            description: description.trim() || null,
            ifUpdatedAt: space.updatedAt,
          },
        }),
      ),
    onSuccess: (s) => {
      qc.setQueryData(['space', s.slug], s)
      void qc.invalidateQueries({ queryKey: ['spaces'] })
      void qc.invalidateQueries({ queryKey: ['space'] })
      onOpenChange(false)
    },
    onError: () => toast.error(t('task.saveFailed')),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) save.mutate()
  }
  const field = 'flex flex-col gap-1.5 text-sm'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,30rem)]" data-testid="kb-edit-dialog">
        <DialogTitle>{t('kb.edit')}</DialogTitle>
        <DialogDescription className="sr-only">{t('kb.edit')}</DialogDescription>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          {space.isPersonal ? null : (
            <>
              <label className={field}>
                <span className="text-fg-muted text-xs">{t('space.name')}</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              </label>
              <label className={field}>
                <span className="text-fg-muted text-xs">{t('space.group')}</span>
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="h-9 rounded-md border border-border bg-surface px-2"
                  data-testid="kb-edit-group"
                >
                  <option value="">{t('space.groups.none')}</option>
                  {(groups.data ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                <span className="text-fg-muted text-xs">{t('space.kindLabel')}</span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as SpaceKind)}
                  className="h-9 rounded-md border border-border bg-surface px-2"
                  data-testid="kb-edit-kind"
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`space.kind.${k}`)}
                    </option>
                  ))}
                </select>
                <span className="text-fg-muted text-xs">{t('kb.kindHint')}</span>
              </label>
            </>
          )}
          <label className={field}>
            <span className="text-fg-muted text-xs">{t('kb.description')}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              className="rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('ui.action.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={save.isPending}
              data-testid="kb-edit-save"
            >
              {t('ui.action.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
