/** Better Auth 客户端（登录 / 2FA / Passkey / 魔法链接）。 */
import { passkeyClient } from '@better-auth/passkey/client'
import { magicLinkClient, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? 'http://localhost:3010' : window.location.origin,
  basePath: '/api/auth',
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.assign(`/login/2fa${window.location.search}`)
      },
    }),
    passkeyClient(),
    magicLinkClient(),
  ],
})
