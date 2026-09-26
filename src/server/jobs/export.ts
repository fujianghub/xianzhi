/**
 * 导出作业 `export.run`（02 §8、03 §8、REQ-EXPORT-001 · 002 · 007 · 008）。
 * - 内容一律按**发起人**的 visibleEntriesWhere / visibleTasksWhere 过滤，不因 admin 身份放宽（07 §2.4）；scope=workspace 仅 owner/admin。
 * - zip：`<space>/<kind 或自定义类型名>/<yyyy-mm-dd>-<slug>.md`（YAML frontmatter：id / title / kind / fields / tags / links …）、`assets/<id>.<ext>`、
 *   `<space>/tasks.json`、`cycles.json`、`README.md`（说明有损项）。scope=entry 且 format=md|html 时产出单文件。
 * - 失败重试 3 次指数退避（共 4 次尝试），仍失败 → audit export.failed 并抛出（作业状态 failed）。
 * - 成功：DATA_DIR/exports/<jobId>.<ext>，audit export.done，发 system.export_done（通知发起人）；gc.exports 7 天后清理。
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'
import { strToU8, zipSync } from 'fflate'
import { pmToHtmlDocument } from '../../shared/editor/serializers/html.ts'
import { frontmatter, pmToMarkdown } from '../../shared/editor/serializers/markdown.ts'
import type { PmNode } from '../../shared/schemas/pm.ts'
import { type Actor, can, visibleEntriesWhere, visibleTasksWhere } from '../authz.ts'
import type { Db } from '../db/index.ts'
import { user as userTable } from '../db/schema/auth.ts'
import {
  attachments,
  cycles,
  entries,
  entryTags,
  entryTypes,
  links,
  spaces,
  tags,
  tasks,
} from '../db/schema/business.ts'
import { dataPath } from '../lib/files.ts'
import { loadActor } from '../services/actors.ts'
import { audit } from '../services/audit.ts'
import { emit } from '../services/events.ts'
import type { JobDef } from './types.ts'

export interface ExportJobData {
  userId: string
  workspaceId: string
  scope: 'workspace' | 'space' | 'entry'
  id?: string
  format: 'zip' | 'md' | 'html'
}
export interface ExportResult {
  fileKey: string
  fileName: string
  sizeBytes: number
  mime: string
  entries: number
  tasks: number
}

export const EXPORT_TTL_DAYS = 7
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
}
const ATTACH_RE = /xz:attachment\/([0-9a-f-]{36})/gi
const ymd = (d: Date) => d.toISOString().slice(0, 10)
/** 文件名片段：保留中文，去掉路径与 Windows 非法字符，空白 → -。 */
export const fileSlug = (s: string) =>
  [...s]
    .filter((ch) => ch.charCodeAt(0) >= 32 && !'\\/:*?"<>|#%'.includes(ch))
    .join('')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'untitled'

class ExportDenied extends Error {}

