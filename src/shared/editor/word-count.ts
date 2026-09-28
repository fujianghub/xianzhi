/** 字数：CJK 每字计 1，其余按空白分词计 1（01 §3.4 word_count）。服务端派生与编辑器工具栏共用（ADR-0025）。 */
export function wordCount(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/gu) ?? []).length
  const rest = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/gu, ' ')
  const words = rest.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  return cjk + words
}
