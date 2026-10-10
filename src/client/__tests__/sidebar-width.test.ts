import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applySidebarWidth,
  clampSidebarWidth,
  SIDEBAR_W,
  saveSidebarWidth,
  storedSidebarWidth,
} from '../lib/sidebar-width.ts'

/** node 环境：最小化的 localStorage 与 html.style 桩 */
function stubDom() {
  const store = new Map<string, string>()
  const props = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  vi.stubGlobal('document', {
    documentElement: {
      style: {
        setProperty: (k: string, v: string) => void props.set(k, v),
        removeProperty: (k: string) => void props.delete(k),
      },
    },
  })
  return { store, props }
}

describe('ADR-0058 侧栏宽度', () => {
  let dom: ReturnType<typeof stubDom>
  beforeEach(() => {
    dom = stubDom()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('REQ-UI-054 宽度夹在 200 ~ 400 且取整', () => {
    expect(clampSidebarWidth(120)).toBe(SIDEBAR_W.min)
    expect(clampSidebarWidth(999)).toBe(SIDEBAR_W.max)
    expect(clampSidebarWidth(287.6)).toBe(288)
  })

  it('REQ-UI-054 保存写本机键与 html 变量；默认值 / 还原则删键并移除变量', () => {
    saveSidebarWidth(320)
    expect(dom.store.get('xz:sidebar-w')).toBe('320')
    expect(dom.props.get('--xz-sidebar-w')).toBe('320px')
    expect(storedSidebarWidth()).toBe(320)
    saveSidebarWidth(SIDEBAR_W.def)
    expect(dom.store.has('xz:sidebar-w')).toBe(false)
    expect(dom.props.has('--xz-sidebar-w')).toBe(false)
    saveSidebarWidth(500)
    expect(dom.store.get('xz:sidebar-w')).toBe('400')
    saveSidebarWidth(null)
    expect(storedSidebarWidth()).toBeNull()
  })

  it('REQ-UI-054 存储里的非法 / 越界值：非法忽略，越界夹回范围', () => {
    dom.store.set('xz:sidebar-w', 'abc')
    expect(storedSidebarWidth()).toBeNull()
    dom.store.set('xz:sidebar-w', '900')
    expect(storedSidebarWidth()).toBe(400)
    applySidebarWidth(storedSidebarWidth())
    expect(dom.props.get('--xz-sidebar-w')).toBe('400px')
  })
})
