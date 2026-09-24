/** nodemailer SMTP 出口（05 §2：dev 走 Mailpit 1025；生产走腾讯云 SES）。未配置 SMTP_HOST 时保持 noop。 */
import nodemailer from 'nodemailer'
import type { Env } from '../env.ts'
import { type MailSender, setMailSender } from './index.ts'

export function createSmtpSender(
  env: Pick<Env, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'MAIL_FROM'>,
): MailSender | null {
  if (!env.SMTP_HOST) return null
  const port = env.SMTP_PORT ?? 587
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
  })
  const from = env.MAIL_FROM ?? 'Xianzhi <no-reply@xz.local>'
  return async (msg) => {
    await transport.sendMail({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    })
  }
}

/** 启动时调用：有 SMTP 配置则注入真实出口。 */
export function configureMail(env: Env): boolean {
  const s = createSmtpSender(env)
  if (s) setMailSender(s)
  return s !== null
}
