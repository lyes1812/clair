CREATE TABLE "source_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"sync_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"encoding" text NOT NULL,
	"sealed_content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "dsn_file_workspace_isolation" ON "dsn_file" CASCADE;--> statement-breakpoint
-- Reprise des fichiers DSN déjà conservés (même chiffrement : contexte « <espace>:dsn-file »).
INSERT INTO "source_file" ("id", "workspace_id", "sync_id", "kind", "sha256", "filename", "size_bytes", "encoding", "sealed_content", "created_at")
SELECT "id", "workspace_id", "sync_id", 'dsn', "sha256", "filename", "size_bytes", "encoding", "sealed_content", "created_at" FROM "dsn_file";--> statement-breakpoint
DROP TABLE "dsn_file" CASCADE;--> statement-breakpoint
ALTER TABLE "source_file" ADD CONSTRAINT "source_file_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_file" ADD CONSTRAINT "source_file_sync_id_source_sync_id_fk" FOREIGN KEY ("sync_id") REFERENCES "public"."source_sync"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_file_ws_sha_uq" ON "source_file" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE INDEX "source_file_ws_kind_idx" ON "source_file" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE POLICY "source_file_workspace_isolation" ON "source_file" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "source_file" FORCE ROW LEVEL SECURITY;
