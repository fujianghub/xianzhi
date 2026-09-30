/**
 * 模板正文编辑器（ADR-0023、REQ-TPL-010）：schemaKit + 本地撤销，不接协同——模板正文是 `entry_templates.body`（PM JSON），
 * 不是 entries.ydoc，不触及不变量 1。斜杠菜单去掉依赖记录上下文的命令（上传、记录卡片 / 链接、源码、模板）；
 * 粘贴 / 拖入文件不上传（模板不带附件）。Mod+S 保存模板（覆盖 GiKeymap 的「已同步」提示）。随编辑器 chunk 懒加载。
 * ADR-0037（REQ-TPL-012）：与记录页同一套编辑外框——吸顶格式工具栏（「+」插入面板排除同一批依赖记录的项）、
 * 块手柄、表格工具条、窄屏底部工具栏（无图片按钮）；没有文档栏（字数 / 阅读 / 版本属于记录）。
 */
import { Extension, getSchema } from '@tiptap/core'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { UndoRedo } from '@tiptap/extensions'
import { EditorContent, useEditor } from '@tiptap/react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { unwrapUnknownPm, wrapUnknownPm } from '../../shared/editor/unknown.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { BlockHandle, onBlockNodeChange } from './BlockMenu.tsx'
import { BubbleBar } from './BubbleBar.tsx'
import { EditorToolbar } from './EditorToolbar.tsx'
import { createPastePlugin } from './extensions.ts'
import { schemaKit } from './kit.ts'
import { MobileToolbar } from './MobileToolbar.tsx'
import { createSlash, type SlashCtx } from './slash.tsx'
import { TableMenu } from './TableMenu.tsx'

/** 模板里不提供的斜杠命令（需要记录 id / ydoc / 记录选择器）；工具栏「+」插入面板同一份排除。 */
const EXCLUDED_SLASH = ['image', 'file', 'card', 'entryLink', 'source', 'template'] as const

/** 占位符（代码常量：i18next 会吃掉文案里的 {{…}}）。 */
export const TEMPLATE_VARS = ['{{date}}', '{{user}}', '{{space}}'] as const

let known: ReadonlySet<string> | null = null
const knownNodes = () => {
  known ??= new Set(Object.keys(getSchema(schemaKit()).nodes))
  return known
}

export interface TemplateEditorHandle {
  getBody: () => PmNode
}

export default function TemplateEditor({
  initial,
  editable = true,
  onSave,
  handleRef,
}: {
  initial: PmNode
  editable?: boolean
  onSave?: () => void
  handleRef?: { current: TemplateEditorHandle | null }
}) {
  const { t } = useTranslation()
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  // 斜杠命令只用到 editor 本身；排除的命令才会读 ctx，这里给一个无害的占位
  const stubCtx = useRef<SlashCtx>({
    entryId: '',
    kind: 'note',
    ydoc: null as unknown as SlashCtx['ydoc'],
    pickEntry: () => {},
  })
  const editor = useEditor(
    {
      extensions: [
        ...schemaKit({ placeholder: t('template.editor.placeholder') }),
        UndoRedo,
        createSlash(() => stubCtx.current, { exclude: EXCLUDED_SLASH }),
        createPastePlugin({ onFiles: () => toast.info(t('template.editor.noAttachments')) }),
        Extension.create({
          name: 'xzTemplateSave',
          priority: 1000,
          addKeyboardShortcuts: () => ({
            'Mod-s': () => {
              saveRef.current?.()
              return true
            },
          }),
        }),
      ],
      content: wrapUnknownPm(initial, knownNodes()),
      editable,
      immediatelyRender: true,
      editorProps: {
        attributes: {
          class: 'xz-prose outline-none',
          'data-testid': 'template-editor',
          'aria-label': t('template.editor.body'),
        },
      },
    },
    [],
  )
  if (handleRef)
    handleRef.current = editor
      ? { getBody: () => unwrapUnknownPm(editor.getJSON() as PmNode) }
      : null
  return (
    <div className="flex flex-col gap-2">
      {editable ? (
        <p className="text-fg-muted text-xs" data-testid="template-vars-hint">
          {t('template.editor.varsHint')}{' '}
          {TEMPLATE_VARS.map((v) => (
            <code key={v} className="mx-0.5 rounded-sm bg-surface-2 px-1 font-mono">
              {v}
            </code>
          ))}
        </p>
      ) : null}
      <div
        className="paper relative min-h-64 rounded-lg border border-border px-5 pb-4 sm:px-8"
        data-testid="template-paper"
      >
        {editor && editable ? (
          <>
            <EditorToolbar
              editor={editor}
              readOnly={false}
              getCtx={() => stubCtx.current}
              exclude={EXCLUDED_SLASH}
            />
            <DragHandle editor={editor} onNodeChange={onBlockNodeChange}>
              <BlockHandle editor={editor} />
            </DragHandle>
            <BubbleBar editor={editor} />
            <TableMenu editor={editor} />
            <MobileToolbar editor={editor} />
          </>
        ) : (
          <div className="h-4" />
        )}
        {editor ? <EditorContent editor={editor} /> : null}
      </div>
    </div>
  )
}
