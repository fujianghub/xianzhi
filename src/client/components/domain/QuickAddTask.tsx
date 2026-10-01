/**
 * 快速添加（ADR-0043 → ADR-0044、REQ-TASK-026 · 032 · 033）。
 * - 一行输入，回车即建；识别 日期 / `!优先级` / `#标签` / `~清单或空间`，框下胶囊预览、× 取消识别。
 * - 框内右侧按钮：日期 · 优先级 · 清单 · 标签；按钮选择优先于文字识别，按钮上显示当前生效值。
 * - 展开（Shift+Enter 或「展开」）：多行备注 + 子任务，Ctrl/⌘+Enter 提交；建好父任务后逐条建子任务。
 * - 形态：full（任务页等页顶）· compact（组内就地添加：无按钮，带组的预设）· dialog（全局 `c`：建完关闭，Toast 可「打开」）。
 * 默认值：页面登记的 `useNewTask` 默认 < 组预设 < 文字识别 < 按钮选择。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  ChevronsUpDown,
  Flag,
  Folder,
  Hash,
  ListTodo,
  Maximize2,
  Plus,
  Tag as TagIcon,
  X,
} from 'lucide-react'
import { type KeyboardEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { parseQuickAdd, type QuickToken, quickDueIso } from '../../../shared/quick-add.ts'
import { localDateOf } from '../../../shared/tz.ts'
import { useMe } from '../../hooks/useMe.ts'
import { useSpaces } from '../../hooks/useSpaces.ts'
import { useTaskActions } from '../../hooks/useTasks.ts'
import { ApiError, api, unwrap } from '../../lib/api.ts'
import { cn } from '../../lib/cn.ts'
import { canCreateIn } from '../../lib/space-queries.ts'
import { useNewTask } from '../../lib/stores.ts'
import { flatLists, taskListsQuery } from '../../lib/task-list-queries.ts'
import type { Task } from '../../lib/task-queries.ts'
import { newId } from '../../lib/uuid.ts'
import { colorFor, type Tag, TagPicker, tagsQuery } from './TagPicker.tsx'
import {
  DuePicker,
  type DueValue,
  dueShort,
  ListDot,
  ListPicker,
  PickerButton,
  PriorityPicker,
} from './TaskPickers.tsx'

const ICON = { date: CalendarDays, priority: Flag, tag: Hash, list: ListTodo } as const

/** 组预设（组内就地添加 / 清单视图）：截止 ISO、清单 id */
export interface QuickAddPreset {
  dueAt?: string | null
  listId?: string | null
}

/** 纯文本备注 → lite 文档（每行一段） */
const noteDoc = (text: string) => ({
  type: 'doc',
  content: text
    .split('\n')
    .map((l) => l.trimEnd())
    .map((l) =>
      l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' },
    ),
})

