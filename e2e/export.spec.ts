/** REQ-EXPORT-001（e2e，真实 pg-boss worker）：导出 → 作业完成 → 通知 → 下载 zip 结构断言。 */
import { expect, test } from '@playwright/test'
import { unzipSync } from 'fflate'
import { BASE, STATE, sameSite } from './helpers.ts'

test.use({ storageState: STATE.owner })

test('REQ-EXPORT-001 导出空间 → 轮询 /jobs/:id 完成 → 收到 system.export_done → 下载 zip 含 <space>/<kind>/<date>-<slug>.md', async ({
  playwright,
}) => {
  const req = await playwright.request.newContext({ baseURL: BASE, storageState: STATE.owner })
  const product = (await (await req.get('/api/v1/spaces/product')).json()) as { id: string }
  const r = await req.post('/api/v1/exports', {
    data: { scope: 'space', id: product.id },
    headers: sameSite,
  })
  expect(r.status()).toBe(202)
  const { jobId } = (await r.json()) as { jobId: string }
  let job: { status: string; resultUrl?: string } = { status: 'queued' }
  await expect
    .poll(
      async () => {
        job = (await (await req.get(`/api/v1/jobs/${jobId}`)).json()) as typeof job
        return job.status
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe('completed')
  const dl = await req.get(job.resultUrl ?? '')
  expect(dl.status()).toBe(200)
  const files = Object.keys(unzipSync(new Uint8Array(await dl.body())))
  expect(files.some((f) => /^product\/[a-z]+\/\d{4}-\d{2}-\d{2}-.+\.md$/.test(f))).toBe(true)
  expect(files).toContain('README.md')
  await expect
    .poll(
      async () => {
        const n = (await (await req.get('/api/v1/notifications?limit=50')).json()) as {
          items: { kind: string }[]
        }
        return n.items.some((x) => x.kind === 'system.export_done')
      },
      { timeout: 15_000 },
    )
    .toBe(true)
  await req.dispose()
})
