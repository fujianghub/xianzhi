/**
 * 空间图标与颜色选择（REQ-SPACE-008、ADR-0035 REQ-KB-011）：新建空间对话框与空间 ⋯ 菜单 / 页头图标共用。
 * 两组原生 radio + 胶囊外观（键盘方向键切换由浏览器提供）；「默认」= null（按空间类型出图标、不着色）。
 */
import type { ReactNode } from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import { PALETTE, PALETTE_CLASS, type PaletteName, SPACE_ICONS, SpaceIcon } from './SpaceIcon.tsx'

/** 单选组：原生 radio + 胶囊外观。 */
export function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  render,
  className,
  compact,
}: {
  legend: string
  name: string
  value: T
  options: readonly T[]
  onChange: (v: T) => void
  render: (v: T) => ReactNode
  className?: string
  /** 菜单内的紧凑版（小胶囊） */
  compact?: boolean
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={cn('mb-1.5 font-medium text-fg-muted', compact ? 'text-xs' : 'text-sm')}>
        {legend}
      </legend>
      <div className={cn('flex flex-wrap', compact ? 'gap-1' : 'gap-1.5', className)}>
        {options.map((o) => (
          <label
            key={o}
            className={cn(
              'relative inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border has-[:checked]:border-selected-border has-[:checked]:bg-selected has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-(--xz-focus-color)',
              compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={o}
              checked={value === o}
              onChange={() => onChange(o)}
            />
            {render(o)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function SpaceIconPicker({
  kind,
  color,
  icon,
  onColor,
  onIcon,
  compact,
}: {
  kind: string
  /** null = 默认 */
  color: string | null
  icon: string | null
  onColor: (c: string | null) => void
  onIcon: (i: string | null) => void
  compact?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-4')}>
      <Choice
        legend={t('space.color')}
        name={`${id}-color`}
        value={color ?? 'none'}
        options={['none', ...PALETTE] as const}
        onChange={(c) => onColor(c === 'none' ? null : c)}
        compact={compact}
        render={(c) =>
          c === 'none' ? (
            t('space.noIcon')
          ) : (
            <>
              <span
                className={cn('size-3.5 rounded-full', PALETTE_CLASS[c as PaletteName])}
                aria-hidden
              />
              {t(`ui.palette.${c}`)}
            </>
          )
        }
      />
      <Choice
        legend={t('space.icon')}
        name={`${id}-icon`}
        value={icon ?? 'none'}
        options={['none', ...Object.keys(SPACE_ICONS)] as const}
        onChange={(i) => onIcon(i === 'none' ? null : i)}
        className="max-h-28 overflow-y-auto"
        compact={compact}
        render={(i) =>
          i === 'none' ? (
            t('space.noIcon')
          ) : (
            <>
              <SpaceIcon icon={i} kind={kind} color={null} plain className="size-5" />
              <span className="sr-only">{i}</span>
            </>
          )
        }
      />
    </div>
  )
}
