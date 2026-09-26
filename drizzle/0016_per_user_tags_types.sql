ALTER TABLE "entry_types" DROP CONSTRAINT "entry_types_workspace_name_uq";--> statement-breakpoint
ALTER TABLE "tags" DROP CONSTRAINT "tags_workspace_name_uq";--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_owner_name_uq" UNIQUE("workspace_id","created_by","name");--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_name_uq" UNIQUE("workspace_id","created_by","name");--> statement-breakpoint
-- ADR-0017：标签 / 自定义类型按人隔离；无主的旧数据归工作区所有者
UPDATE "tags" t SET "created_by" = m."user_id" FROM "member" m WHERE t."created_by" IS NULL AND m."organization_id" = t."workspace_id" AND m."role" = 'owner';--> statement-breakpoint
UPDATE "entry_types" e SET "created_by" = m."user_id" FROM "member" m WHERE e."created_by" IS NULL AND m."organization_id" = e."workspace_id" AND m."role" = 'owner';