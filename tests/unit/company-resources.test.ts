import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { organization, reconciliationRun, workspaceSetting } from "@/db/schema";
import { withCompanyScope, withWorkspace } from "@/db/workspace-scope";
import { createScenario, saveBudget } from "@/lib/budget/store";
import type { BaseSnapshot } from "@/lib/budget/types";
import { createCompany, listCompanies } from "@/lib/companies";
import { resourceCompanyId } from "@/lib/company-resources";
import { emptyFinanceSettings, FINANCE_SETTINGS_KEY } from "@/lib/finance/plans";
import type { FinancePlan } from "@/lib/finance/types";
import { COMPARATOR_VERSION, snapshotOf } from "@/lib/reconciliation/snapshot";
import { CASH_PLAN_KEY, emptyCashPlan } from "@/lib/restructuring/crisis/cashplan";

// PostgreSQL fictif migré : l'ancien lien ne transporte plus qu'un identifiant.
// Le propriétaire se retrouve parmi les métadonnées autorisées de cet espace,
// sans utiliser la société sélectionnée ni choisir arbitrairement une société.
const workspaceId = `test-company-resources-${randomUUID()}`;
const otherWorkspaceId = `${workspaceId}-other`;
const actor = null as unknown as string;
const path = (page: string) => `/e/${workspaceId}/${page}`;
let companyA: string;
let companyB: string;
let scenarioA: string;
let projectA: string;
let scenarioB: string;
let budgetA: string;
let runA: string;
const planA = randomUUID(), planB = randomUUID(), sharedPlan = randomUUID(), foreignPlan = randomUUID();
const cashA = randomUUID(), cashB = randomUUID(), sharedCash = randomUUID(), foreignCash = randomUUID();
const scoped = <T>(companyId: string, fn: () => Promise<T>) => withCompanyScope(workspaceId, companyId, fn);
const base: BaseSnapshot = {
  currency: "EUR", refMonth: "2026-09", syncId: "lecture-fictive", readAt: "2026-10-01",
  contracts: [], actuals: [], refMasse: 0, refBaseCost: 0, etpNote: null,
};
const scenarioInput = (name: string) => ({ name, kind: "budget" as const, firstMonth: "2026-10", lastMonth: "2026-12" });
const financePlan = (id: string): FinancePlan => ({
  id, name: "Plan fictif", kind: "budget", year: 2026, currency: "EUR", firstForecastMonth: null,
  cells: {}, personnelSource: "manual", rhScenarioId: null, updatedAt: "2026-11-21T12:00:00.000Z",
});
async function settings(ws: string, plans: string[], scenarios: string[]) {
  await withWorkspace(ws, async (tx) => {
    await tx.insert(workspaceSetting).values([
      { workspaceId: ws, key: FINANCE_SETTINGS_KEY, value: { ...emptyFinanceSettings(), plans: plans.map(financePlan) } },
      { workspaceId: ws, key: CASH_PLAN_KEY, value: { ...emptyCashPlan(), scenarios: scenarios.map((id) => ({ id, name: "Trésorerie fictive", measures: [] })) } },
    ]);
  });
}

beforeAll(async () => {
  await db.insert(organization).values([
    { id: workspaceId, name: "Espace fictif des liens", slug: workspaceId, createdAt: new Date() },
    { id: otherWorkspaceId, name: "Espace étranger fictif", slug: otherWorkspaceId, createdAt: new Date() },
  ]);
  companyA = (await listCompanies(workspaceId))[0].id;
  companyB = (await createCompany(workspaceId, actor, { name: "Société B fictive" })).id;
  await scoped(companyA, async () => {
    scenarioA = await createScenario(workspaceId, actor, scenarioInput("Référence A"), base, { prorata: "calendaire" });
    projectA = await createScenario(workspaceId, actor, scenarioInput("Projet A"), base, { prorata: "calendaire" });
    budgetA = await saveBudget(workspaceId, actor, { name: "Budget A fictif", year: "2026", amounts: {} });
    const snapshot = snapshotOf({ workspaceId, controlMonth: "2026-10", dsnSyncs: [], coverage: [], dsnRecords: [], payfitSync: null, payfitRecords: [] });
    [runA] = await withWorkspace(workspaceId, async (tx) => (await tx.insert(reconciliationRun).values({ workspaceId, controlMonth: "2026-10", inputHash: snapshot.inputHash, comparatorVersion: COMPARATOR_VERSION, snapshot, createdBy: "auteur-fictif" }).returning({ id: reconciliationRun.id })).map((row) => row.id));
    await settings(workspaceId, [planA, sharedPlan], [cashA, sharedCash]);
  });
  await scoped(companyB, async () => {
    scenarioB = await createScenario(workspaceId, actor, scenarioInput("Projet B"), base, { prorata: "calendaire" });
    await settings(workspaceId, [planB, sharedPlan], [cashB, sharedCash]);
  });
  await settings(otherWorkspaceId, [foreignPlan], [foreignCash]);
});

