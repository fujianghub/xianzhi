/** G7 记录页（T1-013 · T1-017）：新建 Dialog + fields 422 就地显示、固定置顶、标记版本、移动空间。 */
import { type APIRequestContext, expect, request as pwRequest, test } from '@playwright/test'
import { BASE, createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
async function space(req: APIRequestContext, visibility: 'workspace' | 'members' = 'workspace') {
  const slug = `ent-${stamp()}`
  const r = await req.post('/api/v1/spaces', {
    data: { name: `记录 ${slug}`, slug, kind: 'project', visibility },
    headers: sameSite,
  })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()) as { id: string; slug: string }
}

test('REQ-ENTRY-001 新建 decision：fields 422 就地显示，修正后创建并进入编辑页', async ({
  page,
}) => {
  await page.goto('/entries')
  await expect(page.getByTestId('entries-page')).toBeVisible()
  await page.keyboard.press('e')
  const dlg = page.getByTestId('new-entry-dialog')
  await expect(dlg).toBeVisible()
  await dlg.locator('[data-kind="decision"]').click()
  await page.getByTestId('new-entry-title').fill('采用 Yjs 做正文真源')
  await dlg.locator('#field-supersedesId').fill('not-a-uuid')
  await page.getByTestId('new-entry-submit').click()
  await expect(page.getByTestId('field-error-supersedesId')).toBeVisible()
  await expect(dlg).toBeVisible()
  await dlg.locator('#field-supersedesId').fill('')
  await page.getByTestId('new-entry-submit').click()
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]{36}$/)
  await expect(page.getByTestId('entry-title')).toContainText('采用 Yjs 做正文真源')
})

test('REQ-ENTRY-006 固定项在列表中置顶', async ({ page, request }) => {
  const s = await space(request)
  const older = await createEntry(request, { kind: 'note', title: '较早但固定', spaceId: s.id })
  await createEntry(request, { kind: 'note', title: '较新未固定', spaceId: s.id })
  await page.goto(`/entries/${older}`)
  await page.getByTestId('entry-pin').click()
  await expect(page.getByTestId('entry-pin')).toHaveAttribute('aria-pressed', 'true')
  await page.goto(`/spaces/${s.slug}/entries?view=cards`)
  const cards = page.getByTestId('entry-card')
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toHaveAttribute('data-entry-id', older)
  await expect(cards.first()).toHaveAttribute('data-pinned', 'true')
})

test('REQ-COLLAB-007 Aside 属性页标记版本后 snapshots 多一条带 label', async ({
  page,
  request,
}) => {
  const id = await createEntry(request, { kind: 'note', title: '标记版本用例' })
  const count = async () =>
    (
      (await (
        await request.get(`/api/v1/entries/${id}/snapshots`, { headers: sameSite })
      ).json()) as {
        items: { label: string | null }[]
      }
    ).items
  const before = (await count()).length
  await page.goto(`/entries/${id}?aside=props`)
  await page.getByTestId('snapshot-label').fill('评审前')
  await page.getByRole('button', { name: '标记版本' }).click()
  await expect(page.getByTestId('snapshot-list')).toContainText('评审前')
  const after = await count()
  expect(after.length).toBe(before + 1)
  expect(after.some((s) => s.label === '评审前')).toBe(true)
  // 大纲页签：URL 同步
  await page.getByTestId('aside-tab-outline').click()
  await expect(page).not.toHaveURL(/aside=props/)
})

test('REQ-ENTRY-011 移动到另一空间后，原空间成员（非目标空间成员）GET 404', async ({
  page,
  request,
}) => {
  const s1 = await space(request, 'workspace')
  const s2 = await space(request, 'members') // 仅 owner 是成员
  const id = await createEntry(request, {
    kind: 'note',
    title: '要搬家的记录',
    spaceId: s1.id,
    visibility: 'space',
  })
  const member = await pwRequest.newContext({ baseURL: BASE, storageState: STATE.member })
  expect((await member.get(`/api/v1/entries/${id}`, { headers: sameSite })).status()).toBe(200)
  await page.goto(`/entries/${id}?aside=props`)
  await page.getByTestId('entry-space').selectOption(s2.id)
  await expect(page.getByText(/已移动到/)).toBeVisible()
  await expect
    .poll(async () => (await member.get(`/api/v1/entries/${id}`, { headers: sameSite })).status())
    .toBe(404)
  await member.dispose()
})

test('REQ-ATTACH-008 上传中断后重试同一文件：同 sha256 幂等，无重复附件行', async ({
  page,
  request,
}) => {
  const id = await createEntry(request, { kind: 'note', title: '重复上传' })
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  const upload = () =>
    request.post('/api/v1/attachments', {
      headers: sameSite,
      multipart: {
        file: { name: 'retry.png', mimeType: 'image/png', buffer: png },
        targetType: 'entry',
        targetId: id,
      },
    })
  // 第一次请求在浏览器里被中断（客户端取消），随后重试完整上传两次
  await page.goto('/today')
  await page.evaluate(async (entryId) => {
    const ctrl = new AbortController()
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(64)], 'retry.png', { type: 'image/png' }))
    fd.append('targetType', 'entry')
    fd.append('targetId', entryId)
    const p = fetch('/api/v1/attachments', { method: 'POST', body: fd, signal: ctrl.signal }).catch(
      () => null,
    )
    ctrl.abort()
    await p
  }, id)
  const a = await upload()
  expect(a.status(), await a.text()).toBe(201)
  const b = await upload()
  expect(b.status()).toBe(201)
  expect(((await b.json()) as { id: string }).id).toBe(((await a.json()) as { id: string }).id)
})

test('REQ-UI-036 非安全上下文（无 crypto.randomUUID）下新建记录与任务仍成功', async ({ page }) => {
  // 模拟按局域网 IP 走 HTTP：浏览器不暴露 randomUUID
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true })
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/entries')
  await expect(page.getByTestId('entries-page')).toBeVisible()
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')
  await page.keyboard.press('e')
  const dlg = page.getByTestId('new-entry-dialog')
  await expect(dlg).toBeVisible()
  await dlg.locator('[data-kind="note"]').click()
  await page.getByTestId('new-entry-title').fill('HTTP 局域网下创建')
  await page.getByTestId('new-entry-submit').click()
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]{36}$/)
  await page.goto('/inbox')
  await expect(page.getByTestId('inbox')).toBeVisible()
  await page.keyboard.press('c')
  await expect(page.getByTestId('new-task-dialog')).toBeVisible()
  await page.getByTestId('new-task-input').fill('HTTP 局域网下的任务')
  await page.getByTestId('new-task-input').press('Enter')
  await expect(page.getByTestId('new-task-dialog')).toBeHidden()
  expect(errors.filter((m) => m.includes('randomUUID'))).toEqual([])
})
