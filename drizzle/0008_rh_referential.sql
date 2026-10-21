CREATE TABLE "rh_build" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"builder_version" integer NOT NULL,
	"inputs_hash" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"reference_date" text,
	"presence_from" text,
	"presence_to" text,
	"summary" jsonb DEFAULT '{"persons":0,"contracts":0,"months":0,"events":0,"findings":0}'::jsonb NOT NULL,
	"unavailable_reason" text,
	"built_by" text,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rh_build" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rh_contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"build_id" uuid NOT NULL,
	"contract_key" text NOT NULL,
	"external_id" text NOT NULL,
	"person_key" text,
	"establishment_id" text,
	"start_date" text,
	"end_date" text,
	"end_reason" text,
	"end_status" text NOT NULL,
	"nature" text,
	"status_source" text,
	"fte_at_read" double precision,
	"weekly_hours_at_read" double precision,
	"is_full_time_at_read" boolean,
	"modality_at_read" text,
	"executive" boolean,
	"first_declared_month" text,
	"last_declared_month" text,
	"fields_nd" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rh_contract" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rh_contract_month" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"build_id" uuid NOT NULL,
	"contract_key" text NOT NULL,
	"month" text NOT NULL,
	"establishment_id" text NOT NULL,
	"presence_basis" text NOT NULL,
	"present_any_day" boolean NOT NULL,
	"present_month_end" boolean NOT NULL,
	"nature" text,
	"reference_quota" double precision,
	"contract_quota" double precision,
	"quota_unit" text,
	"modality" text,
	"paid_time" double precision,
	"worked_time" double precision,
	"time_unit" text,
	"payment_count" integer,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields_nd" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rh_contract_month" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rh_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"build_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" text NOT NULL,
	"month" text NOT NULL,
	"contract_key" text NOT NULL,
	"person_key" text,
	"establishment_id" text,
	"nature" text,
	"end_reason" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields_nd" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rh_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rh_finding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"build_id" uuid NOT NULL,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"person_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contract_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"month" text,
	"message" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rh_finding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rh_month_coverage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"build_id" uuid NOT NULL,
	"establishment_id" text NOT NULL,
	"month" text NOT NULL,
	"presence_status" text NOT NULL,
	"presence_reason" text,
	"time_status" text NOT NULL,
	"time_reason" text,
	"declaration_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rh_month_coverage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rh_person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"build_id" uuid NOT NULL,
	"person_key" text NOT NULL,
	"external_id" text NOT NULL,
	"identifier_kind" text NOT NULL,
	"siren" text,
	"establishment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"family_name" text,
	"given_names" text,
	"usage_name" text,
	"employee_number" text,
	"team_name" text,
	"has_contract" boolean NOT NULL,
	"first_declared_month" text,
	"last_declared_month" text,
	"fields_nd" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rh_person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rh_build" ADD CONSTRAINT "rh_build_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_build" ADD CONSTRAINT "rh_build_built_by_user_id_fk" FOREIGN KEY ("built_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_contract" ADD CONSTRAINT "rh_contract_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_contract" ADD CONSTRAINT "rh_contract_build_id_rh_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."rh_build"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_contract_month" ADD CONSTRAINT "rh_contract_month_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_contract_month" ADD CONSTRAINT "rh_contract_month_build_id_rh_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."rh_build"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_event" ADD CONSTRAINT "rh_event_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_event" ADD CONSTRAINT "rh_event_build_id_rh_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."rh_build"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_finding" ADD CONSTRAINT "rh_finding_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_finding" ADD CONSTRAINT "rh_finding_build_id_rh_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."rh_build"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_month_coverage" ADD CONSTRAINT "rh_month_coverage_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_month_coverage" ADD CONSTRAINT "rh_month_coverage_build_id_rh_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."rh_build"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_person" ADD CONSTRAINT "rh_person_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh_person" ADD CONSTRAINT "rh_person_build_id_rh_build_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."rh_build"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rh_build_current_uq" ON "rh_build" USING btree ("workspace_id","source") WHERE status = 'current';--> statement-breakpoint
CREATE INDEX "rh_build_ws_source_idx" ON "rh_build" USING btree ("workspace_id","source","built_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rh_contract_build_key_uq" ON "rh_contract" USING btree ("build_id","contract_key");--> statement-breakpoint
CREATE INDEX "rh_contract_build_person_idx" ON "rh_contract" USING btree ("build_id","person_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rh_contract_month_uq" ON "rh_contract_month" USING btree ("build_id","contract_key","month","establishment_id");--> statement-breakpoint
CREATE INDEX "rh_contract_month_build_month_idx" ON "rh_contract_month" USING btree ("build_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "rh_event_uq" ON "rh_event" USING btree ("build_id","contract_key","kind");--> statement-breakpoint
CREATE INDEX "rh_event_build_month_idx" ON "rh_event" USING btree ("build_id","month");--> statement-breakpoint
CREATE INDEX "rh_event_build_person_idx" ON "rh_event" USING btree ("build_id","person_key");--> statement-breakpoint
CREATE INDEX "rh_finding_build_code_idx" ON "rh_finding" USING btree ("build_id","code");--> statement-breakpoint
CREATE INDEX "rh_finding_build_month_idx" ON "rh_finding" USING btree ("build_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "rh_month_coverage_uq" ON "rh_month_coverage" USING btree ("build_id","establishment_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "rh_person_build_key_uq" ON "rh_person" USING btree ("build_id","person_key");--> statement-breakpoint
CREATE INDEX "rh_person_build_name_idx" ON "rh_person" USING btree ("build_id","family_name");--> statement-breakpoint
CREATE POLICY "rh_build_workspace_isolation" ON "rh_build" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE POLICY "rh_contract_workspace_isolation" ON "rh_contract" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE POLICY "rh_contract_month_workspace_isolation" ON "rh_contract_month" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE POLICY "rh_event_workspace_isolation" ON "rh_event" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE POLICY "rh_finding_workspace_isolation" ON "rh_finding" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE POLICY "rh_month_coverage_workspace_isolation" ON "rh_month_coverage" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE POLICY "rh_person_workspace_isolation" ON "rh_person" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "rh_build" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rh_person" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rh_contract" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rh_contract_month" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rh_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rh_month_coverage" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rh_finding" FORCE ROW LEVEL SECURITY;
