CREATE TABLE "entry_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"space_kind" text,
	"body" jsonb NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_templates_scope_ck" CHECK ("entry_templates"."scope" in ('personal', 'workspace')),
	CONSTRAINT "entry_templates_kind_ck" CHECK ("entry_templates"."kind" in ('decision', 'iteration', 'bug', 'changelog', 'journal', 'note', 'review', 'optimize', 'plan')),
	CONSTRAINT "entry_templates_space_kind_ck" CHECK ("entry_templates"."space_kind" is null or "entry_templates"."space_kind" in ('project', 'learning', 'work'))
);
--> statement-breakpoint
ALTER TABLE "entries" DROP CONSTRAINT "entries_kind_ck";--> statement-breakpoint
ALTER TABLE "entry_templates" ADD CONSTRAINT "entry_templates_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_templates" ADD CONSTRAINT "entry_templates_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_templates_workspace_scope_idx" ON "entry_templates" USING btree ("workspace_id","scope");--> statement-breakpoint
CREATE INDEX "entry_templates_owner_idx" ON "entry_templates" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_kind_ck" CHECK ("entries"."kind" in ('decision', 'iteration', 'bug', 'changelog', 'journal', 'note', 'review', 'optimize', 'plan'));