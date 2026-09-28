/**
 * 阅读与写作偏好面板（ADR-0024、REQ-READ-002 ~ 004）：记录页「Aa」弹层与设置 → 阅读与写作共用。
 * 改动即时生效（乐观），由 useReading 防抖同步到服务端；字体选项用各自字体渲染，纸张选项是纸面小样。
 */
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  READING_CODE_FOLDS,
  READING_FONTS,
  READING_LINE_HEIGHTS,
  READING_PAPERS,
  READING_PARAGRAPHS,
  READING_SIZES,
  READING_TOC_DEPTHS,
  READING_WIDTHS,
  type ReadingPrefs,
} from '../../../shared/schemas/preferences.ts'
import { cn } from '../../lib/cn.ts'
import { useReading } from '../../lib/reading.ts'
import { Button } from '../ui/button.tsx'
import { Checkbox } from '../ui/checkbox.tsx'

const FONT_VAR: Record<ReadingPrefs['font'], string> = {
  sans: 'var(--xz-font-sans)',
  wenkai: 'var(--xz-font-serif)',
  song: 'var(--xz-font-song)',
  system: 'var(--xz-font-system)',
  mono: 'var(--xz-font-mono)',
}

function Segmented<T extends string | number>({
  label,
  name,
  value,
  options,
  onChange,
  render,
  optionStyle,
}: {
  label: string
  name: string
  value: T
  options: readonly T[]
  onChange: (v: T) => void
  render: (v: T) => string
  optionStyle?: (v: T) => CSSProperties | undefined
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-fg-muted text-xs">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            aria-pressed={o === value}
            onClick={() => onChange(o)}
            style={optionStyle?.(o)}
            data-testid={`reading-${name}-${o}`}
            className={cn(
              'h-8 min-w-12 rounded-md border px-2.5 text-sm transition-colors duration-(--xz-dur-fast)',
              o === value
                ? 'border-selected-border bg-selected font-medium text-primary-text'
                : 'border-border bg-surface text-fg hover:bg-hover',
            )}
          >
            {render(o)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  testId,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  testId: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        data-testid={testId}
      />
      <span className="flex flex-col">
        {label}
        {hint ? <span className="text-fg-muted text-xs">{hint}</span> : null}
      </span>
    </label>
  )
}

/** 字体（简斋 ReaderFontPicker）：竖排列表，每项用本字体渲染。 */
export function FontPanel() {
  const { t } = useTranslation()
  const font = useReading((s) => s.prefs.font)
  const update = useReading((s) => s.update)
  return (
    <fieldset className="flex flex-col gap-1" data-testid="reading-font-panel">
      <legend className="mb-1.5 text-fg-muted text-xs">{t('reading.font')}</legend>
      {READING_FONTS.map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={f === font}
          onClick={() => update({ font: f })}
          style={{ fontFamily: FONT_VAR[f] }}
          data-testid={`reading-font-${f}`}
          className={cn(
            'rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-(--xz-dur-fast)',
            f === font ? 'bg-selected text-primary-text' : 'hover:bg-hover',
          )}
        >
          {t(`reading.fontsLong.${f}`)}
        </button>
      ))}
    </fieldset>
  )
}

