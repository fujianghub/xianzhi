# 发往 Mailpit 的每封邮件耗时 2.4–7 秒，拖慢通知扇出

- 日期：2026-09-24
- 影响范围：infra（dev）、server（通知扇出）
- 严重度：medium
- 相关：T0-024 · REQ-NOTIF-002

## 症状
e2e「事件后 2s 内铃铛 +1」失败；`notify.fanout` 作业从开始到完成约 2.5s，通知行在作业末尾才插入。

## 复现
```
python3 -c "import socket,time;t=time.time();s=socket.create_connection(('127.0.0.1',1025));s.recv(100);print(time.time()-t)"
```
输出约 2.4s；用 `localhost` 连接总耗时约 7.2s。

## 根因
1. Mailpit 在发 220 欢迎语前对客户端 IP（Docker 网关）做反向 DNS，这里超时约 2.4s。
2. `localhost` 先解析到 `::1`，连 Docker 发布端口先超时再回落 IPv4，再多约 5s。
3. 扇出作业里同步发信，且 fanout worker 串行，一个慢邮件阻塞后续事件的站内通知。

## 修复
- `infra/docker-compose.yml` 给 Mailpit 加 `MP_SMTP_DISABLE_RDNS=1`；`.env.example` 与验证环境 `SMTP_HOST=127.0.0.1`。
- 架构上把发信拆成独立作业 `notify.email`（`services/notify.ts:sendNotificationEmail`），扇出只落 `pending` 投递行；`notify.fanout` 并发 4、轮询 0.5s。
- 出箱加提交后即时接力：`events` 插入触发器 `pg_notify('gi_outbox')`，worker `LISTEN` 后立即 drain（`drizzle/0002_outbox_notify.sql`）。

## 验证
欢迎语延迟 0.00s；`notify.test.ts` REQ-NOTIF-001 断言事件 → 通知 < 2s；e2e REQ-NOTIF-002 绿。
