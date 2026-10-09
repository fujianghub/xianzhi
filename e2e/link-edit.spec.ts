/**
 * ADR-0055：链接「编辑」同时改显示文字与真实地址（REQ-LINK-009）· 任务详情描述支持网页链接（REQ-TASK-049）。
 * xz_e2e 共用：标题带随机后缀，用完删除。
 */
import { randomUUID } from 'node:crypto'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { createEntry, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const personalSpace = async (request: APIRequestContext) =>
  (
    (await (await request.get('/api/v1/spaces')).json()) as {
      items: { id: string; isPersonal: boolean }[]
    }
  ).items.find((s) => s.isPersonal) as { id: string }

/** 在编辑器末尾输入网址 + 空格（自动识别成链接），点进链接打开气泡 */
async function typeLink(page: Page, pm: ReturnType<Page['locator']>, url: string) {
  await pm.locator('p').last().click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(`看 ${url} `)
  const link = pm.locator(`a[href="${url}"]`)
  await expect(link).toBeVisible()
  await link.click()
  return link
}

/** 链接气泡「编辑」：改显示文字与地址 */
async function editLink(page: Page, text: string, href: string) {
  const bubble = page.getByTestId('link-bubble')
  await expect(bubble).toBeVisible()
  await bubble.getByTestId('link-bubble-edit').click()
  await bubble.getByTestId('link-bubble-text').fill(text)
  await bubble.getByTestId('link-bubble-input').fill(href)
  await bubble.getByTestId('link-bubble-save').click()
}

test('REQ-LINK-009 链接「编辑」同时改显示文字与真实地址；网页卡片「编辑」改标题与网址', async ({
  page,
  request,
}) => {
  const s = stamp()
  const sp = await personalSpace(request)
  const id = await createEntry(request, {
    kind: 'note',
    title: `改链接 ${s}`,
    spaceId: sp.id,
    templateId: 'builtin:blank',
  })
  try {
    await page.goto(`/entries/${id}`)
    const pm = page.locator('.ProseMirror')
    await typeLink(page, pm, 'https://example.org/')
    await editLink(page, '示例站点', 'https://example.com/docs')
    const edited = pm.locator('a[href="https://example.com/docs"]')
    await expect(edited).toHaveText('示例站点')
    await expect(pm.locator('a[href="https://example.org/"]')).toHaveCount(0)

    // 转成卡片后编辑：标题与网址都可改
    await edited.click()
    await page.getByTestId('link-bubble').getByTestId('link-bubble-as-card').click()
    const card = page.getByTestId('link-card').first()
    await card.hover()
    await card.getByTestId('link-card-edit').click()
    const form = page.getByTestId('link-card-form')
    await form.getByTestId('link-card-title-input').fill('自定义标题')
    await form.getByTestId('link-card-url-input').fill('https://example.net/x')
    await form.getByTestId('link-card-save').click()
    const after = page.getByTestId('link-card').first()
    await expect(after).toContainText('自定义标题')
    await expect(after.locator('a').first()).toHaveAttribute('href', 'https://example.net/x')
  } finally {
    await request.delete(`/api/v1/entries/${id}`, { headers: sameSite })
  }
})

test('REQ-TASK-049 任务详情描述：网址自动成链接，链接气泡可编辑文字与地址并保存', async ({
  page,
  request,
}) => {
  const s = stamp()
  const r = await request.post('/api/v1/tasks', {
    data: { title: `描述链接 ${s}`, status: 'inbox' },
    headers: { ...sameSite, 'idempotency-key': randomUUID() },
  })
  expect(r.status()).toBe(201)
  const taskId = ((await r.json()) as { id: string }).id
  try {
    await page.goto(`/inbox?task=${taskId}`)
    const sheet = page.getByTestId('task-sheet')
    const pm = sheet.getByTestId('lite-editor')
    await pm.click()
    await page.keyboard.type('参考 https://example.org/ ')
    const link = pm.locator('a[href="https://example.org/"]')
    await expect(link).toBeVisible()
    await link.click()
    await editLink(page, '官方文档', 'https://example.com/guide')
    await expect(pm.locator('a[href="https://example.com/guide"]')).toHaveText('官方文档')
    // 失焦保存
    await sheet.getByTestId('task-title').click()
    await expect
      .poll(async () =>
        JSON.stringify(
          (
            (await (await request.get(`/api/v1/tasks/${taskId}`)).json()) as {
              descriptionPm: unknown
            }
          ).descriptionPm,
        ),
      )
      .toContain('https://example.com/guide')
    const saved = JSON.stringify(
      ((await (await request.get(`/api/v1/tasks/${taskId}`)).json()) as { descriptionPm: unknown })
        .descriptionPm,
    )
    expect(saved).toContain('官方文档')
  } finally {
    await request.delete(`/api/v1/tasks/${taskId}?permanent=1`, { headers: sameSite })
  }
})
