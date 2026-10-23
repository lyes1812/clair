-- Module 5 : colonnes d'auteur d'une base ou d'un scénario figé. Seul le passage à NULL (suppression de l'utilisateur,
-- ON DELETE SET NULL) est accepté ; une réattribution est refusée.
CREATE OR REPLACE FUNCTION budget_base_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by IS NULL AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'budget_base est immuable (base figée)';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS budget_base_no_update ON "budget_base";
--> statement-breakpoint
CREATE TRIGGER budget_base_no_update BEFORE UPDATE OF id, workspace_id, ref_month, sync_id, data, hash, created_by, created_at ON "budget_base" FOR EACH ROW EXECUTE FUNCTION budget_base_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION budget_scenario_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'fige' AND (
    (to_jsonb(NEW) - 'created_by' - 'frozen_by') IS DISTINCT FROM (to_jsonb(OLD) - 'created_by' - 'frozen_by')
    OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL)
    OR (NEW.frozen_by IS DISTINCT FROM OLD.frozen_by AND NEW.frozen_by IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'scénario figé : modification refusée';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION budget_hypothesis_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.created_by IS NULL AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
    RETURN NEW;
  END IF;
  IF (SELECT status FROM budget_scenario WHERE id = NEW.scenario_id) = 'fige' THEN
    RAISE EXCEPTION 'scénario figé : hypothèse refusée';
  END IF;
  IF TG_OP = 'UPDATE' AND (SELECT status FROM budget_scenario WHERE id = OLD.scenario_id) = 'fige' THEN
    RAISE EXCEPTION 'scénario figé : hypothèse refusée';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS budget_hypothesis_draft_only ON "budget_hypothesis";
--> statement-breakpoint
CREATE TRIGGER budget_hypothesis_draft_only BEFORE INSERT OR UPDATE OF id, workspace_id, scenario_id, kind, data, currency, created_by, created_at ON "budget_hypothesis" FOR EACH ROW EXECUTE FUNCTION budget_hypothesis_draft_only();
