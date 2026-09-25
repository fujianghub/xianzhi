/**
 * 只读正文渲染（REQ-COLLAB-008 历史预览、REQ-TPL-004 模板预览）：schemaKit（与编辑页同一套节点视图），不接协同；
 * 未知节点包成 unknownBlock 显示占位；可选顶层块差异装饰（ops[i] 对应第 i 个顶层块）。
 */
import { Extension, getSchema } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { EditorContent, useEditor } from '@tiptap/react'
import type { BlockOp } from '../../shared/editor/diff.ts'
import { wrapUnknownPm } from '../../shared/editor/unknown.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { schemaKit } from './kit.ts'

const NO_OPS: BlockOp[] = []

let known: ReadonlySet<string> | null = null
const knownNodes = () => {
  known ??= new Set(Object.keys(getSchema(schemaKit()).nodes))
  return known
}

/** 顶层块差异装饰：ops[i] 对应 doc 第 i 个顶层块。 */
const DiffDecorations = Extension.create<{ ops: BlockOp[] }>({
  name: 'xzSnapshotDiff',
  addOptions: () => ({ ops: [] }),
  addProseMirrorPlugins() {
    const ops = this.options.ops
    return [
      new Plugin({
        props: {
          decorations(state) {
            if (!ops.length) return DecorationSet.empty
            const decos: Decoration[] = []
            state.doc.forEach((node, offset, index) => {
              const op = ops[index]
              if (op && op !== 'same')
                decos.push(
                  Decoration.node(offset, offset + node.nodeSize, {
                    class: `xz-diff-${op}`,
                    'data-diff': op,
                  }),
                )
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})

export function ReadOnlyDoc({
  doc,
  ops = NO_OPS,
  testId = 'snapshot-doc',
}: {
  doc: PmNode
  ops?: BlockOp[]
  testId?: string
}) {
  const editor = useEditor(
    {
      extensions: [...schemaKit(), DiffDecorations.configure({ ops })],
      content: wrapUnknownPm(doc, knownNodes()),
      editable: false,
      immediatelyRender: true,
      editorProps: {
        attributes: { class: 'xz-prose outline-none', 'data-testid': testId },
      },
    },
    [doc, ops],
  )
  return <EditorContent editor={editor} />
}
