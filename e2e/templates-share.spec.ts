/** ADR-0023 模板编辑与工作区共享（REQ-TPL-010）：设置页新建 / 编辑正文、成员共享、他人看到作者并复制到我的、?preview 链接。 */
import { expect, request as pwRequest, test } from '@playwright/test'
import { BASE, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

test('REQ-TPL-010 成员在设置页新建模板并共享 → 管理员看到作者、复制到我的、按链接预览；作者改正文后预览更新', async ({
  page,
  browser,
  request,
}) => {
  const name = `会议纪要模板 ${stamp()}`
  const mctx = await browser.newContext({ baseURL: BASE, storageState: STATE.member })
  const mp = await mctx.newPage()

  // 成员：新建模板，写一个标题，勾选共享，保存
  await mp.goto('/settings/templates')
  await mp.getByTestId('template-new').click()
  await expect(mp).toHaveURL(/\/settings\/templates\/new$/)
  await mp.getByTestId('template-name').fill(name)
  await mp.getByTestId('template-description').fill('每周例会用')
  const ed = mp.getByTestId('template-editor')
  await ed.click()
  await mp.keyboard.type('## 会议议程')
  await mp.keyboard.press('Enter')
  await mp.keyboard.type('第一项')
  await expect(ed.locator('h2', { hasText: '会议议程' })).toBeVisible()
  await expect(mp.getByTestId('template-vars-hint')).toContainText('{{date}}')
  await mp.getByTestId('template-form-share').click()
  await mp.getByTestId('template-save').click()
  await expect(mp).toHaveURL(/\/settings\/templates$/)
  const mRow = mp
    .getByTestId('templates-workspace')
    .getByTestId('template-row')
    .filter({ hasText: name })
  await expect(mRow).toHaveCount(1)
  await expect(mRow.getByTestId('template-share')).toHaveAttribute('data-state', 'checked')
  const id = await mRow.getAttribute('data-template-id')
  expect(id).toMatch(/^[0-9a-f-]{36}$/)

  // 管理员：在「工作区共享」看到它与作者，复制到我的
  await page.goto('/settings/templates')
  const row = page
    .getByTestId('templates-workspace')
    .getByTestId('template-row')
    .filter({ hasText: name })
  await expect(row.getByTestId('template-owner')).toContainText('共享')
  await row.getByTestId('template-copy').click()
  await expect(page.getByText(`已复制为「${name} 副本」`)).toBeVisible()
  await expect(
    page
      .getByTestId('templates-personal')
      .getByTestId('template-row')
      .filter({ hasText: `${name} 副本` }),
  ).toHaveCount(1)

  // 分享链接：?preview=<id> 直接打开预览
  await page.goto(`/settings/templates?preview=${id}`)
  const prev = page.getByTestId('template-preview')
  await expect(
    prev.getByTestId('template-doc').locator('h2', { hasText: '会议议程' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/preview=/)

  // 作者编辑正文（Mod+S 保存）→ 预览是新内容
  await mRow.getByTestId('template-edit').click()
  await expect(mp).toHaveURL(new RegExp(`/settings/templates/${id}$`))
  const ed2 = mp.getByTestId('template-editor')
  await expect(ed2.locator('h2', { hasText: '会议议程' })).toBeVisible()
  await ed2.locator('p', { hasText: '第一项' }).click()
  await mp.keyboard.press('End')
  await mp.keyboard.press('Enter')
  await mp.keyboard.type('第二项')
  await mp.keyboard.press('ControlOrMeta+s')
  await expect(mp).toHaveURL(/\/settings\/templates$/)
  await page.goto(`/settings/templates?preview=${id}`)
  await expect(page.getByTestId('template-preview').getByTestId('template-doc')).toContainText(
    '第二项',
  )

  // 清理：成员删自己的共享模板；管理员删副本
  const member = await pwRequest.newContext({ baseURL: BASE, storageState: STATE.member })
  expect((await member.delete(`/api/v1/templates/${id}`, { headers: sameSite })).status()).toBe(204)
  await member.dispose()
  const mine = (await (await request.get('/api/v1/templates', { headers: sameSite })).json()) as {
    items: { id: string; name: string }[]
  }
  for (const t of mine.items.filter((x) => x.name === `${name} 副本`))
    await request.delete(`/api/v1/templates/${t.id}`, { headers: sameSite })
  await mctx.close()
})
