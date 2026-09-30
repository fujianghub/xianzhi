CREATE TABLE "builtin_template_overrides" (
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text,
	"description" text,
	"kind" text,
	"space_kinds" jsonb,
	"fields" jsonb,
	"body" jsonb,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builtin_template_overrides_workspace_id_key_pk" PRIMARY KEY("workspace_id","key"),
	CONSTRAINT "builtin_template_overrides_kind_ck" CHECK ("builtin_template_overrides"."kind" is null or "builtin_template_overrides"."kind" in ('decision', 'iteration', 'bug', 'changelog', 'journal', 'note', 'review', 'optimize', 'plan'))
);
--> statement-breakpoint
ALTER TABLE "entry_templates" DROP CONSTRAINT "entry_templates_scope_ck";--> statement-breakpoint
ALTER TABLE "builtin_template_overrides" ADD CONSTRAINT "builtin_template_overrides_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_templates" ADD CONSTRAINT "entry_templates_scope_ck" CHECK ("entry_templates"."scope" in ('personal', 'workspace', 'builtin'));