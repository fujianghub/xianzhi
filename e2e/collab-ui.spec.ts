/** G8 协作前端（T1-019 · 023 · 026 · 027 · 029 · 030）：回收站、评论、⌘K 与搜索直达、通知中心、实时失效、快捷键、Peek。 */
import { type APIRequestContext, expect, request as pwRequest, test } from '@playwright/test'
import { BASE, createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
async function space(req: APIRequestContext) {
  const slug = `g8-${stamp()}`
  const r = await req.post('/api/v1/spaces', {
    data: { name: `协作 ${slug}`, slug, kind: 'project' },
    headers: sameSite,
  })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()) as { id: string; slug: string }
}
async function task(req: APIRequestContext, body: Record<string, unknown>) {
  const r = await req.post('/api/v1/tasks', { data: body, headers: sameSite })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()) as { id: string; title: string; updatedAt: string; spaceSlug: string }
}
const memberCtx = () => pwRequest.newContext({ baseURL: BASE, storageState: STATE.member })
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('REQ-ENTRY-007 删除记录 → 回收站可见 → 恢复后可读', async ({ page, request }) => {
  const id = await createEntry(request, { kind: 'note', title: `回收站用例 ${stamp()}` })
  expect((await request.delete(`/api/v1/entries/${id}`, { headers: sameSite })).status()).toBe(204)
  expect((await request.get(`/api/v1/entries/${id}`, { headers: sameSite })).status()).toBe(404)
  await page.goto('/trash?tab=entries')
  const row = page.locator(`[data-testid="trash-row"][data-id="${id}"]`)
  await expect(row).toBeVisible()
  await expect(row).toContainText('剩 30 天')
  await row.getByTestId('trash-restore').click()
  await expect(row).toBeHidden()
  expect((await request.get(`/api/v1/entries/${id}`, { headers: sameSite })).status()).toBe(200)
})

test('REQ-SPACE-007 member 永久删空间 403，回收站不显示永久删除按钮', async ({
  browser,
  request,
}) => {
  const s = await space(request)
  expect((await request.delete(`/api/v1/spaces/${s.id}`, { headers: sameSite })).status()).toBe(204)
  const member = await memberCtx()
  expect(
    (await member.delete(`/api/v1/spaces/${s.id}?permanent=1`, { headers: sameSite })).status(),
  ).toBe(403)
  await member.dispose()
  const ctx = await browser.newContext({ storageState: STATE.member })
  const p = await ctx.newPage()
  await p.goto('/trash?tab=spaces')
  await expect(p.getByTestId('trash-page')).toBeVisible()
  await expect(p.getByTestId('trash-purge')).toHaveCount(0)
  await ctx.close()
})

test('REQ-COMMENT-004 评论输入 /标题 无候选，Enter 发送', async ({ page, request }) => {
  const s = await space(request)
  const t = await task(request, { title: '评论输入', spaceId: s.id })
  await page.goto(`/spaces/${s.slug}/tasks/${t.id}`)
  const input = page.getByTestId('comment-new')
  await input.click()
  await page.keyboard.type('/标题')
  await expect(page.getByTestId('slash-menu')).toHaveCount(0)
  await page.keyboard.press('Enter')
  const thread = page.getByTestId('comment-thread')
  await expect(thread).toHaveCount(1)
  await expect(thread).toContainText('/标题')
  await expect(input).not.toContainText('/标题') // 发送后清空
})

