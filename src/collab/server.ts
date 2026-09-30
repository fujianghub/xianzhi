/**
 * Hocuspocus 协同服务（T0-014；03 §4、07 §2.3、REQ-COLLAB-002 · 003 · 006 · 009 · 014 · 015）。
 * 文档名 `entry:<uuid>`；Y.Doc gc:false（CLAUDE.md 不变量 7）；ydoc 为正文唯一真源，派生列由 writeEntryDerived 同事务生成。
 *
 * 关闭码（03 §4.2）：Hocuspocus 4 在一条 socket 上多路复用文档，服务端关单个文档时客户端只收到 reason，
 * 因此统一编码为 reason = "<码>:<原因>"（如 "4403:revoked"）；鉴权失败同样放在 permission-denied 的 reason 里。
 */
import { fileURLToPath } from 'node:url'
import { type Connection, Server } from '@hocuspocus/server'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import * as Y from 'yjs'
import { type Actor, can } from '../server/authz.ts'
import type { Db, DbOrTx } from '../server/db/index.ts'
import { builtinTemplateOverrides, entries, events, spaces } from '../server/db/schema/business.ts'
import { JtiCache, verifyCollabToken } from '../server/lib/collab-token.ts'
import type { BusEvents, EventBus } from '../server/lib/event-bus.ts'
import { loadActor } from '../server/services/actors.ts'
import { writeEntryDerived } from '../server/services/derived.ts'
import { loadEntry } from '../server/services/entries.ts'
import { emit } from '../server/services/events.ts'
import { fillTemplateVars, KIND_DEFAULT_TEMPLATE } from '../shared/editor/builtin-templates.ts'
import { entryTemplate } from '../shared/editor/templates.ts'
import type { EntryKind } from '../shared/schemas/enums.ts'
import type { PmNode } from '../shared/schemas/pm.ts'
import {
  SAVE_VERSION_MAX_BYTES,
  SAVE_VERSION_REPLY,
  SAVE_VERSION_THROTTLE_MS,
  type SaveVersionResult,
  saveVersionRequestSchema,
} from '../shared/schemas/versions.ts'
import { EDITOR_SCHEMA_VERSION, YDOC_FRAGMENT } from './derive.ts'
import { restoreFragment } from './history.ts'
import {
  getSnapshotRow,
  insertSnapshot,
  latestManualSnapshot,
  maybeAutoSnapshot,
  RESTORE_BEFORE_LABEL,
} from './snapshots.ts'
import { appendPmJson } from './ydoc-json.ts'

export const CLOSE = {
  unauthenticated: '4401',
  forbidden: '4403',
  conflict: '4409',
  tooLarge: '4413',
  tooMany: '4429',
} as const
const reason = (code: string, slug: string) => `${code}:${slug}`
const reject = (code: string, slug: string) => ({ reason: reason(code, slug) })

export const LIMITS = {
  maxConnectionsPerUser: 10, // 07 §5
  maxUpdateBytes: 2 * 1024 * 1024,
  maxDocBytes: 20 * 1024 * 1024,
  maxPmJsonBytes: 5 * 1024 * 1024,
  entryUpdatedMergeMs: 5 * 60 * 1000,
}

export interface CollabContext {
  userId: string
  entryId: string
  workspaceId: string
  name: string
  locale: string
}

export interface CollabDeps {
  db: Db
  bus: EventBus
  secret: string
  appUrl: string
  logger: Logger
  /** 测试注入：派生失败模拟（REQ-COLLAB-009） */
  derive?: (db: DbOrTx, id: string, ydoc: Uint8Array) => Promise<void>
  debounce?: number
  maxDebounce?: number
  /** 派生失败时入队 derive.retry（REQ-COLLAB-009）；进程入口注入只发不收的 pg-boss */
  enqueueRetry?: (entryId: string) => Promise<unknown>
}

const DOC_PREFIX = 'entry:'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const docNameOf = (entryId: string) => `${DOC_PREFIX}${entryId}`
function entryIdOf(documentName: string): string | null {
  if (!documentName.startsWith(DOC_PREFIX)) return null
  const id = documentName.slice(DOC_PREFIX.length)
  return UUID_RE.test(id) ? id : null
}

