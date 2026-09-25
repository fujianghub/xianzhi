/**
 * 个人设置（08 §2.13、T1-033、REQ-WS-010 · 022 · 023）：头像、用户名、邮箱（须当前密码）、显示名、时区、周起始（服务端，影响「今日」「周期」）；
 * 主题、密度与动效档位为本机偏好。改动即保存，显示「已保存 · 刚刚」；时区改动后失效任务列表（今日边界变化）。
 */
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Input } from '../components/ui/input.tsx'
import { type Me, useMe } from '../hooks/useMe.ts'
import { ApiError, api, unwrap } from '../lib/api.ts'
import { useLayout } from '../lib/stores.ts'
import { currentTheme, setTheme, storedChoice, type ThemeChoice } from '../lib/theme.ts'
import { ProfileAccount } from './-components/profile-account.tsx'

export const Route = createFileRoute('/_app/settings/')({ component: Profile })

const zones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
      'timeZone',
    )
  } catch {
    return ['Asia/Shanghai', 'UTC']
  }
}

function Profile() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const router = useRouter()
  const { data: me } = useMe()
  const [saved, setSaved] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const { density, setDensity, motion, setMotion } = useLayout()
  const [theme, setThemeChoice] = useState<ThemeChoice>(() => storedChoice())
  const allZones = useMemo(zones, [])
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, d) =>
        new Intl.DateTimeFormat(i18n.language, { weekday: 'long' }).format(
          new Date(Date.UTC(2024, 0, 7 + d)),
        ),
      ),
    [i18n.language],
  )
  if (!me) return null

  const save = async (patch: Partial<Pick<Me, 'displayName' | 'timezone' | 'weekStartsOn'>>) => {
    setSaved(false)
    try {
      const r = await unwrap<Me>(api.me.$patch({ json: patch as never }))
      qc.setQueryData(['me'], r)
      await router.invalidate()
      if (patch.timezone || patch.weekStartsOn !== undefined)
        await qc.invalidateQueries({ queryKey: ['tasks'] })
      setSaved(true)
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.problem.errors?.[0]
          ? err.problem.errors[0].message
          : t('task.saveFailed'),
      )
    }
  }
  const row = 'flex flex-col gap-1.5 text-sm'
  const label = 'text-fg-muted text-xs'
  const select = 'h-10 rounded-md border border-border bg-surface px-3'
  return (
    <section className="max-w-3xl" data-testid="settings-profile">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="font-semibold text-2xl tracking-tight">{t('settings.nav.profile')}</h1>
        {saved ? (
          <span className="text-fg-muted text-xs" role="status" data-testid="saved">
            {t('task.savedJustNow')}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-5">
        <ProfileAccount me={me} />
        <label className={row}>
          <span className={label}>{t('settings.profile.displayName')}</span>
          <Input
            value={name ?? me.displayName ?? ''}
            placeholder={me.name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== null && name.trim() !== (me.displayName ?? ''))
                void save({ displayName: name.trim() || null })
            }}
            data-testid="profile-display-name"
          />
        </label>
        <label className={row}>
          <span className={label}>{t('settings.profile.timezone')}</span>
          <select
            className={select}
            value={me.timezone}
            onChange={(e) => void save({ timezone: e.target.value })}
            data-testid="profile-timezone"
          >
            {(allZones.includes(me.timezone) ? allZones : [me.timezone, ...allZones]).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className={row}>
          <span className={label}>{t('settings.profile.weekStartsOn')}</span>
          <select
            className={select}
            value={me.weekStartsOn}
            onChange={(e) => void save({ weekStartsOn: Number(e.target.value) })}
          >
            {weekdays.map((w, d) => (
              <option key={w} value={d}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className={row}>
          <span className={label}>{t('settings.profile.locale')}</span>
          <select className={select} value={me.locale} disabled>
            <option value="zh-CN">{t('settings.profile.zhCN')}</option>
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={row}>
            <span className={label}>{t('ui.theme.toggle')}</span>
            <select
              className={select}
              value={theme}
              onChange={(e) => {
                const v = e.target.value as ThemeChoice
                setThemeChoice(v)
                void setTheme(v)
              }}
            >
              {(['system', 'light', 'dark'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`ui.theme.${v}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={row}>
            <span className={label}>{t('settings.profile.density')}</span>
            <select
              className={select}
              value={density}
              onChange={(e) => setDensity(e.target.value as typeof density)}
            >
              <option value="comfortable">{t('settings.profile.comfortable')}</option>
              <option value="compact">{t('settings.profile.compact')}</option>
            </select>
          </label>
          <label className={row}>
            <span className={label}>{t('settings.profile.motion')}</span>
            <select
              className={select}
              value={motion}
              onChange={(e) => setMotion(e.target.value as typeof motion)}
              data-testid="profile-motion"
            >
              {(['standard', 'rich', 'reduce'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`settings.profile.motionLevel.${v}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-fg-muted text-xs">
          {t('settings.profile.localHint', { theme: t(`ui.theme.${currentTheme()}`) })}
        </p>
      </div>
    </section>
  )
}
