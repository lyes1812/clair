import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { member, organization } from "@/db/schema";
import { hasAtLeast, isRole, type Role } from "./roles";
import { requireUser } from "./session";
import { requiresMfaSetup } from "./mfa-policy";
import { getCompanyContext, type Company } from "./companies";
import { readCompanyRequest } from "./company-request";
import { companyRouteDecision } from "./company-routing";
import { resourceCompanyId } from "./company-resources";

export type WorkspaceAccess = { id: string; name: string; slug: string; role: Role; company?: Company | null; companies?: Company[] };

export function workspaceDisplayName(workspace: WorkspaceAccess): string {
  return workspace.company && workspace.company.name !== workspace.name
    ? `${workspace.name} · ${workspace.company.name}` : workspace.name;
}

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
  if (access.role === "admin" && requiresMfaSetup(session.user)) {
    redirect(`/securite?retour=${encodeURIComponent(`/e/${slug}`)}`);
  }
  const request = await readCompanyRequest(access.id);
  // Les traitements hors page (API de l'espace et tests d'autorisation) restent
  // des contrôles d'accès. Le middleware identifie les requêtes de travail.
  if (request.url) {
    const resourceId = await resourceCompanyId(access.id, request.url);
    const context = await getCompanyContext(access.id);
    const destination = companyRouteDecision({ slug, relative: request.url, method: request.method ?? "GET", selectedId: context.selected?.id ?? null, companyCount: context.companies.filter(c => !c.archivedAt).length, error: Boolean(context.selectionError), resourceId });
    if (destination) redirect(destination);
    access.company = context.selected;
    access.companies = context.companies;
  }
  return { session, workspace: access };
}
