import { and, asc, eq } from "drizzle-orm";
import { sourceSync, workspaceCompany, workspaceEvent } from "@/db/schema";
import { CompanySelectionError, selectCompanyId, withWorkspace } from "@/db/workspace-scope";
import { COMPANY_ID_RE, readCompanyRequest } from "./company-request";

export type Company = typeof workspaceCompany.$inferSelect;
export type CompanyInput = { name: string; siren?: string | null };
export class CompanyError extends Error {
  constructor(message: string) { super(message); this.name = "CompanyError"; }
}

export function parseCompanyInput(input: CompanyInput): { name: string; siren: string | null } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 120) throw new CompanyError("Nom de société requis, de 120 caractères au plus.");
  if (input.siren !== undefined && input.siren !== null && typeof input.siren !== "string") throw new CompanyError("Le SIREN doit contenir neuf chiffres, ou rester vide.");
  const siren = input.siren === undefined || input.siren === null ? null : input.siren.trim() || null;
  if (siren !== null && !/^\d{9}$/.test(siren)) throw new CompanyError("Le SIREN doit contenir neuf chiffres, ou rester vide.");
  return { name, siren };
}

export async function listCompanies(workspaceId: string): Promise<Company[]> {
  return withWorkspace(workspaceId, (tx) => tx.select().from(workspaceCompany)
    .where(eq(workspaceCompany.workspaceId, workspaceId)).orderBy(asc(workspaceCompany.createdAt), asc(workspaceCompany.id)), { allCompanies: true });
}

export async function getCompany(workspaceId: string, companyId: string): Promise<Company | null> {
  if (!COMPANY_ID_RE.test(companyId)) return null;
  const [company] = await withWorkspace(workspaceId, (tx) => tx.select().from(workspaceCompany)
    .where(and(eq(workspaceCompany.workspaceId, workspaceId), eq(workspaceCompany.id, companyId))).limit(1), { allCompanies: true });
  return company ?? null;
}

export async function getCompanyContext(workspaceId: string): Promise<{ companies: Company[]; selected: Company | null; selectionError: string | null; requestedId: string | null }> {
  const [companies, request] = await Promise.all([listCompanies(workspaceId), readCompanyRequest(workspaceId)]);
  try {
    const selectedId = selectCompanyId(companies, request.requestedId);
    return { companies, selected: companies.find((company) => company.id === selectedId) ?? null, selectionError: null, requestedId: request.requestedId };
  } catch (error) {
    if (!(error instanceof CompanySelectionError)) throw error;
    return { companies, selected: null, selectionError: error.message, requestedId: request.requestedId };
  }
}

function databaseConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; cause?: unknown };
  return value.code === "23505" || (value.cause !== undefined && value.cause !== error && databaseConflict(value.cause));
}

export async function createCompany(workspaceId: string, actor: string, input: CompanyInput): Promise<Company> {
  const parsed = parseCompanyInput(input);
  try {
    return await withWorkspace(workspaceId, async (tx) => {
      const [company] = await tx.insert(workspaceCompany).values({ workspaceId, ...parsed, origin: "manual", createdBy: actor, updatedBy: actor }).returning();
      if (!company) throw new CompanyError("Création de société impossible.");
      await tx.insert(workspaceEvent).values({ workspaceId, companyId: company.id, actorUserId: actor, kind: "company.created", detail: { companyId: company.id } });
      return company;
    }, { allCompanies: true });
  } catch (error) {
    if (error instanceof CompanyError) throw error;
    if (databaseConflict(error)) throw new CompanyError("Une société de cet espace utilise déjà ce nom.");
    throw new CompanyError("Création de société impossible. Réessaie.");
  }
}

export async function renameCompany(workspaceId: string, actor: string, companyId: string, input: CompanyInput): Promise<Company> {
  if (!COMPANY_ID_RE.test(companyId)) throw new CompanyError("Société introuvable dans cet espace.");
  const parsed = parseCompanyInput(input);
  try {
    return await withWorkspace(workspaceId, async (tx) => {
      const [existing] = await tx.select().from(workspaceCompany)
        .where(and(eq(workspaceCompany.workspaceId, workspaceId), eq(workspaceCompany.id, companyId))).limit(1).for("update");
      if (!existing) throw new CompanyError("Société introuvable dans cet espace.");
      const siren = input.siren === undefined ? existing.siren : parsed.siren;
      if (siren !== existing.siren) {
        const [source] = await tx.select({ id: sourceSync.id }).from(sourceSync)
          .where(and(eq(sourceSync.workspaceId, workspaceId), eq(sourceSync.companyId, companyId))).limit(1);
        if (source) throw new CompanyError("Le SIREN ne peut plus être modifié après la première lecture d’une source.");
      }
      const [company] = await tx.update(workspaceCompany).set({ ...parsed, siren, updatedBy: actor, updatedAt: new Date() })
        .where(and(eq(workspaceCompany.workspaceId, workspaceId), eq(workspaceCompany.id, companyId))).returning();
      if (!company) throw new CompanyError("Société introuvable dans cet espace.");
      await tx.insert(workspaceEvent).values({ workspaceId, companyId: company.id, actorUserId: actor, kind: "company.updated", detail: { companyId: company.id } });
      return company;
    }, { allCompanies: true });
  } catch (error) {
    if (error instanceof CompanyError) throw error;
    if (databaseConflict(error)) throw new CompanyError("Une société de cet espace utilise déjà ce nom.");
    throw new CompanyError("Modification de société impossible. Réessaie.");
  }
}
