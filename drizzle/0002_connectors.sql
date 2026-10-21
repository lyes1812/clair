CREATE TABLE "connector_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"sealed_secret" text NOT NULL,
	"external_company_id" text,
	"company_name" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_credential" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"sync_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"record_key" text NOT NULL,
	"period" text,
	"data" jsonb NOT NULL,
	"record_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_record" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"baseline_sync_id" uuid,
	"content_hash" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"requested_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"decided_by" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "source_sync" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_credential" ADD CONSTRAINT "connector_credential_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_credential" ADD CONSTRAINT "connector_credential_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_sync_id_source_sync_id_fk" FOREIGN KEY ("sync_id") REFERENCES "public"."source_sync"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sync" ADD CONSTRAINT "source_sync_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sync" ADD CONSTRAINT "source_sync_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sync" ADD CONSTRAINT "source_sync_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_credential_ws_provider_uq" ON "connector_credential" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "source_record_sync_key_uq" ON "source_record" USING btree ("sync_id","collection","record_key");--> statement-breakpoint
CREATE INDEX "source_record_ws_collection_idx" ON "source_record" USING btree ("workspace_id","collection");--> statement-breakpoint
CREATE INDEX "source_sync_ws_provider_idx" ON "source_sync" USING btree ("workspace_id","provider","started_at");--> statement-breakpoint
CREATE POLICY "connector_credential_workspace_isolation" ON "connector_credential" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE POLICY "source_record_workspace_isolation" ON "source_record" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE POLICY "source_sync_workspace_isolation" ON "source_sync" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));