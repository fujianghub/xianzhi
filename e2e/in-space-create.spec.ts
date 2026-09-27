/**
 * ADR-0018：大类就地管理（REQ-KB-008）· 新建对话框显示位置（REQ-ENTRY-021）· e 跟随上下文（REQ-ENTRY-022）·
 * 新建子页面（REQ-ENTRY-023）· 新建并关联（REQ-LINK-006）。
 * 共用 xz_e2e：每个用例自建空间 / 大类，结束时删掉自建的大类。
 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
async function mkSpace(req: APIRequestContext, groupId: string | null = null) {
  const slug = `isc-${stamp()}`
  const r = await req.post('/api/v1/spaces', {
    data: { name: `就地 ${slug}`, slug, kind: 'project', visibility: 'workspace', groupId },
    headers: sameSite,
  })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()) as { id: string; slug: string; name: string }
}
async function tree(req: APIRequestContext, spaceId: string) {
  const r = await req.get(`/api/v1/spaces/${spaceId}/tree`)
  const b = (await r.json()) as
    | { id: string; parentId: string | null; title: string }[]
    | { items: { id: string; parentId: string | null; title: string }[] }
  return Array.isArray(b) ? b : b.items
}
/** 提交新建后等跳到另一篇（在记录页上新建时 URL 本就匹配 /entries/<id>），返回新记录 id */
async function submitAndGetId(page: Page) {
  const before = page.url()
  await page.getByTestId('new-entry-submit').click()
  await expect.poll(() => page.url()).not.toBe(before)
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]{36}$/)
  return page.url().split('/').pop() as string
}
/** 记录页：等编辑器同步完（它会抢焦点），再失焦按 e */
async function onEntryReady(page: Page) {
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'synced')
}
/** 页面失焦后按 e 打开新建对话框 */
async function pressE(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('e')
  await expect(page.getByTestId('new-entry-dialog')).toBeVisible()
}

test('REQ-KB-008 侧栏就地管理大类：「管理大类」新建 → 分区 ⋯ 回车改名、改色 → 空间卡片移到该大类 → 删除', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const s = await mkSpace(request)
  const name = `大类${stamp()}`.slice(0, 16)
  await page.goto('/spaces')
  await page.getByTestId('sidebar-groups-manage').click()
  const dlg = page.getByTestId('space-groups-dialog')
  await dlg.getByTestId('space-group-new-name').fill(name)
  await dlg.getByTestId('space-group-new-name').press('Enter')
  await expect(dlg.locator('[data-testid="space-group-name"]').last()).toHaveValue(name)
  await page.keyboard.press('Escape')

  const section = page
    .getByTestId('space-switcher')
    .locator('[data-testid="space-section"]')
    .filter({ hasText: name })
  await section.hover()
  await section.getByTestId('group-menu').click()
  const panel = page.getByTestId('group-menu-panel')
  await panel.getByTestId('group-menu-name').fill(`${name}改`)
  await panel.getByTestId('group-menu-name').press('Enter')
  await panel.locator('[data-color="purple"]').click()
  await page.keyboard.press('Escape')
  const renamed = page
    .getByTestId('space-switcher')
    .locator('[data-testid="space-section"]')
    .filter({ hasText: `${name}改` })
  await expect(renamed).toBeVisible()
  const groups = (await (await request.get('/api/v1/space-groups')).json()) as {
    items: { id: string; name: string; color: string | null }[]
  }
  const g = groups.items.find((x) => x.name === `${name}改`)
  expect(g?.color).toBe('purple')

  // 空间卡片 ⋯ → 移到大类
  const card = page.locator(`[data-testid="space-card"][data-space-id="${s.id}"]`)
  await card.getByTestId('space-actions').click()
  await page.locator(`[data-testid="space-move-group"][data-group-id="${g?.id}"]`).click()
  await expect(renamed.getByRole('link', { name: s.name })).toBeVisible()

  // 分区 ⋯ → 删除大类（空间回到未分类）
  await renamed.hover()
  await renamed.getByTestId('group-menu').click()
  await page.getByTestId('group-menu-delete').click()
  await page.getByTestId('confirm-ok').click()
  await expect(renamed).toHaveCount(0)
})

test('REQ-ENTRY-021 · 022 在空间概览按 e：位置 = 本空间目录顶层，建好后在目录根；记录页按 e = 同级；可改位置', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  await page.goto(`/spaces/${s.slug}/home`)
  await expect(page.getByTestId('kb-home')).toBeVisible() // 页面就绪、上下文已登记
  await pressE(page)
  await expect(page.getByTestId('new-entry-space')).toHaveValue(s.id)
  await expect(page.getByTestId('new-entry-where')).toHaveValue('root')
  await page.getByTestId('new-entry-title').fill('概览里新建的')
  const rootId = await submitAndGetId(page)
  expect((await tree(request, s.id)).find((n) => n.id === rootId)?.parentId).toBeNull()

  // 在它下面建一个子页，再在子页里按 e：默认同级（父页 = rootId）
  const child = await createEntry(request, {
    kind: 'note',
    title: '子页甲',
    spaceId: s.id,
    parentId: rootId,
  })
  await page.goto(`/entries/${child}`)
  await expect(page.getByTestId('entry-title')).toBeVisible()
  await onEntryReady(page)
  await pressE(page)
  await expect(page.getByTestId('new-entry-space')).toHaveValue(s.id)
  await expect(page.getByTestId('new-entry-where')).toHaveValue(rootId)
  // 改为「不放进目录」再建
  await page.getByTestId('new-entry-where').selectOption('none')
  await page.getByTestId('new-entry-title').fill('不进目录的')
  const loose = await submitAndGetId(page)
  expect((await tree(request, s.id)).some((n) => n.id === loose)).toBe(false)

  // 离开空间后按 e 不再沿用旧位置（修一次性默认值被永久记住）
  await page.goto('/entries')
  await expect(page.getByTestId('entries-page')).toBeVisible()
  await pressE(page)
  await expect(page.getByTestId('new-entry-where')).toHaveValue('none')
})

