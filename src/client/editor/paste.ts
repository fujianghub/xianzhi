/**
 * 粘贴规则的纯函数部分（03 §11.3、REQ-EDITOR-005）：Markdown 启发式识别与转换、HTML 净化、外部图片识别。
 * 不依赖 DOM，便于在 node 环境单测；schema 过滤（未知标记 / 颜色）由 ProseMirror 解析时完成。
 */
import MarkdownIt from 'markdown-it'

/** 单次粘贴上限 2MB 文本（03 §11.5）。 */
export const PASTE_MAX_CHARS = 2 * 1024 * 1024

const MD_MARKERS: RegExp[] = [
  /^#{1,6}\s+\S/m, // 标题
  /^\s*[-*+]\s+\S/m, // 无序列表
  /^\s*\d+[.)]\s+\S/m, // 有序列表
  /^```/m, // 代码围栏
  /\[[^\]\n]+\]\([^)\s]+\)/, // 链接
  /^>\s+\S/m, // 引用
  /(\*\*|__)[^*_\n]+\1/, // 加粗
  /^\s*[-*]\s+\[[ xX]\]\s/m, // 任务项
  /^\|.+\|\s*$/m, // 表格
]

/** 含 ≥ 2 种 Markdown 标记才按 Markdown 处理，避免把普通带连字符的文本误转（03 §11.3）。 */
export function looksLikeMarkdown(text: string): boolean {
  let n = 0
  for (const re of MD_MARKERS) if (re.test(text) && ++n >= 2) return true
  return false
}

const STRUCTURAL_TAG =
  /<(h[1-6]|ul|ol|li|table|tr|td|th|blockquote|pre|strong|b|em|i|a|img|code|hr)\b/i

/**
 * HTML 只是「纯文本的包装」（语雀式识别）：VS Code / Typora 源码模式 / 部分终端复制时会同时放 text/html，
 * 但里面只有 div / span / br / p / meta 与内联样式，没有任何结构标签。此时应按 text/plain 的 Markdown 处理。
 */
export function htmlIsPlainWrapper(html: string): boolean {
  if (!html.trim()) return true
  if (/data-pm-slice/.test(html)) return false // 本编辑器复制的片段
  if (/vscode|monaco|cm-line|CodeMirror/i.test(html)) return true
  return !STRUCTURAL_TAG.test(html)
}

/** 粘贴文本按空行切段落（「撤销为纯文本」与超长截断共用）。 */
export function plainParagraphs(text: string) {
  return text.split(/\n{2,}/).map((p) => ({
    type: 'paragraph',
    content: p ? [{ type: 'text', text: p }] : [],
  }))
}

let md: InstanceType<typeof MarkdownIt> | null = null

const CALLOUT_FENCE = /^:::(info|tip|warn|danger)[ \t]*\n([\s\S]*?)\n:::[ \t]*$/m

/**
 * Markdown → HTML（html:false 不透传原始 HTML；链接校验交给 schema 的 Link 白名单）。
 * 与导出序列化（shared/editor/serializers/markdown.ts）对称：`:::kind` → callout、```mermaid → mermaid、
 * `$$…$$` 段 → 公式块、`[标题](xz://entry/<id>)` → entryLink。
 */
export function markdownToHtml(text: string): string {
  const m = CALLOUT_FENCE.exec(text)
  if (m) {
    const before = text.slice(0, m.index)
    const after = text.slice(m.index + m[0].length)
    return `${before.trim() ? markdownToHtml(before) : ''}<aside data-callout="${m[1]}">${markdownToHtml(m[2] ?? '')}</aside>${after.trim() ? markdownToHtml(after) : ''}`
  }
  md ??= new MarkdownIt({ html: false, linkify: true, breaks: false })
  return (
    md
      .render(text)
      .replace(
        /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
        (_m, code: string) => `<pre data-mermaid="">${code.replace(/\n$/, '')}</pre>`,
      )
      .replace(
        /<p>\$\$\n?([\s\S]*?)\n?\$\$<\/p>/g,
        (_m, latex: string) => `<div data-math="">${latex}</div>`,
      )
      .replace(
        /<a href="xz:\/\/entry\/([0-9a-f-]{36})">([\s\S]*?)<\/a>/gi,
        (_m, id: string, title: string) =>
          `<a data-entry-link="${id}" id="${id}" title="${title.replace(/<[^>]*>/g, '')}">${title}</a>`,
      )
      // 任务列表：markdown-it 不内置，转成 Tiptap taskList 能解析的结构
      .replace(
        /<li>\s*(?:<p>)?\[([ xX])\]\s*/g,
        (_m: string, c: string) =>
          `<li data-type="taskItem" data-checked="${c.trim() ? 'true' : 'false'}"><p>`,
      )
      .replace(/<ul>(\s*<li data-type="taskItem")/g, '<ul data-type="taskList">$1')
  )
}

/** 剥字体 / 颜色 / 字号 / style / class，丢 <font> 包裹与脚本（03 §11.3）；结构标签保留。 */
export function sanitizePastedHtml(html: string): string {
  // 本编辑器复制出的片段（data-pm-slice）走 ProseMirror 原生 slice，属性完整保留
  if (/data-pm-slice/.test(html)) return html
  return html
    .replace(/<(script|style|meta|link|title)\b[\s\S]*?(<\/\1>|\/?>)/gi, '')
    .replace(/<\/?(font|span|o:p)\b[^>]*>/gi, '')
    .replace(/\s(style|color|face|size|bgcolor|lang|dir)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sclass\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (_m, v: string) => {
      // 只留代码块语言（language-xx），其余 class 丢弃
      const lang = /language-[\w+#-]+/.exec(v)
      return lang ? ` class="${lang[0]}"` : ''
    })
    .replace(/<!--[\s\S]*?-->/g, '')
}

/** 找出 HTML 里非 xz: 的图片（外域 / data:），它们会被 schema 拒绝，需提示用户（07 §2.5）。 */
export function externalImages(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const src = m[2] ?? m[3] ?? ''
    if (!src.startsWith('xz:attachment/')) out.push(src)
  }
  return out
}