/** 模板注入用的 clientID：由记录 id 派生（FNV-1a 32 位），同一记录每次注入得到相同的 Yjs 条目 ID */
export function templateClientId(entryId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < entryId.length; i++) {
    h ^= entryId.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** 模板正文 → Yjs update（确定性：固定 clientID、从空文档开始，时钟从 0 起） */
export function templateUpdate(entryId: string, template: Parameters<typeof appendPmJson>[1]) {
  const seed = new Y.Doc({ gc: false }) // 不变量 7：与前后端一致
  seed.clientID = templateClientId(entryId)
  seed.transact(() => appendPmJson(seed.getXmlFragment(YDOC_FRAGMENT), template))
  const update = Y.encodeStateAsUpdate(seed)
  seed.destroy()
  return update
}

export function createCollabServer(deps: CollabDeps) {
  const jti = new JtiCache()
  const appOrigin = new URL(deps.appUrl).origin
  const byUser = new Map<string, Set<Connection<CollabContext>>>()
  const docSize = new Map<string, number>()
  const derive = deps.derive ?? writeEntryDerived
  const log = deps.logger

  async function resolve(
    userId: string,
    entryId: string,
  ): Promise<{
    actor: Actor
    read: boolean
    write: boolean
    name: string
    locale: string
    workspaceId: string
  } | null> {
    const a = await loadActor(deps.db, userId)
    if (!a) return null
    const loaded = await loadEntry(deps.db, a.actor, entryId)
    if (!loaded)
      return {
        actor: a.actor,
        read: false,
        write: false,
        name: a.name,
        locale: a.locale,
        workspaceId: a.workspaceId,
      }
    return {
      actor: a.actor,
      read: can(a.actor, 'entry.read', loaded.ref),
      write: can(a.actor, 'entry.write', loaded.ref),
      name: a.name,
      locale: a.locale,
      workspaceId: a.workspaceId,
    }
  }

  /** 权限复核（07 §2.1 entry.access_changed）：失去读 → 4403，失去写 → readOnly。 */
  async function recheck(conn: Connection<CollabContext>): Promise<void> {
    const ctx = conn.context
    const r = await resolve(ctx.userId, ctx.entryId)
    if (!r?.read)
      conn.close({ code: 4403, reason: reason(CLOSE.forbidden, 'access-revoked') } as CloseEvent)
    else conn.readOnly = !r.write
  }

  const allConnections = () => [...byUser.values()].flatMap((s) => [...s])

  const offRevoked = deps.bus.subscribe('user.revoked', ({ userId }) => {
    for (const conn of [...(byUser.get(userId) ?? [])])
      conn.close({ code: 4403, reason: reason(CLOSE.forbidden, 'revoked') } as CloseEvent)
  })
  const offAccess = deps.bus.subscribe('entry.access_changed', ({ entryIds, spaceId, userIds }) => {
    const targets = allConnections().filter(
      (c) =>
        (!entryIds && !userIds && !spaceId) ||
        entryIds?.includes(c.context.entryId) ||
        userIds?.includes(c.context.userId) ||
        !!spaceId,
    )
    for (const c of targets) recheck(c).catch((err) => log.error({ err }, 'collab recheck failed'))
  })

  /**
   * 恢复历史版本（REQ-COLLAB-008）：API 已鉴权并审计；此处以直连打开在线文档（无人在线时即加载），
   * 先按当前在线状态打「恢复前」快照，再把快照状态作为一次修改写回；disconnect 立即落库（带操作者上下文）。
   */
  async function restoreSnapshot(p: BusEvents['entry.restore']): Promise<void> {
    const snap = await getSnapshotRow(deps.db, p.entryId, p.snapshotId)
    const a = await loadActor(deps.db, p.actorId)
    if (!snap || !a) return
    const conn = await server.hocuspocus.openDirectConnection(docNameOf(p.entryId), {
      userId: a.actor.id,
      entryId: p.entryId,
      workspaceId: a.workspaceId,
      name: a.name,
      locale: a.locale,
    })
    try {
      const doc = conn.document
      if (!doc) return
      const [row] = await deps.db
        .select({ v: entries.ydocVersion })
        .from(entries)
        .where(eq(entries.id, p.entryId))
      if (!row) return
      await insertSnapshot(deps.db, p.entryId, Y.encodeStateAsUpdate(doc), row.v, {
        label: RESTORE_BEFORE_LABEL,
        createdBy: a.actor.id,
      })
      let stats: ReturnType<typeof restoreFragment> | undefined
      await conn.transact((d) => {
        stats = restoreFragment(d, snap.snapshot)
      })
      log.info({ entryId: p.entryId, snapshotId: p.snapshotId, ...stats }, 'snapshot restored')
    } finally {
      await conn.disconnect()
    }
  }
  const offRestore = deps.bus.subscribe('entry.restore', (p) => {
    restoreSnapshot(p).catch((err) => log.error({ err, ...p }, 'snapshot restore failed'))
  })

  /**
   * 落库 + 派生；`saveVersion` 时在同一事务里用同一份字节打手动快照（ADR-0026：快照 ydocVersion = 落库版本，
   * 预览读到的就是这份 ydoc），并跳过自动快照。调用方须持有 document.saveMutex（与 Hocuspocus 防抖落库串行）。
   */
  /**
   * 默认骨架取内置模板的类型（优化 / 学习计划，ADR-0011 §3）：所有者改过该内置模板的正文则用改后的（ADR-0038）；
   * 删除内置模板不影响默认骨架（骨架是类型的，不是模板的）。
   */
  async function kindSkeletonOverride(workspaceId: string, kind: string) {
    const id = KIND_DEFAULT_TEMPLATE[kind as EntryKind]
    if (!id) return null
    const [o] = await deps.db
      .select({ body: builtinTemplateOverrides.body })
      .from(builtinTemplateOverrides)
      .where(
        and(
          eq(builtinTemplateOverrides.workspaceId, workspaceId),
          eq(builtinTemplateOverrides.key, id.slice('builtin:'.length)),
        ),
      )
    if (!o?.body) return null
    return fillTemplateVars(o.body as PmNode, { date: new Date().toISOString().slice(0, 10) })
  }

  async function storeDocument(
    documentName: string,
    document: Y.Doc,
    ctx: Partial<CollabContext> | undefined,
    opts: { saveVersion?: { createdBy: string } } = {},
  ): Promise<{ snapshotId: string; createdAt: Date } | null> {
    const entryId = entryIdOf(documentName)
    if (!entryId) return null
    const bytes = Buffer.from(Y.encodeStateAsUpdate(document))
    docSize.set(documentName, bytes.length)
    let failedDerive = false
    let saved: { snapshotId: string; createdAt: Date } | null = null
    await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .update(entries)
        .set({ ydoc: bytes, ydocVersion: sql`${entries.ydocVersion} + 1` })
        .where(eq(entries.id, entryId))
        .returning({
          version: entries.ydocVersion,
          title: entries.title,
          kind: entries.kind,
          spaceId: entries.spaceId,
          workspaceId: entries.workspaceId,
          plain: entries.plain,
        })
      if (!row) return
      // 派生失败不阻塞 ydoc 落库（03 §4.2、REQ-COLLAB-009）：savepoint 内执行，失败写 derived_error
      try {
        await tx.transaction(async (sp) => {
          await derive(sp, entryId, bytes)
          const [chk] = await sp
            .select({ n: sql<number>`octet_length(${entries.pmJson}::text)` })
            .from(entries)
            .where(eq(entries.id, entryId))
          if ((chk?.n ?? 0) > LIMITS.maxPmJsonBytes)
            throw new Error(`pm_json 超过 ${LIMITS.maxPmJsonBytes} 字节`)
        })
      } catch (err) {
        log.warn({ err, entryId }, 'derive failed')
        // derived_at 只记最后一次成功（01 §3.4）；失败只写 derived_error，提交后入队 derive.retry
        await tx
          .update(entries)
          .set({ derivedError: String(err instanceof Error ? err.message : err).slice(0, 500) })
          .where(eq(entries.id, entryId))
        failedDerive = true
      }
      if (ctx?.userId) await recordEntryUpdated(tx, entryId, ctx.userId, ctx.name ?? '', row)
      if (opts.saveVersion) {
        const s = await insertSnapshot(tx, entryId, bytes, row.version, {
          createdBy: opts.saveVersion.createdBy,
        })
        saved = { snapshotId: s.id, createdAt: s.createdAt }
      } else await maybeAutoSnapshot(tx, entryId, bytes, row.version)
    })
    if (failedDerive)
      await deps
        .enqueueRetry?.(entryId)
        .catch((err) => log.error({ err, entryId }, 'enqueue derive.retry failed'))
    return saved
  }

  /** 保存版本节流：`userId:entryId` → 上次成功时间。 */
  const lastSave = new Map<string, number>()

  /**
   * 保存版本（ADR-0026、REQ-COLLAB-017）：stateless 请求。只回执、绝不抛出（Hocuspocus 不 await 本钩子，抛错会让进程退出）。
   * 校验体积 / 格式 → 只读连接拒绝 → 重跑 can('entry.write') → 5s 节流 → 与上一个手动 / 带标记快照完全相同（状态向量 +
   * 删除集，equalSnapshots）则回 unchanged → 否则在 saveMutex 内落库并同事务打快照。
   */
  async function saveVersion(
    connection: Connection,
    documentName: string,
    document: Y.Doc & { saveMutex?: { runExclusive: <T>(f: () => Promise<T>) => Promise<T> } },
    payload: string,
  ): Promise<void> {
    let id = ''
    const reply = (r: SaveVersionResult) =>
      connection.sendStateless(JSON.stringify({ t: SAVE_VERSION_REPLY, id, ...r }))
    try {
      if (payload.length > SAVE_VERSION_MAX_BYTES) return reply({ ok: false, reason: 'invalid' })
      let parsed: unknown
      try {
        parsed = JSON.parse(payload)
      } catch {
        return // 不是保存版本请求（其它 stateless 用途）：忽略
      }
      if ((parsed as { t?: unknown })?.t !== 'save-version') return
      const req = saveVersionRequestSchema.safeParse(parsed)
      if (!req.success) return reply({ ok: false, reason: 'invalid' })
      id = req.data.id
      const ctx = connection.context as CollabContext
      const entryId = entryIdOf(documentName)
      if (!entryId || connection.readOnly) return reply({ ok: false, reason: 'readonly' })
      const r = await resolve(ctx.userId, entryId)
      if (!r?.write) return reply({ ok: false, reason: 'readonly' })
      const key = `${ctx.userId}:${entryId}`
      if (Date.now() - (lastSave.get(key) ?? 0) < SAVE_VERSION_THROTTLE_MS)
        return reply({ ok: false, reason: 'throttled' })
      const last = await latestManualSnapshot(deps.db, entryId)
      if (last && Y.equalSnapshots(Y.decodeSnapshot(last.snapshot), Y.snapshot(document)))
        return reply({ ok: false, reason: 'unchanged' })
      const run = () =>
        storeDocument(documentName, document, ctx, { saveVersion: { createdBy: ctx.userId } })
      const saved = document.saveMutex ? await document.saveMutex.runExclusive(run) : await run()
      if (!saved) return reply({ ok: false, reason: 'error' })
      lastSave.set(key, Date.now())
      log.info({ entryId, snapshotId: saved.snapshotId }, 'version saved')
      return reply({
        ok: true,
        snapshotId: saved.snapshotId,
        createdAt: saved.createdAt.toISOString(),
      })
    } catch (err) {
      log.error({ err, documentName }, 'save version failed')
      try {
        reply({ ok: false, reason: 'error' })
      } catch {
        /* 连接已断 */
      }
    }
  }

  /** entry.updated 5 分钟合并（01 §4.1）：同 entry 同 actor 未处理的行则 UPDATE payload。 */
  async function recordEntryUpdated(
    tx: DbOrTx,
    entryId: string,
    actorId: string,
    actorName: string,
    row: { version: number; title: string; kind: string; spaceId: string; workspaceId: string },
  ): Promise<void> {
    const [cur] = await tx
      .select({ plain: entries.plain, wordCount: entries.wordCount, slug: spaces.slug })
      .from(entries)
      .innerJoin(spaces, eq(spaces.id, entries.spaceId))
      .where(eq(entries.id, entryId))
    const payload = {
      entryId,
      title: row.title,
      kind: row.kind,
      actorId,
      actorName,
      spaceSlug: cur?.slug ?? '',
      ydocVersion: row.version,
      wordCount: cur?.wordCount ?? 0,
      summary: (cur?.plain ?? '').slice(0, 120),
    }
    const merged = await tx
      .update(events)
      .set({ payload, createdAt: new Date() })
      .where(
        and(
          eq(events.kind, 'entry.updated'),
          eq(events.targetId, entryId),
          eq(events.actorId, actorId),
          isNull(events.processedAt),
          gt(events.createdAt, new Date(Date.now() - LIMITS.entryUpdatedMergeMs)),
        ),
      )
      .returning({ id: events.id })
    if (merged.length) return
    await emit(tx, {
      kind: 'entry.updated',
      workspaceId: row.workspaceId,
      actorId,
      targetType: 'entry',
      targetId: entryId,
      visibilityScope: { spaceId: row.spaceId },
      payload,
    })
  }

  const server = new Server<CollabContext>({
    name: 'xz-collab',
    quiet: true,
    debounce: deps.debounce ?? 2000,
    maxDebounce: deps.maxDebounce ?? 10_000,
    yDocOptions: { gc: false, gcFilter: () => false },

    async onRequest({ request, response }) {
      if (request.url?.split('?')[0]?.endsWith('/health')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ ok: true }))
        throw null // 截断默认响应
      }
    },

    async onAuthenticate({ token, documentName, requestHeaders, connectionConfig }) {
      const origin = requestHeaders.get('origin')
      if (origin !== appOrigin) throw reject(CLOSE.forbidden, 'origin')
      const entryId = entryIdOf(documentName)
      if (!entryId) throw reject(CLOSE.conflict, 'document-name')
      if (!token) throw reject(CLOSE.unauthenticated, 'no-token')
      const v = verifyCollabToken(deps.secret, token)
      if (!v.ok) throw reject(CLOSE.unauthenticated, v.reason)
      if (v.payload.entryId !== entryId) throw reject(CLOSE.conflict, 'entry-mismatch')
      if (!jti.use(v.payload.jti, v.payload.exp)) throw reject(CLOSE.conflict, 'replay')
      const r = await resolve(v.payload.userId, entryId)
      if (!r || r.actor.suspended || !r.read) throw reject(CLOSE.forbidden, 'forbidden')
      if ((byUser.get(r.actor.id)?.size ?? 0) >= LIMITS.maxConnectionsPerUser)
        throw reject(CLOSE.tooMany, 'too-many-connections')
      connectionConfig.readOnly = !r.write
      return {
        userId: r.actor.id,
        entryId,
        workspaceId: r.workspaceId,
        name: r.name,
        locale: r.locale,
      } satisfies CollabContext
    },

    async connected({ connection }) {
      const uid = connection.context.userId
      let set = byUser.get(uid)
      if (!set) {
        set = new Set()
        byUser.set(uid, set)
      }
      set.add(connection)
      connection.onClose(() => {
        set?.delete(connection)
        if (set?.size === 0) byUser.delete(uid)
      })
    },

    async onLoadDocument({ document, documentName, context }) {
      const entryId = entryIdOf(documentName)
      if (!entryId) throw reject(CLOSE.conflict, 'document-name')
      const [row] = await deps.db
        .select({
          ydoc: entries.ydoc,
          version: entries.ydocVersion,
          kind: entries.kind,
          schema: entries.editorSchemaVersion,
          workspaceId: entries.workspaceId,
        })
        .from(entries)
        .where(eq(entries.id, entryId))
      if (!row) throw reject(CLOSE.forbidden, 'not-found')
      if (row.ydoc.length) Y.applyUpdate(document, row.ydoc)
      docSize.set(documentName, row.ydoc.length)
      const frag = document.getXmlFragment(YDOC_FRAGMENT)
      // 模板：仅在从未落库过的空文档注入（03 §6）。注入是确定性的（固定 clientID 的临时文档 → 同一批条目 ID），
      // 从未落库就离开再打开时服务端会再注入一次，与客户端本地缓存（y-indexeddb）里上次的注入合并后按 ID 去重，
      // 不会出现两份骨架（debug/2026-09-30-template-double-inject）
      if (frag.length === 0 && row.version === 0)
        Y.applyUpdate(
          document,
          templateUpdate(
            entryId,
            (await kindSkeletonOverride(row.workspaceId, row.kind)) ??
              entryTemplate(row.kind as EntryKind, context?.locale),
          ),
        )
      // schema 迁移（03 §3.3）：当前无迁移脚本，只 bump 版本
      if (row.schema < EDITOR_SCHEMA_VERSION) {
        await deps.db
          .update(entries)
          .set({ editorSchemaVersion: EDITOR_SCHEMA_VERSION })
          .where(eq(entries.id, entryId))
      }
      return document
    },

    async beforeHandleMessage({ update, documentName }) {
      if (update.byteLength > LIMITS.maxUpdateBytes)
        throw { code: 4413, reason: reason(CLOSE.tooLarge, 'update-too-large') }
      if ((docSize.get(documentName) ?? 0) + update.byteLength > LIMITS.maxDocBytes)
        throw { code: 4413, reason: reason(CLOSE.tooLarge, 'document-too-large') }
    },

    async onStoreDocument({ documentName, document, lastContext }) {
      await storeDocument(documentName, document, lastContext)
    },

    async onStateless({ connection, documentName, document, payload }) {
      await saveVersion(connection, documentName, document as never, payload)
    },

    async afterUnloadDocument({ documentName }) {
      docSize.delete(documentName)
    },
  })

  return {
    server,
    connectionsOf: (userId: string) => byUser.get(userId)?.size ?? 0,
    totalConnections: () => allConnections().length,
    async destroy() {
      offRevoked()
      offAccess()
      offRestore()
      await server.destroy()
    },
  }
}

