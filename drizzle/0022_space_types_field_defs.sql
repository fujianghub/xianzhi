ALTER TABLE "entry_types" DROP CONSTRAINT "entry_types_owner_name_uq";--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_ck";--> statement-breakpoint
ALTER TABLE "entry_templates" DROP CONSTRAINT "entry_templates_kind_ck";--> statement-breakpoint
ALTER TABLE "entry_kind_overrides" ADD COLUMN "field_defs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_templates" ADD COLUMN "type_id" uuid;--> statement-breakpoint
ALTER TABLE "entry_types" ADD COLUMN "status_colors" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_types" ADD COLUMN "field_defs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_types" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "default_type_id" uuid;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "enabled_kinds" jsonb;--> statement-breakpoint
ALTER TABLE "entry_templates" ADD CONSTRAINT "entry_templates_type_id_entry_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."entry_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_types" ADD CONSTRAINT "entry_types_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_default_type_id_entry_types_id_fk" FOREIGN KEY ("default_type_id") REFERENCES "public"."entry_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entry_types_owner_name_uq" ON "entry_types" USING btree ("workspace_id","created_by","name") WHERE "entry_types"."space_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "entry_types_space_name_uq" ON "entry_types" USING btree ("space_id","name") WHERE "entry_types"."space_id" is not null;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_ck" CHECK ("audit_log"."action" in ('auth.login', 'auth.logout', 'auth.login_failed', 'auth.locked', 'auth.password_reset', 'auth.password_changed', 'auth.2fa_enabled', 'auth.2fa_disabled', 'auth.2fa_reset_by_admin', 'member.invited', 'member.joined', 'member.registered', 'member.approved', 'member.rejected', 'member.role_changed', 'member.suspended', 'member.unsuspended', 'member.removed', 'member.content_transferred', 'user.created', 'user.updated', 'user.deleted', 'workspace.owner_transferred', 'workspace.settings_changed', 'space.deleted', 'space.permanently_deleted', 'space.merged', 'task.permanently_deleted', 'entry.permanently_deleted', 'entry.restored', 'export.requested', 'export.done', 'export.failed', 'api_key.created', 'api_key.revoked', 'gc.failed', 'backup.failed', 'entry_type.deleted', 'entry_type.fields_changed'));--> statement-breakpoint
ALTER TABLE "entry_templates" ADD CONSTRAINT "entry_templates_custom_type_ck" CHECK (("entry_templates"."kind" = 'custom') = ("entry_templates"."type_id" is not null));--> statement-breakpoint
ALTER TABLE "entry_templates" ADD CONSTRAINT "entry_templates_kind_ck" CHECK ("entry_templates"."kind" in ('decision', 'iteration', 'bug', 'changelog', 'journal', 'note', 'review', 'optimize', 'plan', 'custom'));