CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"calendar_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"notes" text,
	"url" text,
	"all_day" boolean DEFAULT false NOT NULL,
	"start_at" timestamp (3) with time zone NOT NULL,
	"end_at" timestamp (3) with time zone NOT NULL,
	"timezone" text NOT NULL,
	"rrule" text,
	"repeat_until" timestamp (3) with time zone,
	"exdates" timestamp (3) with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL,
	"recurrence_id" uuid,
	"original_start_at" timestamp (3) with time zone,
	"alarms" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_range_ck" CHECK ("calendar_events"."end_at" > "calendar_events"."start_at"),
	CONSTRAINT "calendar_events_override_ck" CHECK (("calendar_events"."recurrence_id" is null) = ("calendar_events"."original_start_at" is null))
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendars_color_ck" CHECK ("calendars"."color" in ('moss', 'amber', 'indigo', 'ochre', 'teal', 'plum', 'gray', 'pine'))
);
--> statement-breakpoint
CREATE TABLE "join_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ip" text,
	"decided_by" text,
	"decided_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "join_requests_user_uq" UNIQUE("user_id"),
	CONSTRAINT "join_requests_status_ck" CHECK ("join_requests"."status" in ('pending', 'approved'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_ck";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_kind_ck";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_target_type_ck";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "display_username" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_owner_range_idx" ON "calendar_events" USING btree ("owner_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "calendar_events_recurrence_idx" ON "calendar_events" USING btree ("recurrence_id");--> statement-breakpoint
CREATE INDEX "calendar_events_alarm_idx" ON "calendar_events" USING btree ("start_at") WHERE cardinality("calendar_events"."alarms") > 0 and "calendar_events"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "calendars_owner_idx" ON "calendars" USING btree ("owner_id","position");--> statement-breakpoint
CREATE INDEX "join_requests_status_created_idx" ON "join_requests" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_unique" UNIQUE("username");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_ck" CHECK ("audit_log"."action" in ('auth.login', 'auth.logout', 'auth.login_failed', 'auth.locked', 'auth.password_reset', 'auth.2fa_enabled', 'auth.2fa_disabled', 'auth.2fa_reset_by_admin', 'member.invited', 'member.joined', 'member.registered', 'member.approved', 'member.rejected', 'member.role_changed', 'member.suspended', 'member.unsuspended', 'member.removed', 'member.content_transferred', 'user.deleted', 'workspace.owner_transferred', 'workspace.settings_changed', 'space.deleted', 'space.permanently_deleted', 'task.permanently_deleted', 'entry.permanently_deleted', 'export.requested', 'export.done', 'export.failed', 'api_key.created', 'api_key.revoked', 'gc.failed', 'backup.failed'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_kind_ck" CHECK ("events"."kind" in ('entry.updated', 'task.assigned', 'task.unassigned', 'task.due_soon', 'task.completed', 'task.uncompleted', 'task.commented', 'entry.commented', 'mention.created', 'space.invited', 'member.joined', 'member.requested', 'workspace.owner_transferred', 'cycle.review_due', 'calendar.reminder', 'system.export_done', 'system.backup_failed', 'system.outbox_stalled'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_target_type_ck" CHECK ("events"."target_type" in ('task', 'entry', 'cycle', 'space', 'comment', 'member', 'job', 'system', 'calendar_event'));