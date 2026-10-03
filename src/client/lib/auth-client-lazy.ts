/**
 * 认证页按需加载 Better Auth 客户端（REQ-UI-015 首屏 JS ≤ 250 KB）：客户端连同 passkey / webauthn 约 16 KB gzip，
 * 只有点「登录 / 验证 / 通行密钥 / 魔法链接」时才用到——首屏不带，交互时再取（并缓存同一个 Promise）。
 * 已登录应用（AppShell、设置 → 安全）照常静态引用 `auth-client.ts`。
 */
let pending: Promise<typeof import('./auth-client.ts')['authClient']> | null = null

export function loadAuthClient() {
  pending ??= import('./auth-client.ts').then((m) => m.authClient)
  return pending
}
