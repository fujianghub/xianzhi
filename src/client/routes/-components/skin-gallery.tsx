/**
 * 个人设置 · 皮肤画廊（ADR-0059、REQ-UI-060）：首张「衔枝原生」，其余为已安装皮肤（缩略图 · 日 / 夜徽标 · 作者）。
 * 点选即随账号保存（setAppearance）；工作区默认的那张标「默认」；选了但已卸载的皮肤给出提示。
 */
import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SKIN_NONE, type SkinSummary } from '../../../shared/skins.ts'
import { cn } from '../../lib/cn.ts'
import { skinsQuery, skinThumbUrl } from '../../lib/skin.ts'

export function SkinGallery({
  value,
  defaultValue,
  onChange,
}: {
  value: string
  defaultValue: string
  onChange: (id: string) => void
}) {
  const { t } = useTranslation()
  const q = useQuery(skinsQuery)
  const skins = q.data ?? []
  const missing = value !== SKIN_NONE && q.isSuccess && !skins.some((s) => s.id === value)
  return (
    <div className="flex flex-col gap-2" data-testid="skin-gallery">
      <span className="text-fg-muted text-xs">{t('ui.skin.label')}</span>
      {missing ? (
        <p className="text-fg-muted text-xs" role="status" data-testid="skin-missing">
          {t('ui.skin.missing', { id: value })}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Card
          id={SKIN_NONE}
          name={t('ui.skin.none')}
          meta={t('ui.skin.noneHint')}
          selected={value === SKIN_NONE || missing}
          isDefault={defaultValue === SKIN_NONE}
          onSelect={onChange}
        />
        {skins.map((s) => (
          <Card
            key={s.id}
            id={s.id}
            skin={s}
            name={s.name}
            meta={[t(`ui.theme.${s.mode}`), s.author].filter(Boolean).join(' · ')}
            selected={value === s.id}
            isDefault={defaultValue === s.id}
            onSelect={onChange}
          />
        ))}
      </div>
      {q.isSuccess && !skins.length ? (
        <p className="text-fg-muted text-xs" data-testid="skin-empty">
          {t('ui.skin.empty')} <code className="font-mono">pnpm xz skin install &lt;id&gt;</code>
        </p>
      ) : null}
    </div>
  )
}

function Card({
  id,
  skin,
  name,
  meta,
  selected,
  isDefault,
  onSelect,
}: {
  id: string
  skin?: SkinSummary
  name: string
  meta: string
  selected: boolean
  isDefault: boolean
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const [broken, setBroken] = useState(false)
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={skin?.description || undefined}
      onClick={() => onSelect(id)}
      data-testid={`skin-card-${id}`}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border bg-surface text-start',
        'transition-[border-color,box-shadow] duration-(--xz-dur-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--xz-focus-color)',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-fg-faint',
      )}
    >
      <span className="relative block aspect-[16/10] w-full overflow-hidden bg-surface-2">
        {skin && !broken ? (
          <img
            src={skinThumbUrl(skin)}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="size-full object-cover"
          />
        ) : (
          <span className="block size-full bg-(image:--xz-primary-gradient) opacity-70" />
        )}
        {selected ? (
          <span className="absolute end-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-fg">
            <Check className="size-3.5" aria-hidden />
          </span>
        ) : null}
      </span>
      <span className="flex flex-col gap-0.5 px-2.5 py-2">
        <span className="truncate font-medium text-sm">
          {name}
          {isDefault ? (
            <span className="ms-1.5 font-normal text-fg-muted text-xs">{t('ui.skin.default')}</span>
          ) : null}
        </span>
        <span className="truncate text-fg-muted text-xs">{meta}</span>
      </span>
    </button>
  )
}
