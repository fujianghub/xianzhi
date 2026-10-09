/**
 * 斜杠菜单（03 §11.1、REQ-EDITOR-002）：`/` 触发 @tiptap/suggestion；最多 8 条，模糊匹配中英触发词与命令名；
 * ↑↓ 选择、Enter 执行、Esc 关闭并保留 `/`。弹层 glass-thick，定位用 @floating-ui/dom。
 */

import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { type Editor, Extension, type Range } from '@tiptap/core'
import { PluginKey, TextSelection } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import i18n from 'i18next'
import { Fragment, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { stringifyEntryFilter } from '../../shared/entry-search.ts'
import type { EntryKind } from '../../shared/schemas/enums.ts'
import { cn } from '../lib/cn.ts'
import { SOURCE_EVENT, TEMPLATE_EVENT } from './extensions.ts'
import { InsertIcon, LINK_INSERT_EVENT } from './insert-meta.tsx'
import { pickFiles, uploadFiles } from './upload.ts'

export interface SlashCtx {
  entryId: string
  kind: EntryKind
  ydoc: import('yjs').Doc
  pickEntry: (mode: 'card' | 'link', at: number) => void
  /** 本篇所在空间（查询块默认范围，ADR-0033） */
  spaceId?: string
}

export interface SlashItem {
  id: string
  group: 'basic' | 'list' | 'code' | 'diagram' | 'structure' | 'media' | 'time' | 'template'
  /** i18n key：editor.slash.<id>（默认） */
  terms: string[]
  run: (editor: Editor, range: Range, ctx: SlashCtx) => void
}

const chainAt = (e: Editor, r: Range) => e.chain().focus().deleteRange(r)

/** Mermaid 预设示例（ASCII，插入后可编辑；ADR-0025 §2）。 */
export const MERMAID_PRESETS = {
  mermaidFlow: 'flowchart TD\n  A[Start] --> B{OK?}\n  B -- yes --> C[Done]\n  B -- no --> A',
  mermaidSeq: 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi',
  mermaidClass: 'classDiagram\n  class Animal {\n    +name\n    +speak()\n  }\n  Animal <|-- Dog',
  mermaidState: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> [*]',
  mermaidGantt:
    'gantt\n  dateFormat YYYY-MM-DD\n  section Plan\n  Design :a1, 2026-10-01, 3d\n  Build :after a1, 5d',
} as const

const pad2 = (n: number) => String(n).padStart(2, '0')
/** 插入时间的文本（本地时间）：date = YYYY-MM-DD，time = HH:mm，datetime = YYYY-MM-DD HH:mm。 */
export function nowText(kind: 'date' | 'time' | 'datetime', d = new Date()): string {
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return kind === 'date' ? date : kind === 'time' ? time : `${date} ${time}`
}

/** 分组顺序（斜杠空查询按此分组展示，ADR-0025 §2）。 */
export const SLASH_GROUPS = [
  'basic',
  'list',
  'structure',
  'code',
  'diagram',
  'media',
  'time',
  'template',
] as const

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
  // Mermaid 预设（ADR-0025 §2）：插入带示例代码的图表
  ...(Object.entries(MERMAID_PRESETS) as [string, string][]).map(
    ([id, code]): SlashItem => ({
      id,
      group: 'diagram',
      terms: ['mermaid', id.replace('mermaid', '').toLowerCase()],
      run: (e, r) => chainAt(e, r).insertContent({ type: 'mermaid', attrs: { code } }).run(),
    }),
  ),
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
    id: 'mathInline',
    group: 'code',
    terms: ['math', 'inline', 'gongshi', 'hangnei'],
    run: (e, r) =>
      chainAt(e, r)
        .insertContent({ type: 'mathInline', attrs: { latex: '' } })
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
      else
        chainAt(e, r)
          .insertContent({ type: 'toc' })
          // 插入原子块后选区是整块选中，接着打字会把目录替换掉：把光标移到其后的段落（没有就补一个）
          .command(({ tr }) => {
            const after = tr.selection.to
            const next = tr.doc.resolve(after).nodeAfter
            const para = e.schema.nodes.paragraph
            if (!next?.isTextblock && para) tr.insert(after, para.create())
            tr.setSelection(TextSelection.create(tr.doc, after + 1))
            return true
          })
          .run()
    },
  },
  // 插入时间（ADR-0032）：本地时间，普通文字
  ...(
    [
      ['date', 'riqi today'],
      ['time', 'shijian now'],
      ['datetime', 'riqishijian now'],
    ] as const
  ).map(
    ([id, py]): SlashItem => ({
      id,
      group: 'time',
      terms: [id, ...py.split(' ')],
      run: (e, r) => chainAt(e, r).insertContent(nowText(id)).run(),
    }),
  ),
  {
    id: 'link',
    group: 'media',
    terms: ['url', 'href', 'chaolianjie'],
    // 打开工具栏的链接弹层（网址 + 文字，REQ-EDITOR-018 白名单）
    run: (e, r) => {
      chainAt(e, r).run()
      window.dispatchEvent(new CustomEvent(LINK_INSERT_EVENT))
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
  // 网页卡片（ADR-0054 §D）：插入空卡片，在卡片里输入网址
  {
    id: 'linkCard',
    group: 'media',
    terms: ['link', 'web', 'url', 'wangye', 'lianjie', 'bookmark'],
    run: (e, r) => {
      chainAt(e, r)
        .insertContent({ type: 'linkCard', attrs: { url: '' } })
        .run()
    },
  },
  // 查询块（ADR-0033）：默认 = 本空间未关闭的 Bug，按优先级；插入后在块上「设置」改筛选
  {
    id: 'query',
    group: 'media',
    terms: ['query', 'chaxun', 'bug', 'shitu', 'tongji'],
    run: (e, r, ctx) =>
      chainAt(e, r)
        .insertContent({
          type: 'entryQuery',
          attrs: {
            title: '',
            query: stringifyEntryFilter({
              kind: 'bug',
              fields: 'status=new|pending',
              sort: 'priority',
              ...(ctx.spaceId ? { spaceId: ctx.spaceId } : {}),
            }),
            view: 'table',
            limit: 20,
          },
        })
        .run(),
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
    id: 'source',
    group: 'code',
    terms: ['markdown', 'md', 'source', 'yuanma'],
    run: (e, r) => {
      chainAt(e, r).run()
      window.dispatchEvent(new CustomEvent(SOURCE_EVENT))
    },
  },
  {
    id: 'template',
    group: 'template',
    terms: ['template', 'muban'],
    // 选模板后在此处插入正文，不替换已有内容（03 §11.1、REQ-TPL-005）
    run: (e, r) => {
      chainAt(e, r).run()
      window.dispatchEvent(new CustomEvent(TEMPLATE_EVENT, { detail: { at: r.from } }))
    },
  },
]

export const slashLabel = (id: string) => i18n.t(`editor.slash.${id}`)
/** 本地化触发词（空格分隔，i18n：editor.slash.terms.<id>）。 */
const slashTerms = (id: string) => {
  const v = i18n.t(`editor.slash.terms.${id}`, { defaultValue: '' })
  return v ? v.split(/\s+/) : []
}

/**
 * 模糊匹配（03 §11.1）：query 为空 → 全部命令按分组顺序（菜单里带分组标题、可滚动，ADR-0025 §2）；
 * 否则命中触发词前缀 / 包含或命令名包含，扁平排序最多 8 条。
 */
export function filterSlash(
  query: string,
  label: (id: string) => string = slashLabel,
  localTerms: (id: string) => string[] = slashTerms,
  pool: SlashItem[] = SLASH_ITEMS,
): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q)
    return SLASH_GROUPS.flatMap((g) => pool.filter((it) => it.group === g)).concat(
      pool.filter((it) => !(SLASH_GROUPS as readonly string[]).includes(it.group)),
    )
  const score = (it: SlashItem) => {
    const terms = [...it.terms, ...localTerms(it.id), label(it.id)].map((s) => s.toLowerCase())
    if (terms.some((s) => s.startsWith(q))) return 2
    if (terms.some((s) => s.includes(q))) return 1
    return 0
  }
  return pool
    .map((it) => [it, score(it)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([it]) => it)
}

