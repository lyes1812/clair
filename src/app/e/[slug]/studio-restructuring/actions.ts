"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isIsoDate } from "@/lib/dates";
import { z } from "zod";
import type { Hypothesis } from "@/lib/budget/types";
import { applyChanges, getScenario } from "@/lib/budget/store";
import { recordEvent } from "@/lib/events";
import { canonicalJson, sha256 } from "@/lib/crypto";
import { exitFromForm } from "@/lib/restructuring/forms";
import { CRISIS_RANKS_KEY, ranksFromForm } from "@/lib/restructuring/crisis/ranks";
import { flowFromForm, MAX_FLOWS, MAX_MEASURES, MAX_SCENARIOS, measureFromForm, scenarioNameFromForm, startFromForm } from "@/lib/restructuring/crisis/cashplan";
import { CashPlanError, updateCashPlan } from "@/lib/restructuring/crisis/store";
import { setSetting } from "@/lib/settings";
import { requireWorkspace } from "@/lib/workspace";
import type { FormState } from "../studio-rh/hypotheses/actions";

export async function saveExitAction(slug: string, scenarioId: string, displayedVersions: Record<string, string>, _previous: FormState, form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  if (!z.string().uuid().safeParse(scenarioId).success) return { error: "Scénario introuvable." };
  // Relire l’espace et le brouillon ; applyChanges reprend ces contrôles sous verrou dans la transaction existante.
  let full;
  try { full = await getScenario(workspace.id, scenarioId); }
  catch { return { error: "Le scénario ne peut pas être relu. Aucune modification enregistrée." }; }
  if (!full || full.scenario.status !== "brouillon") return { error: "Le projet doit être un brouillon modifiable. Duplique le scénario figé." };
  const requestedId = String(form.get("hypothesisId") ?? "").trim();
  const previous = requestedId ? full.hypotheses.find((h) => h.id === requestedId && h.kind === "depart") : undefined;
  if (requestedId && (!previous || previous.kind !== "depart")) return { error: "Départ introuvable dans ce projet. Recharge la page." };
  // L’argument lié côté serveur représente le rendu du formulaire, pas un état relu à sa soumission.
  if (previous && displayedVersions?.[previous.id] !== sha256(canonicalJson(previous))) return { error: "Ce départ a changé depuis l’affichage du formulaire. Recharge la page avant de saisir son coût." };
  let departure: Extract<Hypothesis, { kind: "depart" }>;
  try { departure = exitFromForm(form, randomUUID(), previous?.kind === "depart" ? previous : undefined); }
  catch (error) { return { error: error instanceof Error ? error.message : "Saisie du coût de sortie invalide." }; }
  if (!full.base.contracts.some((c) => c.contractKey === departure.contractKey)) return { error: "Contrat absent de la base figée de ce projet." };
  if (!previous && full.hypotheses.some((h) => h.kind === "depart" && h.contractKey === departure.contractKey)) return { error: "Un départ existe déjà pour ce contrat. Complète son coût dans la ligne existante." };
  if (departure.lastPaidDate.slice(0, 7) < full.scenario.firstMonth || departure.lastPaidDate.slice(0, 7) > full.scenario.lastMonth) return { error: "Le dernier jour payé doit appartenir à l’horizon projeté." };
  try {
    // Un seul départ, créé ou remplacé : le coût non récurrent ne devient jamais un deuxième élément ponctuel.
    await applyChanges(workspace.id, session.user.id, scenarioId, { put: [departure], remove: [], expected: previous ? [previous] : [] });
  } catch {
    return { error: "Enregistrement refusé : vérifie les dates, le contrat et les autres hypothèses du projet, puis recharge la page." };
  }
  let journalOk = true;
  try { await recordEvent(workspace.id, session.user.id, "budget.hypothesis_added", { kind: "depart", operation: previous ? "updated" : "created", count: 1 }); }
  catch { journalOk = false; } // L’écriture métier a réussi : ne pas inviter à la répéter et ne journaliser aucune valeur client.
  revalidatePath(`/e/${slug}/studio-restructuring`);
  revalidatePath(`/e/${slug}/studio-rh/hypotheses`);
  revalidatePath(`/e/${slug}/studio-finance`);
  return { ok: previous ? "Coût non récurrent du départ mis à jour une seule fois." : "Départ et coût non récurrent enregistrés dans le projet.", ...(!journalOk ? { details: ["La mesure est enregistrée ; son entrée dans le journal d’administration n’a pas pu être confirmée."] } : {}) };
}

