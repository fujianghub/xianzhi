ALTER TABLE "entries" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "tree_order" text;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- 手写（ADR-0012）：目录顺序键按字节序比较（同 0003），须在建索引前改列排序规则
ALTER TABLE "entries" ALTER COLUMN "tree_order" TYPE text COLLATE "C";--> statement-breakpoint
CREATE INDEX "entries_space_tree_idx" ON "entries" USING btree ("space_id","parent_id","tree_order");