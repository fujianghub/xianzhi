/** 静态闸门（REQ-UI-002 · 003 · 012 · 023、REQ-COLLAB-006）：lint 脚本以单测形式跑一遍，另加 Portal 与 gc:false 的源码断言。 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { emptyYdoc, loadYdoc } from '../../collab/derive.ts'

const root = new URL('../../../', import.meta.url).pathname
const tsx = join(root, 'node_modules/.bin/tsx')
const run = (script: string) =>
  execFileSync(tsx, [join(root, 'scripts', script)], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('gates', () => {
  it('REQ-UI-002 check-css：src/client 无裸色值、!important、嵌套 glass', () => {
    expect(run('check-css.ts')).toContain('零违规')
  })
  it('REQ-UI-020 主色辉光 glow-primary 引用点 ≤ 6（ADR-0005 §4）；侧栏当前项为 selected 胶囊 + 左侧 3px 主色条', () => {
    const out = run('check-css.ts')
    const m = /glow-primary 引用 (\d+) \/ 6/.exec(out)
    expect(m, out).not.toBeNull()
    expect(Number(m?.[1])).toBeLessThanOrEqual(6)
    const nav = read('src/client/components/domain/SpaceSwitcher.tsx')
    for (const cls of ['bg-selected', 'rounded-full', 'before:w-[3px]', 'before:bg-primary'])
      expect(nav, cls).toContain(cls)
  })
  it('REQ-UI-003 check-contrast：两主题最坏合成底对比度矩阵通过', () => {
    expect(run('check-contrast.ts')).toContain('全部达标')
  })
  it('REQ-UI-026 代码高亮九色、primary-text、danger-fg 进入对比度矩阵（ADR-0005）', () => {
    const out = execFileSync(tsx, [join(root, 'scripts', 'check-contrast.ts'), '--verbose'], {
      cwd: root,
      encoding: 'utf8',
    })
    for (const k of [
      'code-keyword / code-bg',
      'code-comment / code-bg',
      'primary-text / 纸面',
      'danger-fg / danger',
    ])
      expect(out, k).toContain(k)
  })
  it('REQ-UI-012 check-i18n：src/client 组件无硬编码中文', () => {
    expect(run('check-i18n.ts')).toContain('零违规')
  })
  it('REQ-UI-023 浮层组件（Dialog / Sheet / Popover / Tooltip / Command）均经 Portal 渲染到 body', () => {
    const dir = 'src/client/components/ui'
    for (const f of ['dialog.tsx', 'sheet.tsx', 'popover.tsx', 'tooltip.tsx', 'command.tsx']) {
      const src = read(join(dir, f))
      expect(src, f).toMatch(/\.Portal>/)
    }
    // Toast 是唯一例外（06 §4：容器在 Topbar 内、自身不 blur）
    expect(read('src/client/components/layout/StatusPill.tsx')).toContain('glass-thick-flat')
    expect(readdirSync(join(root, dir)).length).toBeGreaterThan(5)
  })
  it('REQ-COLLAB-006 Y.Doc 前后端均 gc:false', () => {
    const d = loadYdoc(emptyYdoc())
    expect(d.gc).toBe(false)
    expect(new Y.Doc({ gc: false }).gc).toBe(false)
    expect(read('src/collab/server.ts')).toMatch(/yDocOptions:\s*\{\s*gc:\s*false/)
    expect(read('src/client/editor/EntryEditor.tsx')).toContain('new Y.Doc({ gc: false })')
    expect(read('src/server/services/seed.ts')).toContain('new Y.Doc({ gc: false })')
  })
})
