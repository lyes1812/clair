CREATE TABLE "workspace_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_setting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_setting" ADD CONSTRAINT "workspace_setting_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_setting" ADD CONSTRAINT "workspace_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_setting_ws_key_uq" ON "workspace_setting" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE POLICY "workspace_setting_workspace_isolation" ON "workspace_setting" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "workspace_setting" FORCE ROW LEVEL SECURITY;