// ---------- 进程入口：`tsx watch src/collab/server.ts` / `node dist/collab/server.js` ----------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const { getEnv, EnvError } = await import('../server/env.ts')
  try {
    const env = getEnv()
    const { getDb } = await import('../server/db/index.ts')
    const { getLogger } = await import('../server/lib/logger.ts')
    const { getEventBus } = await import('../server/lib/event-bus.ts')
    const { listenPg } = await import('../server/lib/bus-pg.ts')
    const logger = getLogger().child({ svc: 'collab' })
    const bus = getEventBus()
    await listenPg(bus, env.DATABASE_URL, (err) => logger.error({ err }, 'bus listen error'))
    // 只发不收的 pg-boss：派生失败即入队 derive.retry（worker 在 xz-app 进程）
    const { PgBoss } = await import('pg-boss')
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: 'pgboss',
      schedule: false,
      supervise: false,
    })
    boss.on('error', (err) => logger.error({ err }, 'pg-boss error'))
    await boss.start()
    const collab = createCollabServer({
      db: getDb(),
      bus,
      secret: env.COLLAB_TOKEN_SECRET,
      appUrl: env.APP_URL,
      logger,
      enqueueRetry: (entryId) =>
        boss.send('derive.retry', { entryId }, { singletonKey: `derive:${entryId}` }),
    })
    await collab.server.listen(env.COLLAB_PORT)
    logger.info({ port: env.COLLAB_PORT }, 'collab listening')
    const shutdown = async () => {
      await collab.destroy()
      process.exit(0)
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
  } catch (err) {
    console.error(err instanceof EnvError ? err.message : err)
    process.exit(1)
  }
}
