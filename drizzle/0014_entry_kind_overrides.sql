CREATE TABLE "entry_kind_overrides" (
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"color" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_kind_overrides_workspace_id_kind_pk" PRIMARY KEY("workspace_id","kind"),
	CONSTRAINT "entry_kind_overrides_kind_ck" CHECK ("entry_kind_overrides"."kind" in ('decision', 'iteration', 'bug', 'changelog', 'journal', 'note', 'review', 'optimize', 'plan')),
	CONSTRAINT "entry_kind_overrides_color_ck" CHECK ("entry_kind_overrides"."color" is null or "entry_kind_overrides"."color" in ('blue', 'orange', 'yellow', 'red', 'green', 'purple', 'pink', 'cyan', 'gray'))
);
--> statement-breakpoint
ALTER TABLE "entry_kind_overrides" ADD CONSTRAINT "entry_kind_overrides_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ADR-0017：原「隐藏的内置类型」迁为「已删除」（可在类型管理页恢复）
INSERT INTO "entry_kind_overrides" ("workspace_id", "kind", "deleted") SELECT "workspace_id", "kind", true FROM "hidden_entry_kinds" ON CONFLICT DO NOTHING;