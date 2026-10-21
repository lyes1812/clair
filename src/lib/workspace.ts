import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { member, organization } from "@/db/schema";
import { hasAtLeast, isRole, type Role } from "./roles";
import { requireUser } from "./session";

export type WorkspaceAccess = { id: string; name: string; slug: string; role: Role };

// Seule source de vérité pour « cet utilisateur peut-il voir cet espace ? ».
export async function findAccess(userId: string, slug: string): Promise<WorkspaceAccess | null> {
  const rows = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, userId), eq(organization.slug, slug)))
    .limit(1);
  const row = rows[0];
  if (!row || !isRole(row.role)) return null;
  return { ...row, role: row.role };
}

export async function listWorkspaces(userId: string): Promise<WorkspaceAccess[]> {
  const rows = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug, role: member.role })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));
  return rows.flatMap((r) => (isRole(r.role) ? [{ ...r, role: r.role }] : []));
}

// Garde des pages d'un espace : non-membre → 404 (on ne révèle pas l'existence de l'espace),
// administrateur sans TOTP → configuration obligatoire, rôle insuffisant → 404.
export async function requireWorkspace(slug: string, minRole: Role = "reader") {
  const session = await requireUser(`/e/${slug}`);
  const access = await findAccess(session.user.id, slug);
  if (!access || !hasAtLeast(access.role, minRole)) notFound();
  if (access.role === "admin" && !session.user.twoFactorEnabled) {
    redirect(`/securite?retour=${encodeURIComponent(`/e/${slug}`)}`);
  }
  return { session, workspace: access };
}
