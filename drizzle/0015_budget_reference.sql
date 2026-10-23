CREATE TABLE "budget_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"year" text NOT NULL,
	"amounts" jsonb NOT NULL,
	"currency" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_reference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budget_reference" ADD CONSTRAINT "budget_reference_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reference" ADD CONSTRAINT "budget_reference_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reference" ADD CONSTRAINT "budget_reference_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_reference_ws_idx" ON "budget_reference" USING btree ("workspace_id","year");--> statement-breakpoint
CREATE POLICY "budget_reference_workspace_isolation" ON "budget_reference" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "budget_reference" FORCE ROW LEVEL SECURITY;
