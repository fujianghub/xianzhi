/**
 * 提示块视图（ADR-0025 §6、REQ-EDITOR-030）：按 kind 分色（info / tip→success / warn→warning / danger，色值见 editor-blocks.css）、
 * 左色条 + 图标；可编辑时头部条可切换类型、取消提示块（内容提出到外层）。保留 `aside[data-callout].xz-callout` 以兼容导出与测试。
 */
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Info, Lightbulb, type LucideIcon, OctagonAlert, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CALLOUT_KINDS, type CalloutKind } from './nodes.ts'

const ICONS: Record<CalloutKind, LucideIcon> = {
  info: Info,
  tip: Lightbulb,
  warn: TriangleAlert,
  danger: OctagonAlert,
}

export function CalloutView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const { t } = useTranslation()
  const kind = (
    CALLOUT_KINDS.includes(node.attrs.kind as CalloutKind) ? node.attrs.kind : 'info'
  ) as CalloutKind
  const Icon = ICONS[kind]
  const unwrap = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    // 选中提示块内全部内容再 lift：整块内容提到外层，提示块本身消失
    editor
      .chain()
      .focus()
      .setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 })
      .lift('callout')
      .run()
  }
  return (
    <NodeViewWrapper as="aside" className="xz-callout" data-callout={kind}>
      <span className="xz-callout-icon" contentEditable={false} aria-hidden>
        <Icon className="size-4" />
      </span>
      {editor.isEditable ? (
        <span className="xz-callout-tools" contentEditable={false}>
          <select
            value={kind}
            aria-label={t('editor.callout.switch')}
            title={t('editor.callout.switch')}
            data-testid="callout-kind"
            onChange={(e) => updateAttributes({ kind: e.target.value })}
            className="h-6 rounded border border-border bg-surface px-1 text-fg text-xs"
          >
            {CALLOUT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`editor.callout.kind.${k}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={unwrap}
            aria-label={t('editor.callout.unwrap')}
            title={t('editor.callout.unwrap')}
            data-testid="callout-unwrap"
            className="grid size-6 place-items-center rounded text-fg-muted hover:bg-hover hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ) : null}
      <NodeViewContent className="xz-callout-body" />
    </NodeViewWrapper>
  )
}
