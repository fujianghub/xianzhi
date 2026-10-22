/**
 * 主题（ADR-0059 · 0060）的页面挂载：只碰 DOM 与本机缓存，不依赖 API 客户端（认证页也引用，不撑大首屏包）。
 * - 生效：`html[data-skin]` + `<style id="xz-skin">` + `data-theme` 锁定为主题自带明暗 + 移除 `data-glass`（主题自带材质）
 * - 缓存：`xz:skin` = 本人生效主题（工作台首帧），`xz:skin-default` = 工作区默认主题（认证页首帧）；theme-init.js 按路径择一注入
 * - 认证页跟随本机上次登录者（ADR-0063）：登录后同步过外观即写 `xz:skin-auth = user`，此后认证页也用 `xz:skin`（含「无主题」），
 *   与登录后一致；从没在本机登录过才用工作区默认
 */
import {
  DEFAULT_SKIN_ART,
  SKIN_ART_LEVELS,
  type SkinArtLevel,
  type SkinMode,
} from '../../shared/skins.ts'
import { applyTheme } from './theme.ts'

export interface SkinCache {
  id: string
  mode: SkinMode
  /** 样式表指纹（= 列表里的 rev） */
  rev: string
  css: string
}

export const SKIN_KEY = 'xz:skin'
export const SKIN_DEFAULT_KEY = 'xz:skin-default'
const STYLE_ID = 'xz-skin'

export function storedSkin(key = SKIN_KEY): SkinCache | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as SkinCache | null
    return v && typeof v.id === 'string' && typeof v.css === 'string' ? v : null
  } catch {
    return null
  }
}

export function persistSkin(s: SkinCache | null, key = SKIN_KEY) {
  try {
    if (s) localStorage.setItem(key, JSON.stringify(s))
    else localStorage.removeItem(key)
  } catch {
    /* 隐私模式 / 配额 */
  }
}

const AUTH_KEY = 'xz:skin-auth'

/** 本机登录后同步过外观：认证页沿用本人生效主题（ADR-0063） */
export function markAuthFollowsUser() {
  try {
    if (localStorage.getItem(AUTH_KEY) !== 'user') localStorage.setItem(AUTH_KEY, 'user')
  } catch {
    /* 隐私模式 */
  }
}

export function authFollowsUser(): boolean {
  try {
    return localStorage.getItem(AUTH_KEY) === 'user'
  } catch {
    return false
  }
}

/** 当前页面上生效的主题 id（无 = 衔枝原生） */
export const activeSkin = () => document.documentElement.dataset.skin ?? null

/** 挂上主题（同步；调用方负责过渡动画）；key 为写入的缓存位 */
export function mountSkin(s: SkinCache, key = SKIN_KEY) {
  const root = document.documentElement
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  if (el.textContent !== s.css) el.textContent = s.css
  root.dataset.skin = s.id
  delete root.dataset.glass
  applyTheme(s.mode)
  persistSkin(s, key)
}

/** 卸下主题（同步）；明暗与玻璃强度由调用方按生效偏好重新应用。key = null 时不动缓存 */
export function unmountSkin(key: string | null = SKIN_KEY) {
  document.getElementById(STYLE_ID)?.remove()
  delete document.documentElement.dataset.skin
  if (key) persistSkin(null, key)
}

/** 图片强度（ADR-0061）：写 `html[data-skin-art]`（各档都写，主题样式表按它换材质）；本机 `xz:skin-art` 只作首帧缓存，默认档不存 */
const ART_KEY = 'xz:skin-art'

export function storedSkinArt(): SkinArtLevel {
  try {
    const v = localStorage.getItem(ART_KEY)
    return (SKIN_ART_LEVELS as readonly string[]).includes(v ?? '')
      ? (v as SkinArtLevel)
      : DEFAULT_SKIN_ART
  } catch {
    return DEFAULT_SKIN_ART
  }
}

export function setSkinArt(level: SkinArtLevel) {
  try {
    if (level === DEFAULT_SKIN_ART) localStorage.removeItem(ART_KEY)
    else localStorage.setItem(ART_KEY, level)
  } catch {
    /* 隐私模式 */
  }
  document.documentElement.dataset.skinArt = level
}