test('REQ-COMMENT-002 删除锚定文本后线程标 orphaned，仍在侧栏', async ({ page, request }) => {
  const product = (await (await request.get('/api/v1/spaces/product')).json()) as { id: string }
  const id = await createEntry(request, {
    kind: 'note',
    title: '锚定评论',
    spaceId: product.id,
    visibility: 'workspace',
  })
  await page.goto(`/entries/${id}`)
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'synced', {
    timeout: 15_000,
  })
  const editor = page.getByTestId('editor')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('这一句会被评论然后删掉')
  await page.keyboard.press('Shift+Home')
  await page.getByTestId('bubble-menu').getByRole('button', { name: '评论' }).click()
  await expect(page).toHaveURL(/aside=comments/)
  const pending = page.getByTestId('comment-pending')
  await expect(pending).toContainText('这一句会被评论然后删掉')
  await pending.getByTestId('comment-input').click()
  await page.keyboard.type('这句话要再斟酌')
  await page.keyboard.press('Enter')
  const thread = page.getByTestId('comment-thread')
  await expect(thread).toHaveCount(1)
  await expect(editor.locator('[data-comment]')).toHaveCount(1)
  // 删掉被评论的整句
  await editor.locator('[data-comment]').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Backspace')
  await expect(editor.locator('[data-comment]')).toHaveCount(0)
  // 落库（collab 防抖）后 orphaned 置位；侧栏重取仍列出线程
  await expect
    .poll(
      async () => {
        const r = await request.get(`/api/v1/comments?targetType=entry&targetId=${id}`, {
          headers: sameSite,
        })
        return ((await r.json()) as { items: { orphaned: boolean }[] }).items[0]?.orphaned
      },
      { timeout: 15_000 },
    )
    .toBe(true)
  await page.reload()
  await expect(page.getByTestId('orphaned-badge')).toBeVisible()
})

test('REQ-SEARCH-006 ⌘K 输入「缓存」候选为搜索结果，Enter 打开首项', async ({ page, request }) => {
  const title = `缓存策略 ${stamp()}`
  const id = await createEntry(request, { kind: 'decision', title, fields: { status: 'proposed' } })
  await page.goto('/today')
  await expect(page.getByTestId('bell')).toBeVisible() // 外壳就绪、热键已注册
  await page.keyboard.press(`${mod}+k`)
  await expect(page.getByTestId('command-input')).toBeFocused()
  await page.keyboard.type(title)
  const hit = page.getByTestId('command-hit').first()
  await expect(hit).toBeVisible()
  await expect(page.getByTestId('command-results')).toContainText(title)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/entries/${id}`))
})

test('REQ-UI-005 焦点在任务上 ⌘K 首组为任务命令；无焦点时首组为跳转', async ({ page, request }) => {
  const s = await space(request)
  const t = await task(request, { title: '上下文任务', spaceId: s.id, status: 'todo' })
  await page.goto('/inbox')
  await expect(page.getByTestId('bell')).toBeVisible()
  await page.keyboard.press(`${mod}+k`)
  const list = page.getByTestId('command-palette')
  await expect(list).toHaveAttribute('data-context', 'none')
  await expect(list.locator('[cmdk-group]').first()).toHaveAttribute(
    'data-testid',
    'command-group-navigate',
  )
  await page.keyboard.press('Escape')
  await page.goto(`/spaces/${s.slug}?view=list`)
  await page.getByTestId('task-list').focus()
  await expect(page.locator(`[data-task-id="${t.id}"][data-focused="true"]`)).toBeVisible()
  await page.keyboard.press(`${mod}+k`)
  await expect(list).toHaveAttribute('data-context', 'task')
  const first = list.locator('[cmdk-group]').first()
  await expect(first).toHaveAttribute('data-testid', 'command-group-context')
  for (const label of ['改状态', '指派', '设截止', '移到周期'])
    await expect(first).toContainText(label)
  // 二级页：改状态 → 进行中
  await page.getByTestId('cmd-task.status').click()
  await page.getByRole('option', { name: '进行中' }).click()
  await expect
    .poll(
      async () =>
        (
          (await (await request.get(`/api/v1/tasks/${t.id}`, { headers: sameSite })).json()) as {
            status: string
          }
        ).status,
    )
    .toBe('doing')
})

test('REQ-UI-006 g i 跳收件箱、g t 跳今日；? 打开快捷键面板', async ({ page }) => {
  await page.goto('/entries')
  await expect(page.getByTestId('entries-page')).toBeVisible()
  // 不点页面（会点中卡片进编辑器）：让当前焦点失焦即可
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('g')
  await page.keyboard.press('i')
  await expect(page).toHaveURL(/\/inbox$/)
  await page.keyboard.press('g')
  await page.keyboard.press('t')
  await expect(page).toHaveURL(/\/today$/)
  await page.keyboard.press('Shift+?')
  await expect(page.getByTestId('shortcuts-dialog')).toBeVisible()
  await expect(page.getByTestId('shortcuts-dialog')).toContainText('G')
})

test('REQ-UI-007 悬停 700ms Peek 可见且 URL 不变；Enter 后 URL 变为详情', async ({
  page,
  request,
}) => {
  const s = await space(request)
  const t = await task(request, { title: 'Peek 目标', spaceId: s.id, status: 'todo' })
  await page.goto(`/spaces/${s.slug}?view=list`)
  const url = page.url()
  await page.locator(`[data-testid="task-row"][data-task-id="${t.id}"]`).hover()
  await page.waitForTimeout(700)
  const peek = page.getByTestId('peek-panel')
  await expect(peek).toBeVisible()
  await expect(peek).toContainText('Peek 目标')
  expect(page.url()).toBe(url)
  // 无 Scrim：页面其他部分仍可交互（列表仍可滚动 / 点击）
  await expect(page.locator('.scrim')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/tasks/${t.id}`))
})

