/**
 * 记录页左栏（ADR-0014、REQ-ENTRY-012）：全部 · 最近打开 · 收藏 · 已归档 · 个人随笔，
 * 再按 大类 → 空间 → 目录树 逐级展开（目录树展开时才请求 `GET /spaces/:id/tree`）。
 * 选中项写入 URL（spaceId / under / groupId / favorite / recent / archived，互斥）。
 * 空间页签内（`fixedSpace`）只显示本空间的「全部」与目录树。
 */
import { useQuery } from '@tanstack/react-query'
import { Archive, Clock, FileText, Layers, NotebookPen, Star } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import { treeQuery } from '../../lib/entry-queries.ts'
import { groupSpaces, type Space, spaceGroupsQuery, spacesQuery } from '../../lib/space-queries.ts'
import { flatten } from '../../lib/tree.ts'
import { Disclosure } from '../ui/disclosure.tsx'
import type { EntriesSearch } from './EntriesPage.tsx'
import { SpaceIcon } from './SpaceIcon.tsx'

export const LOCATION_KEYS = [
  'spaceId',
  'under',
  'groupId',
  'favorite',
  'recent',
  'archived',
] as const
export type EntriesLocation = Pick<EntriesSearch, (typeof LOCATION_KEYS)[number]>
/** 切换位置：先清空全部位置键再写入（互斥），并清掉只对旧位置有意义的多选。 */
export const locationPatch = (loc: EntriesLocation): Partial<EntriesSearch> => ({
  ...Object.fromEntries(LOCATION_KEYS.map((k) => [k, undefined])),
  ...loc,
})

const rowCls = (active: boolean) =>
  cn(
    'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm',
    active ? 'bg-selected font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
  )