/** Cap 13 : rang choisi pour chaque nature de dette. Un champ vide retire le rang ; aucun rang n’est supposé. */
export async function saveCrisisRanksAction(slug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  let ranks;
  try { ranks = ranksFromForm(form); }
  catch (error) { return { error: error instanceof Error ? error.message : "Rang invalide." }; }
  try { await setSetting(workspace.id, CRISIS_RANKS_KEY, ranks, session.user.id); }
  catch { return { error: "Enregistrement des rangs refusé. Recharge la page avant de réessayer." }; }
  revalidatePath(`/e/${slug}/studio-restructuring`);
  return { ok: "Rangs enregistrés pour cet espace." };
}

const cashFailure = (error: unknown): FormState => ({ error: error instanceof CashPlanError ? error.message : "Enregistrement refusé. Recharge la page avant de réessayer." });

/** Cap 13 : ajoute une ligne de flux au plan de trésorerie de l’espace. */
export async function addCashFlowAction(slug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  let flow;
  try { flow = flowFromForm(form, randomUUID()); }
  catch (error) { return { error: error instanceof Error ? error.message : "Ligne de flux invalide." }; }
  try {
    await updateCashPlan(workspace.id, session.user.id, (current) => {
      if (current.flows.length >= MAX_FLOWS) throw new CashPlanError(`Le plan contient déjà ${MAX_FLOWS} lignes : supprime des lignes avant d’en ajouter.`);
      return { ...current, flows: [...current.flows, flow] };
    }, "flow-added");
  } catch (error) { return cashFailure(error); }
  revalidatePath(`/e/${slug}/studio-restructuring`);
  // Ligne proposée depuis le FEC : retour à un formulaire vide, pour qu'un second envoi ne compte pas la dette deux fois.
  if (form.get("prefilled") === "1") {
    const query = new URLSearchParams({ vue: "cash" });
    const exercice = String(form.get("exercice") ?? "");
    const arrete = String(form.get("arrete") ?? "");
    if (exercice && exercice.length <= 255) query.set("exercice", exercice);
    if (isIsoDate(arrete)) query.set("date", arrete);
    redirect(`/e/${slug}/studio-restructuring?${query}`);
  }
  return { ok: "Ligne ajoutée au plan." };
}

/** Cap 13 : supprime une ligne de flux. Une ligne déjà supprimée ailleurs n’est pas une erreur. */
export async function deleteCashFlowAction(slug: string, flowId: string, _previous: FormState, _form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  try { await updateCashPlan(workspace.id, session.user.id, (current) => ({ ...current, flows: current.flows.filter((flow) => flow.id !== flowId) }), "flow-removed"); }
  catch (error) { return cashFailure(error); }
  revalidatePath(`/e/${slug}/studio-restructuring`);
  return { ok: "Ligne supprimée." };
}

/** Cap 13 : solde de départ saisi (ou retour au solde du FEC) et découvert autorisé. */
export async function saveCashStartAction(slug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  let values;
  try { values = startFromForm(form); }
  catch (error) { return { error: error instanceof Error ? error.message : "Saisie invalide." }; }
  try { await updateCashPlan(workspace.id, session.user.id, (current) => ({ ...current, ...values }), "start-changed"); }
  catch (error) { return cashFailure(error); }
  revalidatePath(`/e/${slug}/studio-restructuring`);
  return { ok: values.start ? "Solde de départ saisi enregistré." : "Le plan part du solde du FEC." };
}

