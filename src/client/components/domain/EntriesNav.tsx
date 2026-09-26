/**
 * 记录页左栏（ADR-0014、REQ-ENTRY-012）：全部 · 最近打开 · 收藏 · 已归档 · 个人随笔，
 * 再按 大类 → 空间 → 目录树 逐级展开（目录树展开时才请求 `GET /spaces/:id/tree`）。
 * 选中项写入 URL（spaceId / under / groupId / favorite / recent / archived，互斥）。
 * 空间页签内（`fixedSpace`）只显示本空间的「全部」与目录树。
 */
import { useQuery } from '@tanstack/react-query'
import { Archive, Clock, FileText, Layers, type LucideIcon, NotebookPen, Star } from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn.ts'
import { groupSpaces, type Space, spaceGroupsQuery, spacesQuery } from '../../lib/space-queries.ts'
import { Disclosure } from '../ui/disclosure.tsx'
import { TreeGuides } from '../ui/tree-guides.tsx'
import { DirTree, navRowCls, TWISTY_CENTER } from './DirTree.tsx'
import type { EntriesSearch } from './EntriesPage.tsx'
import { IconChip } from './KindIcon.tsx'
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

const rowCls = (active: boolean) => cn(navRowCls(active), 'group h-8')
/** 位置导航层级缩进（大类 → 空间 → 目录），与展开指示中心对齐画引导线 */
const INDENT = 12
/** 快捷项专属色（沿用侧栏 --xz-icon-*，REQ-UI-037） */
const QUICK_HUE: Record<string, string> = {
  all: 'blue',
  recent: 'cyan',
  favorite: 'amber',
  archived: 'violet',
  personal: 'emerald',
}
function HueIcon({ icon: Icon, hue }: { icon: LucideIcon; hue: string }) {
  return (
    <span
      className="xz-hue inline-grid shrink-0 place-items-center"
      style={{ '--xz-ico': `var(--xz-icon-${hue})` } as CSSProperties}
      aria-hidden
    >
      <Icon className="size-4" strokeWidth={2} />
    </span>
  )
}

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
    icon: LucideIcon,
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
        <HueIcon icon={icon} hue={QUICK_HUE[key] ?? 'blue'} />
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
            FileText,
            t('entry.nav.all'),
            !search.under && !search.favorite && !search.archived,
            {},
          )}
          {quick('archived', Archive, t('entry.nav.archived'), !!search.archived, {
            archived: '1',
          })}
        </ul>
        <div className="mt-3 border-divider border-t pt-3">
          <DirTree
            spaceId={fixedSpace.id}
            level={0}
            indent={INDENT}
            active={search.under}
            onSelect={(under) => onSelect({ under })}
          />
        </div>
      </nav>
    )

  return (
    <nav aria-label={t('entry.nav.label')} data-testid="entries-nav">
      <ul className="flex flex-col gap-0.5">
        {quick('all', FileText, t('entry.nav.all'), noLoc, {})}
        {quick('recent', Clock, t('entry.nav.recent'), !!search.recent, { recent: '1' })}
        {quick('favorite', Star, t('entry.nav.favorite'), !!search.favorite, { favorite: '1' })}
        {quick('archived', Archive, t('entry.nav.archived'), !!search.archived, { archived: '1' })}
        {personal
          ? quick(
              'personal',
              NotebookPen,
              t('entry.nav.personal'),
              search.spaceId === personal.id,
              { spaceId: personal.id },
            )
          : null}
      </ul>
      <ul className="mt-3 flex flex-col gap-1.5 border-divider border-t pt-3">
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
                  className="xz-twisty size-6"
                >
                  <Disclosure open={open} />
                </button>
                <button
                  type="button"
                  className={cn(rowCls(search.groupId === gid), 'xz-tree-l0 h-8 text-fg')}
                  aria-current={search.groupId === gid ? 'page' : undefined}
                  onClick={() => onSelect({ groupId: gid })}
                >
                  <IconChip icon={Layers} tone={group?.color ?? 'gray'} size="sm" />
                  <span className="truncate">{name}</span>
                  <span className="xz-tree-count ms-auto" aria-hidden>
                    {items.length}
                  </span>
                </button>
              </div>
              {open ? (
                <ul className="flex flex-col">
                  {items.map((sp) => {
                    const spOpen = openSpaces.has(sp.id)
                    const active = search.spaceId === sp.id && !search.under
                    return (
                      <li
                        key={sp.id}
                        className="relative"
                        data-testid="entries-nav-space"
                        data-space-id={sp.id}
                      >
                        <TreeGuides depth={1} x0={TWISTY_CENTER} indent={INDENT} active={active} />
                        <div
                          className="flex items-center py-px"
                          style={{ paddingInlineStart: INDENT }}
                        >
                          <button
                            type="button"
                            aria-expanded={spOpen}
                            aria-label={t(spOpen ? 'entry.nav.collapse' : 'entry.nav.expand', {
                              name: sp.name,
                            })}
                            onClick={() => setOpenSpaces((s) => toggle(s, sp.id))}
                            className="xz-twisty size-6"
                            data-testid="entries-nav-space-toggle"
                          >
                            <Disclosure open={spOpen} />
                          </button>
                          <button
                            type="button"
                            className={cn(rowCls(active), 'xz-tree-l1')}
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
                          <DirTree
                            spaceId={sp.id}
                            level={2}
                            indent={INDENT}
                            active={search.spaceId === sp.id ? search.under : undefined}
                            onSelect={(under) => onSelect({ spaceId: sp.id, under })}
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
