/** 任务详情（08 §2.7）：叠在空间页之上的 Sheet；关闭回到空间页并保留筛选参数。 */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { TaskDetailSheet } from '../components/domain/TaskDetailSheet.tsx'
import { optUuid } from '../lib/search.ts'

export const Route = createFileRoute('/_app/spaces/$spaceSlug/tasks/$taskId')({
  component: TaskRoute,
})

function TaskRoute() {
  const { spaceSlug, taskId: raw } = Route.useParams()
  const taskId = optUuid(raw) ?? ''
  const nav = useNavigate()
  return (
    <TaskDetailSheet
      taskId={taskId}
      onClose={() =>
        nav({
          to: '/spaces/$spaceSlug',
          params: { spaceSlug },
          search: (s: Record<string, unknown>) => ({ ...s, task: taskId }),
        })
      }
      onOpenTask={(t) =>
        nav({
          to: '/spaces/$spaceSlug/tasks/$taskId',
          params: { spaceSlug: t.spaceSlug, taskId: t.id },
        })
      }
    />
  )
}
