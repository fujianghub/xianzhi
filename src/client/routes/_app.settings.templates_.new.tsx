/** 新建模板（ADR-0023、REQ-TPL-010）：直接编写模板正文，无需先建记录。 */
import { createFileRoute } from '@tanstack/react-router'
import { TemplateForm } from '../components/domain/TemplateForm.tsx'

export const Route = createFileRoute('/_app/settings/templates_/new')({
  component: () => <TemplateForm />,
})