interface ListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
}
type ListProps = SuggestionProps<SlashItem, SlashItem>

const SlashList = forwardRef<ListHandle, ListProps>(function SlashList(
  { items, command, query },
  ref,
) {
  const { t } = useTranslation()
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  // 键盘移动时把高亮项滚进可视区（空查询是完整分组列表，会超出高度）
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const grouped = !query.trim()
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
      ref={listRef}
      className="glass-thick max-h-80 w-64 overflow-y-auto rounded-lg p-1 text-fg text-sm"
    >
      {items.length ? (
        items.map((it, i) => (
          <Fragment key={it.id}>
            {grouped && it.group !== items[i - 1]?.group ? (
              <div
                role="presentation"
                className="px-2 pt-2 pb-1 font-medium text-[11px] text-fg-muted tracking-wider"
              >
                {t(`editor.slash.groups.${it.group}`)}
              </div>
            ) : null}
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              data-index={i}
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
              <span className="flex items-center gap-2">
                <InsertIcon id={it.id} />
                {t(`editor.slash.${it.id}`)}
              </span>
              {grouped ? null : (
                <span className="text-fg-muted text-xs">
                  {t(`editor.slash.groups.${it.group}`)}
                </span>
              )}
            </button>
          </Fragment>
        ))
      ) : (
        <p className="px-2 py-2 text-fg-muted">{t('editor.slash.empty')}</p>
      )}
    </div>
  )
})

export const slashKey = new PluginKey('giSlash')

/**
 * `exclude`：不提供的命令 id（模板编辑器没有记录 / ydoc 上下文，去掉上传、记录卡片 / 链接、源码、模板，ADR-0023）。
 */
export function createSlash(getCtx: () => SlashCtx, opts: { exclude?: readonly string[] } = {}) {
  const pool = opts.exclude?.length
    ? SLASH_ITEMS.filter((it) => !opts.exclude?.includes(it.id))
    : SLASH_ITEMS
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
          items: ({ query }) => filterSlash(query, slashLabel, slashTerms, pool),
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