export function QuickAddTask({
  className,
  variant = 'full',
  preset,
  onCreated,
  autoFocus,
  testId = 'quick-add',
}: {
  className?: string
  variant?: 'full' | 'compact' | 'dialog'
  preset?: QuickAddPreset
  /** 建好之后（dialog 用来关闭并 Toast） */
  onCreated?: (task: Task) => void
  autoFocus?: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const spaces = useSpaces()
  const tags = useQuery(tagsQuery)
  const lists = useQuery(taskListsQuery)
  const defaults = useNewTask((s) => s.defaults)
  const actions = useTaskActions()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [ignored, setIgnored] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // 按钮选择（undefined = 未手选，取识别 / 预设）
  const [due, setDue] = useState<DueValue | null | undefined>(undefined)
  const [priority, setPriority] = useState<number | undefined>(undefined)
  const [listId, setListId] = useState<string | null | undefined>(undefined)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [note, setNote] = useState('')
  const [subs, setSubs] = useState<string[]>([''])
  const tz = me?.timezone ?? 'Asia/Shanghai'
  // 今天（用户时区）：按时区记忆，避免每次渲染都换新对象让识别结果重算
  const today = useMemo(() => localDateOf(tz, new Date()), [tz])
  const parsed = useMemo(() => parseQuickAdd(text, today, ignored), [text, today, ignored])
  const buttons = variant !== 'compact'

  // ~名：先本人清单，再可写空间（全名优先，其次唯一前缀）
  const myLists = flatLists(lists.data?.items ?? [])
  const writable = (spaces.data ?? []).filter((s) => !s.archivedAt && canCreateIn(s))
  const byName = <T extends { name: string }>(items: T[], name: string): T | undefined => {
    const exact = items.find((x) => x.name === name)
    if (exact) return exact
    const hits = items.filter((x) => x.name.startsWith(name))
    return hits.length === 1 ? hits[0] : undefined
  }
  const tildeList = parsed.list ? byName(myLists, parsed.list) : undefined
  const tildeSpace = parsed.list && !tildeList ? byName(writable, parsed.list) : undefined

  // 生效值
  const effListId = listId !== undefined ? listId : (tildeList?.id ?? preset?.listId ?? null)
  const effList = myLists.find((l) => l.id === effListId)
  const effPriority = priority ?? parsed.priority ?? 0
  const effDue: DueValue | null = due !== undefined ? due : (parsed.due ?? null)
  const dueIso = effDue
    ? quickDueIso(effDue, tz)
    : due === null
      ? null
      : (preset?.dueAt ?? defaults.dueAt ?? null)
  const pickedTags = (tags.data ?? []).filter((x) => tagIds.includes(x.id))

  const tokenLabel = (tok: QuickToken): string => {
    if (tok.kind === 'date' && parsed.due) return dueShort(parsed.due, today, t)
    if (tok.kind === 'priority' && parsed.priority) return t(`task.priority.${parsed.priority}`)
    if (tok.kind === 'list')
      return tildeList?.name ?? tildeSpace?.name ?? t('quickAdd.noList', { name: parsed.list })
    return tok.text.slice(1)
  }

  const ensureTags = async (names: string[]): Promise<string[]> => {
    const own = tags.data ?? []
    const ids: string[] = []
    for (const name of names) {
      const hit = own.find((x) => x.name === name)
      if (hit) {
        ids.push(hit.id)
        continue
      }
      if (!me || me.workspaceRole === 'guest') continue
      const tag = await unwrap<Tag>(
        api.tags.$post(
          { json: { name, color: colorFor(name) } },
          { headers: { 'idempotency-key': newId() } },
        ),
      )
      qc.setQueryData<Tag[]>(tagsQuery.queryKey, (old) => [...(old ?? []), tag])
      ids.push(tag.id)
    }
    return ids
  }

  const reset = () => {
    setText('')
    setIgnored([])
    setDue(undefined)
    setPriority(undefined)
    setListId(undefined)
    setTagIds([])
    setNote('')
    setSubs([''])
    setExpanded(false)
  }

  const submit = async () => {
    if (!parsed.title || busy) return
    setBusy(true)
    try {
      const fromText = parsed.tags.length ? await ensureTags(parsed.tags) : []
      const allTags = [...new Set([...tagIds, ...fromText])]
      const spaceId = tildeSpace?.id ?? defaults.spaceId
      const task = await actions.create({
        title: parsed.title,
        // 全局 `c` 在没有页面上下文时仍进收件箱（08 §2.4）；页内添加默认待办
        status: defaults.status ?? (variant === 'dialog' ? 'inbox' : 'todo'),
        ...(spaceId ? { spaceId } : {}),
        ...(dueIso ? { dueAt: dueIso } : {}),
        ...(effPriority ? { priority: effPriority } : {}),
        ...(allTags.length ? { tagIds: allTags } : {}),
        ...(effListId ? { listId: effListId } : {}),
        ...(defaults.parentId ? { parentId: defaults.parentId } : {}),
        ...(expanded && note.trim() ? { descriptionPm: noteDoc(note.trim()) } : {}),
      })
      if (expanded)
        for (const s of subs.map((x) => x.trim()).filter(Boolean))
          await actions.create({
            title: s,
            parentId: task.id,
            spaceId: task.spaceId,
            status: task.status,
          })
      reset()
      onCreated?.(task)
      if (variant !== 'dialog') inputRef.current?.focus()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('task.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (e.shiftKey && variant !== 'compact') setExpanded((x) => !x)
      else void submit()
    } else if (e.key === 'Escape' && (text || expanded)) {
      e.preventDefault()
      e.stopPropagation()
      reset()
    }
  }
  const onAreaKey = (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div
      className={cn('xz-qa', variant === 'compact' && 'xz-qa-compact', className)}
      data-testid={testId}
      data-variant={variant}
    >
      <div className={cn('xz-qa-box', expanded && 'xz-qa-box-open')}>
        <div className="flex min-h-10 items-center gap-2 px-3">
          <Plus className="size-4 shrink-0 text-fg-muted" aria-hidden />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              variant === 'compact' ? t('quickAdd.compactPlaceholder') : t('quickAdd.placeholder')
            }
            aria-label={t('quickAdd.label')}
            aria-busy={busy}
            // biome-ignore lint/a11y/noAutofocus: 对话框 / 组内添加打开即输入
            autoFocus={autoFocus}
            maxLength={500}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-faint"
            data-testid={variant === 'dialog' ? 'new-task-input' : 'quick-add-input'}
          />
          {buttons ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <DuePicker
                value={effDue}
                onChange={setDue}
                trigger={
                  <PickerButton
                    icon={CalendarDays}
                    label={t('quickAdd.due')}
                    value={effDue ? dueShort(effDue, today, t) : undefined}
                    active={!!effDue}
                    testId="qa-due"
                  />
                }
              />
              <PriorityPicker
                value={effPriority}
                onChange={setPriority}
                trigger={
                  <PickerButton
                    icon={Flag}
                    label={t('quickAdd.priority')}
                    active={effPriority > 0}
                    className="xz-prio-flag"
                    data-priority={effPriority}
                    testId="qa-priority"
                  />
                }
              />
              <ListPicker
                value={effListId}
                onChange={setListId}
                trigger={
                  <PickerButton
                    icon={effList ? ListTodo : Folder}
                    label={t('quickAdd.list')}
                    value={
                      effList ? (
                        <span className="inline-flex items-center gap-1">
                          <ListDot list={effList} />
                          {effList.name}
                        </span>
                      ) : undefined
                    }
                    active={!!effList}
                    testId="qa-list"
                  />
                }
              />
              <TagPicker
                value={pickedTags}
                onChange={setTagIds}
                trigger={
                  <PickerButton
                    icon={TagIcon}
                    label={t('quickAdd.tags')}
                    value={pickedTags.length ? String(pickedTags.length) : undefined}
                    active={pickedTags.length > 0}
                    testId="qa-tags"
                  />
                }
              />
              <PickerButton
                icon={expanded ? ChevronsUpDown : Maximize2}
                label={t(expanded ? 'quickAdd.collapse' : 'quickAdd.expand')}
                active={expanded}
                onClick={() => setExpanded((x) => !x)}
                testId="qa-expand"
              />
            </div>
          ) : null}
        </div>
        {expanded ? (
          <div className="xz-qa-more" data-testid="qa-more">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={onAreaKey}
              placeholder={t('quickAdd.notePlaceholder')}
              aria-label={t('quickAdd.note')}
              rows={2}
              maxLength={2000}
              className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-fg-faint"
              data-testid="qa-note"
            />
            <ul className="flex flex-col gap-1">
              {subs.map((s, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 草稿行无稳定 id
                <li key={i} className="flex items-center gap-2">
                  <span className="xz-task-check-ghost" aria-hidden />
                  <input
                    value={s}
                    onChange={(e) =>
                      setSubs((l) => l.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    onKeyDown={(e) => {
                      onAreaKey(e)
                      if (
                        e.key === 'Enter' &&
                        !e.metaKey &&
                        !e.ctrlKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault()
                        setSubs((l) => [...l.slice(0, i + 1), '', ...l.slice(i + 1)])
                      }
                      if (e.key === 'Backspace' && !s && subs.length > 1) {
                        e.preventDefault()
                        setSubs((l) => l.filter((_, j) => j !== i))
                      }
                    }}
                    placeholder={t('quickAdd.subtaskPlaceholder')}
                    aria-label={t('task.subtask')}
                    maxLength={200}
                    className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-faint"
                    data-testid="qa-subtask"
                  />
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between pt-1 text-fg-faint text-xs">
              <span>{t('quickAdd.submitHint')}</span>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!parsed.title || busy}
                className="xz-qa-submit"
                data-testid="qa-submit"
              >
                {t('quickAdd.submit')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {parsed.tokens.length ? (
        <ul className="flex flex-wrap items-center gap-1.5 ps-1 pt-1.5" aria-live="polite">
          {parsed.tokens.map((tok) => {
            const Icon = ICON[tok.kind]
            const miss = tok.kind === 'list' && !tildeList && !tildeSpace
            return (
              <li
                key={`${tok.kind}:${tok.start}`}
                className={cn('xz-qa-token', miss && 'xz-qa-token-miss')}
                data-testid="quick-add-token"
                data-kind={tok.kind}
              >
                <Icon className="size-3" aria-hidden />
                {tokenLabel(tok)}
                <button
                  type="button"
                  aria-label={t('quickAdd.ignore', { text: tok.text })}
                  onClick={() => setIgnored((l) => [...l, tok.text])}
                  className="grid size-4 place-items-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"
                >
                  <X className="size-3" />
                </button>
              </li>
            )
          })}
        </ul>
      ) : variant === 'full' ? (
        <p id="quick-add-hint" className="ps-1 pt-1.5 text-fg-faint text-xs">
          {t('quickAdd.hint')}
        </p>
      ) : null}
    </div>
  )
}
