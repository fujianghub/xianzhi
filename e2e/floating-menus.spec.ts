/**
 * ADR-0056 §E：编辑器 fixed 浮层在详情坞里的位置（REQ-EDITOR-036）。
 * xz_e2e 共用：标题带随机后缀，用完删除；坞宽写在本机 localStorage（每个用例新上下文，不影响别的用例）。
 */
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

/** 浮层整个在坞内（横向）、顶部不低于坞顶，中心点得中自己 */
async function expectMenuInDock(page: Page, testId: string) {
  const r = await page.evaluate((id) => {
    const m = document.querySelector(`[data-testid="${id}"]`) as HTMLElement
    const d = document.querySelector('.xz-detail-dock') as HTMLElement
    const a = m.getBoundingClientRect()
    const b = d.getBoundingClientRect()
    const hit = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2)
    return {
      inside:
        a.left >= b.left - 1 &&
        a.right <= b.right + 1 &&
        a.top >= b.top - 1 &&
        a.bottom <= innerHeight + 1,
      hit: !!hit && m.contains(hit),
      scrollLeft: d.scrollLeft,
    }
  }, testId)
  expect(r).toEqual({ inside: true, hit: true, scrollLeft: 0 })
}

test('REQ-EDITOR-036 表格工具条在最窄的详情坞里不被裁剪、不撑横向滚动；长表格顶部滚出后工具条停在可视区顶部', async ({
  page,
  request,
}) => {
  const s = stamp()
  const sp = await personalSpace(request)
  const id = await createEntry(request, {
    kind: 'note',
    title: `表格浮层 ${s}`,
    spaceId: sp.id,
    templateId: 'builtin:blank',
  })
  await page.addInitScript(() => localStorage.setItem('xz:dock-w', '320'))
  try {
    await page.goto(`/entries?q=${encodeURIComponent(s)}`)
    await page
      .locator(`[data-testid="entry-row"][data-entry-id="${id}"]`)
      .getByRole('link', { name: `表格浮层 ${s}` })
      .click()
    const dock = page.getByTestId('entry-dock')
    const pm = dock.locator('.ProseMirror')
    await expect(pm).toBeVisible({ timeout: 15_000 })
    await pm.locator('p').last().click()
    await page.keyboard.type('/biaoge')
    await expect(page.getByTestId('slash-menu')).toBeVisible()
    await page.keyboard.press('Enter')
    const menu = page.getByTestId('table-menu')
    await expect(menu).toBeVisible()
    await expectMenuInDock(page, 'table-menu')

    // 加到 16 行，使表格高于坞；把表格顶部滚出可视区，光标仍在表格里
    for (let i = 0; i < 13; i++) await menu.getByTestId('table-rowAfter').click()
    await dock.evaluate((d) => {
      const t = d.querySelector('.ProseMirror table') as HTMLElement
      d.scrollBy(0, t.getBoundingClientRect().top - d.getBoundingClientRect().top + 160)
    })
    await expect(menu).toBeVisible()
    await expect
      .poll(async () => {
        const t = (await dock.locator('.ProseMirror table').boundingBox())?.y ?? 0
        const m = (await menu.boundingBox())?.y ?? -1
        return m > t
      })
      .toBe(true)
    await expectMenuInDock(page, 'table-menu')
  } finally {
    await request.delete(`/api/v1/entries/${id}`, { headers: sameSite })
  }
})
