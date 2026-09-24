/**
 * 邮件出口（T0-010 接 nodemailer + react-email → Mailpit）。此处先定义接口与可替换实现，
 * 便于测试注入；未配置 SMTP 时降级为日志。
 */
export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export type MailSender = (msg: MailMessage) => Promise<void>

let sender: MailSender = async (msg) => {
  console.info(`[mail:noop] to=${msg.to} subject=${msg.subject}`)
}

export function setMailSender(fn: MailSender): void {
  sender = fn
}

export function sendMail(msg: MailMessage): Promise<void> {
  return sender(msg)
}
