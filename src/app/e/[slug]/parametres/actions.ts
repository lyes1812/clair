"use server";
import { revalidatePath } from "next/cache";
import { setHeadcountNatures } from "@/lib/rh-settings";
import { requireWorkspace } from "@/lib/workspace";

export type FormState = { error?: string; ok?: string } | undefined;

export async function saveHeadcountNatures(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const checked = formData.getAll("natures").map(String);
  const extra = String(formData.get("extra") ?? "")
    .split(/[\s,;]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const codes = [...new Set([...checked, ...extra])];
  if (codes.some((c) => !/^\d{2}$/.test(c))) return { error: "Un code de nature est composé de deux chiffres (ex. 01, 02, 29)." };
  if (codes.length === 0) return { error: "Choisissez au moins une nature de contrat." };
  try {
    await setHeadcountNatures(workspace.id, codes, session.user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Enregistrement impossible." };
  }
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: "Natures comptées dans l'effectif enregistrées." };
}