export function EntriesNav({
  search,
  onSelect,
  fixedSpace,
}: {
  search: EntriesSearch
  onSelect: (loc: EntriesLocation) => void
  fixedSpace?: Space
}) {
  const { t } = useTranslation()
  const spaces = useQuery({ ...spacesQuery(), enabled: !fixedSpace })
  const groups = useQuery({ ...spaceGroupsQuery, enabled: !fixedSpace })
  const sections = useMemo(
    () => groupSpaces(spaces.data ?? [], groups.data ?? []),
    [spaces.data, groups.data],
  )
  const personal = spaces.data?.find((s) => s.isPersonal)
  const noLoc = !LOCATION_KEYS.some((k) => search[k])

  // 展开状态：大类默认展开；空间默认收起，当前所选空间自动展开
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set())
  const [openSpaces, setOpenSpaces] = useState<Set<string>>(
    () => new Set(search.spaceId ? [search.spaceId] : []),
  )
  useEffect(() => {
    const id = search.spaceId
    if (id) setOpenSpaces((s) => (s.has(id) ? s : new Set([...s, id])))
  }, [search.spaceId])
  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  }

  const quick = (
    key: string,
    icon: ReactNode,
    label: string,
    active: boolean,
    loc: EntriesLocation,
  ) => (
    <li className="flex">
      <button
        type="button"
        className={rowCls(active)}
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelect(loc)}
        data-testid={`entries-nav-${key}`}
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
    </li>
  )

  if (fixedSpace)
    return (
      <nav aria-label={t('entry.nav.label')} data-testid="entries-nav">
        <ul className="flex flex-col gap-0.5">
          {quick(
            'all',
            <FileText className="size-4 shrink-0" />,
            t('entry.nav.all'),
            !search.under && !search.favorite && !search.archived,
            {},
          )}
          {quick(
            'archived',
            <Archive className="size-4 shrink-0" />,
            t('entry.nav.archived'),
            !!search.archived,
            { archived: '1' },
          )}
        </ul>
        <div className="mt-3 border-divider border-t pt-3">
          <SpaceTree
            spaceId={fixedSpace.id}
            under={search.under}
            onSelect={(under) => onSelect({ under })}
            depth={0}
          />
        </div>
      </nav>
    )

  return (
    <nav aria-label={t('entry.nav.label')} data-testid="entries-nav">
      <ul className="flex flex-col gap-0.5">
        {quick('all', <FileText className="size-4 shrink-0" />, t('entry.nav.all'), noLoc, {})}
        {quick(
          'recent',
          <Clock className="size-4 shrink-0" />,
          t('entry.nav.recent'),
          !!search.recent,
          { recent: '1' },
        )}
        {quick(
          'favorite',
          <Star className="size-4 shrink-0" />,
          t('entry.nav.favorite'),
          !!search.favorite,
          { favorite: '1' },
        )}
        {quick(
          'archived',
          <Archive className="size-4 shrink-0" />,
          t('entry.nav.archived'),
          !!search.archived,
          { archived: '1' },
        )}
        {personal
          ? quick(
              'personal',
              <NotebookPen className="size-4 shrink-0" />,
              t('entry.nav.personal'),
              search.spaceId === personal.id,
              { spaceId: personal.id },
            )
          : null}
      </ul>
      <ul className="mt-3 flex flex-col gap-2 border-divider border-t pt-3">
        {sections.map(({ group, items }) => {
          const gid = group?.id ?? 'none'
          const open = !closedGroups.has(gid)
          const name = group?.name ?? t('entry.nav.ungrouped')
          return (
            <li key={gid} data-testid="entries-nav-group" data-group-id={gid}>
              <div className="flex items-center">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={t(open ? 'entry.nav.collapse' : 'entry.nav.expand', { name })}
                  onClick={() => setClosedGroups((s) => toggle(s, gid))}
                  className="grid size-6 shrink-0 place-items-center rounded text-fg-muted hover:bg-hover"
                >
                  <Disclosure open={open} />
                </button>
                <button
                  type="button"
                  className={cn(rowCls(search.groupId === gid), 'h-7 text-xs uppercase')}
                  aria-current={search.groupId === gid ? 'page' : undefined}
                  onClick={() => onSelect({ groupId: gid })}
                >
                  <Layers className="size-3.5 shrink-0" />
                  <span className="truncate">{name}</span>
                </button>
              </div>
              {open ? (
                <ul className="mt-0.5 flex flex-col gap-0.5">
                  {items.map((sp) => {
                    const spOpen = openSpaces.has(sp.id)
                    const active = search.spaceId === sp.id && !search.under
                    return (
                      <li key={sp.id} data-testid="entries-nav-space" data-space-id={sp.id}>
                        <div className="flex items-center pl-3">
                          <button
                            type="button"
                            aria-expanded={spOpen}
                            aria-label={t(spOpen ? 'entry.nav.collapse' : 'entry.nav.expand', {
                              name: sp.name,
                            })}
                            onClick={() => setOpenSpaces((s) => toggle(s, sp.id))}
                            className="grid size-6 shrink-0 place-items-center rounded text-fg-muted hover:bg-hover"
                            data-testid="entries-nav-space-toggle"
                          >
                            <Disclosure open={spOpen} />
                          </button>
                          <button
                            type="button"
                            className={rowCls(active)}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => onSelect({ spaceId: sp.id })}
                          >
                            <SpaceIcon
                              icon={sp.icon}
                              kind={sp.kind}
                              color={sp.color}
                              className="size-5 shrink-0 text-xs"
                            />
                            <span className="truncate">{sp.name}</span>
                          </button>
                        </div>
                        {spOpen ? (
                          <SpaceTree
                            spaceId={sp.id}
                            under={search.spaceId === sp.id ? search.under : undefined}
                            onSelect={(under) => onSelect({ spaceId: sp.id, under })}
                            depth={1}
                          />
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** 某空间的目录树（懒加载）；选中节点 = 过滤该子树。节点展开状态本地保存在组件内。 */
function SpaceTree({
  spaceId,
  under,
  onSelect,
  depth,
}: {
  spaceId: string
  under: string | undefined
  onSelect: (under: string) => void
  depth: number
}) {
  const { t } = useTranslation()
  const tree = useQuery(treeQuery(spaceId))
  const nodes = tree.data ?? []
  // 默认全部收起，只展开当前所选节点的祖先链
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (!under || !tree.data) return
    const byId = new Map(tree.data.map((n) => [n.id, n]))
    const chain: string[] = []
    let cur = byId.get(under)?.parentId ?? null
    while (cur) {
      chain.push(cur)
      cur = byId.get(cur)?.parentId ?? null
    }
    if (chain.length) setOpen((s) => new Set([...s, ...chain]))
  }, [under, tree.data])
  const collapsed = useMemo(
    () => new Set(nodes.filter((n) => !open.has(n.id)).map((n) => n.id)),
    [nodes, open],
  )
  const flat = flatten(nodes, collapsed)
  if (tree.isPending) return null
  if (!flat.length)
    return (
      <p className="py-1 text-fg-faint text-xs" style={{ paddingLeft: `${depth * 12 + 38}px` }}>
        {t('entry.nav.treeEmpty')}
      </p>
    )
  return (
    <ul className="flex flex-col gap-0.5" data-testid="entries-nav-tree">
      {flat.map((n) => {
        const active = under === n.id
        const isOpen = open.has(n.id)
        const title = n.title || t('entry.untitled')
        return (
          <li
            key={n.id}
            className="flex items-center"
            style={{ paddingLeft: `${(depth + n.depth) * 12 + 12}px` }}
            data-testid="entries-nav-node"
            data-entry-id={n.id}
          >
            {n.hasChildren ? (
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={t(isOpen ? 'entry.nav.collapse' : 'entry.nav.expand', { name: title })}
                onClick={() =>
                  setOpen((s) => {
                    const x = new Set(s)
                    if (x.has(n.id)) x.delete(n.id)
                    else x.add(n.id)
                    return x
                  })
                }
                className="grid size-6 shrink-0 place-items-center rounded text-fg-muted hover:bg-hover"
              >
                <Disclosure open={isOpen} />
              </button>
            ) : (
              <span className="size-6 shrink-0" aria-hidden />
            )}
            <button
              type="button"
              className={cn(rowCls(active), 'h-7')}
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(n.id)}
            >
              <span className="truncate">{title}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
