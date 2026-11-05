"use server";

import { revalidatePath } from "next/cache";
import { addHypothesisAction, type FormState } from "../studio-rh/hypotheses/actions";

export async function addRestructuringHireAction(slug: string, scenarioId: string, previous: FormState, form: FormData): Promise<FormState> {
  // L’action RH conserve les contrôles de rôle, d’espace, de brouillon et les calculs existants.
  const result = await addHypothesisAction(slug, scenarioId, "embauche", previous, form);
  if (result?.ok && !result.error) {
    revalidatePath(`/e/${slug}/studio-restructuring`);
    revalidatePath(`/e/${slug}/studio-finance`);
  }
  return result;
}
