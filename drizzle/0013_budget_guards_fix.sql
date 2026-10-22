-- Module 5 : garde-fous ajustés. Les déclencheurs ne visent plus les colonnes d'auteur (la suppression d'un utilisateur
-- met created_by / frozen_by à NULL) ; un déplacement d'hypothèse hors d'un scénario figé est refusé ; la suppression
-- d'une hypothèse ou d'un scénario figé est refusée par des politiques RLS restrictives (les suppressions en cascade
-- d'un espace ne sont pas soumises à la RLS).
DROP TRIGGER IF EXISTS budget_base_no_update ON "budget_base";
--> statement-breakpoint
CREATE TRIGGER budget_base_no_update BEFORE UPDATE OF id, workspace_id, ref_month, sync_id, data, hash, created_at ON "budget_base" FOR EACH ROW EXECUTE FUNCTION budget_base_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION budget_scenario_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'fige' AND (to_jsonb(NEW) - 'created_by' - 'frozen_by') IS DISTINCT FROM (to_jsonb(OLD) - 'created_by' - 'frozen_by') THEN
    RAISE EXCEPTION 'scénario figé : modification refusée';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION budget_hypothesis_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
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
CREATE TRIGGER budget_hypothesis_draft_only BEFORE INSERT OR UPDATE OF id, workspace_id, scenario_id, kind, data, currency, created_at ON "budget_hypothesis" FOR EACH ROW EXECUTE FUNCTION budget_hypothesis_draft_only();
--> statement-breakpoint
CREATE POLICY "budget_hypothesis_frozen_no_delete" ON "budget_hypothesis" AS RESTRICTIVE FOR DELETE TO public USING (NOT EXISTS (SELECT 1 FROM budget_scenario s WHERE s.id = scenario_id AND s.status = 'fige'));
--> statement-breakpoint
CREATE POLICY "budget_scenario_frozen_no_delete" ON "budget_scenario" AS RESTRICTIVE FOR DELETE TO public USING (status <> 'fige');
