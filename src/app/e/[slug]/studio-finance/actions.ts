"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formId, formName, formRevision, mappingsFromForm, planFromForm } from "@/lib/finance/forms";
import { FinanceError } from "@/lib/finance/plans";
import { getFinanceSettings, saveFinanceSettings } from "@/lib/finance/store";
import type { FinanceFormState } from "@/lib/finance/types";
import { requireWorkspace } from "@/lib/workspace";

const path = (slug: string) => `/e/${slug}/studio-finance`;
const failure = (e: unknown): FinanceFormState => ({ error: e instanceof FinanceError ? e.message : "Enregistrement impossible. Réessayez après avoir rechargé la page." });
export async function savePlanAction(slug: string, _previous: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  let id: string, year: number;
  try {
    const revision = formRevision(form);
    const settings = await getFinanceSettings(workspace.id);
    if (revision !== settings.revision) throw new FinanceError("La saisie a changé dans un autre onglet. Rechargez la page avant de recommencer.");
    const plan = planFromForm(form, settings);
    const plans = [...settings.plans.filter((p) => p.id !== plan.id), plan];
    await saveFinanceSettings(workspace.id, session.user.id, revision, { ...settings, plans });
    id = plan.id; year = plan.year;
  } catch (e) { return failure(e); }
  revalidatePath(path(slug));
  redirect(`${path(slug)}?vue=plans&annee=${year}&plan=${id}`);
}
export async function duplicatePlanAction(slug: string, _previous: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const { session, workspace } = await requireWorkspace(slug, "editor");
  let id: string, year: number;
  try {
    const revision = formRevision(form);
    const settings = await getFinanceSettings(workspace.id);
    if (revision !== settings.revision) throw new FinanceError("La saisie a changé dans un autre onglet. Rechargez la page.");
    const original = settings.plans.find((p) => p.id === formId(form));
    if (!original) throw new FinanceError("Version introuvable dans cet espace.");
    if (settings.plans.length >= 12) throw new FinanceError("Cet espace contient déjà 12 plans : modifiez une version existante.");
    const copy = { ...original, id: randomUUID(), name: formName(form), updatedAt: new Date().toISOString() };
    await saveFinanceSettings(workspace.id, session.user.id, revision, { ...settings, plans: [...settings.plans, copy] });
    id = copy.id; year = copy.year;
  } catch (e) { return failure(e); }
  revalidatePath(path(slug));
  redirect(`${path(slug)}?vue=plans&annee=${year}&plan=${id}`);
}
export async function saveMappingsAction(slug: string, _previous: FinanceFormState, form: FormData): Promise<FinanceFormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  try {
    const revision = formRevision(form);
    const settings = await getFinanceSettings(workspace.id);
    if (revision !== settings.revision) throw new FinanceError("Le modèle a changé dans un autre onglet. Rechargez la page.");
    await saveFinanceSettings(workspace.id, session.user.id, revision, { ...settings, mappings: mappingsFromForm(form, settings) });
  } catch (e) { return failure(e); }
  revalidatePath(path(slug));
  return { ok: "Correspondances enregistrées pour cet espace. Les écritures sources restent intactes." };
}
