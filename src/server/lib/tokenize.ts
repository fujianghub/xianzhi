/**
 * 中文分词（ADR-0001 §4.3、02 §4.1）：索引与查询用同一个 tokenize()。
 * jieba 精确模式 → 小写 → 去停用词与纯标点；结果以空格拼接后 `to_tsvector('simple', …)`。
 */
import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict.js'

let jieba: Jieba | undefined
function engine(): Jieba {
  if (!jieba) jieba = Jieba.withDict(dict)
  return jieba
}

const STOPWORDS = new Set([
  '的',
  '了',
  '是',
  '在',
  '和',
  '与',
  '或',
  '也',
  '都',
  '就',
  '而',
  '及',
  '着',
  '把',
  '被',
  '让',
  '对',
  '从',
  '到',
  '为',
  '于',
  '之',
  '这',
  '那',
  '一个',
  '我们',
  '你们',
  '他们',
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'is',
  'are',
  'was',
  'were',
  'be',
  'it',
  'this',
  'that',
  'with',
  'as',
  'at',
  'by',
])
const PUNCT = /^[\s\p{P}\p{S}]+$/u

export function tokenize(text: string): string[] {
  if (!text) return []
  const out: string[] = []
  for (const raw of engine().cut(text, false)) {
    const t = raw.trim().toLowerCase()
    if (!t || PUNCT.test(t) || STOPWORDS.has(t)) continue
    out.push(t)
  }
  return out
}

/** 供 `to_tsvector('simple', $1)` 的文本。 */
export function tsvText(text: string): string {
  return tokenize(text).join(' ')
}

/** 字数：CJK 每字计 1，其余按空白分词计 1（01 §3.4 word_count）。 */
export function wordCount(text: string): number {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/gu) ?? []).length
  const rest = text.replace(/[㐀-鿿豈-﫿]/gu, ' ')
  const words = rest.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  return cjk + words
}
