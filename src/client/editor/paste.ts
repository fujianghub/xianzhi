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

let md: InstanceType<typeof MarkdownIt> | null = null
/** Markdown → HTML（html:false 不透传原始 HTML；链接校验交给 schema 的 Link 白名单）。 */
export function markdownToHtml(text: string): string {
  md ??= new MarkdownIt({ html: false, linkify: true, breaks: false })
  // 任务列表：markdown-it 不内置，转成 Tiptap taskList 能解析的结构
  return md
    .render(text)
    .replace(
      /<li>\s*(?:<p>)?\[([ xX])\]\s*/g,
      (_m: string, c: string) =>
        `<li data-type="taskItem" data-checked="${c.trim() ? 'true' : 'false'}"><p>`,
    )
    .replace(/<ul>(\s*<li data-type="taskItem")/g, '<ul data-type="taskList">$1')
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
