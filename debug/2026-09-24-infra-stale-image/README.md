# e2e:infra 一直在测 Phase 0 的旧镜像

- 日期：2026-09-24
- 影响范围：`e2e/infra.spec.ts`（生产栈 / Caddy / Lighthouse）
- 严重度：medium（基础设施层测试结果与当前代码无关，REQ-ATTACH-010 被误判为失败）
- 相关：REQ-ATTACH-010 · REQ-UI-015 · 05 §3 `pnpm e2e:infra`

## 症状
Phase 1 验收时跑 `pnpm e2e:infra`：REQ-ATTACH-010「经 Caddy 访问 `/data/...` 应返回 404」得到 200；Lighthouse 用例因串行模式被跳过；整轮只用了 28 秒。

## 复现
改代码后直接 `pnpm e2e:infra`（本机已有 `growing-interlude:local`）。

## 根因
`infra.spec.ts` 用 `docker image inspect` 判断镜像是否存在，存在就跳过构建。本机的 `growing-interlude:local` 是 13 小时前（Phase 0）构建的，而 `/data`、`/uploads` 的 404 处理是 G3 才加到 app.ts 的。

## 修复
用新标签触发重建：`GI_IMAGE=growing-interlude:p1 pnpm e2e:infra`（compose 与测试都读取 `GI_IMAGE`），5/5 绿。没有删除旧镜像（删除需先确认）。05 §3 已加注：代码改动后必须换标签重建。

## 验证
新镜像下 REQ-OPS-002 · 005、REQ-ATTACH-010 通过，Lighthouse 中位 90。
