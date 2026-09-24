/**
 * 代码高亮（03 §9、REQ-EDITOR-003）：预注册 20 种常用语言；其余语言选中时按需 import（各自独立 chunk）。
 */
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { createLowlight } from 'lowlight'

export const lowlight = createLowlight({
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  python,
  ruby,
  sql,
  swift,
  typescript,
  xml,
  yaml,
})
export const PRESET_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'java',
  'javascript',
  'json',
  'kotlin',
  'markdown',
  'php',
  'python',
  'ruby',
  'sql',
  'swift',
  'typescript',
  'xml',
  'yaml',
] as const

/** 按需语言：值是动态 import，Vite 为每种语言产出独立 chunk。 */
const LAZY: Record<string, () => Promise<{ default: Parameters<typeof lowlight.register>[1] }>> = {
  rust: () => import('highlight.js/lib/languages/rust'),
  scala: () => import('highlight.js/lib/languages/scala'),
  haskell: () => import('highlight.js/lib/languages/haskell'),
  elixir: () => import('highlight.js/lib/languages/elixir'),
  erlang: () => import('highlight.js/lib/languages/erlang'),
  lua: () => import('highlight.js/lib/languages/lua'),
  r: () => import('highlight.js/lib/languages/r'),
  perl: () => import('highlight.js/lib/languages/perl'),
  dart: () => import('highlight.js/lib/languages/dart'),
  clojure: () => import('highlight.js/lib/languages/clojure'),
  ocaml: () => import('highlight.js/lib/languages/ocaml'),
  fsharp: () => import('highlight.js/lib/languages/fsharp'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  latex: () => import('highlight.js/lib/languages/latex'),
  protobuf: () => import('highlight.js/lib/languages/protobuf'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  ini: () => import('highlight.js/lib/languages/ini'),
}
export const ALL_LANGUAGES = [...PRESET_LANGUAGES, ...Object.keys(LAZY)].sort()

/** 确保语言已注册（已注册则立即返回）。 */
export async function ensureLanguage(name: string): Promise<boolean> {
  if (!name || lowlight.registered(name)) return true
  const load = LAZY[name]
  if (!load) return false
  const mod = await load()
  lowlight.register(name, mod.default)
  return true
}
