/**
 * Mermaid 节点视图（ADR-0025 §8、REQ-EDITOR-007、03 §3.2 · §12）：
 * - 预览：`import('mermaid')` 懒加载，`securityLevel:'strict'`（内置 DOMPurify，不得放宽）、`htmlLabels:false`、
 *   先 `parse` 取错误行再 `render`；渲染在 idle 回调、串行（全局配置）、随日 / 夜场重渲。
 * - 编辑：点预览或「编辑」进入 CodeMirror 6（懒加载）+ 实时预览；源码**失焦或停顿 800ms** 才写回 `code` 属性
 *   （Y 文档 gc:false，逐键写属性会让 ydoc 无限膨胀）；Esc / ⌘↵ /「完成」退出。并发编辑同一图按整段后写覆盖。
 * - 只读者只看预览。
 */
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import type { MermaidConfig } from 'mermaid'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { newId } from '../../lib/uuid.ts'
import {
  currentDark,
  mermaidErrorText,
  neutralizeNoteListMarkers,
  onIdle,
  onThemeChange,
  serial,
} from './diagram-utils.ts'

const MermaidSource = lazy(() => import('./MermaidSource.tsx'))

const COMMIT_MS = 800
const PREVIEW_MS = 300

interface Rendered {
  code: string
  svg: string
  error: string | null
}

async function renderMermaid(code: string): Promise<Rendered> {
  const mermaid = (await import('mermaid')).default
  const config: MermaidConfig & { htmlLabels?: boolean } = {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: currentDark() ? 'dark' : 'default',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    suppressErrorRendering: true,
  }
  mermaid.initialize(config)
  const src = neutralizeNoteListMarkers(code)
  try {
    await mermaid.parse(src)
  } catch (err) {
    return { code, svg: '', error: mermaidErrorText(err) }
  }
  const id = `xzm${newId().replace(/-/g, '')}`
  try {
    const { svg } = await mermaid.render(id, src)
    return { code, svg, error: null }
  } catch (err) {
    return { code, svg: '', error: mermaidErrorText(err) }
  } finally {
    // 渲染失败时 mermaid 可能在 body 上留下临时容器
    document.getElementById(`d${id}`)?.remove()
  }
}

/** 渲染给定源码（空闲时、串行）；主题切换后重渲。 */
export function useMermaid(code: string): Rendered | null {
  const [out, setOut] = useState<Rendered | null>(null)
  const [themeTick, setThemeTick] = useState(0)
  useEffect(() => onThemeChange(() => setThemeTick((n) => n + 1)), [])
  useEffect(() => {
    void themeTick
    if (!code.trim()) {
      setOut({ code, svg: '', error: null })
      return
    }
    let alive = true
    const cancel = onIdle(() => {
      void serial(() => renderMermaid(code)).then((r) => {
        if (alive) setOut(r)
      })
    })
    return () => {
      alive = false
      cancel()
    }
  }, [code, themeTick])
  return out
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    if (!ms) {
      setV(value)
      return
    }
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

export function MermaidView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const { t } = useTranslation()
  const code = String(node.attrs.code ?? '')
  const editable = editor.isEditable
  // 刚从斜杠 / 插入面板插入的空图（光标紧随其后）直接进入编辑态（03 §11.1「空源码进入编辑态」）
  const [editing, setEditing] = useState(() => {
    if (!editable || code.trim()) return false
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos !== 'number') return false
    // 刚插入：节点被整块选中（NodeSelection），或光标在其后（块级原子插入后可能落在其后段落开头，多 1 位）
    const sel = editor.state.selection
    if (sel.from === pos && sel.to === pos + node.nodeSize) return true
    const gap = sel.from - (pos + node.nodeSize)
    return gap === 0 || gap === 1
  })
  const [autoFocus, setAutoFocus] = useState(editing)
  const [draft, setDraft] = useState(code)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const codeRef = useRef(code)
  codeRef.current = code

  // 不在编辑时跟随远端 / 撤销带来的变化
  useEffect(() => {
    if (!editing) setDraft(code)
  }, [code, editing])

  const commit = useCallback(() => {
    if (draftRef.current !== codeRef.current) updateAttributes({ code: draftRef.current })
  }, [updateAttributes])

  // 每次改动重新计时：停顿 COMMIT_MS 后写回
  useEffect(() => {
    void draft
    if (!editing) return
    const id = window.setTimeout(commit, COMMIT_MS)
    return () => window.clearTimeout(id)
  }, [draft, editing, commit])

  const done = useCallback(() => {
    commit()
    setEditing(false)
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos === 'number') editor.chain().focus().setNodeSelection(pos).run()
  }, [commit, editor, getPos])

  const previewSrc = useDebounced(editing ? draft : code, editing ? PREVIEW_MS : 0)
  const r = useMermaid(previewSrc)
  const empty = !previewSrc.trim()

  const preview = (
    <>
      {r?.error ? (
        <div className="xz-diagram-error" role="alert" data-testid="mermaid-error">
          <strong>{t('editor.mermaid.error')}</strong>
          <pre>{r.error}</pre>
        </div>
      ) : null}
      {r?.svg && !r.error ? (
        <div
          className="xz-diagram-svg"
          data-testid="mermaid-svg"
          // mermaid securityLevel:'strict' 已用 DOMPurify 净化 SVG（03 §3.2）
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid strict 输出已净化
          dangerouslySetInnerHTML={{ __html: r.svg }}
        />
      ) : null}
      {empty ? (
        <p className="xz-diagram-empty">
          {editable ? t('editor.mermaid.empty') : t('editor.mermaid.emptyReadOnly')}
        </p>
      ) : !r || (r.code !== previewSrc && !r.svg && !r.error) ? (
        <p className="xz-diagram-empty">{t('editor.mermaid.rendering')}</p>
      ) : null}
    </>
  )

  return (
    <NodeViewWrapper
      className="xz-diagram"
      data-testid="mermaid"
      data-editing={editing || undefined}
      contentEditable={false}
    >
      <div className="xz-diagram-head">
        <span className="xz-diagram-label">{t('editor.mermaid.label')}</span>
        {editable ? (
          editing ? (
            <button
              type="button"
              className="xz-diagram-btn"
              onClick={done}
              data-testid="mermaid-done"
            >
              {t('editor.mermaid.done')}
            </button>
          ) : (
            <button
              type="button"
              className="xz-diagram-btn"
              onClick={() => {
                setAutoFocus(true)
                setEditing(true)
              }}
              data-testid="mermaid-edit"
            >
              {t('editor.mermaid.edit')}
            </button>
          )
        ) : null}
      </div>
      {editing ? (
        <div className="xz-diagram-editor" data-stop-pm="">
          <Suspense fallback={<div className="xz-diagram-source" />}>
            <MermaidSource
              value={draft}
              label={t('editor.mermaid.sourceLabel')}
              hint={t('editor.mermaid.sourceHint')}
              autoFocus={autoFocus}
              onChange={setDraft}
              onBlur={commit}
              onDone={done}
            />
          </Suspense>
          <div className="xz-diagram-preview">{preview}</div>
        </div>
      ) : editable ? (
        <button
          type="button"
          className="xz-diagram-preview xz-diagram-click"
          onClick={() => {
            setAutoFocus(true)
            setEditing(true)
          }}
          aria-label={t('editor.mermaid.edit')}
        >
          {preview}
        </button>
      ) : (
        <div className="xz-diagram-preview">{preview}</div>
      )}
    </NodeViewWrapper>
  )
}
