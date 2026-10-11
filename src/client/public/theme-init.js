// 首帧前设置主题（06 §6），避免闪白；CSP 允许 'self' 脚本，故放外链文件而非内联
;(() => {
  let theme = 'light'
  try {
    const saved = localStorage.getItem('xz:theme')
    const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    theme = saved === 'light' || saved === 'dark' ? saved : sys
  } catch (_) {}
  // 主题（ADR-0059 · 0060）：缓存的样式表同步注入，明暗锁定为主题自带模式；
  // 认证页不知道是谁，用工作区默认主题的缓存（xz:skin-default），其余页面用本人生效主题（xz:skin）
  let skin = null
  try {
    const auth = /^\/(login|register|invite)(\/|$)/.test(location.pathname)
    const s = JSON.parse(localStorage.getItem(auth ? 'xz:skin-default' : 'xz:skin') || 'null')
    if (
      s &&
      typeof s.css === 'string' &&
      /^[a-z0-9][a-z0-9-]{0,63}$/.test(s.id) &&
      (s.mode === 'light' || s.mode === 'dark')
    )
      skin = s
  } catch (_) {}
  if (skin) {
    theme = skin.mode
    const el = document.createElement('style')
    el.id = 'xz-skin'
    el.textContent = skin.css
    document.head.appendChild(el)
    document.documentElement.dataset.skin = skin.id
  }
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  // 动效档位（04 §2.4、REQ-UI-028）：standard 不写属性
  try {
    const m = localStorage.getItem('xz:motion')
    if (m === 'reduce' || m === 'rich') document.documentElement.dataset.motion = m
  } catch (_) {}
  // 玻璃强度（ADR-0047）：默认 liquid 流光（不存储）；standard 不写属性
  let glass = 'liquid'
  try {
    const g = localStorage.getItem('xz:glass')
    if (g === 'standard' || g === 'clear' || g === 'vivid') glass = g
  } catch (_) {}
  if (glass !== 'standard' && !skin) document.documentElement.dataset.glass = glass
})()
