/** 展开缩写引用：「REQ-WS-004 · 012 · 013」→ 三个完整 id。 */
export function reqIds(title: string): string[] {
  const ids = new Set<string>()
  for (const g of title.matchAll(/(REQ-[A-Z]+)-(\d{3})((?:\s*[·,，]\s*\d{3})*)/g)) {
    ids.add(`${g[1]}-${g[2]}`)
    for (const n of (g[3] ?? '').matchAll(/\d{3}/g)) ids.add(`${g[1]}-${n[0]}`)
  }
  return [...ids]
}
