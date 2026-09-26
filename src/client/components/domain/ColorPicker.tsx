/** 9 色板选色（ADR-0010）：标签 / 自定义类型管理共用。 */
import { cn } from '../../lib/cn.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { PALETTE, PALETTE_CLASS, type PaletteName } from './SpaceIcon.tsx'

export function ColorPicker({
  value,
  onChange,
  label,
  disabled,
  testId = 'tag-color',
}: {
  value: PaletteName
  onChange: (c: PaletteName) => void
  label: string
  disabled?: boolean
  testId?: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-hover disabled:opacity-60"
          data-testid={testId}
        >
          <span className={cn('size-4 rounded-full', PALETTE_CLASS[value])} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-auto grid-cols-5 gap-1 p-2">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={c === value}
            onClick={() => onChange(c as PaletteName)}
            className={cn(
              'grid size-8 place-items-center rounded-md hover:bg-hover',
              c === value && 'ring-2 ring-selected-border',
            )}
            data-color={c}
          >
            <span className={cn('size-4 rounded-full', PALETTE_CLASS[c as PaletteName])} />
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
