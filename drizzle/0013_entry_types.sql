CREATE TABLE "entry_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"statuses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_types_workspace_name_uq" UNIQUE("workspace_id","name"),
	CONSTRAINT "entry_types_color_ck" CHECK ("entry_types"."color" in ('blue', 'orange', 'yellow', 'red', 'green', 'purple', 'pink', 'cyan', 'gray'))
);
--> statement-breakpoint
CREATE TABLE "hidden_entry_kinds" (
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_entry_kinds_workspace_id_kind_pk" PRIMARY KEY("workspace_id","kind"),
	CONSTRAINT "hidden_entry_kinds_kind_ck" CHECK ("hidden_entry_kinds"."kind" in ('decision', 'iteration', 'bug', 'changelog', 'journal', 'note', 'review', 'optimize', 'plan'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_ck";--> statement-breakpoint
ALTER TABLE "entries" DROP CONSTRAINT "entries_kind_ck";--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "type_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hidden_entry_kinds" ADD CONSTRAINT "hidden_entry_kinds_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_type_id_entry_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."entry_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_type_idx" ON "entries" USING btree ("type_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_ck" CHECK ("audit_log"."action" in ('auth.login', 'auth.logout', 'auth.login_failed', 'auth.locked', 'auth.password_reset', 'auth.password_changed', 'auth.2fa_enabled', 'auth.2fa_disabled', 'auth.2fa_reset_by_admin', 'member.invited', 'member.joined', 'member.registered', 'member.approved', 'member.rejected', 'member.role_changed', 'member.suspended', 'member.unsuspended', 'member.removed', 'member.content_transferred', 'user.created', 'user.updated', 'user.deleted', 'workspace.owner_transferred', 'workspace.settings_changed', 'space.deleted', 'space.permanently_deleted', 'task.permanently_deleted', 'entry.permanently_deleted', 'entry.restored', 'export.requested', 'export.done', 'export.failed', 'api_key.created', 'api_key.revoked', 'gc.failed', 'backup.failed', 'entry_type.deleted'));--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_custom_type_ck" CHECK (("entries"."kind" = 'custom') = ("entries"."type_id" is not null));--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_kind_ck" CHECK ("entries"."kind" in ('decision', 'iteration', 'bug', 'changelog', 'journal', 'note', 'review', 'optimize', 'plan', 'custom'));