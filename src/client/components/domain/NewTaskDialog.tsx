/**
 * 全局新任务（04 §6：`c` 唯一含义，列表内也不改绑；REQ-TASK-020）：默认值来自当前页面登记的上下文
 * （空间页 → 该空间 todo；今日 → 截止今天；收件箱 / 其他 → 个人空间 inbox）。
 * ADR-0044：输入框换成快速添加（识别 + 日期 / 优先级 / 清单 / 标签按钮 + 展开备注与子任务）；回车建好即关闭，Toast 可「打开」。
 */
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useNewTask } from '../../lib/stores.ts'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { QuickAddTask } from './QuickAddTask.tsx'

export default function NewTaskDialog() {
  const { t } = useTranslation()
  const { open, setOpen } = useNewTask()
  const nav = useNavigate()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[min(94vw,36rem)]" data-testid="new-task-dialog">
        <DialogTitle>{t('task.newTask')}</DialogTitle>
        <DialogDescription className="sr-only">{t('task.newTaskPlaceholder')}</DialogDescription>
        <QuickAddTask
          className="mt-4"
          variant="dialog"
          autoFocus
          testId="new-task-quick-add"
          onCreated={(task) => {
            setOpen(false)
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
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
