"use server";

import { revalidatePath } from "next/cache";
import { isBankCategory, type BankCategoryId } from "@/lib/bank/categories";
import { loadCategorization } from "@/lib/bank/categorization-context";
import { CategorizationError, personNames, updateCategorization } from "@/lib/bank/categorization-store";
import { recordEvent } from "@/lib/events";
import { IaUnavailable } from "@/lib/ia/client";
import { proposeCategories } from "@/lib/ia/categorize";
import { requireWorkspace } from "@/lib/workspace";
import type { FormState } from "../../../studio-rh/hypotheses/actions";

const fail = (error: unknown): FormState => ({ error: error instanceof CategorizationError ? error.message : "Enregistrement refusé. Recharge la page avant de réessayer." });
const done = (slug: string) => { revalidatePath(`/e/${slug}/donnees/bank/categories`); revalidatePath(`/e/${slug}/donnees/bank`); };

/**
 * Revue : pour chaque ligne affichée, `key-<i>` (flux), `cat-<i>` (catégorie, ou « ok » pour valider la proposition) et
 * `tier-<i>` (appliquer à tout le tiers). Le tiers est recalculé côté serveur à partir du flux, jamais lu du formulaire.
 */
export async function saveCategoriesAction(slug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  const { flows, unreadable } = await loadCategorization(workspace.id);
  if (unreadable) return { error: "Catégories enregistrées illisibles : rien n’a été remplacé." };
  const byKey = new Map(flows.map((f) => [f.key, f]));
  const decisions: Record<string, BankCategoryId> = {};
  const learned: Record<string, BankCategoryId> = {};
  for (let i = 0; form.has(`key-${i}`); i++) {
    const flow = byKey.get(String(form.get(`key-${i}`)));
    const raw = String(form.get(`cat-${i}`) ?? "");
    if (!flow || !raw) continue;
    const category = raw === "ok" ? flow.category : raw;
    if (!isBankCategory(category)) return { error: "Catégorie inconnue." };
    if (form.get(`tier-${i}`) === "on" && flow.tier) learned[flow.tier] = category;
    else decisions[flow.key] = category;
  }
  const changed = Object.keys(decisions).length + Object.keys(learned).length;
  if (!changed) return { ok: "Aucune modification." };
  try {
    await updateCategorization(workspace.id, session.user.id, (c) => ({ ...c, decisions: { ...c.decisions, ...decisions }, learned: { ...c.learned, ...learned } }), "revue", { decisions: Object.keys(decisions).length, learned: Object.keys(learned).length });
  } catch (error) { return fail(error); }
  done(slug);
  return { ok: `${changed} catégorie(s) enregistrée(s).` };
}

export async function forgetTierAction(slug: string, tier: string, _previous: FormState, _form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  try {
    await updateCategorization(workspace.id, session.user.id, (c) => { const learned = { ...c.learned }; delete learned[tier]; return { ...c, learned }; }, "regle_retiree");
  } catch (error) { return fail(error); }
  done(slug);
  return { ok: "Règle retirée." };
}

export async function setNoAiAction(slug: string, noAi: boolean, _previous: FormState, _form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "admin");
  try { await updateCategorization(workspace.id, session.user.id, (c) => ({ ...c, noAi }), noAi ? "sans_ia_active" : "sans_ia_retire"); }
  catch (error) { return fail(error); }
  done(slug);
  return { ok: noAi ? "Mode sans IA activé : règles seules, revue manuelle." : "Mode sans IA retiré." };
}

/** IA sur le résidu : propositions enregistrées, jamais appliquées sans revue sous les seuils. */
export async function runAiAction(slug: string, _previous: FormState, _form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  const { flows, settings, unreadable, iaReady } = await loadCategorization(workspace.id);
  if (unreadable) return { error: "Catégories enregistrées illisibles : rien n’a été envoyé." };
  if (settings.noAi) return { error: "Mode sans IA activé pour cet espace : aucun flux n’est envoyé." };
  if (!iaReady) return { error: "IA non configurée pour cette installation : aucun flux n’est envoyé." };
  const names = await personNames(workspace.id);
  let run;
  try {
    run = await proposeCategories(flows, names, (detail) => recordEvent(workspace.id, session.user.id, "ia.called", { task: "categorisation", ...detail }));
  } catch (error) {
    if (error instanceof IaUnavailable) return { error: error.message };
    return { error: "Appel au modèle impossible. Aucune catégorie n’a été modifiée." };
  }
  const count = Object.keys(run.proposals).length;
  if (count) {
    try { await updateCategorization(workspace.id, session.user.id, (c) => ({ ...c, ai: { ...c.ai, ...run.proposals } }), "propositions_ia", { proposals: count }); }
    catch (error) { return fail(error); }
  }
  done(slug);
  const details = [
    ...(run.blocked ? [`${run.blocked} flux non envoyé(s) : un nom de personne restait visible après pseudonymisation.`] : []),
    ...(run.failedBatches ? [`${run.failedBatches} lot(s) en échec : relance plus tard.`] : []),
    ...(run.remaining ? [`${run.remaining} flux restant(s) : relance pour la suite.`] : []),
  ];
  return { ok: `${count} proposition(s) de l’IA sur ${run.sent} flux envoyé(s), à revoir sous les seuils.`, ...(details.length ? { details } : {}) };
}
