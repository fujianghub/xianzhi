-- 标题子串兜底（02 §4.1、REQ-SEARCH-003）。同一版本起 tsv 改为「标题 A + 正文 D」加权（services/derived.ts weightedTsv）：
-- 分词在 JS（jieba），迁移无法在库内重算——升级后执行一次 `pnpm xz rebuild-derived`。
CREATE INDEX "entries_title_trgm_idx" ON "entries" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tags_name_trgm_idx" ON "tags" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tasks_title_trgm_idx" ON "tasks" USING gin ("title" gin_trgm_ops);