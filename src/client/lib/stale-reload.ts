/**
 * 部署后旧页面自愈（REQ-OPS-016，debug/2026-10-22-stale-html-cache）：页面还是旧版本时懒加载的 chunk 已随新镜像删除，
 * 动态 import 失败 → Vite 派发 `vite:preloadError`。此时整页刷新一次换成新版 index.html；
 * 刷新后 10 秒内又失败（新版本本身有问题 / 离线）就不再刷，交给错误边界，避免无限刷新。
 * 会话存储不可用时也不刷（无法防循环）。
 * 与 TanStack Router 配合：路由 chunk 失败由它的 lazyRouteComponent 刷新一次并记 `tanstack_router_reload:*`。
 * 失败常先发生在预加载阶段，这里若立刻刷新，页面卸载时它还没拿到模块错误、没记标记，新页面会再刷一次（实测两次）。
 * 所以不吞错误（不 preventDefault）、刷新推迟 RELOAD_DELAY_MS：路由 chunk 先由它刷（本定时器随卸载作废），
 * 它不管的 React.lazy 组件（Peek、详情编辑器等）才由这里刷。
 */
const KEY = 'xz:stale-reload'
export const STALE_RELOAD_WINDOW_MS = 10_000
export const RELOAD_DELAY_MS = 500

interface Win {
  addEventListener(type: 'vite:preloadError', fn: () => void): void
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
  location: { reload(): void }
  setTimeout(fn: () => void, ms: number): unknown
}

/** 处理一次加载失败；返回是否已安排刷新 */
export function onPreloadError(win: Win, now = Date.now()): boolean {
  try {
    const last = Number(win.sessionStorage.getItem(KEY) ?? 0)
    if (now - last < STALE_RELOAD_WINDOW_MS) return false
    win.sessionStorage.setItem(KEY, String(now))
  } catch {
    return false
  }
  win.setTimeout(() => win.location.reload(), RELOAD_DELAY_MS)
  return true
}

export function installStaleReload(win: Win = window) {
  win.addEventListener('vite:preloadError', () => {
    onPreloadError(win)
  })
}
