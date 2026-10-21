"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ProviderError } from "@/lib/connectors/http";
import { isMonth, monthRange } from "@/lib/connectors/months";
import { applySync, deleteCredential, discardSync, saveCredential, startSync, SyncError, verifyPayFitKey } from "@/lib/connectors/sync";
import { requireWorkspace } from "@/lib/workspace";

export type FormState = { error?: string; ok?: string } | undefined;

const MAX_MONTHS = 24;

function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(new Date());
}

export async function connectPayFit(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const key = String(formData.get("apiKey") ?? "").trim();
  if (!key) return { error: "Saisissez la clé API PayFit." };
  try {
    const verified = await verifyPayFitKey(key);
    await saveCredential(workspace.id, "payfit", key, verified, session.user.id);
  } catch (e) {
    return { error: e instanceof ProviderError ? e.message : "Vérification impossible. Réessayez." };
  }
  revalidatePath(`/e/${slug}/donnees`, "layout");
  return { ok: "Connexion vérifiée auprès de PayFit." };
}

export async function disconnectPayFit(slug: string) {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  await deleteCredential(workspace.id, "payfit", session.user.id);
  revalidatePath(`/e/${slug}/donnees`, "layout");
}

export async function launchPayFitSync(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  if (!isMonth(from) || !isMonth(to)) return { error: "Choisissez un mois de début et un mois de fin." };
  if (from > to) return { error: "Le mois de début doit précéder le mois de fin." };
  if (to > currentMonth()) return { error: "Le mois de fin ne peut pas être dans le futur." };
  const months = monthRange(from, to);
  if (months.length > MAX_MONTHS) return { error: `${MAX_MONTHS} mois au plus par lecture.` };
  let id: string;
  try {
    id = await startSync(workspace.id, "payfit", months, session.user.id);
  } catch (e) {
    return { error: e instanceof SyncError ? e.message : "Lecture impossible. Réessayez." };
  }
  redirect(`/e/${slug}/donnees/synchro/${id}`);
}

export async function decideSync(slug: string, syncId: string, decision: "apply" | "discard"): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  try {
    if (decision === "apply") await applySync(workspace.id, syncId, session.user.id);
    else await discardSync(workspace.id, syncId, session.user.id);
  } catch (e) {
    return { error: e instanceof SyncError ? e.message : "Opération impossible." };
  }
  revalidatePath(`/e/${slug}/donnees`, "layout");
  return { ok: decision === "apply" ? "Synchronisation appliquée : c'est désormais la source active." : "Aperçu abandonné." };
}
