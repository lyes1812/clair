import { desc, eq } from "drizzle-orm";
import { budgetBase, budgetScenario, connectorCredential, sourceSync } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { listCompanies } from "./companies";

// Seulement le catalogue et l'état des périmètres : aucune paie, hypothèse ou clé
// ne doit être chargée pour afficher le registre de l'espace.
export async function companyOverview(workspaceId: string) {
  const companies = await listCompanies(workspaceId);
  const metadata = await withWorkspace(workspaceId, async (tx) => {
    const connections = await tx.select({ companyId: connectorCredential.companyId, provider: connectorCredential.provider, status: connectorCredential.status }).from(connectorCredential);
    const reads = await tx.select({ companyId: sourceSync.companyId, provider: sourceSync.provider, status: sourceSync.status, startedAt: sourceSync.startedAt }).from(sourceSync).orderBy(desc(sourceSync.startedAt));
    const scenarios = await tx.select({ companyId: budgetBase.companyId, id: budgetScenario.id, name: budgetScenario.name, status: budgetScenario.status }).from(budgetScenario).innerJoin(budgetBase, eq(budgetBase.id, budgetScenario.baseId));
    return { connections, reads, scenarios };
  }, { allCompanies: true, accessMode: "read only" });
  return companies.map((company) => ({ company,
    connections: metadata.connections.filter((row) => row.companyId === company.id && row.status !== "disconnected"),
    lastRead: metadata.reads.find((row) => row.companyId === company.id && row.status === "applied") ?? null,
    hasSources: metadata.reads.some((row) => row.companyId === company.id),
    scenarios: metadata.scenarios.filter((row) => row.companyId === company.id),
  }));
}
