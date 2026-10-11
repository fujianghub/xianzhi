/**
 * 设置 → 主题（ADR-0060、REQ-UI-062 · 063）：外观集中在这一页，随账号保存（ADR-0049）。
 * - 主题画廊（ADR-0059 的「皮肤」，界面统一叫「主题」）：点选即生效；「恢复默认主题」= 删除本人值、跟随工作区默认
 * - 明暗模式（日场 / 夜场 / 跟随系统）· 密度 · 动效 · 玻璃强度；主题生效时明暗与玻璃强度随主题
 * - 所有者 / 管理员：卡片上「设为默认」与「工作区默认外观」（原在工作区信息页）；默认主题同时用于登录 / 注册页
 * - 图片强度（ADR-0061）：淡 / 中（默认）/ 浓，画廊标题旁的分段按钮；没选主题时禁用
 */
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  APPEARANCE_DENSITIES,
  APPEARANCE_GLASS,
  APPEARANCE_MOTIONS,
  APPEARANCE_THEMES,
  type AppearanceKey,
  type AppearancePrefs,
  BUILTIN_APPEARANCE,
  resolveAppearance,
} from '../../shared/schemas/preferences.ts'
import { SKIN_ART_LEVELS } from '../../shared/skins.ts'
import { PageHeader } from '../components/ui/page-header.tsx'
import { isAdmin, useMe } from '../hooks/useMe.ts'
import { api, unwrap } from '../lib/api.ts'
import { setAppearance, setWorkspaceAppearance, useAppearance } from '../lib/appearance.ts'
import { cn } from '../lib/cn.ts'
import { SkinGallery } from './-components/skin-gallery.tsx'

export const Route = createFileRoute('/_app/settings/theme')({ component: ThemeSettings })

type Row = [AppearanceKey, string, readonly string[], (v: string) => string]

const row = 'flex flex-col gap-1.5 text-sm'
const label = 'text-fg-muted text-xs'
const select = 'h-10 rounded-md border border-border bg-surface px-3 text-sm'

function useRows(): Row[] {
  const { t } = useTranslation()
  return [
    ['theme', t('ui.theme.mode'), APPEARANCE_THEMES, (v) => t(`ui.theme.${v}`)],
    [
      'density',
      t('settings.profile.density'),
      APPEARANCE_DENSITIES,
      (v) => t(`settings.profile.${v}`),
    ],
    [
      'motion',
      t('settings.profile.motion'),
      APPEARANCE_MOTIONS,
      (v) => t(`settings.profile.motionLevel.${v}`),
    ],
    [
      'glass',
      t('settings.profile.glass'),
      APPEARANCE_GLASS,
      (v) => t(`settings.profile.glassLevel.${v}`),
    ],
  ]
}

