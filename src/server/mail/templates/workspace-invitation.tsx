/** @jsxRuntime automatic @jsxImportSource react */
/** 工作区邀请邮件（01 §4.1、07 §4）：深链不带任何凭据；只含标题级信息。 */
import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

export interface WorkspaceInvitationProps {
  inviterName: string
  workspaceName: string
  role: string
  url: string
  expiresDays: number
}

export function WorkspaceInvitationEmail(p: WorkspaceInvitationProps) {
  return (
    <Html lang="zh-CN">
      <Head />
      <Preview>{`${p.inviterName} 邀请你加入 ${p.workspaceName}`}</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', backgroundColor: '#f6f6f7', margin: 0 }}>
        <Container
          style={{
            maxWidth: 520,
            margin: '32px auto',
            padding: 24,
            backgroundColor: '#ffffff',
            borderRadius: 12,
          }}
        >
          <Text
            style={{ fontSize: 18, fontWeight: 600 }}
          >{`${p.inviterName} 邀请你加入 ${p.workspaceName}`}</Text>
          <Text>{`你的角色：${p.role}。链接 ${p.expiresDays} 天内有效，仅限本邮箱使用一次。`}</Text>
          <Section style={{ margin: '24px 0' }}>
            <Button
              href={p.url}
              style={{
                backgroundColor: '#1d4ed8',
                color: '#ffffff',
                padding: '10px 18px',
                borderRadius: 8,
              }}
            >
              接受邀请
            </Button>
          </Section>
          <Text
            style={{ fontSize: 12, color: '#6b7280' }}
          >{`若按钮无法打开，复制此链接：${p.url}`}</Text>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>衔枝 · Xianzhi</Text>
        </Container>
      </Body>
    </Html>
  )
}

export function workspaceInvitationText(p: WorkspaceInvitationProps): string {
  return [
    `${p.inviterName} 邀请你加入 ${p.workspaceName}（角色：${p.role}）。`,
    `打开链接接受邀请（${p.expiresDays} 天内有效，仅限本邮箱使用一次）：`,
    p.url,
    '',
    '衔枝 · Xianzhi',
  ].join('\n')
}
