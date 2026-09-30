/**
 * 模板预览（REQ-TPL-004 · 010）：只读渲染模板 body；可「用此模板新建」；看不到 / 不存在时提示。随编辑器 chunk 懒加载。
 * ADR-0039（REQ-TPL-016）：正文上方列出用它新建的记录会带的属性（类型属性去掉被移除的 + 模板属性）与预填值。
 */
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FieldValue, useFieldSpecs, withTemplateSpecs } from '../components/domain/FieldValue.tsx'
import { Button } from '../components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { useKindLabel } from '../lib/entry-types.ts'
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
  const specsOf = useFieldSpecs()
  const kindOf = useKindLabel()
  const tpl = q.data
  // Bug 的发现 / 解决日期由服务端维护，不属于模板
  const specs = tpl
    ? withTemplateSpecs(specsOf(tpl.kind, tpl.typeId), tpl, tpl.kind, tpl.typeId).filter(
        (f) => !(tpl.kind === 'bug' && (f.name === 'foundAt' || f.name === 'resolvedAt')),
      )
    : []
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
              {t('template.kindLabel', { kind: kindOf(q.data.kind, q.data.typeId).label })}
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
        {tpl && specs.length ? (
          <dl
            className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
            aria-label={t('template.meta.previewTitle')}
            data-testid="template-preview-fields"
          >
            {specs.map((f) => (
              <div key={f.name} className="flex items-center gap-1.5" data-field={f.name}>
                <dt className="text-fg-muted text-xs">{f.label}</dt>
                <dd>
                  <FieldValue
                    spec={f}
                    value={tpl.fields[f.name]}
                    fields={tpl.fields}
                    size="sm"
                    empty={<span className="text-fg-faint text-xs">{t('field.empty')}</span>}
                  />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="mt-3 min-h-40 flex-1 overflow-y-auto rounded-md border border-border p-4">
          {q.data ? (
            <ReadOnlyDoc doc={q.data.body} testId="template-doc" />
          ) : q.isError ? (
            <p className="text-fg-muted text-sm" data-testid="template-preview-missing">
              {t('template.notFound')}
            </p>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
