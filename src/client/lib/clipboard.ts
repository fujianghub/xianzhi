/**
 * 复制文本。`navigator.clipboard` 只在安全上下文存在；按局域网 IP 走 HTTP 时退回 execCommand('copy')。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 权限被拒时继续走降级
    }
  }
  // 降级要选中临时 textarea，会抢走焦点：复制完还给原元素（热键可能在编辑器里按下，ADR-0058）
  const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    return document.execCommand('copy')
  } finally {
    ta.remove()
    prev?.focus({ preventScroll: true })
  }
}