afterAll(async () => {
  await db.delete(organization).where(inArray(organization.id, [workspaceId, otherWorkspaceId]));
  await pool.end();
});

describe("société propriétaire des anciennes adresses", () => {
  it("retrouve scénario, budget et contrôle de rapprochement par UUID, même depuis le contexte B", async () => {
    await scoped(companyB, async () => {
      expect(await resourceCompanyId(workspaceId, path(`studio-rh/hypotheses?scenario=${scenarioA}`))).toBe(companyA);
      expect(await resourceCompanyId(workspaceId, path(`studio-rh/hypotheses?budget=${budgetA}`))).toBe(companyA);
      expect(await resourceCompanyId(workspaceId, path(`donnees/rapprochement?run=${runA}`))).toBe(companyA);
    });
  });

  it("retrouve les plans Finance et scénarios de trésorerie stockés en JSON", async () => {
    expect(await resourceCompanyId(workspaceId, path(`studio-finance?plan=${planA}`))).toBe(companyA);
    expect(await resourceCompanyId(workspaceId, path(`studio-finance?plan=${planB}`))).toBe(companyB);
    expect(await resourceCompanyId(workspaceId, path(`studio-restructuring?vue=cash&scenario=${cashA}`))).toBe(companyA);
    expect(await resourceCompanyId(workspaceId, path(`studio-restructuring?vue=cash&scenario=${cashB}`))).toBe(companyB);
  });

  it("exige un choix si un identifiant JSON existe dans deux sociétés", async () => {
    expect(await resourceCompanyId(workspaceId, path(`studio-finance?plan=${sharedPlan}`))).toBe("ambiguous");
    expect(await resourceCompanyId(workspaceId, path(`studio-restructuring?vue=cash&scenario=${sharedCash}`))).toBe("ambiguous");
  });

  it("autorise référence/projet d'une société et marque deux sociétés comme ambiguës", async () => {
    expect(await resourceCompanyId(workspaceId, path(`studio-restructuring?reference=${scenarioA}&projet=${projectA}`))).toBe(companyA);
    expect(await resourceCompanyId(workspaceId, path(`studio-restructuring?reference=${scenarioA}&projet=${scenarioA}`))).toBe(companyA);
    expect(await resourceCompanyId(workspaceId, path(`studio-restructuring?reference=${scenarioA}&projet=${scenarioB}`))).toBe("ambiguous");
    expect(await resourceCompanyId(workspaceId, path(`studio-restructuring?reference=${scenarioB}&projet=${scenarioA}`))).toBe("ambiguous");
  });

  it("ne révèle aucune ressource d'un espace étranger, y compris les identifiants JSON", async () => {
    for (const query of [`studio-rh/hypotheses?scenario=${scenarioA}`, `studio-rh/hypotheses?budget=${budgetA}`, `donnees/rapprochement?run=${runA}`, `studio-finance?plan=${planA}`, `studio-restructuring?vue=cash&scenario=${cashA}`, `studio-restructuring?reference=${scenarioA}&projet=${projectA}`]) {
      expect(await resourceCompanyId(otherWorkspaceId, path(query))).toBeNull();
    }
    expect(await resourceCompanyId(workspaceId, path(`studio-finance?plan=${foreignPlan}`))).toBeNull();
    expect(await resourceCompanyId(workspaceId, path(`studio-restructuring?vue=cash&scenario=${foreignCash}`))).toBeNull();
  });

  it("respecte une société explicite et ignore les références absentes ou invalides", async () => {
    for (const selection of [companyA, companyB, "", "*"]) {
      expect(await resourceCompanyId(workspaceId, path(`studio-rh/hypotheses?scenario=${scenarioA}&societe=${selection}`))).toBeNull();
    }
    for (const query of ["studio-rh", "studio-rh/hypotheses?scenario=invalide", `studio-rh/hypotheses?scenario=${randomUUID()}`, "donnees/rapprochement?run=*"]) {
      expect(await resourceCompanyId(workspaceId, path(query))).toBeNull();
    }
  });
});
