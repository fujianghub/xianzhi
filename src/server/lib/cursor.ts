/** 游标（02 §4）：base64url(JSON [sortValue, id])。 */
export function encodeCursor(parts: (string | number | null)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url')
}
export function decodeCursor(
  cursor: string | undefined,
  size: number,
): (string | number | null)[] | null {
  if (!cursor) return null
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!Array.isArray(v) || v.length !== size) return null
    return v as (string | number | null)[]
  } catch {
    return null
  }
}
