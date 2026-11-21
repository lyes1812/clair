"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CompanyError, createCompany, getCompany, renameCompany } from "@/lib/companies";
import { companyCookieName } from "@/lib/company-request";
import { requireWorkspace } from "@/lib/workspace";

export type CompanyFormState = { error?: string; ok?: string } | undefined;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
function fields(form: FormData): { name: string; siren: string | null } | string {
  const name = str(form, "name"); const siren = str(form, "siren");
  if (!name || name.length > 120) return "Nom de société requis, de 120 caractères au plus.";
  if (siren && !/^\d{9}$/.test(siren)) return "Le SIREN doit contenir 9 chiffres, ou rester vide.";
  return { name, siren: siren || null };
}
async function remember(workspaceId: string, slug: string, companyId: string) {
  (await cookies()).set(companyCookieName(workspaceId), companyId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.BETTER_AUTH_URL?.startsWith("https://"), path: `/e/${slug}`, maxAge: 60 * 60 * 24 * 30 });
}

export async function selectCompanyAction(slug: string, _previous: CompanyFormState, form: FormData): Promise<CompanyFormState> {
  const { workspace } = await requireWorkspace(slug);
  const id = str(form, "companyId");
  if (!idPattern.test(id)) return { error: "Choisis une société de cet espace." };
  const company = await getCompany(workspace.id, id);
  if (!company || company.archivedAt) return { error: "Société indisponible dans cet espace." };
  await remember(workspace.id, slug, company.id);
  redirect(`/e/${slug}/donnees?societe=${encodeURIComponent(company.id)}`);
}

export async function createCompanyAction(slug: string, _previous: CompanyFormState, form: FormData): Promise<CompanyFormState> {
  const { workspace, session } = await requireWorkspace(slug, "admin");
  const input = fields(form);
  if (typeof input === "string") return { error: input };
  let company;
  try { company = await createCompany(workspace.id, session.user.id, input); }
  catch (error) { return { error: error instanceof CompanyError ? error.message : "Création impossible. Vérifie le nom et le SIREN de la société." }; }
  await remember(workspace.id, slug, company.id);
  revalidatePath(`/e/${slug}`, "layout");
  redirect(`/e/${slug}/donnees?societe=${encodeURIComponent(company.id)}`);
}

export async function renameCompanyAction(slug: string, companyId: string, _previous: CompanyFormState, form: FormData): Promise<CompanyFormState> {
  const { workspace, session } = await requireWorkspace(slug, "admin");
  if (!idPattern.test(companyId)) return { error: "Société indisponible." };
  const input = fields(form);
  if (typeof input === "string") return { error: input };
  try { await renameCompany(workspace.id, session.user.id, companyId, input); }
  catch (error) { return { error: error instanceof CompanyError ? error.message : "Modification impossible. Vérifie les informations de la société." }; }
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: "Informations de la société enregistrées." };
}
