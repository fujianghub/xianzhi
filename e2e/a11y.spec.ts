/** REQ-UI-013：全部已实现路由 axe 0 serious / critical（Phase 0 + T1-002 空间页）。 */
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { createEntry, STATE } from './helpers.ts'

const scan = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    )
}

test.describe('anon', () => {
  for (const path of [
    '/login',
    '/login/2fa',
    '/register',
    '/invite/01920000-0000-7000-8000-000000000999',
  ]) {
    test(`REQ-UI-013 axe ${path}`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      expect(await scan(page)).toEqual([])
    })
  }
})

test.describe('owner', () => {
  test.use({ storageState: STATE.owner })
  for (const theme of ['light', 'dark'] as const) {
    test(`REQ-UI-013 axe 已登录路由（${theme}）`, async ({ page, request }) => {
      // 32 条路由逐个扫描：dev 模式下全规则集 axe 每条约 10 s + 加载 2 s（2026-10-02 实测，main 基线同值），240 s 已不够（debug/2026-10-02-a11y-axe-route-timeout）
      test.setTimeout(600_000)
      // ADR-0049：外观随账号保存，登录后按账号生效值（未选 = 跟随系统）覆盖本机缓存——用系统主题指定
      await page.emulateMedia({ colorScheme: theme })
      await page.addInitScript((t) => localStorage.setItem('xz:theme', t), theme)
      const id = await createEntry(request, {
        kind: 'decision',
        title: 'axe',
        fields: { status: 'proposed' },
      })
      for (const path of [
        '/today',
        '/tasks',
        `/entries/${id}`,
        '/settings/security',
        '/settings',
        '/settings/notifications',
        '/settings/api-keys',
        '/settings/workspace',
        '/settings/workspace/members',
        '/settings/workspace/users',
        '/settings/workspace/audit',
        '/settings/tags',
        '/entries?kind=bug&view=board',
        '/entries',
        '/spaces/product/entries',
        '/spaces/product?view=list',
        '/inbox',
        '/search?q=%E7%BC%93%E5%AD%98',
        '/notifications',
        '/trash',
        '/spaces',
        '/spaces?archived=1',
        '/spaces/product',
        '/calendar',
        '/calendar?view=week',
        '/calendar?view=day',
        '/calendar?view=year',
        '/settings/design?page=tokens',
        '/settings/design?page=materials',
        '/settings/design?page=depth',
        '/settings/design?page=switch',
        '/settings/design?page=components',
      ]) {
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        expect(await scan(page), `${path} (${theme})`).toEqual([])
      }
    })
  }
})
