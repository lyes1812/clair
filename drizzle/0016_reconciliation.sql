CREATE TABLE "reconciliation_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"input_hash" text NOT NULL,
	"action" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_decision_revision_valid" CHECK ("reconciliation_decision"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "reconciliation_decision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reconciliation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"control_month" text NOT NULL,
	"input_hash" text NOT NULL,
	"comparator_version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_run_revision_valid" CHECK ("reconciliation_run"."revision" >= 0),
	CONSTRAINT "reconciliation_run_month_valid" CHECK ("reconciliation_run"."control_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "reconciliation_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_run_ws_id_uq" ON "reconciliation_run" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "reconciliation_decision" ADD CONSTRAINT "reconciliation_decision_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_decision" ADD CONSTRAINT "reconciliation_decision_ws_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."reconciliation_run"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_run" ADD CONSTRAINT "reconciliation_run_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_decision_run_revision_uq" ON "reconciliation_decision" USING btree ("workspace_id","run_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_run_ws_input_uq" ON "reconciliation_run" USING btree ("workspace_id","input_hash");--> statement-breakpoint
CREATE INDEX "reconciliation_run_ws_created_idx" ON "reconciliation_run" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE POLICY "reconciliation_decision_workspace_isolation" ON "reconciliation_decision" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));--> statement-breakpoint
CREATE POLICY "reconciliation_run_workspace_isolation" ON "reconciliation_run" AS PERMISSIVE FOR ALL TO public USING (workspace_id = current_setting('app.workspace_id', true)) WITH CHECK (workspace_id = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "reconciliation_run" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reconciliation_decision" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION reconciliation_run_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- L'effacement d'un espace entier conserve sa sémantique de cascade.
    IF NOT EXISTS (SELECT 1 FROM organization WHERE id = OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'reconciliation run immutable';
  END IF;
  IF (to_jsonb(NEW) - 'revision') IS DISTINCT FROM (to_jsonb(OLD) - 'revision')
     OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'reconciliation run immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reconciliation_run_immutable BEFORE UPDATE OR DELETE ON "reconciliation_run"
FOR EACH ROW EXECUTE FUNCTION reconciliation_run_immutable();
--> statement-breakpoint
CREATE FUNCTION reconciliation_decision_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organization WHERE id = OLD.workspace_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'reconciliation decision append only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reconciliation_decision_append_only BEFORE UPDATE OR DELETE ON "reconciliation_decision"
FOR EACH ROW EXECUTE FUNCTION reconciliation_decision_append_only();
--> statement-breakpoint
CREATE FUNCTION reconciliation_decision_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM reconciliation_run WHERE workspace_id = NEW.workspace_id AND id = NEW.run_id
                 AND revision = NEW.revision AND input_hash = NEW.input_hash) THEN
    RAISE EXCEPTION 'reconciliation decision invalid revision';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reconciliation_decision_consistent BEFORE INSERT ON "reconciliation_decision"
FOR EACH ROW EXECUTE FUNCTION reconciliation_decision_consistent();
