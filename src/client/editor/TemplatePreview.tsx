/** 模板正文预览（REQ-TPL-004）：只读渲染模板 body；可「用此模板新建」。随编辑器 chunk 懒加载。 */
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { templateQuery } from '../lib/template-queries.ts'
import { ReadOnlyDoc } from './ReadOnlyDoc.tsx'

export default function TemplatePreview({
  id,
  onClose,
  onUse,
}: {
  id: string
  onClose: () => void
  onUse?: () => void
}) {
  const { t } = useTranslation()
  const q = useQuery(templateQuery(id))
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] w-[min(96vw,52rem)] flex-col"
        data-testid="template-preview"
      >
        <div className="flex items-center gap-3 pe-8">
          <DialogTitle className="truncate">{q.data?.name ?? ''}</DialogTitle>
          {q.data ? (
            <span className="text-fg-muted text-xs">
              {t('template.kindLabel', { kind: t(`entry.kind.${q.data.kind}`) })}
            </span>
          ) : null}
          {onUse ? (
            <Button
              size="sm"
              variant="primary"
              className="ms-auto"
              onClick={onUse}
              data-testid="template-use"
            >
              {t('template.useIt')}
            </Button>
          ) : null}
        </div>
        <DialogDescription className="mt-1 text-fg-muted text-xs">
          {q.data?.description}
        </DialogDescription>
        <div className="mt-3 min-h-40 flex-1 overflow-y-auto rounded-md border border-border p-4">
          {q.data ? (
            <ReadOnlyDoc doc={q.data.body} testId="template-doc" />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
