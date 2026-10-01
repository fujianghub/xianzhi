CREATE TABLE "task_list_items" (
	"task_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"list_id" uuid NOT NULL,
	CONSTRAINT "task_list_items_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "task_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"color" text,
	"sort_key" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_lists_owner_name_uq" UNIQUE("workspace_id","owner_id","kind","name"),
	CONSTRAINT "task_lists_kind_ck" CHECK ("task_lists"."kind" in ('list', 'folder')),
	CONSTRAINT "task_lists_color_ck" CHECK ("task_lists"."color" is null or "task_lists"."color" in ('blue', 'orange', 'yellow', 'red', 'green', 'purple', 'pink', 'cyan', 'gray')),
	CONSTRAINT "task_lists_folder_color_ck" CHECK (("task_lists"."kind" = 'folder') = ("task_lists"."color" is null))
);
--> statement-breakpoint
ALTER TABLE "task_list_items" ADD CONSTRAINT "task_list_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_list_items" ADD CONSTRAINT "task_list_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_list_items" ADD CONSTRAINT "task_list_items_list_id_task_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."task_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_parent_id_task_lists_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."task_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_list_items_list_idx" ON "task_list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "task_lists_owner_idx" ON "task_lists" USING btree ("owner_id","sort_key");--> statement-breakpoint
-- fractional-indexing 键须按字节序比较（同 0003 / 0011，手写）
ALTER TABLE "task_lists" ALTER COLUMN "sort_key" TYPE text COLLATE "C";
