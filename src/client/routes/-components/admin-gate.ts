/** 工作区设置页门禁（T1-043）：非 owner/admin 一律 404（不暴露页面存在，02 §2）。 */
import { notFound } from '@tanstack/react-router'
import { isAdmin, type Me } from '../../hooks/useMe.ts'

export function requireAdmin({ context }: { context: unknown }) {
  if (!isAdmin((context as { me?: Me }).me)) throw notFound()
}
