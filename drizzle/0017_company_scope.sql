-- Les migrations sont exécutées dans une transaction par le migrateur Drizzle.
CREATE TABLE "workspace_company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"siren" text,
	"origin" text DEFAULT 'manual' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_company_name_valid" CHECK (length(btrim("workspace_company"."name")) between 1 and 120),
	CONSTRAINT "workspace_company_siren_valid" CHECK ("workspace_company"."siren" is null or "workspace_company"."siren" ~ '^[0-9]{9}$'),
	CONSTRAINT "workspace_company_origin_valid" CHECK ("workspace_company"."origin" in ('initial', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "workspace_company" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_company_workspace_isolation" ON "workspace_company" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "workspace_company" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "budget_base" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
ALTER TABLE "budget_reference" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
ALTER TABLE "connector_credential" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
ALTER TABLE "connector_credential" ADD COLUMN "secret_scope_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_run" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
ALTER TABLE "rh_build" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
ALTER TABLE "source_file" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
ALTER TABLE "source_sync" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
ALTER TABLE "source_sync" ADD COLUMN "credential_id" uuid;
--> statement-breakpoint
ALTER TABLE "workspace_event" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
ALTER TABLE "workspace_setting" ADD COLUMN "company_id" uuid;
--> statement-breakpoint
-- Reprise du périmètre historique de chaque espace : aucun JSON, hash,
-- identifiant métier ou secret chiffré n'est réécrit.
ALTER TABLE "reconciliation_run" DISABLE TRIGGER reconciliation_run_immutable;
--> statement-breakpoint
DO $$
DECLARE workspace_row record; initial_company uuid; previous_workspace text;
BEGIN
  previous_workspace := current_setting('app.workspace_id', true);
  FOR workspace_row IN SELECT id, name FROM organization LOOP
    PERFORM set_config('app.workspace_id', workspace_row.id, true);
    INSERT INTO workspace_company (workspace_id, name, origin)
      VALUES (workspace_row.id, workspace_row.name, 'initial') RETURNING id INTO initial_company;
    UPDATE "budget_base" SET company_id = initial_company WHERE workspace_id = workspace_row.id;
    UPDATE "budget_reference" SET company_id = initial_company WHERE workspace_id = workspace_row.id;
    UPDATE "connector_credential" SET company_id = initial_company WHERE workspace_id = workspace_row.id;
    UPDATE "reconciliation_run" SET company_id = initial_company WHERE workspace_id = workspace_row.id;
    UPDATE "rh_build" SET company_id = initial_company WHERE workspace_id = workspace_row.id;
    UPDATE "source_file" SET company_id = initial_company WHERE workspace_id = workspace_row.id;
    UPDATE "source_sync" SET company_id = initial_company WHERE workspace_id = workspace_row.id;
    UPDATE "workspace_setting" SET company_id = initial_company WHERE workspace_id = workspace_row.id;
    UPDATE "workspace_event" SET company_id = initial_company WHERE workspace_id = workspace_row.id;
  END LOOP;
  PERFORM set_config('app.workspace_id', coalesce(previous_workspace, ''), true);
END;
$$;
--> statement-breakpoint
ALTER TABLE "reconciliation_run" ENABLE TRIGGER reconciliation_run_immutable;
--> statement-breakpoint
ALTER TABLE "budget_base" ALTER COLUMN "company_id" SET DEFAULT case when current_setting('app.company_id', true) ~ '^[0-9a-fA-F-]{36}$' then current_setting('app.company_id', true)::uuid else null end, ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "budget_reference" ALTER COLUMN "company_id" SET DEFAULT case when current_setting('app.company_id', true) ~ '^[0-9a-fA-F-]{36}$' then current_setting('app.company_id', true)::uuid else null end, ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "connector_credential" ALTER COLUMN "company_id" SET DEFAULT case when current_setting('app.company_id', true) ~ '^[0-9a-fA-F-]{36}$' then current_setting('app.company_id', true)::uuid else null end, ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_run" ALTER COLUMN "company_id" SET DEFAULT case when current_setting('app.company_id', true) ~ '^[0-9a-fA-F-]{36}$' then current_setting('app.company_id', true)::uuid else null end, ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "rh_build" ALTER COLUMN "company_id" SET DEFAULT case when current_setting('app.company_id', true) ~ '^[0-9a-fA-F-]{36}$' then current_setting('app.company_id', true)::uuid else null end, ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "source_file" ALTER COLUMN "company_id" SET DEFAULT case when current_setting('app.company_id', true) ~ '^[0-9a-fA-F-]{36}$' then current_setting('app.company_id', true)::uuid else null end, ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "source_sync" ALTER COLUMN "company_id" SET DEFAULT case when current_setting('app.company_id', true) ~ '^[0-9a-fA-F-]{36}$' then current_setting('app.company_id', true)::uuid else null end, ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_setting" ALTER COLUMN "company_id" SET DEFAULT case when current_setting('app.company_id', true) ~ '^[0-9a-fA-F-]{36}$' then current_setting('app.company_id', true)::uuid else null end, ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_event" ALTER COLUMN "company_id" SET DEFAULT case when current_setting('app.company_id', true) ~ '^[0-9a-fA-F-]{36}$' then current_setting('app.company_id', true)::uuid else null end;
--> statement-breakpoint
DROP INDEX "connector_credential_ws_provider_uq";
--> statement-breakpoint
DROP INDEX "reconciliation_run_ws_input_uq";
--> statement-breakpoint
DROP INDEX "rh_build_current_uq";
--> statement-breakpoint
DROP INDEX "source_file_ws_sha_uq";
--> statement-breakpoint
DROP INDEX "source_sync_ws_provider_idx";
--> statement-breakpoint
DROP INDEX "workspace_setting_ws_key_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_company_ws_id_uq" ON "workspace_company" USING btree ("workspace_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_company_initial_uq" ON "workspace_company" USING btree ("workspace_id") WHERE origin = 'initial';
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_company_name_uq" ON "workspace_company" USING btree ("workspace_id",lower(btrim("name")));
--> statement-breakpoint
CREATE INDEX "workspace_company_ws_created_idx" ON "workspace_company" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "connector_credential_ws_company_id_uq" ON "connector_credential" USING btree ("workspace_id","company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "connector_credential_external_company_uq" ON "connector_credential" USING btree ("workspace_id","provider","external_company_id") WHERE external_company_id is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "source_sync_ws_company_id_uq" ON "source_sync" USING btree ("workspace_id","company_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "source_sync_api_applied_uq" ON "source_sync" USING btree ("workspace_id","company_id","provider") WHERE provider in ('payfit', 'pennylane') and status = 'applied';
--> statement-breakpoint
CREATE UNIQUE INDEX "source_sync_api_running_uq" ON "source_sync" USING btree ("workspace_id","company_id","provider") WHERE provider in ('payfit', 'pennylane') and status = 'running';
--> statement-breakpoint
CREATE UNIQUE INDEX "connector_credential_ws_provider_uq" ON "connector_credential" USING btree ("workspace_id","company_id","provider");
--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_run_ws_input_uq" ON "reconciliation_run" USING btree ("workspace_id","company_id","input_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "rh_build_current_uq" ON "rh_build" USING btree ("workspace_id","company_id","source") WHERE status = 'current';
--> statement-breakpoint
CREATE UNIQUE INDEX "source_file_ws_sha_uq" ON "source_file" USING btree ("workspace_id","company_id","sha256");
--> statement-breakpoint
CREATE INDEX "source_sync_ws_provider_idx" ON "source_sync" USING btree ("workspace_id","company_id","provider","started_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_setting_ws_key_uq" ON "workspace_setting" USING btree ("workspace_id","company_id","key");
--> statement-breakpoint
ALTER TABLE "workspace_company" ADD CONSTRAINT "workspace_company_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_company" ADD CONSTRAINT "workspace_company_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_company" ADD CONSTRAINT "workspace_company_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budget_base" ADD CONSTRAINT "budget_base_company_ws_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_company"("workspace_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "budget_reference" ADD CONSTRAINT "budget_reference_company_ws_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_company"("workspace_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "connector_credential" ADD CONSTRAINT "connector_credential_company_ws_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_company"("workspace_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "reconciliation_run" ADD CONSTRAINT "reconciliation_run_company_ws_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_company"("workspace_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "rh_build" ADD CONSTRAINT "rh_build_company_ws_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_company"("workspace_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "source_file" ADD CONSTRAINT "source_file_company_ws_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_company"("workspace_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "source_file" ADD CONSTRAINT "source_file_sync_company_fk" FOREIGN KEY ("workspace_id","company_id","sync_id") REFERENCES "public"."source_sync"("workspace_id","company_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_sync" ADD CONSTRAINT "source_sync_credential_company_fk" FOREIGN KEY ("workspace_id","company_id","credential_id") REFERENCES "public"."connector_credential"("workspace_id","company_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "source_sync" ADD CONSTRAINT "source_sync_baseline_company_fk" FOREIGN KEY ("workspace_id","company_id","baseline_sync_id") REFERENCES "public"."source_sync"("workspace_id","company_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "source_sync" ADD CONSTRAINT "source_sync_company_ws_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_company"("workspace_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "workspace_setting" ADD CONSTRAINT "workspace_setting_company_ws_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."workspace_company"("workspace_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE POLICY "budget_base_company_isolation" ON "budget_base" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true)) WITH CHECK (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true));
--> statement-breakpoint
CREATE POLICY "budget_hypothesis_company_isolation" ON "budget_hypothesis" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "budget_scenario" company_parent where company_parent.id = "budget_hypothesis"."scenario_id" and company_parent.workspace_id = "budget_hypothesis".workspace_id)) WITH CHECK (exists (select 1 from "budget_scenario" company_parent where company_parent.id = "budget_hypothesis"."scenario_id" and company_parent.workspace_id = "budget_hypothesis".workspace_id));
--> statement-breakpoint
CREATE POLICY "budget_reference_company_isolation" ON "budget_reference" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true)) WITH CHECK (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true));
--> statement-breakpoint
CREATE POLICY "budget_scenario_company_isolation" ON "budget_scenario" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "budget_base" company_parent where company_parent.id = "budget_scenario"."base_id" and company_parent.workspace_id = "budget_scenario".workspace_id)) WITH CHECK (exists (select 1 from "budget_base" company_parent where company_parent.id = "budget_scenario"."base_id" and company_parent.workspace_id = "budget_scenario".workspace_id));
--> statement-breakpoint
CREATE POLICY "connector_credential_company_isolation" ON "connector_credential" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true)) WITH CHECK (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true));
--> statement-breakpoint
CREATE POLICY "reconciliation_decision_company_isolation" ON "reconciliation_decision" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "reconciliation_run" company_parent where company_parent.id = "reconciliation_decision"."run_id" and company_parent.workspace_id = "reconciliation_decision".workspace_id)) WITH CHECK (exists (select 1 from "reconciliation_run" company_parent where company_parent.id = "reconciliation_decision"."run_id" and company_parent.workspace_id = "reconciliation_decision".workspace_id));
--> statement-breakpoint
CREATE POLICY "reconciliation_run_company_isolation" ON "reconciliation_run" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true)) WITH CHECK (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true));
--> statement-breakpoint
CREATE POLICY "rh_build_company_isolation" ON "rh_build" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true)) WITH CHECK (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true));
--> statement-breakpoint
CREATE POLICY "rh_contract_company_isolation" ON "rh_contract" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_contract"."build_id" and company_parent.workspace_id = "rh_contract".workspace_id)) WITH CHECK (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_contract"."build_id" and company_parent.workspace_id = "rh_contract".workspace_id));
--> statement-breakpoint
CREATE POLICY "rh_contract_month_company_isolation" ON "rh_contract_month" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_contract_month"."build_id" and company_parent.workspace_id = "rh_contract_month".workspace_id)) WITH CHECK (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_contract_month"."build_id" and company_parent.workspace_id = "rh_contract_month".workspace_id));
--> statement-breakpoint
CREATE POLICY "rh_event_company_isolation" ON "rh_event" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_event"."build_id" and company_parent.workspace_id = "rh_event".workspace_id)) WITH CHECK (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_event"."build_id" and company_parent.workspace_id = "rh_event".workspace_id));
--> statement-breakpoint
CREATE POLICY "rh_finding_company_isolation" ON "rh_finding" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_finding"."build_id" and company_parent.workspace_id = "rh_finding".workspace_id)) WITH CHECK (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_finding"."build_id" and company_parent.workspace_id = "rh_finding".workspace_id));
--> statement-breakpoint
CREATE POLICY "rh_month_coverage_company_isolation" ON "rh_month_coverage" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_month_coverage"."build_id" and company_parent.workspace_id = "rh_month_coverage".workspace_id)) WITH CHECK (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_month_coverage"."build_id" and company_parent.workspace_id = "rh_month_coverage".workspace_id));
--> statement-breakpoint
CREATE POLICY "rh_person_company_isolation" ON "rh_person" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_person"."build_id" and company_parent.workspace_id = "rh_person".workspace_id)) WITH CHECK (exists (select 1 from "rh_build" company_parent where company_parent.id = "rh_person"."build_id" and company_parent.workspace_id = "rh_person".workspace_id));
--> statement-breakpoint
CREATE POLICY "source_file_company_isolation" ON "source_file" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true)) WITH CHECK (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true));
--> statement-breakpoint
CREATE POLICY "source_record_company_isolation" ON "source_record" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "source_sync" company_parent where company_parent.id = "source_record"."sync_id" and company_parent.workspace_id = "source_record".workspace_id)) WITH CHECK (exists (select 1 from "source_sync" company_parent where company_parent.id = "source_record"."sync_id" and company_parent.workspace_id = "source_record".workspace_id));
--> statement-breakpoint
CREATE POLICY "source_sync_company_isolation" ON "source_sync" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true)) WITH CHECK (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true));
--> statement-breakpoint
CREATE POLICY "workspace_setting_company_isolation" ON "workspace_setting" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true)) WITH CHECK (current_setting('app.company_id', true) = '*' or company_id::text = current_setting('app.company_id', true));
--> statement-breakpoint
-- Toute création ultérieure d'espace reçoit le même périmètre initial.
CREATE FUNCTION workspace_company_initial() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE previous_workspace text;
BEGIN
  previous_workspace := current_setting('app.workspace_id', true);
  PERFORM set_config('app.workspace_id', NEW.id, true);
  INSERT INTO workspace_company (workspace_id, name, origin) VALUES (NEW.id, NEW.name, 'initial');
  PERFORM set_config('app.workspace_id', coalesce(previous_workspace, ''), true);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_initial_company AFTER INSERT ON "organization"
