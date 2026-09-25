/**
 * 附件类别（REQ-ATTACH-012 · 013）：由服务端魔数判定的 mime + 原文件名扩展名决定卡片图标与预览方式。
 * 代码文件服务端统一存 text/plain，这里按扩展名细分出 code（预览用等宽）。
 */
export type FileKind =
  | 'pdf'
  | 'word'
  | 'sheet'
  | 'slides'
  | 'csv'
  | 'markdown'
  | 'code'
  | 'json'
  | 'text'
  | 'zip'
  | 'image'
  | 'other'

const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|sh|bash|zsh|sql|ya?ml|toml|ini|conf|xml|css|scss|vue|svelte|lua|dart|r|scala|dockerfile|makefile|gradle|proto|graphql|env\.example)$/i

export function fileKind(mime: string, name = ''): FileKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.includes('wordprocessingml')) return 'word'
  if (mime.includes('spreadsheetml')) return 'sheet'
  if (mime.includes('presentationml')) return 'slides'
  if (mime === 'text/csv') return 'csv'
  if (mime === 'text/markdown') return 'markdown'
  if (mime === 'application/json') return 'json'
  if (mime === 'application/zip') return 'zip'
  if (mime === 'text/plain') return CODE_EXT.test(name) ? 'code' : 'text'
  return 'other'
}

/** 能在应用内预览的类别（pdf 交给浏览器新标签页）。 */
export const PREVIEWABLE: ReadonlySet<FileKind> = new Set([
  'pdf',
  'word',
  'csv',
  'markdown',
  'code',
  'json',
  'text',
])

/** 极简 CSV 解析（RFC 4180 引号 / 转义）；最多 maxRows 行，预览用。 */
export function parseCsv(src: string, maxRows = 200): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') q = false
      else cell += c
      continue
    }
    if (c === '"') q = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      if (rows.length >= maxRows) return rows
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
