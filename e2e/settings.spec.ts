/** G9 设置（T1-033 · T1-043）：个人时区、API Key、审计分页与门禁、成员邀请。 */
import { expect, request as pwRequest, test } from '@playwright/test'
import { dayRange } from '../src/shared/tz.ts'
import { BASE, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

test('REQ-WS-010 个人设置改时区后「今日」列表变化', async ({ page, request }) => {
  const sp = await request.post('/api/v1/spaces', {
    data: { name: `时区 ${stamp()}`, slug: `tz-${stamp()}`, kind: 'work' },
    headers: sameSite,
  })
  const s = (await sp.json()) as { id: string }
  const now = new Date()
  const sh = dayRange('Asia/Shanghai', now)
  const la = dayRange('America/Los_Angeles', now)
  const pick = [sh.start.getTime() + 30 * 60_000, sh.end.getTime() - 30 * 60_000].find(
    (x) => x < la.start.getTime() || x >= la.end.getTime(),
  )
  const title = `设置页时区 ${stamp()}`
  const r = await request.post('/api/v1/tasks', {
    data: { title, spaceId: s.id, status: 'todo', dueAt: new Date(pick ?? 0).toISOString() },
    headers: sameSite,
  })
  expect(r.status()).toBe(201)
  try {
    await page.goto('/settings')
    await page.getByTestId('profile-timezone').selectOption('Asia/Shanghai')
    await expect(page.getByTestId('saved')).toContainText('已保存')
    await page.goto('/today')
    await expect(page.getByTestId('today-dueToday').getByText(title)).toBeVisible()
    await page.goto('/settings')
    await page.getByTestId('profile-timezone').selectOption('America/Los_Angeles')
    await expect(page.getByTestId('saved')).toContainText('已保存')
    await page.goto('/today')
    await expect(page.getByTestId('today')).toBeVisible()
    await expect(page.getByTestId('today-dueToday').getByText(title)).toHaveCount(0)
  } finally {
    await request.patch('/api/v1/me', { data: { timezone: 'Asia/Shanghai' }, headers: sameSite })
  }
})

test('REQ-AUTH-010 新建 Key 明文只显示一次；read scope 调 POST 403 SCOPE；撤销后 401', async ({
  page,
}) => {
  await page.goto('/settings/api-keys')
  await page.getByTestId('key-name').fill(`脚本 ${stamp()}`)
  await page.getByTestId('key-scope').selectOption('read')
  await page.getByTestId('key-create').click()
  const plain = (await page.getByTestId('key-plain').textContent())?.trim() ?? ''
  expect(plain).toMatch(/^xz_/)
  await page.getByTestId('key-plain-done').click()
  await expect(page.getByTestId('key-plain-dialog')).toBeHidden()
  await expect(page.getByText(plain)).toHaveCount(0) // 列表只显示前缀
  const api = await pwRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { authorization: `Bearer ${plain}` },
  })
  expect((await api.get('/api/v1/me')).status()).toBe(200)
  const w = await api.post('/api/v1/tasks', { data: { title: 'x' }, headers: sameSite })
  expect(w.status()).toBe(403)
  expect(((await w.json()) as { code: string }).code).toBe('SCOPE')
  const row = page
    .getByTestId('key-row')
    .filter({ hasText: plain.slice(0, 6) })
    .first()
  await row.getByTestId('key-revoke').click()
  await page.getByTestId('confirm-ok').click()
  await expect.poll(async () => (await api.get('/api/v1/me')).status()).toBe(401)
  await api.dispose()
})

test('REQ-WS-005 admin 审计页游标翻页；member 访问工作区设置 404', async ({
  page,
  request,
  browser,
}) => {
  // 造够两页审计：改工作区设置每次一行
  const ws = (await (await request.get('/api/v1/workspace')).json()) as { name: string }
  for (let i = 0; i < 52; i++)
    await request.patch('/api/v1/workspace', { data: { settings: { n: i } }, headers: sameSite })
  await request.patch('/api/v1/workspace', { data: { name: ws.name }, headers: sameSite })
  await page.goto('/settings/workspace/audit')
  const rows = page.getByTestId('audit-row')
  await expect(rows).toHaveCount(50)
  await page.getByTestId('audit-more').click()
  await expect.poll(() => rows.count()).toBeGreaterThan(50)
  // 按动作筛选
  await page.goto('/settings/workspace/audit?action=workspace.settings_changed')
  await expect(rows.first()).toContainText('workspace.settings_changed')
  const ctx = await browser.newContext({ storageState: STATE.member })
  const p = await ctx.newPage()
  const role = ((await (await p.request.get('/api/v1/me')).json()) as { workspaceRole?: string })
    .workspaceRole
  expect(role, 'member 会话有效且角色为 member').toBe('member')
  for (const path of [
    '/settings/workspace/audit',
    '/settings/workspace',
    '/settings/workspace/members',
  ]) {
    await p.goto(path)
    await expect(p.getByTestId('not-found'), `${path} → ${p.url()}`).toBeVisible()
  }
  await p.goto('/settings')
  await expect(p.getByTestId('settings-nav')).not.toContainText('审计日志')
  await ctx.close()
})

