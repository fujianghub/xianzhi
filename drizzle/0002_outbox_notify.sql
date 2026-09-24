-- 出箱提交后即时接力（01 §3.10「事务提交后 best-effort 再 send outbox.drain」）：
-- NOTIFY 只在事务提交后投递；worker LISTEN xz_outbox 后立即 drainOnce。5s 自循环仍是兜底。
CREATE OR REPLACE FUNCTION xz_events_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('xz_outbox', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS xz_events_notify ON events;
--> statement-breakpoint
CREATE TRIGGER xz_events_notify AFTER INSERT ON events FOR EACH STATEMENT EXECUTE FUNCTION xz_events_notify();
