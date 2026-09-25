/**
 * 按内容魔数识别 MIME（07 §2.4、REQ-ATTACH-001）：不信任客户端的 Content-Type 与扩展名。
 * 只识别白名单内的类型；识别不出或识别为危险类型（HTML 等）返回 null → 415。
 */
const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  sig.every((v, i) => b[offset + i] === v)
const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, Math.min(to, b.length)))

/** UTF-8 文本判定：可解码且不含 NUL 等控制字节（\t \n \r 除外）。 */
function isText(b: Uint8Array): boolean {
  const head = b.subarray(0, 8192)
  for (const c of head) if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.length === b.length ? b : trimUtf8(head))
    return true
  } catch {
    return false
  }
}
/** 截断处可能切断多字节字符：去掉末尾不完整的 UTF-8 序列。 */
function trimUtf8(b: Uint8Array): Uint8Array {
  let end = b.length
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const c = b[end - i] as number
    if ((c & 0xc0) === 0x80) continue
    if ((c & 0xe0) === 0xc0 && i < 2) end -= i
    else if ((c & 0xf0) === 0xe0 && i < 3) end -= i
    else if ((c & 0xf8) === 0xf0 && i < 4) end -= i
    break
  }
  return b.subarray(0, end)
}

export function sniffMime(b: Uint8Array, filename = ''): string | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp'
  if (ascii(b, 4, 8) === 'ftyp' && /^(avif|avis)$/.test(ascii(b, 8, 12))) return 'image/avif'
  if (ascii(b, 0, 5) === '%PDF-') return 'application/pdf'
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]))
    return sniffOoxml(b) ?? 'application/zip'
  if (!isText(b)) return null
  const text = new TextDecoder().decode(b.subarray(0, 4096)).replace(/^﻿/, '').trimStart()
  const lower = text.toLowerCase()
  // SVG：允许 XML 声明 / 注释 / DOCTYPE 在前
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(text))
    return 'image/svg+xml'
  // HTML / 其他标记一律拒绝（伪装成 .png 的网页等）
  if (/^<(!doctype html|html|head|body|script|iframe|\?xml)/.test(lower)) return null
  if (/^[{[]/.test(text)) {
    try {
      JSON.parse(new TextDecoder().decode(b))
      return 'application/json'
    } catch {
      /* 当普通文本 */
    }
  }
  if (/\.(md|markdown)$/i.test(filename)) return 'text/markdown'
  if (/\.csv$/i.test(filename)) return 'text/csv'
  // 代码 / 日志 / 配置等其余 UTF-8 文本统一 text/plain（扩展名保留在 filename，前端据此高亮预览）
  return 'text/plain'
}

export const OOXML = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const

/**
 * Office Open XML（REQ-ATTACH-012）：zip 容器 + `[Content_Types].xml` + 各自的主部件。
 * 本地文件头与中央目录都带文件名明文，直接在字节里找；缺任一项按普通 zip 处理（不会因扩展名被骗成 Office）。
 */
function sniffOoxml(b: Uint8Array): string | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  if (!buf.includes('[Content_Types].xml')) return null
  if (buf.includes('word/document.xml')) return OOXML.docx
  if (buf.includes('xl/workbook.xml')) return OOXML.xlsx
  if (buf.includes('ppt/presentation.xml')) return OOXML.pptx
  return null
}
