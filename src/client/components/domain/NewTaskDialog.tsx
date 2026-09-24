/**
 * 全局新任务（04 §6：`c` 唯一含义，列表内也不改绑；REQ-TASK-020）：默认值来自当前页面登记的上下文
 * （空间页 → 该空间 todo；今日 → 截止今天；收件箱 / 其他 → 个人空间 inbox）。
 */
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useTaskActions } from '../../hooks/useTasks.ts'
import { useNewTask } from '../../lib/stores.ts'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'

export function NewTaskDialog() {
  const { t } = useTranslation()
  const { open, setOpen, defaults } = useNewTask()
  const actions = useTaskActions()
  const nav = useNavigate()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = title.trim()
    if (!v) return
    setBusy(true)
    try {
      const task = await actions.create({
        title: v,
        ...defaults,
        status: defaults.status ?? 'inbox',
      })
      toast.success(t('task.created'), {
        action: {
          label: t('task.open'),
          onClick: () =>
            nav({
              to: '/spaces/$spaceSlug/tasks/$taskId',
              params: { spaceSlug: task.spaceSlug, taskId: task.id },
            }),
        },
      })
      setTitle('')
      setOpen(false)
    } catch {
      toast.error(t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[min(92vw,30rem)]" data-testid="new-task-dialog">
        <DialogTitle>{t('task.newTask')}</DialogTitle>
        <DialogDescription className="sr-only">{t('task.newTaskPlaceholder')}</DialogDescription>
        <form onSubmit={submit} className="mt-4 flex gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('task.newTaskPlaceholder')}
            aria-label={t('task.newTask')}
            autoFocus
            data-testid="new-task-input"
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>
            {t('space.create')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
