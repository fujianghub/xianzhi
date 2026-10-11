/**
 * 设置 → 主题 · 主题画廊（ADR-0059 · 0060、REQ-UI-060 · 063）：首张「衔枝原生」，其余为已安装主题（缩略图 · 明暗 · 作者）。
 * 点卡片即随账号保存；工作区默认那张标「默认」；所有者 / 管理员可在卡片上「设为默认」；选了但已卸载的主题给出提示。
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
  onSetDefault,
}: {
  value: string
  defaultValue: string
  onChange: (id: string) => void
  /** 有权限（所有者 / 管理员）时给出，卡片上显示「设为默认」 */
  onSetDefault?: (id: string) => void
}) {
  const { t } = useTranslation()
  const q = useQuery(skinsQuery)
  const skins = q.data ?? []
  const missing = value !== SKIN_NONE && q.isSuccess && !skins.some((s) => s.id === value)
  const card = { value, defaultValue, onChange, onSetDefault }
  return (
    <div className="flex flex-col gap-2" data-testid="skin-gallery">
      {missing ? (
        <p className="text-fg-muted text-xs" role="status" data-testid="skin-missing">
          {t('ui.skin.missing', { id: value })}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <Card
          {...card}
          id={SKIN_NONE}
          name={t('ui.skin.none')}
          meta={t('ui.skin.noneHint')}
          selected={value === SKIN_NONE || missing}
        />
        {skins.map((s) => (
          <Card
            key={s.id}
            {...card}
            id={s.id}
            skin={s}
            name={s.name}
            meta={[t(`ui.theme.${s.mode}`), s.author].filter(Boolean).join(' · ')}
            selected={value === s.id}
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
  defaultValue,
  onChange,
  onSetDefault,
}: {
  id: string
  skin?: SkinSummary
  name: string
  meta: string
  selected: boolean
  defaultValue: string
  onChange: (id: string) => void
  onSetDefault?: (id: string) => void
}) {
  const { t } = useTranslation()
  const [broken, setBroken] = useState(false)
  const isDefault = defaultValue === id
  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border bg-surface',
        'transition-[border-color] duration-(--xz-dur-fast)',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-fg-faint',
      )}
      data-testid={`skin-item-${id}`}
    >
      <button
        type="button"
        aria-pressed={selected}
        title={skin?.description || undefined}
        onClick={() => onChange(id)}
        data-testid={`skin-card-${id}`}
        className="flex flex-col text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--xz-focus-color) focus-visible:ring-inset"
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
        <span className="flex flex-col gap-0.5 px-2.5 pt-2 pb-1">
          <span className="truncate font-medium text-sm">
            {name}
            {isDefault ? (
              <span
                className="ms-1.5 font-normal text-fg-muted text-xs"
                data-testid="skin-default-badge"
              >
                {t('ui.skin.default')}
              </span>
            ) : null}
          </span>
          <span className="truncate text-fg-muted text-xs">{meta}</span>
        </span>
      </button>
      {onSetDefault ? (
        <span className="flex h-8 items-center px-2.5 pb-1.5">
          {!isDefault ? (
            <button
              type="button"
              className="-ms-1 inline-flex h-6 items-center rounded px-1 text-primary-text text-xs hover:underline"
              onClick={() => onSetDefault(id)}
              data-testid={`skin-set-default-${id}`}
            >
              {t('ui.skin.setDefault')}
            </button>
          ) : null}
        </span>
      ) : (
        <span className="pb-1.5" />
      )}
    </div>
  )
}
