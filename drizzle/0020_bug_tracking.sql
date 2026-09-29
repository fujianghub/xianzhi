CREATE TABLE "entry_field_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"actor_id" text,
	"field" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_field_changes_field_ck" CHECK ("entry_field_changes"."field" in ('status', 'priority', 'severity'))
);
--> statement-breakpoint
CREATE TABLE "entry_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"space_id" uuid,
	"name" text NOT NULL,
	"search" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_key" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entry_field_changes" ADD CONSTRAINT "entry_field_changes_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_field_changes" ADD CONSTRAINT "entry_field_changes_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_field_changes" ADD CONSTRAINT "entry_field_changes_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_views" ADD CONSTRAINT "entry_views_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_views" ADD CONSTRAINT "entry_views_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_views" ADD CONSTRAINT "entry_views_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_field_changes_entry_idx" ON "entry_field_changes" USING btree ("entry_id","created_at");--> statement-breakpoint
CREATE INDEX "entry_field_changes_ws_field_idx" ON "entry_field_changes" USING btree ("workspace_id","field","created_at");--> statement-breakpoint
CREATE INDEX "entry_views_owner_idx" ON "entry_views" USING btree ("workspace_id","owner_id","sort_key");