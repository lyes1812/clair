"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isMonth } from "@/lib/connectors/months";
import { pairFingerprint } from "@/lib/reconciliation/compare";
import { parseDecisionCommand } from "@/lib/reconciliation/reduce";
import { ERROR_LABELS, type DecisionError } from "@/lib/reconciliation/types";
import { appendReconciliationDecision, createReconciliationRun, loadReconciliation } from "@/lib/reconciliation/store";
import { requireWorkspace } from "@/lib/workspace";

export type FormState = { error?: string; ok?: string; details?: string[] } | undefined;
const field = (f: FormData, key: string) => typeof f.get(key) === "string" ? (f.get(key) as string).trim() : "";
const base = (slug: string) => `/e/${encodeURIComponent(slug)}/donnees/rapprochement`;
const uuid = z.string().uuid();
const meta = z.object({ runId: uuid, revision: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER), inputHash: z.string().regex(/^[a-f0-9]{64}$/) });
const messages: Record<string, string> = {
  invalid_month: "Choisissez un mois DSN disponible.",
  not_found: "Contrôle indisponible dans cet espace.",
  stale: "Les sources ont changé. Ouvrez un contrôle actualisé.",
  revision_conflict: "Le contrôle a été modifié. Rechargez la page.",
  invalid_decision: "La décision ne correspond plus au contrôle. Rechargez la page.",
  unavailable: "Les deux sources appliquées sont nécessaires pour ouvrir un contrôle.",
};
function failure(error: unknown): FormState {
  if (error && typeof error === "object") {
    const reason = "decisionReason" in error ? error.decisionReason : null;
    if (typeof reason === "string" && Object.prototype.hasOwnProperty.call(ERROR_LABELS, reason)) return { error: ERROR_LABELS[reason as DecisionError] };
    const code = "code" in error ? error.code : null;
    if (typeof code === "string" && Object.prototype.hasOwnProperty.call(messages, code)) return { error: messages[code] };
  }
  // Ne jamais renvoyer les messages SQL, valeurs de source ou commentaires libres d'une exception.
  return { error: "Enregistrement impossible. Rechargez la page et réessayez." };
}

export async function createReconciliationAction(slug: string, _previous: FormState, f: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  const month = field(f, "controlMonth");
  if (!isMonth(month)) return { error: messages.invalid_month };
  let id: string;
  try { id = await createReconciliationRun(workspace.id, session.user.id, month); }
  catch (error) { return failure(error); }
  revalidatePath(base(slug));
  redirect(`${base(slug)}?run=${encodeURIComponent(id)}`);
}

export async function decideReconciliationAction(slug: string, _previous: FormState, f: FormData): Promise<FormState> {
  const { workspace, session } = await requireWorkspace(slug, "editor");
  const parsed = meta.safeParse({ runId: field(f, "runId"), revision: field(f, "revision"), inputHash: field(f, "inputHash") });
  if (!parsed.success || !/^\d+$/.test(field(f, "revision"))) return { error: "Contrôle invalide. Rechargez la page." };
  const { runId, revision, inputHash } = parsed.data;
  const kind = field(f, "kind");
  const dsnId = field(f, "dsnId"), payfitId = field(f, "payfitId");
  const entity = field(f, "entity");
  let fingerprint = field(f, "fingerprint");
  try {
    if (kind === "link-person" || kind === "link-contract") {
      // Les choix sont manuels. L'empreinte du couple est reconstruite sur le serveur, jamais déduite du nom.
      if (!uuid.safeParse(dsnId).success || !uuid.safeParse(payfitId).success) return { error: "Choisissez les deux lignes à associer." };
      const current = (await loadReconciliation(workspace.id, runId)).selected;
      if (!current) return { error: messages.not_found };
      if (current.stale || current.inputHash !== inputHash) return { error: messages.stale };
      if (current.revision !== revision) return { error: messages.revision_conflict };
      fingerprint = pairFingerprint(current.snapshot, kind === "link-person" ? "person" : "contract", dsnId, payfitId, current.state);
    }
    let raw: unknown;
    if (kind === "link-person" || kind === "link-contract") raw = { kind, dsnId, payfitId, fingerprint };
    else if (kind === "unlink-person" || kind === "unlink-contract") raw = { kind, dsnId, payfitId, fingerprint, comment: field(f, "comment") };
    else if (kind === "mark-unmatched" || kind === "reopen-unmatched") raw = { kind, target: { entity, source: field(f, "source"), id: field(f, "id") }, fingerprint, comment: field(f, "comment") };
    else if (kind === "resolve-field" || kind === "reopen-field") raw = { kind, target: { entity, dsnId, payfitId, field: field(f, "field") }, fingerprint, comment: field(f, "comment"), ...(kind === "resolve-field" ? { disposition: field(f, "disposition") } : {}) };
    else return { error: "Décision inconnue." };
    const command = parseDecisionCommand(raw);
    if (!command) return { error: "Décision invalide : vérifiez les lignes et le commentaire (500 caractères maximum)." };
    await appendReconciliationDecision(workspace.id, session.user.id, runId, revision, inputHash, command);
  } catch (error) { return failure(error); }
  revalidatePath(base(slug));
  return { ok: "Décision enregistrée dans l’historique du contrôle." };
}
