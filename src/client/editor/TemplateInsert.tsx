/**
 * 斜杠 `/模板`（03 §11.1、REQ-TPL-005）：在光标处插入所选模板的正文，不替换已有内容。
 * 「本类型默认骨架」排第一，其后按当前 kind 相同的模板优先；占位符按当前用户与今天替换。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fillTemplateVars } from '../../shared/editor/builtin-templates.ts'
import { entryTemplate } from '../../shared/editor/templates.ts'
import type { EntryKind } from '../../shared/schemas/enums.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { Skeleton } from '../components/ui/skeleton.tsx'
import { cn } from '../lib/cn.ts'
import { templateQuery, templatesQuery } from '../lib/template-queries.ts'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function TemplateInsert({
  kind,
  userName,
  onClose,
  onInsert,
}: {
  kind: EntryKind
  userName: string
  onClose: () => void
  onInsert: (content: PmNode[]) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const q = useQuery(templatesQuery)
  const [busy, setBusy] = useState<string | null>(null)
  const items = [...(q.data ?? [])].sort(
    (a, b) => Number(b.kind === kind) - Number(a.kind === kind),
  )
  const pick = async (id: string | null) => {
    setBusy(id ?? 'default')
    try {
      const body = id ? (await qc.fetchQuery(templateQuery(id))).body : entryTemplate(kind)
      const filled = fillTemplateVars(body, { date: today(), user: userName })
      onInsert(filled.content ?? [])
      onClose()
    } finally {
      setBusy(null)
    }
  }
  const row =
    'flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-hover disabled:opacity-60'
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[min(92vw,30rem)]" data-testid="template-insert">
        <DialogTitle>{t('template.insert')}</DialogTitle>
        <DialogDescription className="mt-1 text-fg-muted text-xs">
          {t('template.insertHint')}
        </DialogDescription>
        <ul className="mt-3 flex max-h-[60vh] flex-col overflow-y-auto">
          <li>
            <button
              type="button"
              className={row}
              disabled={!!busy}
              onClick={() => void pick(null)}
              data-template-id="default"
            >
              <span className="text-sm">{t('template.byKind')}</span>
              <span className="text-fg-muted text-xs">{t(`entry.kind.${kind}`)}</span>
            </button>
          </li>
          {q.isPending ? <Skeleton className="h-24 w-full" /> : null}
          {items.map((tpl) => (
            <li key={tpl.id}>
              <button
                type="button"
                className={cn(row, busy === tpl.id && 'bg-hover')}
                disabled={!!busy}
                onClick={() => void pick(tpl.id)}
                data-template-id={tpl.id}
              >
                <span className="text-sm">{tpl.name}</span>
                <span className="line-clamp-1 text-fg-muted text-xs">
                  {t(`entry.kind.${tpl.kind}`)} · {tpl.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
