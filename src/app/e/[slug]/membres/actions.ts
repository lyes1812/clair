"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { recordEvent } from "@/lib/events";
import { isRole } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";

export type ActionState = { error?: string; ok?: string } | undefined;

const fail = (error: string): ActionState => ({ error });

export async function renameWorkspace(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { session, workspace } = await requireWorkspace(slug, "admin");
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 80) return fail("Le nom doit contenir entre 2 et 80 caractères.");
  await auth.api.updateOrganization({
    body: { organizationId: workspace.id, data: { name } },
    headers: await headers(),
  });
  await recordEvent(workspace.id, session.user.id, "workspace.renamed", { from: workspace.name, to: name });
  revalidatePath(`/e/${slug}`, "layout");
  return { ok: "Espace renommé." };
}

export async function inviteMember(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { workspace } = await requireWorkspace(slug, "admin");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = formData.get("role");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Adresse e-mail invalide.");
  if (!isRole(role)) return fail("Rôle invalide.");
  try {
    await auth.api.createInvitation({
      body: { email, role, organizationId: workspace.id },
      headers: await headers(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return fail(/already a member/i.test(message) ? "Cette personne est déjà membre de l'espace." : "Invitation impossible.");
  }
  revalidatePath(`/e/${slug}/membres`);
  return { ok: "Invitation créée : copiez le lien ci-dessous et transmettez-le à la personne." };
}

export async function cancelInvitation(slug: string, invitationId: string) {
  await requireWorkspace(slug, "admin");
  await auth.api.cancelInvitation({ body: { invitationId }, headers: await headers() });
  revalidatePath(`/e/${slug}/membres`);
}

export async function changeRole(slug: string, memberId: string, formData: FormData) {
  const { workspace } = await requireWorkspace(slug, "admin");
  const role = formData.get("role");
  if (!isRole(role)) return;
  await auth.api.updateMemberRole({
    body: { memberId, role, organizationId: workspace.id },
    headers: await headers(),
  });
  revalidatePath(`/e/${slug}/membres`);
}

export async function removeMember(slug: string, memberId: string) {
  const { workspace } = await requireWorkspace(slug, "admin");
  await auth.api.removeMember({
    body: { memberIdOrEmail: memberId, organizationId: workspace.id },
    headers: await headers(),
  });
  revalidatePath(`/e/${slug}/membres`);
}
