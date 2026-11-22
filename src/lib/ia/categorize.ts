import { sha256 } from "@/lib/crypto";
import { fitsDirection, isBankCategory, type AiProposal, type CategorizedFlow } from "@/lib/bank/categories";
import { callJson, IaUnavailable } from "./client";
import { createPseudonymizer } from "./pseudonymize";
import { CATEGORIZE_PROMPT_VERSION, CATEGORIZE_SYSTEM, CategorizeOutput, categorizeUserMessage, type CategorizeInput } from "./prompts/categorize-v1";

// Étape 3 de la catégorisation (section 8) : l'IA ne voit que le résidu laissé par les règles, par lots de 100, après
// pseudonymisation. Un flux dont le texte pseudonymisé contient encore un nom connu n'est pas envoyé.

export const AI_BATCH = 100;
/** Plafond par lancement : borne la durée et le coût d'un clic ; relancer traite la suite. */
export const AI_MAX_PER_RUN = 500;

export type IaJournal = (detail: { model: string; promptVersion: string; inputHash: string; flows: number; returned: number; status: "ok" | "echec" }) => Promise<void>;
export type AiRunResult = { proposals: Record<string, AiProposal>; sent: number; blocked: number; failedBatches: number; remaining: number };

export async function proposeCategories(residue: CategorizedFlow[], personNames: string[], journal: IaJournal): Promise<AiRunResult> {
  const p = createPseudonymizer(personNames);
  const proposals: Record<string, AiProposal> = {};
  const todo = residue.filter((f) => f.source === null).slice(0, AI_MAX_PER_RUN);
  const remaining = residue.filter((f) => f.source === null).length - todo.length;
  let blocked = 0;
  let sent = 0;
  let failedBatches = 0;
  const ready: { flow: CategorizedFlow; input: Omit<CategorizeInput, "i"> }[] = [];
  for (const flow of todo) {
    const libelle = p.apply(flow.label);
    const contrepartie = flow.counterparty ? p.apply(flow.counterparty) || null : null;
    if (p.leaks(`${libelle} ${contrepartie ?? ""}`).length) { blocked++; continue; }
    ready.push({ flow, input: { libelle, sens: flow.direction === "in" ? "encaissement" : "decaissement", montant_arrondi: Math.round(Math.abs(flow.amountCents) / 100), contrepartie } });
  }
  for (let start = 0; start < ready.length; start += AI_BATCH) {
    const batch = ready.slice(start, start + AI_BATCH);
    const user = categorizeUserMessage(batch.map((b, i) => ({ i, ...b.input })));
    const inputHash = sha256(`${CATEGORIZE_PROMPT_VERSION}\n${user}`);
    try {
      const { output, model } = await callJson({ system: CATEGORIZE_SYSTEM, user, schema: CategorizeOutput, maxTokens: 16000 });
      const seen = new Set<number>();
      let returned = 0;
      for (const r of output.resultats) {
        const item = batch[r.i];
        if (!item || seen.has(r.i) || !isBankCategory(r.categorie) || !fitsDirection(r.categorie, item.flow.direction)) continue;
        seen.add(r.i);
        returned++;
        proposals[item.flow.key] = { category: r.categorie, confidence: Math.min(1, Math.max(0, r.confiance)), reason: r.motif.slice(0, 200), promptVersion: CATEGORIZE_PROMPT_VERSION };
      }
      sent += batch.length;
      await journal({ model, promptVersion: CATEGORIZE_PROMPT_VERSION, inputHash, flows: batch.length, returned, status: "ok" });
    } catch (error) {
      failedBatches++;
      await journal({ model: "n.d.", promptVersion: CATEGORIZE_PROMPT_VERSION, inputHash, flows: batch.length, returned: 0, status: "echec" });
      if (error instanceof IaUnavailable) throw error;
    }
  }
  return { proposals, sent, blocked, failedBatches, remaining };
}