function ThemeSettings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const look = useAppearance()
  const rows = useRows()
  const effective = resolveAppearance(look.workspace, look.user)
  const defaults = { ...BUILTIN_APPEARANCE, ...look.workspace }
  const admin = isAdmin(me)

  /** 工作区默认外观：整份保存（缺的键跟随内置默认）；本人生效值随之重算，其他成员下次加载生效 */
  const saveWorkspace = async (next: Partial<AppearancePrefs>) => {
    try {
      await unwrap(api.workspace.$patch({ json: { settings: { appearance: next } } as never }))
      await qc.invalidateQueries({ queryKey: ['workspace'] })
      await qc.invalidateQueries({ queryKey: ['me', 'preferences'] })
      setWorkspaceAppearance(next)
      toast.success(t('settings.theme.defaultSaved'))
    } catch {
      toast.error(t('task.saveFailed'))
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-8" data-testid="settings-theme">
      <PageHeader title={t('settings.theme.title')} description={t('settings.theme.hint')} />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-base">{t('ui.skin.label')}</h2>
          {look.user.skin !== undefined ? (
            <button
              type="button"
              className="text-primary-text text-xs hover:underline"
              onClick={() => setAppearance({ skin: null })}
              data-testid="skin-restore-default"
            >
              {t('ui.skin.restoreDefault')}
            </button>
          ) : null}
          <SkinArtSwitch
            value={effective.skinArt}
            defaultValue={defaults.skinArt}
            disabled={!look.mounted}
          />
        </div>
        <SkinGallery
          value={effective.skin}
          defaultValue={defaults.skin}
          onChange={(skin) => setAppearance({ skin })}
          onSetDefault={
            admin ? (skin) => void saveWorkspace({ ...look.workspace, skin }) : undefined
          }
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-base">{t('settings.theme.appearance')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map(([key, text, values, name]) => (
            <label key={key} className={row}>
              <span className={label}>
                {text}
                {/* 主题生效时明暗与玻璃强度随主题（选择仍保存，退出主题后恢复） */}
                {look.mounted && (key === 'theme' || key === 'glass') ? (
                  <span className="ms-1">{t('ui.skin.locked')}</span>
                ) : null}
              </span>
              <select
                className={select}
                value={effective[key]}
                disabled={Boolean(look.mounted) && (key === 'theme' || key === 'glass')}
                onChange={(e) => setAppearance({ [key]: e.target.value })}
                data-testid={`profile-${key}`}
              >
                {values.map((v) => (
                  <option key={v} value={v}>
                    {defaults[key] === v
                      ? t('settings.profile.appearanceDefault', { name: name(v) })
                      : name(v)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-fg-muted text-xs">{t('settings.profile.localHint')}</p>
          {Object.keys(look.user).length ? (
            <button
              type="button"
              className="text-primary-text text-xs hover:underline"
              onClick={() =>
                setAppearance({
                  theme: null,
                  density: null,
                  motion: null,
                  glass: null,
                  skin: null,
                  skinArt: null,
                })
              }
              data-testid="profile-appearance-reset"
            >
              {t('settings.profile.appearanceReset')}
            </button>
          ) : null}
        </div>
      </section>

      {admin ? (
        <WorkspaceDefaults
          rows={[
            ...rows,
            ['skinArt', t('ui.skin.art'), SKIN_ART_LEVELS, (v) => t(`ui.skin.artLevel.${v}`)],
          ]}
          value={look.workspace}
          onSave={saveWorkspace}
        />
      ) : null}
    </div>
  )
}

/** 图片强度分段按钮（ADR-0061）：淡 / 中 / 浓，随账号保存；工作区默认那一档标「默认」 */
function SkinArtSwitch({
  value,
  defaultValue,
  disabled,
}: {
  value: string
  defaultValue: string
  disabled: boolean
}) {
  const { t } = useTranslation()
  return (
    <fieldset
      disabled={disabled}
      className="ms-auto flex items-center gap-2 text-xs"
      data-testid="skin-art"
    >
      <legend className="float-start me-2 text-fg-muted">
        {t('ui.skin.art')}
        {disabled ? <span className="ms-1">{t('ui.skin.artNeedsTheme')}</span> : null}
      </legend>
      <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
        {SKIN_ART_LEVELS.map((v) => (
          <label
            key={v}
            title={defaultValue === v ? t('ui.skin.default') : undefined}
            data-testid={`skin-art-${v}`}
            className={cn(
              'relative grid h-7 min-w-10 cursor-pointer place-items-center rounded-md px-2.5 transition-colors duration-(--xz-dur-fast)',
              'has-focus-visible:ring-2 has-focus-visible:ring-(--xz-focus-color) has-disabled:cursor-not-allowed has-disabled:opacity-50',
              value === v
                ? 'bg-primary text-primary-fg'
                : 'text-fg-muted hover:bg-hover hover:text-fg',
            )}
          >
            <input
              type="radio"
              name="skin-art"
              value={v}
              checked={value === v}
              onChange={() => setAppearance({ skinArt: v })}
              className="sr-only"
            />
            {t(`ui.skin.artLevel.${v}`)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** 工作区默认外观（所有者 / 管理员）：明暗 · 密度 · 动效 · 玻璃强度；默认主题在上方卡片上「设为默认」 */
function WorkspaceDefaults({
  rows,
  value,
  onSave,
}: {
  rows: Row[]
  value: Partial<AppearancePrefs>
  onSave: (next: Partial<AppearancePrefs>) => Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const current = { ...BUILTIN_APPEARANCE, ...value }
  return (
    <section className="flex flex-col gap-3" data-testid="workspace-appearance">
      <h2 className="font-semibold text-base">{t('settings.workspace.appearance')}</h2>
      <p className="text-fg-muted text-xs">{t('settings.theme.workspaceHint')}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([key, text, values, name]) => (
          <label key={key} className={row}>
            <span className={label}>{text}</span>
            <select
              className={select}
              value={current[key]}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true)
                await onSave({ ...value, [key]: e.target.value })
                setBusy(false)
              }}
              data-testid={`workspace-appearance-${key}`}
            >
              {values.map((v) => (
                <option key={v} value={v}>
                  {name(v)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  )
}
