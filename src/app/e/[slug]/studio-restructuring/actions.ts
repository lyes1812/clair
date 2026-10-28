"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Hypothesis } from "@/lib/budget/types";
import { applyChanges, getScenario } from "@/lib/budget/store";
import { recordEvent } from "@/lib/events";
import { canonicalJson, sha256 } from "@/lib/crypto";
import { exitFromForm } from "@/lib/restructuring/forms";
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
