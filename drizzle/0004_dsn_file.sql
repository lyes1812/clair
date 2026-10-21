CREATE TABLE "dsn_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"sync_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"encoding" text NOT NULL,
	"sealed_content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dsn_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dsn_file" ADD CONSTRAINT "dsn_file_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsn_file" ADD CONSTRAINT "dsn_file_sync_id_source_sync_id_fk" FOREIGN KEY ("sync_id") REFERENCES "public"."source_sync"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dsn_file_ws_sha_uq" ON "dsn_file" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE POLICY "dsn_file_workspace_isolation" ON "dsn_file" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));