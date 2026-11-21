import { AsyncLocalStorage } from "node:async_hooks";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { workspaceCompany } from "./schema";
import { COMPANY_ID_RE, readCompanyRequest } from "@/lib/company-request";

export type WorkspaceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type WorkspaceTransactionConfig = PgTransactionConfig & { companyId?: string; allCompanies?: boolean };
type CompanyScope = { workspaceId: string; companyId: string };
const companyScope = new AsyncLocalStorage<CompanyScope>();

export class CompanySelectionError extends Error {
  constructor(message: string, readonly code: "required" | "invalid" | "archived" | "unavailable" = "required") {
    super(message);
    this.name = "CompanySelectionError";
  }
}

export function selectCompanyId(companies: readonly { id: string; archivedAt: Date | null }[], requestedId: string | null): string {
  if (requestedId !== null) {
    if (!COMPANY_ID_RE.test(requestedId)) throw new CompanySelectionError("Société invalide : choisis une société de cet espace.", "invalid");
    const selected = companies.find((company) => company.id.toLowerCase() === requestedId.toLowerCase());
    if (!selected) throw new CompanySelectionError("Cette société n’appartient pas à cet espace.", "invalid");
    if (selected.archivedAt) throw new CompanySelectionError("Cette société est archivée. Choisis une société active.", "archived");
    return selected.id;
  }
  const active = companies.filter((company) => !company.archivedAt);
  if (active.length === 1) return active[0].id;
  throw new CompanySelectionError(active.length ? "Choisis une société pour consulter ses données." : "Aucune société active dans cet espace.", active.length ? "required" : "unavailable");
}

export function withCompanyScope<T>(workspaceId: string, companyId: string, fn: () => Promise<T>): Promise<T> {
  if (!workspaceId || !COMPANY_ID_RE.test(companyId)) return Promise.reject(new CompanySelectionError("Périmètre de société invalide.", "invalid"));
  return companyScope.run({ workspaceId, companyId }, fn);
}

// Toute lecture ou écriture d'une table métier passe par ici : la transaction déclare l'espace,
// et les politiques RLS de PostgreSQL filtrent les lignes en conséquence.
export async function withWorkspace<T>(workspaceId: string, fn: (tx: WorkspaceTransaction) => Promise<T>, config?: WorkspaceTransactionConfig): Promise<T> {
  if (!workspaceId) throw new Error("Espace manquant");
  const { companyId, allCompanies = false, ...transactionConfig } = config ?? {};
  if (allCompanies && companyId !== undefined) throw new CompanySelectionError("Un seul périmètre de société peut être utilisé à la fois.", "invalid");
  const stored = companyScope.getStore();
  const requested = companyId ?? (stored?.workspaceId === workspaceId ? stored.companyId : undefined);
  const request = allCompanies || requested !== undefined ? null : await readCompanyRequest(workspaceId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    // '*' est exclusivement une option interne pour les listes de sociétés et
    // leurs métadonnées. Ni une adresse ni un cookie ne peuvent le demander.
    if (allCompanies) await tx.execute(sql`select set_config('app.company_id', '*', true)`);
    else {
      const companies = await tx.select({ id: workspaceCompany.id, archivedAt: workspaceCompany.archivedAt }).from(workspaceCompany)
        .where(eq(workspaceCompany.workspaceId, workspaceId)).orderBy(asc(workspaceCompany.createdAt), asc(workspaceCompany.id));
      const selected = selectCompanyId(companies, requested ?? request?.requestedId ?? null);
      await tx.execute(sql`select set_config('app.company_id', ${selected}, true)`);
    }
    return fn(tx);
  }, transactionConfig);
}

export async function currentCompanyId(workspaceId: string): Promise<string> {
  return withWorkspace(workspaceId, async (tx) => {
    const result = await tx.execute(sql`select current_setting('app.company_id', true) as company_id`);
    const id = (result.rows[0] as { company_id?: string } | undefined)?.company_id;
    if (!id || !COMPANY_ID_RE.test(id)) throw new CompanySelectionError("Choisis une société pour consulter ses données.");
    return id;
  });
}
