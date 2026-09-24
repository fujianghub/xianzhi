/**
 * REQ-UI-012：src/client 组件 JSX 文本节点与字符串字面量不得含硬编码中文（i18n/ 目录除外）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../src/client', import.meta.url).pathname
const CJK = /[一-鿿]/

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      // i18n 资源本身与单测（非界面文案）不查
      if (e !== 'i18n' && e !== '__tests__') walk(p, out)
    } else if (/\.tsx?$/.test(e)) out.push(p)
  }
  return out
}

const files = walk(ROOT)
const problems: string[] = []
for (const f of files) {
  // 剥离块注释（保留换行以维持行号），再逐行去掉行注释
  const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    const code = line.replace(/(^|[^:])\/\/.*$/, '$1')
    if (CJK.test(code))
      problems.push(`${f.replace(ROOT, 'src/client')}:${i + 1} ${line.trim().slice(0, 80)}`)
  })
}
if (problems.length) {
  console.error(
    `check-i18n：${problems.length} 处硬编码中文\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  )
  process.exit(1)
}
console.info(`check-i18n：零违规（${files.length} 个文件）`)
