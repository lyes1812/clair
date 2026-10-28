"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { toCents } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";
import { loadPayrollContext } from "@/lib/payroll/context";
import { monthPayroll } from "@/lib/payroll/engine";
import { parseActualEvent } from "@/lib/payroll/non-recurring";
import { ActualEventError, saveActualEvent } from "@/lib/payroll/non-recurring-store";
import type { FormState } from "../hypotheses/actions";

export async function saveActualEventAction(slug: string, syncId: string, displayedVersions: Record<string, string>, _previous: FormState, form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  const value = (key: string) => String(form.get(key) ?? "").trim();
  const requestedId = value("id");
  if (requestedId && !Object.hasOwn(displayedVersions, requestedId)) return { error: "Déclaration absente du formulaire affiché. Recharge la page." };
  const amountText = value("chargedEuros");
  const chargedCents = amountText === "" ? null : toCents(amountText);
  if (amountText && chargedCents === null) return { error: "Montant chargé invalide : saisis des euros, avec au plus deux décimales." };
  const event = parseActualEvent({ id: requestedId || randomUUID(), syncId, month: value("month"), kind: value("kind"), chargedCents, contractKeys: [value("contract1"), value("contract2")].filter(Boolean), note: value("note") });
  if (!event) return { error: "Vérifie le mois, la nature et les contrats : un tuilage demande deux contrats distincts, les autres éléments au plus un contrat." };
  if (event.chargedCents !== null && !event.note) return { error: "Indique la pièce ou la source du montant chargé isolé." };
  try {
    const ctx = await loadPayrollContext(slug);
    if (ctx.source !== "payfit" || ctx.read?.syncId !== syncId || !ctx.input) return { error: "La lecture PayFit a changé ou n’est plus active. Recharge la page." };
    if (monthPayroll(ctx.input, event.month).kind !== "value") return { error: "Le journal PayFit de ce mois doit être disponible avant d’isoler un élément réalisé." };
    const known = new Set(ctx.kpi.collab.data?.contracts.map((c) => c.contractKey));
    if (event.contractKeys.some((key) => !known.has(key))) return { error: "Un contrat est absent du référentiel courant de cet espace." };
    await saveActualEvent(workspace.id, session.user.id, event, requestedId ? displayedVersions[requestedId] : null);
  } catch (error) {
    return { error: error instanceof ActualEventError ? error.message : "Enregistrement indisponible. Aucune donnée source n’a été modifiée." };
  }
  revalidatePath(`/e/${slug}/studio-rh/masse-salariale`);
  return { ok: "Élément réalisé identifié. La paie source reste inchangée et le coût n’est pas ajouté une seconde fois." };
}
