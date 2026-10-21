"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/session";
import { workspaceSlug } from "@/lib/slug";

export type FormState = { error?: string } | undefined;

export async function createWorkspace(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 80) return { error: "Le nom doit contenir entre 2 et 80 caractères." };
  const slug = workspaceSlug(name);
  try {
    await auth.api.createOrganization({ body: { name, slug }, headers: await headers() });
  } catch {
    return { error: "Création impossible. Réessayez." };
  }
  redirect(`/e/${slug}`);
}