FOR EACH ROW EXECUTE FUNCTION workspace_company_initial();
--> statement-breakpoint
CREATE FUNCTION company_scope_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'company scope immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER budget_base_company_immutable BEFORE UPDATE OF company_id ON "budget_base" FOR EACH ROW EXECUTE FUNCTION company_scope_immutable();
--> statement-breakpoint
CREATE TRIGGER budget_reference_company_immutable BEFORE UPDATE OF company_id ON "budget_reference" FOR EACH ROW EXECUTE FUNCTION company_scope_immutable();
--> statement-breakpoint
CREATE TRIGGER connector_credential_company_immutable BEFORE UPDATE OF company_id ON "connector_credential" FOR EACH ROW EXECUTE FUNCTION company_scope_immutable();
--> statement-breakpoint
CREATE TRIGGER reconciliation_run_company_immutable BEFORE UPDATE OF company_id ON "reconciliation_run" FOR EACH ROW EXECUTE FUNCTION company_scope_immutable();
--> statement-breakpoint
CREATE TRIGGER rh_build_company_immutable BEFORE UPDATE OF company_id ON "rh_build" FOR EACH ROW EXECUTE FUNCTION company_scope_immutable();
--> statement-breakpoint
CREATE TRIGGER source_file_company_immutable BEFORE UPDATE OF company_id ON "source_file" FOR EACH ROW EXECUTE FUNCTION company_scope_immutable();
--> statement-breakpoint
CREATE TRIGGER source_sync_company_immutable BEFORE UPDATE OF company_id ON "source_sync" FOR EACH ROW EXECUTE FUNCTION company_scope_immutable();
--> statement-breakpoint
CREATE TRIGGER workspace_setting_company_immutable BEFORE UPDATE OF company_id ON "workspace_setting" FOR EACH ROW EXECUTE FUNCTION company_scope_immutable();
--> statement-breakpoint
CREATE TRIGGER workspace_event_company_immutable BEFORE UPDATE OF company_id ON "workspace_event" FOR EACH ROW EXECUTE FUNCTION company_scope_immutable();