/** 纸张（简斋 PaperPicker）：纹理小样。 */
export function PaperPanel() {
  const { t } = useTranslation()
  const paper = useReading((s) => s.prefs.paper)
  const update = useReading((s) => s.update)
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid="reading-paper-panel">
      <legend className="mb-1.5 text-fg-muted text-xs">{t('reading.paper')}</legend>
      <div className="grid grid-cols-3 gap-2">
        {READING_PAPERS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === paper}
            title={t(`reading.papers.${p}`)}
            onClick={() => update({ paper: p })}
            data-testid={`reading-paper-${p}`}
            className={cn(
              'paper flex h-12 items-end justify-center rounded-md pb-1 text-[11px]',
              p !== 'plain' && `xz-paper-${p}`,
              p === paper ? 'text-primary-text ring-2 ring-(--xz-focus-color)' : 'text-fg-muted',
            )}
          >
            {t(`reading.papers.${p}`)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** 排版（简斋 ReaderLayoutPicker）：字号 / 行距 / 段距 / 版心 / 缩进 / 对齐 / 恢复默认。 */
export function LayoutPanel() {
  const { t } = useTranslation()
  const prefs = useReading((s) => s.prefs)
  const update = useReading((s) => s.update)
  const reset = useReading((s) => s.reset)
  return (
    <div className="flex flex-col gap-3.5" data-testid="reading-layout-panel">
      <Segmented
        label={t('reading.size')}
        name="size"
        value={prefs.size}
        options={READING_SIZES}
        onChange={(size) => update({ size })}
        render={(v) => t(`reading.sizes.${v}`)}
      />
      <Segmented
        label={t('reading.lineHeight')}
        name="lineHeight"
        value={prefs.lineHeight}
        options={READING_LINE_HEIGHTS}
        onChange={(lineHeight) => update({ lineHeight })}
        render={(v) => t(`reading.spacing.${v}`)}
      />
      <Segmented
        label={t('reading.paragraph')}
        name="paragraph"
        value={prefs.paragraph}
        options={READING_PARAGRAPHS}
        onChange={(paragraph) => update({ paragraph })}
        render={(v) => t(`reading.spacing.${v}`)}
      />
      <Segmented
        label={t('reading.width')}
        name="width"
        value={prefs.width}
        options={READING_WIDTHS}
        onChange={(width) => update({ width })}
        render={(v) => t(`reading.widths.${v}`)}
      />
      <Segmented
        label={t('reading.codeFold')}
        name="codeFold"
        value={prefs.codeFold}
        options={READING_CODE_FOLDS}
        onChange={(codeFold) => update({ codeFold })}
        render={(v) => t(`reading.codeFolds.${v}`)}
      />
      <div className="flex flex-col gap-2.5">
        <Toggle
          label={t('reading.indent')}
          checked={prefs.indent}
          onChange={(indent) => update({ indent })}
          testId="reading-indent"
        />
        <Toggle
          label={t('reading.justify')}
          checked={prefs.justify}
          onChange={(justify) => update({ justify })}
          testId="reading-justify"
        />
      </div>
      <div className="border-divider border-t pt-2">
        <Button size="sm" variant="ghost" onClick={reset} data-testid="reading-reset">
          {t('reading.reset')}
        </Button>
      </div>
    </div>
  )
}

/** 目录格式：章节编号 + 目录深度。 */
export function TocPanel() {
  const { t } = useTranslation()
  const prefs = useReading((s) => s.prefs)
  const update = useReading((s) => s.update)
  return (
    <div className="flex flex-col gap-3.5" data-testid="reading-toc-panel">
      <Toggle
        label={t('reading.tocNumbers')}
        hint={t('reading.tocNumbersHint')}
        checked={prefs.tocNumbers}
        onChange={(tocNumbers) => update({ tocNumbers })}
        testId="reading-toc-numbers"
      />
      <Toggle
        label={t('reading.headingNumbers')}
        hint={t('reading.headingNumbersHint')}
        checked={prefs.headingNumbers}
        onChange={(headingNumbers) => update({ headingNumbers })}
        testId="reading-numbers"
      />
      <Segmented
        label={t('reading.tocDepth')}
        name="tocDepth"
        value={prefs.tocDepth}
        options={READING_TOC_DEPTHS}
        onChange={(tocDepth) => update({ tocDepth })}
        render={(v) => t('reading.tocDepthN', { n: v })}
      />
    </div>
  )
}

/** 设置 → 阅读与写作：四个子面板合在一页。 */
export function ReadingPanel() {
  return (
    <div
      className="flex flex-col gap-6 md:grid md:grid-cols-2 md:gap-x-10"
      data-testid="reading-panel"
    >
      <FontPanel />
      <PaperPanel />
      <LayoutPanel />
      <TocPanel />
    </div>
  )
}

export default ReadingPanel
