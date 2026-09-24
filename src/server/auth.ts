/**
 * Better Auth 接入（T0-006；ADR-0001 §4.6、01 §2、02 §2、07 §2.1）。
 * - 不开放注册：emailAndPassword.disableSignUp + magicLink.disableSignUp
 * - 插件：organization / admin / twoFactor / magicLink / passkey / apiKey
 * - impersonation 一期禁用：impersonationSessionDuration = 0，且路由层对 /admin/impersonate-user 返回 404（index.ts）
 * - 表由 `pnpm auth:generate` 生成到 db/schema/auth.ts
 */
import { apiKey } from '@better-auth/api-key'
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, magicLink, organization, twoFactor } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { v7 } from 'uuid'
import { type Db, getDb } from './db/index.ts'
import * as authSchema from './db/schema/auth.ts'
import { getEnv } from './env.ts'
import { sendMail } from './mail/index.ts'
import { sendWorkspaceInvitation } from './mail/invitation.ts'

const DAY = 60 * 60 * 24

export function createAuth(db: Db, opts: { baseURL: string; secret: string; appURL: string }) {
  const appHost = new URL(opts.appURL).hostname
  return betterAuth({
    appName: 'Xianzhi',
    baseURL: opts.baseURL,
    basePath: '/api/auth',
    secret: opts.secret,
    trustedOrigins: [opts.appURL],
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    advanced: {
      database: { generateId: () => v7() },
      cookiePrefix: 'xz',
      useSecureCookies: opts.appURL.startsWith('https://'),
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    },
    session: {
      expiresIn: 7 * DAY,
      updateAge: DAY,
      cookieCache: { enabled: false },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // REQ-AUTH-002
      minPasswordLength: 10,
      resetPasswordTokenExpiresIn: 15 * 60, // 07 §5：15 分钟一次性
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: '重置密码 · 衔枝',
          text: `点击链接重置密码（15 分钟内有效）：${url}`,
        })
      },
    },
    user: {
      additionalFields: {
        displayName: { type: 'string', required: false, input: true },
        avatarAttachmentId: { type: 'string', required: false, input: false },
        locale: { type: 'string', required: false, defaultValue: 'zh-CN', input: true },
        timezone: { type: 'string', required: false, defaultValue: 'Asia/Shanghai', input: true },
        weekStartsOn: { type: 'number', required: false, defaultValue: 1, input: true },
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 }, // REQ-AUTH-012 IP 维度；邮箱维度在 middleware/loginGuard
        '/magic-link': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 10 },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false, // 唯一 Workspace 由 create-owner 建
        organizationLimit: 1,
        membershipLimit: 50, // 07 §5
        invitationExpiresIn: 7 * DAY, // 07 §5：7 天一次性
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async ({ email, invitation, inviter, organization: org }) => {
          // 与 services/invitations.ts 共用同一模板模块（01 §4.1）
          await sendWorkspaceInvitation(email, {
            inviterName: inviter.user.name || inviter.user.email,
            workspaceName: org.name,
            role: invitation.role,
            url: `${opts.appURL}/invite/${invitation.id}`,
            expiresDays: 7,
          })
        },
      }),
      admin({
        defaultRole: 'user',
        impersonationSessionDuration: 0, // REQ-AUTH-015：一期禁用（路由层再拦 404）
      }),
      twoFactor({
        issuer: 'Xianzhi',
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 10 }, // 07 §2.1：10 个恢复码
      }),
      magicLink({
        disableSignUp: true, // REQ-AUTH-002 / 07 §2.1：陌生邮箱不建号
        expiresIn: 15 * 60,
        sendMagicLink: async ({ email, url }) => {
          // 07 §2.1：陌生邮箱不发信、不建号，响应与已注册一致（不泄露存在性）
          const known = await db
            .select({ id: authSchema.user.id })
            .from(authSchema.user)
            .where(eq(authSchema.user.email, email.toLowerCase()))
            .limit(1)
          if (!known[0]) return
          await sendMail({
            to: email,
            subject: '登录链接 · 衔枝',
            text: `点击链接登录（15 分钟内一次性有效）：${url}`,
          })
        },
      }),
      passkey({
        rpID: appHost,
        rpName: 'Xianzhi',
        origin: opts.appURL,
      }),
      apiKey({
        defaultPrefix: 'xz_',
        enableMetadata: true,
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 300 }, // 07 §5：300/min/Key
        keyExpiration: { defaultExpiresIn: null, disableCustomExpiresTime: false },
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

let singleton: Auth | undefined
export function getAuth(): Auth {
  if (!singleton) {
    const env = getEnv()
    singleton = createAuth(getDb(), {
      baseURL: env.BETTER_AUTH_URL,
      secret: env.BETTER_AUTH_SECRET,
      appURL: env.APP_URL,
    })
  }
  return singleton
}

/** Better Auth CLI 需要一个默认导出的实例（`pnpm auth:generate`）。 */
export const auth = process.env.BETTER_AUTH_CLI === '1' ? getAuth() : undefined
