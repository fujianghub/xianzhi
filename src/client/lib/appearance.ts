/**
 * 外观偏好（ADR-0049、REQ-UI-051）：主题 / 密度 / 动效档位 / 玻璃强度 / 皮肤（ADR-0059）随账号保存（`/me/preferences` 的 appearance），跨设备生效。
 * 生效值 = 内置默认 ← 工作区默认 ← 用户值（shared `resolveAppearance`）。
 * 本机 localStorage（xz:theme / xz:density / xz:motion / xz:glass）只作首帧缓存：theme-init.js 先按缓存应用，
 * 登录后拉到服务端值再按生效值覆盖缓存与 html 属性。用户改动：本机立即生效 + PATCH（null = 改回跟随默认）。
 */
import { useQuery } from '@tanstack/react-query'
import i18n from 'i18next'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import {
  type AppearanceKey,
  type AppearancePrefs,
  resolveAppearance,
} from '../../shared/schemas/preferences.ts'
import type { SkinSummary } from '../../shared/skins.ts'
import { setGlass, storedGlass } from './glass.ts'
import { preferencesQuery } from './reading.ts'
import { activeSkin, mountSkin, resolveSkin, skinsQuery, storedSkin, unmountSkin } from './skin.ts'
import { useLayout } from './stores.ts'
import {
  applyTheme,
  persist,
  setTheme,
  storedChoice,
  systemTheme,
  viewTransition,
} from './theme.ts'

export type AppearancePatch = { [K in AppearanceKey]?: AppearancePrefs[K] | null }

interface AppearanceState {
  user: Partial<AppearancePrefs>
  workspace: Partial<AppearancePrefs>
  loaded: boolean
  /** 已安装皮肤（`GET /skins`）；未拉到前为 undefined */
  skins?: SkinSummary[]
  /** 页面上实际挂着的皮肤（选了但已卸载 → null） */
  mounted: string | null
}

export const useAppearance = create<AppearanceState>(() => ({
  user: {},
  workspace: {},
  loaded: false,
  mounted: typeof document === 'undefined' ? null : (document.documentElement.dataset.skin ?? null),
}))

/** 当前生效外观 */
export const effectiveAppearance = (s: AppearanceState = useAppearance.getState()) =>
  resolveAppearance(s.workspace, s.user)

let seq = 0

/**
 * 按生效值应用到本机（写缓存 + html 属性）；只动有变化的项，主题可带揭幕坐标。
 * 皮肤（ADR-0059）：要挂的皮肤先解析（可能要拉样式表），再在一次 View Transition 里换上 / 卸下；
 * 皮肤生效时日夜场与玻璃强度只记住选择，由皮肤锁定。连续切换以最后一次为准。
 */
async function applyLocal(a: AppearancePrefs, origin?: { x: number; y: number }) {
  const layout = useLayout.getState()
  if (layout.density !== a.density) layout.setDensity(a.density)
  if (layout.motion !== a.motion) layout.setMotion(a.motion)

  const my = ++seq
  const skin = await resolveSkin(a.skin, useAppearance.getState().skins)
  if (my !== seq) return
  const cur = activeSkin()
  if (skin) {
    const same = cur === skin.id && storedSkin()?.rev === skin.rev
    const commit = () => {
      mountSkin(skin)
      persist(a.theme)
      setGlass(a.glass)
    }
    if (same && document.getElementById('xz-skin')) commit()
    else void viewTransition(commit, origin)
  } else if (cur) {
    void viewTransition(() => {
      unmountSkin()
      applyTheme(a.theme === 'system' ? systemTheme() : a.theme)
      persist(a.theme)
      setGlass(a.glass)
    }, origin)
  } else {
    if (storedSkin()) unmountSkin()
    if (storedChoice() !== a.theme || origin) void setTheme(a.theme, origin)
    if (storedGlass() !== a.glass) setGlass(a.glass)
  }
  useAppearance.setState({ mounted: skin?.id ?? null })
}

async function save(appearance: AppearancePatch) {
  try {
    const res = await fetch('/api/v1/me/preferences', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appearance }),
      // 改完立刻刷新 / 跳转也要发完（否则下次同步会拿回旧值）
      keepalive: true,
    })
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    toast.error(i18n.t('settings.profile.appearanceSaveFailed'))
  }
}

/** 用户改外观：本机立即生效，随后存到账号（null = 改回跟随工作区默认）。 */
export function setAppearance(patch: AppearancePatch, origin?: { x: number; y: number }) {
  const s = useAppearance.getState()
  const user: Partial<AppearancePrefs> = { ...s.user }
  for (const [k, v] of Object.entries(patch) as [AppearanceKey, string | null][])
    if (v === null) delete user[k]
    else (user as Record<string, string>)[k] = v
  useAppearance.setState({ user })
  void applyLocal(effectiveAppearance({ ...s, user }), origin)
  void save(patch)
}

/** 工作区默认变了（管理员刚保存）：重算生效值并应用。 */
export function setWorkspaceAppearance(workspace: Partial<AppearancePrefs>) {
  useAppearance.setState({ workspace })
  void applyLocal(effectiveAppearance())
}

/** 已登录布局调用：拉到服务端外观 → 合成生效值 → 覆盖本机缓存与 html 属性。 */
export function useAppearanceSync() {
  const q = useQuery({
    ...preferencesQuery,
    select: (r) => ({ user: r.appearance ?? {}, workspace: r.workspaceAppearance ?? {} }),
  })
  const skins = useQuery(skinsQuery)
  useEffect(() => {
    if (!q.data || skins.isPending) return
    // 不把本机旧缓存迁成账号值（ADR-0049：会在新设备 / 共用浏览器里串号）；账号值为准
    useAppearance.setState({
      user: q.data.user,
      workspace: q.data.workspace,
      loaded: true,
      skins: skins.data,
    })
    void applyLocal(effectiveAppearance())
  }, [q.data, skins.data, skins.isPending])
}
