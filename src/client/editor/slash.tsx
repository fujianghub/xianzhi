/**
 * 斜杠菜单（03 §11.1、REQ-EDITOR-002）：`/` 触发 @tiptap/suggestion；最多 8 条，模糊匹配中英触发词与命令名；
 * ↑↓ 选择、Enter 执行、Esc 关闭并保留 `/`。弹层 glass-thick，定位用 @floating-ui/dom。
 */
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { type Editor, Extension, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import i18n from 'i18next'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { entryTemplate } from '../../shared/editor/templates.ts'
import type { EntryKind } from '../../shared/schemas/enums.ts'
import { cn } from '../lib/cn.ts'
import { pickFiles, uploadFiles } from './upload.ts'

export interface SlashCtx {
  entryId: string
  kind: EntryKind
  ydoc: import('yjs').Doc
  pickEntry: (mode: 'card' | 'link', at: number) => void
}

export interface SlashItem {
  id: string
  group: 'basic' | 'list' | 'code' | 'structure' | 'media' | 'template'
  /** i18n key：editor.slash.<id>（默认） */
  terms: string[]
  run: (editor: Editor, range: Range, ctx: SlashCtx) => void
}

const chainAt = (e: Editor, r: Range) => e.chain().focus().deleteRange(r)

export const SLASH_ITEMS: SlashItem[] = [
  ...([1, 2, 3, 4] as const).map(
    (level): SlashItem => ({
      id: `h${level}`,
      group: 'basic',
      terms: [`h${level}`, 'heading', 'biaoti'],
      run: (e, r) => chainAt(e, r).setNode('heading', { level }).run(),
    }),
  ),
  {
    id: 'paragraph',
    group: 'basic',
    terms: ['text', 'paragraph', 'zhengwen'],
    run: (e, r) => chainAt(e, r).setParagraph().run(),
  },
  {
    id: 'quote',
    group: 'basic',
    terms: ['quote', 'yinyong'],
    run: (e, r) => chainAt(e, r).toggleBlockquote().run(),
  },
  {
    id: 'hr',
    group: 'basic',
    terms: ['hr', 'divider', 'fenge'],
    run: (e, r) => chainAt(e, r).setHorizontalRule().run(),
  },
  {
    id: 'bullet',
    group: 'list',
    terms: ['bullet', 'liebiao'],
    run: (e, r) => chainAt(e, r).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    group: 'list',
    terms: ['number', 'ordered', 'bianhao'],
    run: (e, r) => chainAt(e, r).toggleOrderedList().run(),
  },
  {
    id: 'todo',
    group: 'list',
    terms: ['todo', 'task', 'daiban'],
    run: (e, r) => chainAt(e, r).toggleTaskList().run(),
  },
  {
    id: 'code',
    group: 'code',
    terms: ['code', 'daima'],
    run: (e, r) => chainAt(e, r).setCodeBlock().run(),
  },
  {
    id: 'mermaid',
    group: 'code',
    terms: ['mermaid', 'tubiao'],
    run: (e, r) =>
      chainAt(e, r)
        .insertContent({ type: 'mermaid', attrs: { code: '' } })
        .run(),
  },
  {
    id: 'math',
    group: 'code',
    terms: ['math', 'gongshi'],
    run: (e, r) =>
      chainAt(e, r)
        .insertContent({ type: 'mathBlock', attrs: { latex: '' } })
        .run(),
  },
  {
    id: 'table',
    group: 'structure',
    terms: ['table', 'biaoge'],
    run: (e, r) => chainAt(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'details',
    group: 'structure',
    terms: ['toggle', 'details', 'zhedie'],
    run: (e, r) => chainAt(e, r).setDetails().run(),
  },
  ...(['info', 'tip', 'warn', 'danger'] as const).map(
    (kind): SlashItem => ({
      id: kind,
      group: 'structure',
      terms: [
        kind,
        'callout',
        { info: 'tishi', tip: 'jiqiao', warn: 'jinggao', danger: 'weixian' }[kind],
      ],
      run: (e, r) => chainAt(e, r).wrapIn('callout', { kind }).run(),
    }),
  ),
  {
    id: 'toc',
    group: 'structure',
    terms: ['toc', 'mulu'],
    run: (e, r) => {
      let has = false
      e.state.doc.descendants((n) => {
        if (n.type.name === 'toc') has = true
      })
      // 每篇最多 1 个目录
      if (has) chainAt(e, r).run()
      else chainAt(e, r).insertContent({ type: 'toc' }).run()
    },
  },
  {
    id: 'image',
    group: 'media',
    terms: ['image', 'tupian'],
    run: (e, r, ctx) => {
      chainAt(e, r).run()
      pickFiles('image/*', (files) => uploadFiles(e, files, r.from, ctx))
    },
  },
  {
    id: 'file',
    group: 'media',
    terms: ['file', 'fujian'],
    run: (e, r, ctx) => {
      chainAt(e, r).run()
      pickFiles('*/*', (files) => uploadFiles(e, files, r.from, ctx))
    },
  },
  {
    id: 'card',
    group: 'media',
    terms: ['card', 'kapian'],
    run: (e, r, ctx) => {
      chainAt(e, r).run()
      ctx.pickEntry('card', r.from)
    },
  },
  {
    id: 'entryLink',
    group: 'media',
    terms: ['link', 'lianjie'],
    run: (e, r, ctx) => {
      chainAt(e, r).run()
      ctx.pickEntry('link', r.from)
    },
  },
  {
    id: 'template',
    group: 'template',
    terms: ['template', 'muban'],
    // 插入本类型骨架，不替换已有内容（03 §11.1）
    run: (e, r, ctx) =>
      chainAt(e, r)
        .insertContent(entryTemplate(ctx.kind).content ?? [])
        .run(),
  },
]

export const slashLabel = (id: string) => i18n.t(`editor.slash.${id}`)
/** 本地化触发词（空格分隔，i18n：editor.slash.terms.<id>）。 */
const slashTerms = (id: string) => {
  const v = i18n.t(`editor.slash.terms.${id}`, { defaultValue: '' })
  return v ? v.split(/\s+/) : []
}

/** 模糊匹配：query 为空全量；否则命中触发词前缀 / 包含或命令名包含；最多 8 条（03 §11.1）。 */
export function filterSlash(
  query: string,
  label: (id: string) => string = slashLabel,
  localTerms: (id: string) => string[] = slashTerms,
): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_ITEMS.slice(0, 8)
  const score = (it: SlashItem) => {
    const terms = [...it.terms, ...localTerms(it.id), label(it.id)].map((s) => s.toLowerCase())
    if (terms.some((s) => s.startsWith(q))) return 2
    if (terms.some((s) => s.includes(q))) return 1
    return 0
  }
  return SLASH_ITEMS.map((it) => [it, score(it)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([it]) => it)
}

interface ListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
}
type ListProps = SuggestionProps<SlashItem, SlashItem>

const SlashList = forwardRef<ListHandle, ListProps>(function SlashList({ items, command }, ref) {
  const { t } = useTranslation()
  const [active, setActive] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 候选变化时高亮回到第一项
  useEffect(() => setActive(0), [items])
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown') {
        setActive((a) => (a + 1) % Math.max(items.length, 1))
        return true
      }
      if (e.key === 'ArrowUp') {
        setActive((a) => (a - 1 + items.length) % Math.max(items.length, 1))
        return true
      }
      if (e.key === 'Enter') {
        const it = items[active]
        if (it) command(it)
        return !!it
      }
      return false
    },
  }))
  return (
    <div
      role="listbox"
      aria-label={t('editor.slash.groups.basic')}
      data-testid="slash-menu"
      className="glass-thick w-64 overflow-hidden rounded-lg p-1 text-fg text-sm"
    >
      {items.length ? (
        items.map((it, i) => (
          <button
            key={it.id}
            type="button"
            role="option"
            aria-selected={i === active}
            data-slash={it.id}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              command(it)
            }}
            className={cn(
              'flex h-9 w-full items-center justify-between gap-2 rounded-md px-2 text-left',
              i === active && 'bg-selected',
            )}
          >
            <span>{t(`editor.slash.${it.id}`)}</span>
            <span className="text-fg-muted text-xs">{t(`editor.slash.groups.${it.group}`)}</span>
          </button>
        ))
      ) : (
        <p className="px-2 py-2 text-fg-muted">{t('editor.slash.empty')}</p>
      )}
    </div>
  )
})

