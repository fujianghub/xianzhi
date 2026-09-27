ALTER TABLE "spaces" ADD COLUMN "default_kind" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "default_template_id" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_default_kind_ck" CHECK ("spaces"."default_kind" is null or "spaces"."default_kind" in ('decision', 'iteration', 'bug', 'changelog', 'journal', 'note', 'review', 'optimize', 'plan'));