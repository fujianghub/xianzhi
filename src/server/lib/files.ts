/** DATA_DIR 下的文件操作（附件、导出、备份）；路径一律由服务端生成，拒绝越界。 */
import { readdir, rm, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

export function dataPath(dataDir: string, ...parts: string[]): string {
  const root = resolve(dataDir)
  const p = resolve(root, ...parts)
  if (p !== root && !p.startsWith(root + sep))
    throw new Error(`path escapes DATA_DIR: ${parts.join('/')}`)
  return p
}

export async function removeQuietly(path: string): Promise<boolean> {
  try {
    await rm(path, { force: true })
    return true
  } catch {
    return false
  }
}

/** 删除目录下 mtime 早于 cutoff 的普通文件；返回删除数。目录不存在视为 0。 */
export async function removeOlderThan(
  dir: string,
  cutoff: Date,
  match: RegExp = /./,
): Promise<number> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  let n = 0
  for (const name of names) {
    if (!match.test(name)) continue
    const p = join(dir, name)
    const s = await stat(p).catch(() => null)
    if (s?.isFile() && s.mtime < cutoff && (await removeQuietly(p))) n++
  }
  return n
}
