-- Module 5 : garde-fous en base. Une base figée ne se modifie jamais ; un scénario figé ne change plus et n'accepte
-- plus d'hypothèse nouvelle ou modifiée (la suppression d'un scénario figé est refusée par l'application).
CREATE OR REPLACE FUNCTION budget_base_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'budget_base est immuable (base figée)';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER budget_base_no_update BEFORE UPDATE ON "budget_base" FOR EACH ROW EXECUTE FUNCTION budget_base_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION budget_scenario_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'fige' THEN
    RAISE EXCEPTION 'scénario figé : modification refusée';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER budget_scenario_no_unfreeze BEFORE UPDATE ON "budget_scenario" FOR EACH ROW EXECUTE FUNCTION budget_scenario_frozen();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION budget_hypothesis_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM budget_scenario WHERE id = NEW.scenario_id) = 'fige' THEN
    RAISE EXCEPTION 'scénario figé : hypothèse refusée';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER budget_hypothesis_draft_only BEFORE INSERT OR UPDATE ON "budget_hypothesis" FOR EACH ROW EXECUTE FUNCTION budget_hypothesis_draft_only();