test('REQ-WS-002 成员页邀请出现在邀请列表；改角色即时生效', async ({ page, request }) => {
  const email = `inv-${stamp()}@demo.local`
  await page.goto('/settings/workspace/members')
  await page.getByTestId('invite-email').fill(email)
  await page.getByTestId('invite-submit').click()
  await page.getByRole('tab', { name: '邀请' }).click()
  await expect(page.getByTestId('invitation-row').filter({ hasText: email })).toBeVisible()
  // member@demo.local 角色 member → guest → member
  const members = (await (await request.get('/api/v1/workspace/members')).json()) as {
    items: { userId: string; email: string }[]
  }
  const m = members.items.find((x) => x.email === 'member@demo.local')
  expect(m).toBeDefined()
  await page.getByRole('tab', { name: '成员' }).click()
  const row = page.locator(`[data-testid="member-row"][data-user="${m?.userId}"]`)
  await row.getByRole('combobox', { name: '角色' }).selectOption('guest')
  await expect
    .poll(async () => {
      const r = (await (await request.get('/api/v1/workspace/members')).json()) as {
        items: { userId: string; role: string }[]
      }
      return r.items.find((x) => x.userId === m?.userId)?.role
    })
    .toBe('guest')
  await row.getByRole('combobox', { name: '角色' }).selectOption('member')
  await expect
    .poll(async () => {
      const r = (await (await request.get('/api/v1/workspace/members')).json()) as {
        items: { userId: string; role: string }[]
      }
      return r.items.find((x) => x.userId === m?.userId)?.role
    })
    .toBe('member')
})

test('REQ-WS-018 · 019 · 021 owner 用户管理：新建 → 编辑显示名 → 删除；member 访问 404', async ({
  page,
  browser,
}) => {
  const s = stamp()
  await page.goto('/settings/workspace/users')
  await expect(page.getByTestId('nav-users')).toBeVisible()
  await page.getByTestId('user-create').click()
  const dlg = page.getByTestId('user-create-dialog')
  await dlg.getByLabel('显示名').fill(`用户${s}`)
  await dlg.getByLabel('用户名').fill(`u${s}`)
  await dlg.getByLabel('邮箱').fill(`u${s}@demo.local`)
  await dlg.getByRole('button', { name: '随机生成' }).click()
  await page.getByTestId('user-create-ok').click()
  await expect(dlg).toBeHidden()
  const row = page.getByTestId('user-row').filter({ hasText: `@u${s}` })
  await expect(row).toContainText(`用户${s}`)

  await row.getByTestId('user-edit').click()
  const edit = page.getByTestId('user-edit-dialog')
  await edit.getByLabel('显示名').fill(`改名${s}`)
  await page.getByTestId('user-edit-ok').click()
  await expect(edit).toBeHidden()
  await expect(row).toContainText(`改名${s}`)

  await row.getByTestId('user-delete').click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('user-row').filter({ hasText: `@u${s}` })).toHaveCount(0)

  const ctx = await browser.newContext({ storageState: STATE.member })
  const p = await ctx.newPage()
  await p.goto('/settings/workspace/users')
  await expect(p.getByTestId('not-found')).toBeVisible()
  await ctx.close()
})

test('REQ-WS-022 · 023 个人资料：改用户名、上传并移除头像', async ({ page, request }) => {
  const me0 = (await (await request.get('/api/v1/me')).json()) as { username: string | null }
  const s = stamp()
  try {
    await page.goto('/settings')
    await page.getByTestId('profile-username').fill(`owner_${s}`)
    await page.getByTestId('profile-username-save').click()
    await expect(page.getByTestId('profile-username-save')).toBeHidden()
    const me1 = (await (await request.get('/api/v1/me')).json()) as { username: string }
    expect(me1.username).toBe(`owner_${s}`)

    // 1×1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    )
    await page.getByTestId('avatar-file').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: png,
    })
    await expect(page.getByTestId('avatar-remove')).toBeVisible()
    await expect(page.getByTestId('profile-account').locator('img')).toBeVisible()
    await page.getByTestId('avatar-remove').click()
    await expect(page.getByTestId('avatar-remove')).toBeHidden()
    await expect(page.getByTestId('profile-account').locator('img')).toHaveCount(0)
  } finally {
    if (me0.username)
      await request.patch('/api/v1/me/account', {
        data: { username: me0.username },
        headers: sameSite,
      })
  }
})