test('REQ-ENTRY-023 · REQ-LINK-006 记录 ⋯「新建子页面」；关联面板「新建并关联」一步建好关联', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  const a = await createEntry(request, {
    kind: 'note',
    title: '需求 A',
    spaceId: s.id,
    parentId: null,
  })
  await page.goto(`/entries/${a}`)
  await page.getByTestId('entry-menu').first().click()
  await page.getByTestId('entry-menu-new-child').click()
  await expect(page.getByTestId('new-entry-where')).toHaveValue(a)
  await page.getByTestId('new-entry-title').fill('A 的子页')
  const child = await submitAndGetId(page)
  expect((await tree(request, s.id)).find((n) => n.id === child)?.parentId).toBe(a)

  // 关联面板：选「阻塞」→ 新建并关联
  await page.goto(`/entries/${a}?aside=backlinks`)
  const manual = page.getByTestId('relations-manual')
  await manual.getByRole('combobox').selectOption('blocks')
  await manual.getByTestId('link-create').click()
  await expect(page.getByTestId('new-entry-link')).toContainText('需求 A')
  await expect(page.getByTestId('new-entry-link')).toContainText('阻塞')
  await page.getByTestId('new-entry-title').fill('被 A 阻塞的任务说明')
  const b = await submitAndGetId(page)
  await expect
    .poll(async () => {
      const r = await request.get(`/api/v1/links?fromType=entry&fromId=${a}`)
      const body = (await r.json()) as
        | { kind: string; to: { id: string | null } }[]
        | { items: { kind: string; to: { id: string | null } }[] }
      const list = Array.isArray(body) ? body : body.items
      return list.find((l) => l.to.id === b)?.kind
    })
    .toBe('blocks')
  await page.goto(`/entries/${a}?aside=backlinks`)
  await expect(page.getByTestId('relations-manual')).toContainText('被 A 阻塞的任务说明')
})

// ---- 第二期（ADR-0019）----

test('REQ-EDITOR-023 正文 [[ 找不到就新建：建在本空间、作为本篇子页，并插入链接', async ({
  page,
  request,
}) => {
  const s = await mkSpace(request)
  const a = await createEntry(request, {
    kind: 'note',
    title: '父文档',
    spaceId: s.id,
    parentId: null,
  })
  await page.goto(`/entries/${a}`)
  await onEntryReady(page)
  await page.getByTestId('editor').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('参见 [[')
  const title = `新概念${stamp()}`
  await page.getByTestId('entry-picker-input').fill(title)
  await page.getByTestId('entry-picker-create').click()
  await expect(page.getByTestId('editor')).toContainText(title)
  await expect
    .poll(async () => (await tree(request, s.id)).find((n) => n.title === title)?.parentId)
    .toBe(a)
})

test('REQ-KB-009 侧栏空间行「+」与记录页位置导航节点「+ 新建子页」直接带好位置', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const s = await mkSpace(request)
  const node = await createEntry(request, {
    kind: 'note',
    title: '节点页',
    spaceId: s.id,
    parentId: null,
  })
  await page.goto('/entries')
  const row = page.locator(`[data-testid="space-row"][data-space-id="${s.id}"]`)
  await row.hover()
  await row.getByTestId('space-row-new-entry').click()
  await expect(page.getByTestId('new-entry-space')).toHaveValue(s.id)
  await expect(page.getByTestId('new-entry-where')).toHaveValue('root')
  await page.keyboard.press('Escape')

  const nav = page.getByTestId('entries-nav')
  const sp = nav.locator(`[data-testid="entries-nav-space"][data-space-id="${s.id}"]`)
  await sp.getByTestId('entries-nav-space-toggle').click()
  const n = sp.locator(`[data-testid="entries-nav-node"][data-entry-id="${node}"]`)
  await n.hover()
  await n.getByTestId('dir-new-child').click()
  await expect(page.getByTestId('new-entry-where')).toHaveValue(node)
})

test('REQ-KB-010 空间设默认类型 → 在该空间按 e 预选该类型', async ({ page, request }) => {
  const s = await mkSpace(request)
  await page.goto(`/spaces/${s.slug}/home`)
  await expect(page.getByTestId('kb-home')).toBeVisible()
  await page.getByRole('button', { name: '编辑空间' }).click()
  await page.getByTestId('kb-edit-default-kind').selectOption('decision')
  await page.getByTestId('kb-edit-save').click()
  await expect(page.getByTestId('kb-edit-dialog')).toBeHidden()
  await pressE(page)
  await expect(
    page.getByTestId('new-entry-dialog').locator('[data-kind="decision"]'),
  ).toHaveAttribute('aria-checked', 'true')
})
