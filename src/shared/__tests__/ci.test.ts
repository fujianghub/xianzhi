/** REQ-OPS-006 CI 阶段顺序：lint → typecheck → drift → test → build → audit → e2e，逐级 needs（05 §6）。 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../', import.meta.url).pathname
// 用户确认后工作流会移动到 .github/workflows/ci.yml；两处都认
const file = existsSync(`${root}.github/workflows/ci.yml`)
  ? `${root}.github/workflows/ci.yml`
  : `${root}infra/ci/ci.yml`

describe('ci workflow', () => {
  it('REQ-OPS-006 阶段顺序 lint → typecheck → drift → test → build → audit → e2e，每阶段 needs 前一阶段', () => {
    const src = readFileSync(file, 'utf8')
    const jobsSection = src.slice(src.indexOf('\njobs:\n'))
    const jobs = [...jobsSection.matchAll(/^ {2}([a-z0-9-]+):\n((?: {4}.*\n|\n)*)/gm)].map((m) => ({
      name: m[1] as string,
      body: m[2] as string,
    }))
    const order = ['lint', 'typecheck', 'drift', 'test', 'build', 'audit', 'e2e']
    expect(jobs.map((j) => j.name)).toEqual(order)
    for (const [i, j] of jobs.entries()) {
      const needs = /^ {4}needs: (\S+)/m.exec(j.body)?.[1]
      expect(needs, j.name).toBe(i === 0 ? undefined : order[i - 1])
    }
    expect(src).toContain('pnpm audit --audit-level high')
    expect(src).toMatch(/e2e:\n\s+needs: audit\n\s+if: .*refs\/heads\/main.*'e2e'/)
    expect(src).toContain('pnpm test')
    expect(src).toContain('pnpm build')
  })
})
