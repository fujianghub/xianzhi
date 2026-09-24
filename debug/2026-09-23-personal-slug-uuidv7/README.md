# 个人空间 slug 取 UUID v7 前 8 位，同一分钟加入的成员撞唯一约束

- 日期：2026-09-23
- 影响范围：server（services/spaces.ts）、规范 01 §3.1
- 严重度：high（第二个成员无法接受邀请）
- 相关：T0-007 · T0-010 · REQ-SPACE-009

## 症状
`POST /api/v1/workspace/invitations/:id/accept` 返回 500；日志 `duplicate key value violates unique constraint "spaces_workspace_slug_uq"`，params 里两次都是 `me-01a0ce45`。

## 复现
`pnpm gi create-owner` 后一分钟内接受任一邀请；或 `authz`/`invitations` 测试同文件内先 seedOwner 再 accept。

## 根因
01 §3.1 规定 slug = `me-<userId 前 8 位>`，但 01 §1 又规定主键是 UUID v7——v7 的前 48 bit 是 Unix 毫秒时间戳，前 8 个十六进制字符只覆盖到约 4.5 分钟粒度，同一时段建号的用户前缀完全相同。`src/server/services/spaces.ts:personalSlug` 忠实实现了规范，规范本身有缺陷。

## 修复
`personalSlug()` 改取去掉连字符后的**末 8 位**（v7 末 62 bit 为随机）；01 §3.1 加注并保留删除线；CHANGELOG 记录。`(workspace_id, slug)` 唯一约束保留作兜底。

## 验证
`invitations.test.ts` REQ-AUTH-003 接受用例绿（owner 与受邀者同一秒内建号）；`auth.test.ts` REQ-SPACE-009 的 `^me-[0-9a-f]{8}$` 断言仍通过。回归风险：已有数据的 slug 不变（个人空间不可改名，slug 只在创建时生成）。
