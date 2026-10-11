/**
 * 皮肤（ADR-0059、REQ-UI-059）：已安装皮肤由服务端生成样式表（`GET /skins/:id` 的 css），这里负责挂到页面上。
 * - 生效：`html[data-skin]` + `<style id="xz-skin">` + `data-theme` 锁定为皮肤自带模式 + 移除 `data-glass`（皮肤自带材质）
 * - 首帧：本机 `xz:skin` 缓存 `{ id, mode, rev, css }`，public/theme-init.js 同步注入，不闪原生外观
 * - 认证页（登录 / 注册 / 邀请）不套皮肤：此时不知道是谁（同 ADR-0049 §5）
 */
import { SKIN_NONE, type SkinMode, type SkinSummary } from '../../shared/skins.ts'
import { api, unwrap } from './api.ts'
import { applyTheme } from './theme.ts'

export interface SkinDetail extends SkinSummary {
  css: string
}
interface SkinCache {
  id: string
  mode: SkinMode
  /** 样式表指纹（= 列表里的 rev） */
  rev: string
  css: string
}

const KEY = 'xz:skin'
const STYLE_ID = 'xz-skin'

export const skinsQuery = {
  queryKey: ['skins'] as const,
  queryFn: () => unwrap<{ items: SkinSummary[] }>(api.skins.$get()).then((r) => r.items),
  staleTime: 5 * 60_000,
}

export const fetchSkin = (id: string) =>
  unwrap<SkinDetail>(api.skins[':id'].$get({ param: { id } }))

export const skinThumbUrl = (s: Pick<SkinSummary, 'id' | 'version'>) =>
  `/api/v1/skins/${s.id}/thumb?v=${encodeURIComponent(s.version)}`

export function storedSkin(): SkinCache | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SkinCache | null
    return v && typeof v.id === 'string' && typeof v.css === 'string' ? v : null
  } catch {
    return null
  }
}

function persist(s: SkinCache | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    /* 隐私模式 / 配额 */
  }
}

/** 当前页面上生效的皮肤 id（无 = 原生外观） */
export const activeSkin = () => document.documentElement.dataset.skin ?? null

/** 挂上皮肤（同步；调用方负责过渡动画） */
export function mountSkin(s: SkinCache) {
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
  persist(s)
}

/** 卸下皮肤（同步）；日夜场与玻璃强度由调用方按生效偏好重新应用 */
export function unmountSkin(keepCache = false) {
  document.getElementById(STYLE_ID)?.remove()
  delete document.documentElement.dataset.skin
  if (!keepCache) persist(null)
}

/**
 * 解析要挂的皮肤：缓存命中且版本一致直接用，否则拉详情。
 * 皮肤已卸载（404）或 id 为 none → null。
 */
export async function resolveSkin(
  id: string,
  installed?: SkinSummary[],
): Promise<SkinCache | null> {
  if (id === SKIN_NONE) return null
  const cached = storedSkin()
  const meta = installed?.find((s) => s.id === id)
  if (installed && !meta) return null
  if (cached?.id === id && (!meta || meta.rev === cached.rev)) return cached
  try {
    const d = await fetchSkin(id)
    return { id: d.id, mode: d.mode, rev: d.rev, css: d.css }
  } catch {
    return null
  }
}
