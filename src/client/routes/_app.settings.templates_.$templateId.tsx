/** 编辑模板（ADR-0023、REQ-TPL-010）：作者与管理员可改；他人共享的模板只读、可「复制到我的」。 */
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { TemplateForm, TemplateFormSkeleton } from '../components/domain/TemplateForm.tsx'
import { templateQuery } from '../lib/template-queries.ts'

export const Route = createFileRoute('/_app/settings/templates_/$templateId')({
  component: EditTemplate,
})

function EditTemplate() {
  const { t } = useTranslation()
  const { templateId } = Route.useParams()
  const q = useQuery(templateQuery(templateId))
  if (q.isError)
    return (
      <p className="text-fg-muted text-sm" data-testid="template-missing">
        {t('template.notFound')}
      </p>
    )
  if (!q.data) return <TemplateFormSkeleton />
  // key：保存后重新拉取（updatedAt 变化）时表单与编辑器按新数据重建
  return <TemplateForm key={q.data.updatedAt ?? q.data.id} tpl={q.data} />
}
