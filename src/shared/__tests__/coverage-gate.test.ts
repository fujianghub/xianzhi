/** T0-029：删掉一个已运行层的 P0 需求的全部用例 → req-coverage 失败；完整产物 → 通过。 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../', import.meta.url).pathname
const tsx = join(root, 'node_modules/.bin/tsx')
const run = (dir: string) => {
  try {
    return {
      code: 0,
      out: execFileSync(
        tsx,
        [join(root, 'scripts/req-coverage.ts'), '--layers', 'unit', '--dir', dir],
        { cwd: root, encoding: 'utf8', stdio: 'pipe' },
      ),
    }
  } catch (e) {
    const err = e as { status: number; stderr: string }
    return { code: err.status, out: err.stderr }
  }
}

describe('req-coverage gate', () => {
  it('REQ-OPS-006 删除 REQ-WS-007 的全部 unit 用例后门槛失败并点名；恢复后通过', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xz-cov-'))
    const rows = [
      { id: 'REQ-WS-007', layer: 'unit', file: 'x', title: 'REQ-WS-007 矩阵', passed: true },
      { id: 'REQ-ENTRY-001', layer: 'unit', file: 'x', title: 'REQ-ENTRY-001', passed: true },
    ]
    // 其余 unit 层 P0 需求：从 00 读取后补齐，保证只有 REQ-WS-007 这一项被删
    const md = readFileSync(join(root, 'spec_dev_doc/00-requirements.md'), 'utf8')
    for (const m of md.matchAll(/^\| (REQ-[A-Z]+-\d{3}) \| P0 \| 0 \|.*\| ([^|]+) \|\s*$/gm)) {
      if (/unit/.test(m[2] as string) && !/手工/.test(m[2] as string))
        rows.push({
          id: m[1] as string,
          layer: 'unit',
          file: 'x',
          title: m[1] as string,
          passed: true,
        })
    }
    writeFileSync(join(dir, 'req-coverage.unit.json'), JSON.stringify(rows))
    expect(run(dir).code).toBe(0)
    writeFileSync(
      join(dir, 'req-coverage.unit.json'),
      JSON.stringify(rows.filter((r) => r.id !== 'REQ-WS-007')),
    )
    const r = run(dir)
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('REQ-WS-007')
  })
})
