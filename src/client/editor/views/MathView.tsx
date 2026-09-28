/**
 * 公式节点视图（ADR-0025 §8、REQ-EDITOR-008）：KaTeX 懒加载（`import('katex')` + 样式只在这里动态引入，不进编辑器首包），
 * idle 回调渲染；`throwOnError:false`、不开 trust。块级：点击进入 textarea + 实时预览；行内：点击出行内输入框。
 * 源码失焦 / 停顿 800ms / Enter 才写回 `latex` 属性（ydoc gc:false，不逐键写）。
 */
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { onIdle } from './diagram-utils.ts'

type Katex = typeof import('katex').default
let katexP: Promise<Katex> | null = null
function loadKatex(): Promise<Katex> {
  katexP ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
    ([m]) => m.default,
  )
  return katexP
}

const COMMIT_MS = 800

/** 渲染 LaTeX → HTML（KaTeX 输出，错误以 danger 色内联显示）。 */
export function useKatex(latex: string, displayMode: boolean): string | null {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    if (!latex.trim()) {
      setHtml('')
      return
    }
    let alive = true
    const cancel = onIdle(() => {
      void loadKatex().then((k) => {
        if (!alive) return
        setHtml(
          k.renderToString(latex, {
            displayMode,
            throwOnError: false,
            errorColor: 'var(--xz-danger)',
            strict: 'ignore',
          }),
        )
      })
    })
    return () => {
      alive = false
      cancel()
    }
  }, [latex, displayMode])
  return html
}

function Rendered({ html, className }: { html: string; className: string }) {
  return (
    <span
      className={className}
      // KaTeX 默认 trust:false，不输出任意 HTML / 链接
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX 输出（trust 关闭）
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** 刚插入（光标紧随其后）的空公式直接进入编辑态。 */
function justInserted(p: NodeViewProps) {
  if (!p.editor.isEditable || String(p.node.attrs.latex ?? '').trim()) return false
  const pos = typeof p.getPos === 'function' ? p.getPos() : undefined
  if (typeof pos !== 'number') return false
  // 刚插入：斜杠 / 面板插入后节点被整块选中（NodeSelection），或光标紧随其后（行内 0 位，块级其后段落开头 1 位）
  const sel = p.editor.state.selection
  if (sel.from === pos && sel.to === pos + p.node.nodeSize) return true
  const gap = sel.from - (pos + p.node.nodeSize)
  return gap === 0 || gap === 1
}

function useLatexDraft(p: NodeViewProps, editing: boolean) {
  const latex = String(p.node.attrs.latex ?? '')
  const [draft, setDraft] = useState(latex)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const latexRef = useRef(latex)
  latexRef.current = latex
  const { updateAttributes } = p
  useEffect(() => {
    if (!editing) setDraft(latex)
  }, [latex, editing])
  const commit = useCallback(() => {
    if (draftRef.current !== latexRef.current) updateAttributes({ latex: draftRef.current })
  }, [updateAttributes])
  // 每次改动重新计时：停顿 COMMIT_MS 后写回
  useEffect(() => {
    void draft
    if (!editing) return
    const id = window.setTimeout(commit, COMMIT_MS)
    return () => window.clearTimeout(id)
  }, [draft, editing, commit])
  return { latex, draft, setDraft, commit }
}

export function MathBlockView(p: NodeViewProps) {
  const { t } = useTranslation()
  const editable = p.editor.isEditable
  const [editing, setEditing] = useState(() => justInserted(p))
  const { latex, draft, setDraft, commit } = useLatexDraft(p, editing)
  const html = useKatex(editing ? draft : latex, true)
  const done = () => {
    commit()
    setEditing(false)
    const pos = typeof p.getPos === 'function' ? p.getPos() : undefined
    if (typeof pos === 'number') p.editor.chain().focus().setNodeSelection(pos).run()
  }
  const body = html ? (
    <Rendered html={html} className="xz-math-render" />
  ) : (
    <span className="xz-diagram-empty">
      {html === '' ? t('editor.math.empty') : t('editor.mermaid.rendering')}
    </span>
  )
  return (
    <NodeViewWrapper className="xz-math-block" data-testid="math-block" contentEditable={false}>
      {editing ? (
        <div className="xz-math-edit" data-stop-pm="">
          <textarea
            className="xz-math-input"
            value={draft}
            // biome-ignore lint/a11y/noAutofocus: 用户刚插入或点击公式，焦点应在输入框
            autoFocus
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            aria-label={t('editor.math.sourceLabel')}
            placeholder={t('editor.math.sourceHint')}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                e.preventDefault()
                done()
              }
            }}
            data-testid="math-input"
          />
          <div className="xz-math-preview">{body}</div>
        </div>
      ) : editable ? (
        <button
          type="button"
          className="xz-math-preview xz-diagram-click"
          onClick={() => setEditing(true)}
          aria-label={t('editor.math.edit')}
        >
          {body}
        </button>
      ) : (
        <div className="xz-math-preview">{body}</div>
      )}
    </NodeViewWrapper>
  )
}

export function MathInlineView(p: NodeViewProps) {
  const { t } = useTranslation()
  const editable = p.editor.isEditable
  const [editing, setEditing] = useState(() => justInserted(p))
  const { latex, draft, setDraft, commit } = useLatexDraft(p, editing)
  const html = useKatex(latex, false)
  const done = (keep: boolean) => {
    if (keep) commit()
    else setDraft(latex)
    setEditing(false)
    p.editor.commands.focus()
  }
  const shown = html ? (
    <Rendered html={html} className="xz-math-inline-render" />
  ) : (
    <span className="xz-math-inline-empty">
      {latex ? `$${latex}$` : t('editor.math.inlineEmpty')}
    </span>
  )
  return (
    <NodeViewWrapper as="span" className="xz-math-inline" data-testid="math-inline">
      {editing ? (
        <span className="xz-math-inline-edit" data-stop-pm="">
          <input
            className="xz-math-inline-input"
            value={draft}
            // biome-ignore lint/a11y/noAutofocus: 点击行内公式后直接编辑
            autoFocus
            size={Math.max(6, draft.length + 1)}
            aria-label={t('editor.math.sourceLabel')}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => done(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                done(true)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                done(false)
              }
            }}
            data-testid="math-inline-input"
          />
        </span>
      ) : editable ? (
        <button
          type="button"
          className="xz-math-inline-btn"
          onClick={() => setEditing(true)}
          aria-label={t('editor.math.edit')}
        >
          {shown}
        </button>
      ) : (
        shown
      )}
    </NodeViewWrapper>
  )
}