/** 构建产物（纯函数式：给定发起人与范围，返回文件名 → 字节）。 */
export async function buildExport(db: Db, dataDir: string, actor: Actor, d: ExportJobData) {
  if (d.scope === 'workspace' && !can(actor, 'workspace.manage', null))
    throw new ExportDenied('scope=workspace 仅 owner/admin')
  const entryConds: SQL[] = [eq(entries.workspaceId, d.workspaceId), visibleEntriesWhere(actor)]
  const taskConds: SQL[] = [eq(tasks.workspaceId, d.workspaceId), visibleTasksWhere(actor)]
  if (d.scope === 'space' && d.id) {
    entryConds.push(eq(entries.spaceId, d.id))
    taskConds.push(eq(tasks.spaceId, d.id))
  }
  if (d.scope === 'entry' && d.id) entryConds.push(eq(entries.id, d.id))
  const es = await db
    .select({
      e: entries,
      typeName: entryTypes.name,
      slug: spaces.slug,
      author: userTable.name,
      authorDisplay: userTable.displayName,
    })
    .from(entries)
    .innerJoin(spaces, eq(spaces.id, entries.spaceId))
    .leftJoin(userTable, eq(userTable.id, entries.authorId))
    .leftJoin(entryTypes, eq(entryTypes.id, entries.typeId))
    .where(and(...entryConds))
    .orderBy(asc(entries.createdAt))
  const ids = es.map((r) => r.e.id)
  const tagRows = ids.length
    ? await db
        .select({ entryId: entryTags.entryId, name: tags.name })
        .from(entryTags)
        .innerJoin(tags, eq(tags.id, entryTags.tagId))
        .where(inArray(entryTags.entryId, ids))
    : []
  const linkRows = ids.length
    ? await db
        .select({
          fromId: links.fromId,
          toType: links.toType,
          toId: links.toId,
          url: links.externalUrl,
        })
        .from(links)
        .where(and(eq(links.fromType, 'entry'), inArray(links.fromId, ids)))
    : []
  // 正文里引用到的附件（这些附件跟随记录可读，发起人既然能读记录就能读附件）
  const attIds = new Set<string>()
  for (const r of es)
    for (const m of JSON.stringify(r.e.pmJson ?? {}).matchAll(ATTACH_RE))
      attIds.add((m[1] as string).toLowerCase())
  const atts = attIds.size
    ? await db
        .select()
        .from(attachments)
        .where(
          and(eq(attachments.workspaceId, d.workspaceId), inArray(attachments.id, [...attIds])),
        )
    : []
  const attExt = new Map(atts.map((a) => [a.id, EXT[a.mime] ?? 'bin']))

  // 单文件：scope=entry 且 md / html
  if (d.scope === 'entry' && d.format !== 'zip') {
    const r = es[0]
    if (!r) throw new ExportDenied('记录不存在或不可见')
    const doc = r.e.pmJson as PmNode | null
    if (d.format === 'html')
      return {
        single: {
          name: `${fileSlug(r.e.title)}.html`,
          mime: 'text/html; charset=utf-8',
          bytes: strToU8(pmToHtmlDocument(r.e.title, doc)),
        },
        entries: 1,
        tasks: 0,
      }
    const md =
      frontmatter({
        id: r.e.id,
        title: r.e.title,
        kind: r.e.kind,
        ...(r.typeName ? { type: r.typeName } : {}),
      }) + pmToMarkdown(doc)
    return {
      single: {
        name: `${fileSlug(r.e.title)}.md`,
        mime: 'text/markdown; charset=utf-8',
        bytes: strToU8(md),
      },
      entries: 1,
      tasks: 0,
    }
  }

  const files: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  for (const r of es) {
    // 自定义类型按类型名分目录（ADR-0016）
    const kindDir = r.typeName ? fileSlug(r.typeName) : r.e.kind
    const base = `${fileSlug(r.slug)}/${kindDir}/${ymd(r.e.createdAt)}-${fileSlug(r.e.title)}`
    let path = `${base}.md`
    for (let i = 2; used.has(path); i++) path = `${base}-${i}.md`
    used.add(path)
    const fm = frontmatter({
      id: r.e.id,
      title: r.e.title,
      kind: r.e.kind,
      ...(r.typeName ? { type: r.typeName } : {}),
      space: r.slug,
      visibility: r.e.visibility,
      author: r.authorDisplay || r.author || '',
      fields: r.e.fields ?? {},
      tags: tagRows.filter((t) => t.entryId === r.e.id).map((t) => t.name),
      links: linkRows
        .filter((l) => l.fromId === r.e.id)
        .map((l) => (l.toId ? `xz://${l.toType}/${l.toId}` : (l.url ?? ''))),
      pinned: r.e.pinned,
      createdAt: r.e.createdAt.toISOString(),
      updatedAt: r.e.updatedAt.toISOString(),
    })
    const body = pmToMarkdown(r.e.pmJson as PmNode | null, {
      resolveImage: (id) => `../../assets/${id}.${attExt.get(id) ?? 'bin'}`,
    })
    files[path] = strToU8(fm + body)
  }
  for (const a of atts) {
    const bytes = await readFile(dataPath(dataDir, a.storageKey)).catch(() => null)
    if (bytes) files[`assets/${a.id}.${attExt.get(a.id)}`] = new Uint8Array(bytes)
  }
  let taskCount = 0
  if (d.scope !== 'entry') {
    const ts = await db
      .select({ t: tasks, slug: spaces.slug })
      .from(tasks)
      .innerJoin(spaces, eq(spaces.id, tasks.spaceId))
      .where(and(...taskConds))
      .orderBy(asc(tasks.createdAt))
    taskCount = ts.length
    const bySpace = new Map<string, unknown[]>()
    for (const { t, slug } of ts) {
      const list = bySpace.get(slug) ?? []
      list.push({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt?.toISOString() ?? null,
        scheduledAt: t.scheduledAt?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
        assigneeId: t.assigneeId,
        creatorId: t.creatorId,
        parentId: t.parentId,
        cycleId: t.cycleId,
        description: t.descriptionPm ? pmToMarkdown(t.descriptionPm as PmNode) : null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })
      bySpace.set(slug, list)
    }
    for (const [slug, list] of bySpace)
      files[`${fileSlug(slug)}/tasks.json`] = strToU8(`${JSON.stringify(list, null, 2)}\n`)
  }
  if (d.scope === 'workspace') {
    // 周期只含发起人自己的（cycle.* 仅 owner 本人，01 §5）
    const cs = await db
      .select()
      .from(cycles)
      .where(and(eq(cycles.workspaceId, d.workspaceId), eq(cycles.ownerId, actor.id)))
    files['cycles.json'] = strToU8(`${JSON.stringify(cs, null, 2)}\n`)
  }
  files['README.md'] = strToU8(
    '# 衔枝导出\n\n本导出为**有损**转换（03 §8）：评论标记已丢弃；callout 写成 `:::kind`；mermaid / 公式写成代码块；记录间链接写成 `xz://entry/<id>`；图片在 `assets/`。\n',
  )
  return { zip: zipSync(files, { level: 6 }), entries: es.length, tasks: taskCount }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 执行导出（带重试）。`attempt` 注入便于单测（REQ-EXPORT-007）。 */
export async function runExport(
  deps: { db: Db; dataDir: string; backoffMs?: number; build?: typeof buildExport },
  d: ExportJobData,
  jobId: string,
): Promise<ExportResult> {
  const build = deps.build ?? buildExport
  const backoff = deps.backoffMs ?? 1000
  let lastErr: unknown
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const a = await loadActor(deps.db, d.userId)
      if (!a || a.actor.suspended || a.workspaceId !== d.workspaceId)
        throw new ExportDenied('发起人已不在工作区')
      const out = await build(deps.db, deps.dataDir, a.actor, d)
      const ext =
        'single' in out && out.single ? (out.single.name.split('.').pop() as string) : 'zip'
      const bytes =
        'single' in out && out.single ? out.single.bytes : (out as { zip: Uint8Array }).zip
      const fileKey = `exports/${jobId}.${ext}`
      const path = dataPath(deps.dataDir, fileKey)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
      const size = (await stat(path)).size
      const scopeName =
        d.scope === 'workspace' ? 'workspace' : `${d.scope}-${(d.id ?? '').slice(0, 8)}`
      const fileName =
        'single' in out && out.single
          ? out.single.name
          : `xz-export-${scopeName}-${ymd(new Date())}.zip`
      const mime = 'single' in out && out.single ? out.single.mime : 'application/zip'
      const expiresAt = new Date(Date.now() + EXPORT_TTL_DAYS * 86_400_000).toISOString()
      await deps.db.transaction(async (tx) => {
        await audit(tx, {
          workspaceId: d.workspaceId,
          actorId: d.userId,
          action: 'export.done',
          targetType: 'job',
          targetId: jobId,
          meta: { scope: d.scope, id: d.id ?? null, format: d.format, sizeBytes: size },
        })
        await emit(tx, {
          kind: 'system.export_done',
          workspaceId: d.workspaceId,
          actorId: null,
          targetType: 'job',
          targetId: null,
          visibilityScope: { userIds: [d.userId] },
          payload: {
            jobId,
            scope: d.scope,
            format: d.format,
            fileName,
            sizeBytes: size,
            expiresAt,
          },
        })
      })
      return { fileKey, fileName, sizeBytes: size, mime, entries: out.entries, tasks: out.tasks }
    } catch (err) {
      lastErr = err
      if (err instanceof ExportDenied) break // 权限类错误不重试
      if (attempt < 4) await sleep(backoff * 2 ** (attempt - 1))
    }
  }
  await audit(deps.db, {
    workspaceId: d.workspaceId,
    actorId: d.userId,
    action: 'export.failed',
    targetType: 'job',
    targetId: jobId,
    meta: {
      scope: d.scope,
      id: d.id ?? null,
      error: String(lastErr instanceof Error ? lastErr.message : lastErr).slice(0, 300),
    },
  })
  throw lastErr
}

export const EXPORT_JOBS: JobDef[] = [
  {
    name: 'export.run',
    policy: 'standard',
    retryLimit: 0, // 重试在处理函数内完成（REQ-EXPORT-007）
    handler: (ctx, data, jobId) =>
      runExport({ db: ctx.db, dataDir: ctx.dataDir }, data as unknown as ExportJobData, jobId),
  },
]