export const slashKey = new PluginKey('giSlash')

export function createSlash(getCtx: () => SlashCtx) {
  return Extension.create({
    name: 'giSlash',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          pluginKey: slashKey,
          char: '/',
          allowSpaces: false,
          // 代码块内不触发
          allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
          items: ({ query }) => filterSlash(query),
          command: ({ editor, range, props }) => props.run(editor, range, getCtx()),
          render: () => {
            let renderer: ReactRenderer<ListHandle, ListProps> | null = null
            let host: HTMLDivElement | null = null
            const place = (p: ListProps) => {
              const rect = p.clientRect?.()
              if (!rect || !host) return
              void computePosition({ getBoundingClientRect: () => rect }, host, {
                placement: 'bottom-start',
                strategy: 'fixed',
                middleware: [offset(6), flip(), shift({ padding: 8 })],
              }).then(({ x, y }) => {
                if (host) Object.assign(host.style, { left: `${x}px`, top: `${y}px` })
              })
            }
            const close = () => {
              renderer?.destroy()
              host?.remove()
              renderer = null
              host = null
            }
            return {
              onStart: (p) => {
                host = document.createElement('div')
                host.style.position = 'fixed'
                host.style.zIndex = 'var(--xz-z-dropdown)'
                document.body.appendChild(host)
                renderer = new ReactRenderer(SlashList, { props: p, editor: p.editor })
                host.appendChild(renderer.element)
                place(p)
              },
              onUpdate: (p) => {
                renderer?.updateProps(p)
                place(p)
              },
              onKeyDown: ({ event }) => {
                if (event.key === 'Escape') {
                  close() // 保留已输入的 `/`
                  return true
                }
                return renderer?.ref?.onKeyDown(event) ?? false
              },
              onExit: close,
            }
          },
        }),
      ]
    },
  })
}
