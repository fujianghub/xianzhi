/** REQ-NOTIF-009：邀请邮件经 nodemailer 真实送达 Mailpit（pnpm db:up 提供 1025/8025）。 */
import { describe, expect, it } from 'vitest'
import { setMailSender } from '../mail/index.ts'
import { sendWorkspaceInvitation } from '../mail/invitation.ts'
import { createSmtpSender } from '../mail/transport.ts'

const MAILPIT = process.env.XZ_MAILPIT_URL ?? 'http://localhost:8025'

async function searchMailpit(query: string) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error(`Mailpit ${res.status}`)
  return (await res.json()) as {
    messages: { ID: string; Subject: string; To: { Address: string }[] }[]
  }
}

describe('mail → Mailpit', () => {
  it('REQ-NOTIF-009 Mailpit 收到邀请邮件（HTML + 纯文本，含 /invite/ 链接）', async () => {
    const sender = createSmtpSender({
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      SMTP_USER: undefined,
      SMTP_PASS: undefined,
      MAIL_FROM: 'Xianzhi <no-reply@xz.local>',
    })
    expect(sender).not.toBeNull()
    setMailSender(sender!)
    const to = `invitee-${Date.now()}@xz.local`
    const url = 'http://localhost:3010/invite/01920000-0000-7000-8000-000000000001'
    await sendWorkspaceInvitation(to, {
      inviterName: 'Owner',
      workspaceName: '衔枝',
      role: 'member',
      url,
      expiresDays: 7,
    })

    let found: { ID: string; Subject: string } | undefined
    for (let i = 0; i < 20 && !found; i++) {
      const r = await searchMailpit(`to:${to}`)
      found = r.messages[0]
      if (!found) await new Promise((res) => setTimeout(res, 250))
    }
    expect(found, 'Mailpit 未收到邮件').toBeDefined()
    expect(found?.Subject).toContain('邀请你加入 衔枝')
    const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${found?.ID}`)).json()) as {
      HTML: string
      Text: string
    }
    expect(msg.HTML).toContain(url)
    expect(msg.Text).toContain(url)
  })
})
