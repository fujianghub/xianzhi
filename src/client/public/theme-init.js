// 首帧前设置主题（06 §6），避免闪白；CSP 允许 'self' 脚本，故放外链文件而非内联
;(() => {
  let theme = 'light'
  try {
    const saved = localStorage.getItem('xz:theme')
    const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    theme = saved === 'light' || saved === 'dark' ? saved : sys
  } catch (_) {}
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  // 动效档位（04 §2.4、REQ-UI-028）：standard 不写属性
  try {
    const m = localStorage.getItem('xz:motion')
    if (m === 'reduce' || m === 'rich') document.documentElement.dataset.motion = m
  } catch (_) {}
})()
