"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { toCents } from "@/lib/money";
import { requireWorkspace } from "@/lib/workspace";
import { loadPayrollContext } from "@/lib/payroll/context";
import { monthPayroll } from "@/lib/payroll/engine";
import { parseActualEvent } from "@/lib/payroll/non-recurring";
import { ActualEventError, listActualEvents, saveActualEvent } from "@/lib/payroll/non-recurring-store";
import { actualOverlapFromJournal } from "@/lib/payroll/actual-overlap";
import type { FormState } from "../hypotheses/actions";

export async function saveActualEventAction(slug: string, syncId: string, displayedVersions: Record<string, string>, _previous: FormState, form: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  const value = (key: string) => String(form.get(key) ?? "").trim();
  const requestedId = value("id");
  if (requestedId && !Object.hasOwn(displayedVersions, requestedId)) return { error: "Déclaration absente du formulaire affiché. Recharge la page." };
  const mode = value("valuation") || "manual";
  if (mode !== "manual" && mode !== "calendar") return { error: "Choisis un montant fourni ou une estimation calendaire depuis la paie." };
  if (mode === "calendar" && value("kind") !== "tuilage") return { error: "L’estimation calendaire depuis la paie est réservée au tuilage passé." };
  const amountText = value("chargedEuros");
  const chargedCents = mode === "calendar" || amountText === "" ? null : toCents(amountText);
  if (mode === "manual" && amountText && chargedCents === null) return { error: "Montant chargé invalide : saisis des euros, avec au plus deux décimales." };
  let event = parseActualEvent({ id: requestedId || randomUUID(), syncId, month: value("month"), kind: value("kind"), chargedCents, contractKeys: [value("contract1"), value("contract2")].filter(Boolean), note: value("note") });
  if (!event) return { error: "Vérifie le mois, la nature et les contrats : un tuilage demande deux contrats distincts, les autres éléments au plus un contrat." };
  if (event.chargedCents !== null && !event.note) return { error: "Indique la pièce ou la source du montant chargé isolé." };
  try {
    const ctx = await loadPayrollContext(slug);
    if (ctx.source !== "payfit" || ctx.read?.syncId !== syncId || !ctx.input) return { error: "La lecture PayFit a changé ou n’est plus active. Recharge la page." };
    if (monthPayroll(ctx.input, event.month).kind !== "value") return { error: "Le journal PayFit de ce mois doit être disponible avant d’isoler un élément réalisé." };
    const known = new Set(ctx.kpi.collab.data?.contracts.map((c) => c.contractKey));
    if (event.contractKeys.some((key) => !known.has(key))) return { error: "Un contrat est absent du référentiel courant de cet espace." };
    if (mode === "calendar") {
      if (requestedId) {
        const previous = (await listActualEvents(workspace.id)).find((entry) => entry.id === requestedId);
        if (!previous) return { error: "Déclaration introuvable. Recharge la page." };
        if (!previous.calculation && previous.chargedCents !== null && value("confirmReplace") !== "yes") return { error: "Confirme explicitement le remplacement du montant fourni par une estimation calendaire, ou conserve le montant sur justificatif." };
      }
      const data = ctx.kpi.collab.data;
      if (!data || data.build.inputs.source !== "payfit" || data.build.inputs.syncId !== syncId) return { error: "Le référentiel des contrats ne correspond pas à la lecture PayFit appliquée. Recharge la page." };
      const sourceContract = (key: string) => {
        const c = data.contracts.find((contract) => contract.contractKey === key);
        return c ? { contractKey: c.contractKey, externalId: c.externalId, startDate: c.startDate, endDate: c.endDate, syncId } : null;
      };
      const result = actualOverlapFromJournal({ input: ctx.input, syncId, month: event.month, incoming: sourceContract(event.contractKeys[0]), outgoing: sourceContract(event.contractKeys[1]) });
      if (result.kind === "nd") return { error: result.reason };
      event = parseActualEvent({ ...event, chargedCents: result.amountCents, calculation: result.calculation });
      if (!event) return { error: "Estimation hors des bornes de saisie ou provenance invalide ; aucun enregistrement." };
    }
    await saveActualEvent(workspace.id, session.user.id, event, requestedId ? displayedVersions[requestedId] : null);
  } catch (error) {
    return { error: error instanceof ActualEventError ? error.message : "Enregistrement indisponible. Aucune donnée source n’a été modifiée." };
  }
  revalidatePath(`/e/${slug}/studio-rh/masse-salariale`);
  revalidatePath(`/e/${slug}/studio-rh/masse-salariale/croisee`);
  revalidatePath(`/e/${slug}/studio-rh/hypotheses`);
  return { ok: `${mode === "calendar" ? "Estimation calendaire du tuilage enregistrée." : "Élément réalisé identifié."} La paie source reste inchangée et le coût n’est pas ajouté une seconde fois.` };
}
