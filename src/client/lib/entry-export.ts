/**
 * 单篇导出下载（02 §10 `POST /entries/:id/export?format=md|html`）：POST 取回文件后以 Blob 触发下载。
 * 不能用 `location.href`（那是 GET，路由只挂了 POST）。
 */
import { ApiError, type Problem } from './api.ts'

const nameFrom = (disposition: string | null, fallback: string) => {
  const star = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (star) return decodeURIComponent(star)
  return disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback
}

export async function downloadEntryExport(id: string, format: 'md' | 'html' = 'md') {
  const res = await fetch(`/api/v1/entries/${id}/export?format=${format}`, {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let problem: Problem = { status: res.status, code: 'INTERNAL' }
    try {
      problem = (await res.json()) as Problem
    } catch {
      /* 非 JSON */
    }
    throw new ApiError({ ...problem, status: res.status })
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = nameFrom(res.headers.get('content-disposition'), `entry.${format}`)
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