/** Cap 13 : crée un scénario vide (le plan de base n’est pas modifié), puis l’ouvre. */
export async function createCashScenarioAction(slug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  let name: string;
  try { name = scenarioNameFromForm(form); }
  catch (error) { return { error: error instanceof Error ? error.message : "Nom invalide." }; }
  const id = randomUUID();
  try {
    await updateCashPlan(workspace.id, session.user.id, (current) => {
      if (current.scenarios.length >= MAX_SCENARIOS) throw new CashPlanError(`${MAX_SCENARIOS} scénarios au plus : supprime un scénario avant d’en créer un autre.`);
      if (current.scenarios.some((scenario) => scenario.name.toLowerCase() === name.toLowerCase())) throw new CashPlanError("Un scénario porte déjà ce nom.");
      return { ...current, scenarios: [...current.scenarios, { id, name, measures: [] }] };
    }, "scenario-created");
  } catch (error) { return cashFailure(error); }
  revalidatePath(`/e/${slug}/studio-restructuring`);
  const query = new URLSearchParams({ vue: "cash", scenario: id });
  const exercice = String(form.get("exercice") ?? "");
  const arrete = String(form.get("arrete") ?? "");
  if (exercice && exercice.length <= 255) query.set("exercice", exercice);
  if (isIsoDate(arrete)) query.set("date", arrete);
  redirect(`/e/${slug}/studio-restructuring?${query}#cash-scenario`);
}

/** Cap 13 : supprime un scénario et ses mesures. Le plan de base est inchangé. */
export async function deleteCashScenarioAction(slug: string, scenarioId: string, _previous: FormState, _form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  try { await updateCashPlan(workspace.id, session.user.id, (current) => ({ ...current, scenarios: current.scenarios.filter((scenario) => scenario.id !== scenarioId) }), "scenario-removed"); }
  catch (error) { return cashFailure(error); }
  revalidatePath(`/e/${slug}/studio-restructuring`);
  return { ok: "Scénario supprimé." };
}

/** Cap 13 : ajoute une mesure à un scénario. Une ligne de base ne porte qu’une mesure par scénario. */
export async function addCashMeasureAction(slug: string, scenarioId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  let measure;
  try { measure = measureFromForm(form, randomUUID()); }
  catch (error) { return { error: error instanceof Error ? error.message : "Mesure invalide." }; }
  try {
    await updateCashPlan(workspace.id, session.user.id, (current) => {
      const scenario = current.scenarios.find((item) => item.id === scenarioId);
      if (!scenario) throw new CashPlanError("Scénario introuvable. Recharge la page.");
      if (scenario.measures.length >= MAX_MEASURES) throw new CashPlanError(`${MAX_MEASURES} mesures au plus par scénario.`);
      if (measure.kind !== "encaissement") {
        const flow = current.flows.find((item) => item.id === measure.flowId);
        if (!flow) throw new CashPlanError("La ligne visée n’existe plus dans le plan de base. Recharge la page.");
        if (flow.direction !== "out") throw new CashPlanError("Seul un décaissement peut être reporté ou étalé.");
        if (scenario.measures.some((item) => item.kind !== "encaissement" && item.flowId === measure.flowId)) throw new CashPlanError("Cette ligne porte déjà une mesure dans ce scénario : supprime-la avant d’en saisir une autre.");
      }
      return { ...current, scenarios: current.scenarios.map((item) => item.id === scenarioId ? { ...item, measures: [...item.measures, measure] } : item) };
    }, "measure-added");
  } catch (error) { return cashFailure(error); }
  revalidatePath(`/e/${slug}/studio-restructuring`);
  return { ok: "Mesure ajoutée au scénario." };
}

/** Cap 13 : supprime une mesure d’un scénario. */
export async function deleteCashMeasureAction(slug: string, scenarioId: string, measureId: string, _previous: FormState, _form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  try {
    await updateCashPlan(workspace.id, session.user.id, (current) => ({
      ...current, scenarios: current.scenarios.map((item) => item.id === scenarioId ? { ...item, measures: item.measures.filter((measure) => measure.id !== measureId) } : item),
    }), "measure-removed");
  } catch (error) { return cashFailure(error); }
  revalidatePath(`/e/${slug}/studio-restructuring`);
  return { ok: "Mesure supprimée." };
}
