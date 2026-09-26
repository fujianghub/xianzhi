/**
 * 某空间的目录树（懒加载 `GET /spaces/:id/tree`）：位置导航（选中 = 过滤子树）与个人首页「空间目录」（点击 = 打开记录）共用。
 * 层级表达（ADR-0015、REQ-KB-006）：每级 `indent` 缩进 + 祖先引导线 + 类型色块 + 字重递减 + 折叠时子项计数 + 展开入场。
 * `level` = 根节点所在层级（外层还有大类 / 空间行时为 1、2），引导线从第 0 级画起，与外层行的展开指示对齐。
 * 节点展开状态保存在组件内：默认全部收起，只展开 `active` 的祖先链。
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import { treeQuery } from '../../lib/entry-queries.ts'
import { flatten } from '../../lib/tree.ts'
import { Disclosure } from '../ui/disclosure.tsx'
import { Skeleton } from '../ui/skeleton.tsx'
import { staggerIndex, TreeGuides, treeLevelClass } from '../ui/tree-guides.tsx'
import { KindIcon } from './KindIcon.tsx'

/** 行内展开指示的中心相对行起点的偏移（size-6 指示的一半） */
export const TWISTY_CENTER = 12

export const navRowCls = (active: boolean) =>
  cn(
    'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
    active ? 'bg-selected font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
  )

export function DirTree({
  spaceId,
  level,
  indent = 12,
  active,
  onSelect,
  testId = 'entries-nav-tree',
}: {
  spaceId: string
  level: number
  indent?: number
  /** 当前选中节点（位置导航） */
  active?: string
  /** 传入 = 选择模式（按钮）；省略 = 链接模式（打开记录） */
  onSelect?: (id: string) => void
  testId?: string
}) {
  const { t } = useTranslation()
  const tree = useQuery(treeQuery(spaceId))
  const nodes = tree.data ?? []
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (!active || !tree.data) return
    const byId = new Map(tree.data.map((n) => [n.id, n]))
    const chain: string[] = []
    let cur = byId.get(active)?.parentId ?? null
    while (cur) {
      chain.push(cur)
      cur = byId.get(cur)?.parentId ?? null
    }
    if (chain.length) setOpen((s) => new Set([...s, ...chain]))
  }, [active, tree.data])
  const collapsed = useMemo(
    () => new Set(nodes.filter((n) => !open.has(n.id)).map((n) => n.id)),
    [nodes, open],
  )
  const flat = useMemo(() => flatten(nodes, collapsed), [nodes, collapsed])
  const stagger = useMemo(() => staggerIndex(flat), [flat])
  const pad = (d: number) => `${d * indent}px`

  if (tree.isPending)
    return (
      <div className="py-1" style={{ paddingInlineStart: pad(level) }}>
        <Skeleton className="h-5 w-32" />
      </div>
    )
  if (!flat.length)
    return (
      <p
        className="relative py-1 text-fg-faint text-xs"
        style={{ paddingInlineStart: `${level * indent + 26}px` }}
      >
        <TreeGuides depth={level} x0={TWISTY_CENTER} indent={indent} />
        {t('entry.nav.treeEmpty')}
      </p>
    )
  return (
    <ul className="flex flex-col" data-testid={testId}>
      {flat.map((n) => {
        const d = level + n.depth
        const isActive = active === n.id
        const isOpen = open.has(n.id)
        const title = n.title || t('entry.untitled')
        const body = (
          <>
            <KindIcon kind={n.kind} typeId={n.typeId} size="xs" />
            <span className={cn('truncate', treeLevelClass(n.depth))}>{title}</span>
            {n.hasChildren && !isOpen ? (
              <span className="xz-tree-count ms-auto" aria-hidden>
                {n.childCount}
              </span>
            ) : null}
          </>
        )
        return (
          <li
            key={n.id}
            className="relative flex py-px"
            style={{ paddingInlineStart: pad(d), '--i': stagger.get(n.id) ?? 0 } as CSSProperties}
            data-testid="entries-nav-node"
            data-entry-id={n.id}
            data-depth={n.depth}
          >
            <TreeGuides depth={d} x0={TWISTY_CENTER} indent={indent} active={isActive} />
            <div className="xz-tree-in flex min-w-0 flex-1 items-center">
              {n.hasChildren ? (
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={t(isOpen ? 'entry.nav.collapse' : 'entry.nav.expand', {
                    name: title,
                  })}
                  onClick={() =>
                    setOpen((s) => {
                      const x = new Set(s)
                      if (x.has(n.id)) x.delete(n.id)
                      else x.add(n.id)
                      return x
                    })
                  }
                  className="xz-twisty size-6"
                >
                  <Disclosure open={isOpen} />
                </button>
              ) : (
                <span className="size-6 shrink-0" aria-hidden />
              )}
              {onSelect ? (
                <button
                  type="button"
                  className={cn(navRowCls(isActive), 'group h-7')}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onSelect(n.id)}
                >
                  {body}
                </button>
              ) : (
                <Link
                  to="/entries/$entryId"
                  params={{ entryId: n.id }}
                  className={cn(navRowCls(false), 'group h-7')}
                >
                  {body}
                </Link>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
