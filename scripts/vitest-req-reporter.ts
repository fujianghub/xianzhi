/**
 * 05 §5 追溯：Vitest 层按文件路径分层输出 debug/perf/req-coverage.{unit,api,collab}.json（{ id, layer, file, title, passed }）。
 * 分层：src/shared/** 与 authz / derive / tokenize 纯函数 → unit；src/collab/** → collab；其余 src/server/** → api。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { Reporter, TestModule } from 'vitest/node'
import { reqIds } from './req-ids.ts'

type Layer = 'unit' | 'api' | 'collab'
const layerOf = (file: string): Layer => {
  if (file.startsWith('src/collab/')) return 'collab'
  if (file.startsWith('src/shared/') || /__tests__\/(authz|derive|seed)\.test\.ts$/.test(file))
    return 'unit'
  return 'api'
}

export default class VitestReqReporter implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>) {
    const out: Record<
      Layer,
      { id: string; layer: Layer; file: string; title: string; passed: boolean }[]
    > = { unit: [], api: [], collab: [] }
    for (const m of modules) {
      const file = relative(process.cwd(), m.moduleId)
      const layer = layerOf(file)
      for (const t of m.children.allTests()) {
        const title = t.fullName
        for (const id of reqIds(title))
          out[layer].push({ id, layer, file, title, passed: t.result().state === 'passed' })
      }
    }
    mkdirSync('debug/perf', { recursive: true })
    for (const layer of Object.keys(out) as Layer[])
      writeFileSync(
        `debug/perf/req-coverage.${layer}.json`,
        `${JSON.stringify(out[layer], null, 2)}\n`,
      )
  }
}