test('REQ-NOTIF-005 点击通知跳深链并标已读；全部已读后未读 0', async ({ page, request }) => {
  // 由 member 在 owner 的任务上评论，产生 owner 的通知
  const s = await space(request)
  const t = await task(request, { title: '通知深链', spaceId: s.id })
  const member = await memberCtx()
  const c = await member.post('/api/v1/comments', {
    data: {
      targetType: 'task',
      targetId: t.id,
      bodyPm: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '看一下' }] }],
      },
    },
    headers: sameSite,
  })
  expect(c.status(), await c.text()).toBe(201)
  await member.dispose()
  await page.goto('/notifications?tab=unread')
  const item = page.getByTestId('notification-item').filter({ hasText: '通知深链' }).first()
  await expect(item).toBeVisible({ timeout: 15_000 })
  await item.locator('button').first().click()
  await expect(page).toHaveURL(new RegExp(`/tasks/${t.id}`))
  const list = (await (
    await request.get('/api/v1/notifications?limit=50', { headers: sameSite })
  ).json()) as {
    items: { title: string; readAt: string | null; url: string }[]
  }
  expect(list.items.find((n) => n.url.includes(t.id))?.readAt).not.toBeNull()
  await page.goto('/notifications')
  await page.getByTestId('read-all').click()
  await expect(page.getByTestId('bell-count')).toHaveCount(0)
  const after = (await (
    await request.get('/api/v1/notifications?unread=1&limit=1', { headers: sameSite })
  ).json()) as {
    unreadCount: number
  }
  expect(after.unreadCount).toBe(0)
})

test('REQ-NOTIF-004 他人改任务后 ≤ 2s 列表更新，无整页刷新', async ({ page, request }) => {
  const s = await space(request)
  const t = await task(request, { title: '实时之前', spaceId: s.id, status: 'todo' })
  await page.goto(`/spaces/${s.slug}?view=list`)
  await expect(page.locator(`[data-task-id="${t.id}"]`)).toContainText('实时之前')
  await expect.poll(() => page.evaluate(() => window.__gi?.realtime?.status)).toBe('open')
  await page.evaluate(() => {
    ;(window as { __marker?: number }).__marker = 1
  })
  const member = await memberCtx()
  const r = await member.patch(`/api/v1/tasks/${t.id}`, {
    data: { title: '实时之后', ifUpdatedAt: t.updatedAt },
    headers: sameSite,
  })
  expect(r.status(), await r.text()).toBe(200)
  await member.dispose()
  await expect(page.locator(`[data-task-id="${t.id}"]`)).toContainText('实时之后', {
    timeout: 2000,
  })
  expect(await page.evaluate(() => (window as { __marker?: number }).__marker)).toBe(1)
})
