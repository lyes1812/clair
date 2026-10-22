CREATE TABLE "budget_base" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"ref_month" text NOT NULL,
	"sync_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"hash" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_base" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "budget_hypothesis" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scenario_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"currency" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_hypothesis" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "budget_scenario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"base_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"first_month" text NOT NULL,
	"last_month" text NOT NULL,
	"conventions" jsonb NOT NULL,
	"status" text NOT NULL,
	"duplicated_from" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_by" text,
	"frozen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "budget_scenario" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budget_base" ADD CONSTRAINT "budget_base_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_base" ADD CONSTRAINT "budget_base_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_hypothesis" ADD CONSTRAINT "budget_hypothesis_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_hypothesis" ADD CONSTRAINT "budget_hypothesis_scenario_id_budget_scenario_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."budget_scenario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_hypothesis" ADD CONSTRAINT "budget_hypothesis_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_scenario" ADD CONSTRAINT "budget_scenario_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_scenario" ADD CONSTRAINT "budget_scenario_base_id_budget_base_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."budget_base"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_scenario" ADD CONSTRAINT "budget_scenario_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_scenario" ADD CONSTRAINT "budget_scenario_frozen_by_user_id_fk" FOREIGN KEY ("frozen_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_base_ws_idx" ON "budget_base" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "budget_hypothesis_scenario_idx" ON "budget_hypothesis" USING btree ("scenario_id","created_at");--> statement-breakpoint
CREATE INDEX "budget_scenario_ws_idx" ON "budget_scenario" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE POLICY "budget_base_workspace_isolation" ON "budget_base" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE POLICY "budget_hypothesis_workspace_isolation" ON "budget_hypothesis" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE POLICY "budget_scenario_workspace_isolation" ON "budget_scenario" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "budget_base" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "budget_scenario" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "budget_hypothesis" FORCE ROW LEVEL SECURITY;
