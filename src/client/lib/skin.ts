/**
 * 主题（代码里叫 skin，ADR-0059 · 0060、REQ-UI-059）：已安装主题由服务端生成样式表（`GET /skins/:id` 的 css）。
 * 挂载 / 缓存在 skin-dom.ts；这里是列表与详情查询。认证页套工作区默认主题（`GET /skins/default`，见 AuthShell）。
 */
import { SKIN_NONE, type SkinSummary } from '../../shared/skins.ts'
import { api, unwrap } from './api.ts'
import { type SkinCache, storedSkin } from './skin-dom.ts'

export { activeSkin, mountSkin, type SkinCache, storedSkin, unmountSkin } from './skin-dom.ts'

export interface SkinDetail extends SkinSummary {
  css: string
}

export const skinsQuery = {
  queryKey: ['skins'] as const,
  queryFn: () => unwrap<{ items: SkinSummary[] }>(api.skins.$get()).then((r) => r.items),
  staleTime: 5 * 60_000,
}

export const fetchSkin = (id: string) =>
  unwrap<SkinDetail>(api.skins[':id'].$get({ param: { id } }))

export const skinThumbUrl = (s: Pick<SkinSummary, 'id' | 'version'>) =>
  `/api/v1/skins/${s.id}/thumb?v=${encodeURIComponent(s.version)}`

/**
 * 解析要挂的主题：缓存命中且版本一致直接用，否则拉详情。
 * 主题已卸载（404）或 id 为 none → null。
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
