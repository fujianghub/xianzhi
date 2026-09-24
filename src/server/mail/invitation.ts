/** 渲染并发送邀请邮件；Better Auth `sendInvitationEmail` 钩子与 invitations service 共用。 */
import { render } from '@react-email/render'
import { sendMail } from './index.ts'
import {
  WorkspaceInvitationEmail,
  type WorkspaceInvitationProps,
  workspaceInvitationText,
} from './templates/workspace-invitation.tsx'

export async function sendWorkspaceInvitation(
  to: string,
  p: WorkspaceInvitationProps,
): Promise<void> {
  const html = await render(WorkspaceInvitationEmail(p))
  await sendMail({
    to,
    subject: `${p.inviterName} 邀请你加入 ${p.workspaceName} · 衔枝`,
    text: workspaceInvitationText(p),
    html,
  })
}
