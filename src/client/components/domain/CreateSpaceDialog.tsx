/**
 * 新建空间 Dialog（08 §2.5、REQ-SPACE-001 · 008 · REQ-KB-002）：名称、slug（留空按名称生成）、大类、类型、可见性、颜色 token、图标。
 * 服务端校验错误按 `errors[].path` 落到对应字段；slug 冲突（409 CONFLICT_UNIQUE）落到 slug。
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  type SpaceKind,
  type SpaceVisibility,
  spaceGroupsQuery,
  useCreateSpace,
} from '../../hooks/useSpaces.ts'
import { ApiError } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { useCreateSpaceDialog } from '../../lib/stores.ts'
import { Button } from '../ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'
import { FieldError, Label } from '../ui/label.tsx'
import { PALETTE, PALETTE_CLASS, type PaletteName, SPACE_ICONS, SpaceIcon } from './SpaceIcon.tsx'

const KINDS: SpaceKind[] = ['project', 'learning', 'work']
const VISIBILITIES: SpaceVisibility[] = ['workspace', 'members']

/** 单选组：原生 radio + 胶囊外观（键盘方向键切换由浏览器提供）。 */
function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  render,
  className,
}: {
  legend: string
  name: string
  value: T
  options: readonly T[]
  onChange: (v: T) => void
  render: (v: T) => ReactNode
  className?: string
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 font-medium text-fg-muted text-sm">{legend}</legend>
      <div className={cn('flex flex-wrap gap-1.5', className)}>
        {options.map((o) => (
          <label
            key={o}
            className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm has-[:checked]:border-selected-border has-[:checked]:bg-selected has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-(--xz-focus-color)"
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

export function CreateSpaceDialog() {
  const { t } = useTranslation()
  const { open, setOpen, groupId: presetGroup } = useCreateSpaceDialog()
  const groups = useQuery({ ...spaceGroupsQuery, enabled: open })
  const [group, setGroup] = useState<string>('none')
  useEffect(() => {
    if (open) setGroup(presetGroup ?? 'none')
  }, [open, presetGroup])
  const nav = useNavigate()
  const create = useCreateSpace()
  const id = useId()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [kind, setKind] = useState<SpaceKind>('project')
  const [visibility, setVisibility] = useState<SpaceVisibility>('workspace')
  const [color, setColor] = useState<string>('none')
  const [icon, setIcon] = useState<string>('none')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const reset = () => {
    setName('')
    setSlug('')
    setKind('project')
    setVisibility('workspace')
    setColor('none')
    setIcon('none')
    setErrors({})
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErrors({})
    try {
      const s = await create.mutateAsync({
        name: name.trim(),
        slug: slug.trim() || undefined,
        kind,
        visibility,
        color: color === 'none' ? null : color,
        icon: icon === 'none' ? null : icon,
        groupId: group === 'none' ? null : group,
      })
      toast.success(t('space.created', { name: s.name }))
      setOpen(false)
      reset()
      void nav({ to: '/spaces/$spaceSlug/home', params: { spaceSlug: s.slug } })
    } catch (err) {
      if (err instanceof ApiError && err.problem.errors?.length) {
        setErrors(
          Object.fromEntries(
            err.problem.errors.map((x) => [x.path.split('.')[0] ?? '', x.message]),
          ),
        )
      } else if (err instanceof ApiError) {
        toast.error(t(`errors.${err.code}`, { defaultValue: err.message }))
      } else throw err
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogContent className="w-[min(92vw,34rem)]" data-testid="create-space-dialog">
        <DialogTitle>{t('space.newSpace')}</DialogTitle>
        <DialogDescription>{t('space.emptyHint')}</DialogDescription>
        <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
          <div>
            <Label htmlFor={`${id}-name`}>{t('space.name')}</Label>
            <Input
              id={`${id}-name`}
              className="mt-1.5"
              value={name}
              maxLength={60}
              required
              autoFocus
              placeholder={t('space.namePlaceholder')}
              invalid={!!errors.name}
              onChange={(e) => setName(e.target.value)}
              data-testid="space-name"
            />
            <FieldError>{errors.name}</FieldError>
          </div>
          <div>
            <Label htmlFor={`${id}-slug`}>{t('space.slug')}</Label>
            <Input
              id={`${id}-slug`}
              className="mt-1.5 font-mono"
              value={slug}
              maxLength={40}
              invalid={!!errors.slug}
              aria-describedby={`${id}-slug-hint`}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              data-testid="space-slug"
            />
            <p id={`${id}-slug-hint`} className="mt-1 text-fg-muted text-xs">
              {t('space.slugHint')}
            </p>
            <FieldError>{errors.slug}</FieldError>
          </div>
          <Choice
            legend={t('space.group')}
            name={`${id}-group`}
            value={group}
            options={['none', ...(groups.data ?? []).map((g) => g.id)] as const}
            onChange={setGroup}
            render={(g) =>
              g === 'none'
                ? t('space.groups.none')
                : (groups.data?.find((x) => x.id === g)?.name ?? '')
            }
          />
          <Choice
            legend={t('space.kindLabel')}
            name={`${id}-kind`}
            value={kind}
            options={KINDS}
            onChange={setKind}
            render={(k) => t(`space.kind.${k}`)}
          />
          <Choice
            legend={t('space.visibilityLabel')}
            name={`${id}-vis`}
            value={visibility}
            options={VISIBILITIES}
            onChange={setVisibility}
            render={(v) => t(`space.visibility.${v}`)}
          />
          <Choice
            legend={t('space.color')}
            name={`${id}-color`}
            value={color}
            options={['none', ...PALETTE] as const}
            onChange={setColor}
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
            value={icon}
            options={['none', ...Object.keys(SPACE_ICONS)] as const}
            onChange={setIcon}
            className="max-h-28 overflow-y-auto"
            render={(i) =>
              i === 'none' ? (
                t('space.noIcon')
              ) : (
                <>
                  <SpaceIcon icon={i} kind={kind} color={null} className="size-5 bg-transparent" />
                  <span className="sr-only">{i}</span>
                </>
              )
            }
          />
          <FieldError>
            {errors.color ?? errors.icon ?? errors.kind ?? errors.visibility ?? errors.groupId}
          </FieldError>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('ui.action.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={!name.trim()}
              data-testid="create-space-submit"
            >
              {t('space.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
