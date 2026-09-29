-- ADR-0033：Bug 四态状态 · 优先级 · 发现 / 解决日期（数据迁移）；保存视图排序键按字节序比较（同 0003）。
ALTER TABLE "entry_views" ALTER COLUMN "sort_key" TYPE text COLLATE "C";--> statement-breakpoint
UPDATE "entries" SET "fields" = jsonb_set("fields", '{status}', '"new"') WHERE "kind" = 'bug' AND "fields"->>'status' = 'open';--> statement-breakpoint
UPDATE "entries" SET "fields" = "fields" || '{"priority":"p2"}'::jsonb WHERE "kind" = 'bug' AND NOT ("fields" ? 'priority');--> statement-breakpoint
UPDATE "entries" e SET "fields" = e."fields" || jsonb_build_object('foundAt', to_char(e."created_at" AT TIME ZONE coalesce(u."timezone", 'Asia/Shanghai'), 'YYYY-MM-DD')) FROM "user" u WHERE u."id" = e."author_id" AND e."kind" = 'bug' AND NOT (e."fields" ? 'foundAt');--> statement-breakpoint
UPDATE "entries" e SET "fields" = e."fields" || jsonb_build_object('resolvedAt', greatest(e."fields"->>'foundAt', to_char(e."updated_at" AT TIME ZONE coalesce(u."timezone", 'Asia/Shanghai'), 'YYYY-MM-DD'))) FROM "user" u WHERE u."id" = e."author_id" AND e."kind" = 'bug' AND e."fields"->>'status' IN ('fixed', 'wontfix') AND NOT (e."fields" ? 'resolvedAt');--> statement-breakpoint
UPDATE "entry_templates" SET "fields" = jsonb_set("fields", '{status}', '"new"') WHERE "kind" = 'bug' AND "fields"->>'status' = 'open';--> statement-breakpoint
UPDATE "entry_templates" SET "fields" = "fields" - 'foundAt' - 'resolvedAt' WHERE "kind" = 'bug';
