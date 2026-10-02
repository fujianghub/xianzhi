/**
 * 设置 → 阅读与写作（ADR-0024、REQ-READ-006）：同记录页「Aa」面板 + 示例文段实时预览。
 * 偏好按账号存服务端（/me/preferences），换设备一致；只影响本人看到的样子。
 */
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { collectHeadings } from '../../shared/editor/headings.ts'
import { ReadingPanel } from '../components/domain/ReadingPanel.tsx'
import { PageHeader } from '../components/ui/page-header.tsx'
import { readingAttrs, useReading } from '../lib/reading.ts'

export const Route = createFileRoute('/_app/settings/reading')({ component: ReadingSettingsPage })

const SAMPLE = [
  { tag: 'h1', level: 1, key: 'h1' },
  { tag: 'p', level: 0, key: 'p1' },
  { tag: 'h2', level: 2, key: 'h2' },
  { tag: 'p', level: 0, key: 'p2' },
  { tag: 'h3', level: 3, key: 'h3' },
  { tag: 'p', level: 0, key: 'p3' },
] as const

/** 示例标题的编号与正文同一算法（collectHeadings）。 */
const SAMPLE_NUMS = collectHeadings({
  descendants: (f) => {
    SAMPLE.forEach((b, i) => {
      if (b.level) f({ type: { name: 'heading' }, attrs: { level: b.level }, textContent: '' }, i)
    })
  },
})

function ReadingSettingsPage() {
  const { t } = useTranslation()
  const prefs = useReading((s) => s.prefs)
  return (
    <div className="flex flex-col gap-6" data-testid="reading-settings">
      <PageHeader title={t('reading.pageTitle')} description={t('reading.pageHint')} />
      <section className="paper rounded-xl p-5">
        <ReadingPanel />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">{t('reading.preview')}</h2>
        {/* 预览按所选版心但不超出设置页内容区 */}
        <article
          className="paper xz-reading w-full rounded-xl px-6 py-6 shadow-[inset_0_1px_0_var(--xz-edge),var(--xz-shadow-card)] sm:px-10"
          {...readingAttrs(prefs)}
          data-testid="reading-preview"
        >
          <div className="xz-prose min-h-0">
            {SAMPLE.map((b, i) => {
              const Tag = b.tag
              const num = SAMPLE_NUMS.find((h) => h.pos === i)?.num
              return (
                <Tag key={b.key} data-num={num}>
                  {t(`reading.sample.${b.key}`)}
                </Tag>
              )
            })}
          </div>
        </article>
      </section>
    </div>
  )
}
