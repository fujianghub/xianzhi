/**
 * Mermaid 源码编辑器（ADR-0025 §8、REQ-EDITOR-007）：CodeMirror 6，随本模块懒加载（不进编辑器首包）。
 * 只负责编辑与回调；何时写回节点属性（失焦 / 防抖）由 MermaidView 决定。
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { useEffect, useRef } from 'react'

const theme = EditorView.theme({
  '&': { color: 'var(--xz-fg)', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'var(--xz-font-mono)',
    fontSize: '0.875rem',
    lineHeight: '1.6',
    maxHeight: '22rem',
  },
  '.cm-content': { caretColor: 'var(--xz-fg)', padding: '10px 0' },
  '.cm-cursor': { borderLeftColor: 'var(--xz-fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--xz-primary-soft)',
  },
  '.cm-placeholder': { color: 'var(--xz-fg-faint)' },
})

export default function MermaidSource({
  value,
  label,
  hint,
  autoFocus,
  onChange,
  onBlur,
  onDone,
}: {
  value: string
  label: string
  hint: string
  autoFocus: boolean
  onChange: (v: string) => void
  onBlur: () => void
  onDone: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef({ onChange, onBlur, onDone })
  cb.current = { onChange, onBlur, onDone }
  // 只在挂载时以初值建编辑器；之后以 CM 自身状态为准（外部改动不回灌，避免光标跳动）
  const initial = useRef(value)

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          history(),
          keymap.of([
            {
              key: 'Escape',
              run: () => {
                cb.current.onDone()
                return true
              },
            },
            {
              key: 'Mod-Enter',
              run: () => {
                cb.current.onDone()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.lineWrapping,
          placeholder(hint),
          theme,
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            blur: () => {
              cb.current.onBlur()
              return false
            },
          }),
        ],
      }),
    })
    if (autoFocus) view.focus()
    return () => view.destroy()
  }, [autoFocus, hint, label])

  return <div ref={host} className="xz-diagram-source" data-testid="mermaid-source" />
}
