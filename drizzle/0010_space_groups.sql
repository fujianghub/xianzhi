CREATE TABLE "space_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"icon" text,
	"description" text,
	"sort_key" text NOT NULL,
	"created_by" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_groups_workspace_name_uq" UNIQUE("workspace_id","name"),
	CONSTRAINT "space_groups_color_ck" CHECK ("space_groups"."color" is null or "space_groups"."color" in ('blue', 'orange', 'yellow', 'red', 'green', 'purple', 'pink', 'cyan', 'gray'))
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "space_groups" ADD CONSTRAINT "space_groups_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_groups" ADD CONSTRAINT "space_groups_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_group_id_space_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."space_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- 手写（ADR-0012）：sort_key 按字节序比较（同 0003）；为已有工作区预置三个大类，已有知识库按类型归入。
ALTER TABLE "space_groups" ALTER COLUMN "sort_key" TYPE text COLLATE "C";--> statement-breakpoint
INSERT INTO "space_groups" ("id", "workspace_id", "name", "color", "icon", "sort_key")
SELECT gen_random_uuid(), o."id", g."name", g."color", g."icon", g."sort_key"
FROM "organization" o
CROSS JOIN (VALUES ('产品开发', 'blue', 'rocket', 'a0'), ('技术学习规划', 'purple', 'graduation-cap', 'a1'), ('生活', 'green', 'leaf', 'a2')) AS g("name", "color", "icon", "sort_key")
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "spaces" s SET "group_id" = g."id"
FROM "space_groups" g
WHERE g."workspace_id" = s."workspace_id" AND NOT s."is_personal" AND s."group_id" IS NULL
  AND ((s."kind" = 'project' AND g."name" = '产品开发') OR (s."kind" = 'learning' AND g."name" = '技术学习规划'));
