/** 05 §5 追溯：Playwright 层产出 debug/perf/req-coverage.{e2e,infra}.json（{ id, layer, file, title, passed }）；只写本次实际运行了的层。 */
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { reqIds } from '../scripts/req-ids.ts'

type Layer = 'e2e' | 'infra'

export default class ReqReporter implements Reporter {
  private rows: { id: string; layer: Layer; file: string; title: string; passed: boolean }[] = []
  onTestEnd(test: TestCase, result: TestResult) {
    const file = test.location.file.replace(`${process.cwd()}/`, '')
    const layer: Layer = /infra\.spec\.ts$/.test(file) ? 'infra' : 'e2e'
    for (const id of reqIds(test.title))
      this.rows.push({ id, layer, file, title: test.title, passed: result.status === 'passed' })
  }
  onEnd() {
    mkdirSync('debug/perf', { recursive: true })
    for (const layer of ['e2e', 'infra'] as const) {
      const rows = this.rows.filter((r) => r.layer === layer)
      if (rows.length)
        writeFileSync(`debug/perf/req-coverage.${layer}.json`, `${JSON.stringify(rows, null, 2)}\n`)
    }
  }
}
