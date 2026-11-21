import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { budgetBase, budgetHypothesis, budgetScenario, organization, sourceSync } from "@/db/schema";
import { withCompanyScope, withWorkspace } from "@/db/workspace-scope";
import { chainBase } from "@/lib/budget/chain";
import { project } from "@/lib/budget/engine";
import { addHypothesis, createScenario, duplicateScenario, freezeScenario, getBudget, getScenario, importHypotheses, listBudgets, listScenarios, saveBudget } from "@/lib/budget/store";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { createCompany, listCompanies, renameCompany } from "@/lib/companies";
import { canonicalJson, sha256 } from "@/lib/crypto";
import { loadComparison } from "@/app/e/[slug]/studio-rh/hypotheses/resultat-data";

// Deux sociétés fictives dans le même espace et la même clé de contrat PayFit.
// Les montants diffèrent volontairement : aucune hypothèse ni référence ne doit passer de A à B.
const workspaceId = `test-ws-company-budget-${randomUUID()}`;
const actor = null as unknown as string;
const conv = { prorata: "calendaire" as const };
const input = { name: "Scénario A", kind: "budget" as const, firstMonth: "2026-10", lastMonth: "2026-12" };
let companyA: string;
let companyB: string;
let syncA: string;
let scenarioA: string;
let budgetA: string;
let snapshotA: string;
let hashA: string;
const inCompany = <T>(id: string, fn: () => Promise<T>) => withCompanyScope(workspaceId, id, fn);
const baseOf = (syncId: string, salaryCents = 300000): BaseSnapshot => ({
  currency: "EUR", refMonth: "2026-09", syncId, readAt: "2026-10-05", refMasse: salaryCents * 1.4, refBaseCost: salaryCents * 1.4, etpNote: null,
  contracts: [{ contractKey: "payfit:shared", externalId: "shared", label: "Collaborateur fictif", service: "TECH", serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, base: { salaryCents, refBrutCents: salaryCents, refCotisationsCents: salaryCents * 0.4 }, baseNd: null }], actuals: [],
});
const augmentation = (): Hypothesis => ({ id: randomUUID(), kind: "augmentation", label: "Augmentation A", from: "2026-11", rateBps: 200, scope: { kind: "contrat", key: "payfit:shared" } });
const read = (companyId: string) => inCompany(companyId, () => withWorkspace(workspaceId, async (tx) => {
  const [result] = await tx.insert(sourceSync).values({ workspaceId, provider: "payfit", status: "applied" }).returning({ id: sourceSync.id });
  return result.id;
}));

beforeAll(async () => {
  await db.insert(organization).values({ id: workspaceId, name: "Périmètre historique fictif", slug: workspaceId, createdAt: new Date() });
  companyA = (await listCompanies(workspaceId)).find((company) => company.origin === "initial")!.id;
  companyB = (await createCompany(workspaceId, actor, { name: "Société B fictive" })).id;
  syncA = await read(companyA);
  await inCompany(companyA, async () => {
    const base = baseOf(syncA);
    scenarioA = await createScenario(workspaceId, actor, input, base, conv, { sourceSyncId: syncA });
    await addHypothesis(workspaceId, actor, scenarioA, augmentation());
    await freezeScenario(workspaceId, actor, scenarioA);
    budgetA = await saveBudget(workspaceId, actor, { name: "Budget A", year: "2026", amounts: { "2026-10": 440000 } });
    snapshotA = canonicalJson(base);
    hashA = sha256(snapshotA);
  });
});

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, workspaceId));
  await pool.end();
});

describe("scénarios et hypothèses isolés par société", () => {
  it("B sans source ni scénario ne reprend ni les références ni le scénario de A", async () => {
    await inCompany(companyB, async () => {
      expect(await listScenarios(workspaceId)).toEqual([]);
      expect(await listBudgets(workspaceId)).toEqual([]);
      expect(await getScenario(workspaceId, scenarioA)).toBeNull();
      expect(await getBudget(workspaceId, budgetA)).toBeNull();
      expect(await duplicateScenario(workspaceId, actor, scenarioA, "Copie étrangère")).toBeNull();
      expect(await withWorkspace(workspaceId, (tx) => tx.select().from(sourceSync))).toEqual([]);
      await expect(createScenario(workspaceId, actor, { ...input, name: "Source étrangère" }, baseOf(syncA), conv, { sourceSyncId: syncA })).rejects.toThrow("Lecture PayFit indisponible pour cette société");
      await expect(addHypothesis(workspaceId, actor, scenarioA, augmentation())).rejects.toThrow("Scénario introuvable");
      await expect(saveBudget(workspaceId, actor, { id: budgetA, name: "Modification étrangère", year: "2026", amounts: { "2026-10": 0 } })).rejects.toThrow("Budget introuvable");
      expect(await listScenarios(workspaceId)).toEqual([]);
    });
  });

  it("B crée sa propre base et refuse la reprise A même avec une clé de contrat identique", async () => {
    const syncB = await read(companyB);
    await inCompany(companyB, async () => {
      const scenarioB = await createScenario(workspaceId, actor, { ...input, name: "Scénario B" }, baseOf(syncB, 500000), conv, { sourceSyncId: syncB });
      const own = (await getScenario(workspaceId, scenarioB))!;
      expect(own.companyId).toBe(companyB);
      expect(own.base.contracts[0].contractKey).toBe("payfit:shared");
      expect(own.base.syncId).toBe(syncB);
      await expect(importHypotheses(workspaceId, actor, scenarioB, scenarioA, new Set(["augmentation"]))).rejects.toThrow("Scénario source introuvable");
      expect((await getScenario(workspaceId, scenarioB))!.hypotheses).toEqual([]);
      await saveBudget(workspaceId, actor, { name: "Budget B", year: "2026", amounts: { "2026-10": 700000 } });
      expect((await listBudgets(workspaceId)).map((budget) => budget.name)).toEqual(["Budget B"]);
      expect((await listScenarios(workspaceId)).map((row) => row.scenario.name)).toEqual(["Scénario B"]);
      // Le filtrage vaut aussi pour un accès direct aux tables enfants.
      expect(await withWorkspace(workspaceId, (tx) => tx.select().from(budgetHypothesis).where(eq(budgetHypothesis.scenarioId, scenarioA)))).toEqual([]);
      expect(await withWorkspace(workspaceId, (tx) => tx.select().from(budgetScenario).where(eq(budgetScenario.id, scenarioA)))).toEqual([]);
      const projection = project(own.base, own.scenario.firstMonth, own.scenario.lastMonth, [], conv);
      const comparison = await loadComparison("fictif", workspaceId, own.scenario, own.base, projection, { cmp: `scenario:${scenarioA}` }, companyB);
      expect(comparison.selected).toEqual([]);
      expect(comparison.compared).toEqual([]);
      expect(comparison.options.some((option) => option.value === `scenario:${scenarioA}` || option.value === `budget:${budgetA}`)).toBe(false);
      await expect(loadComparison("fictif", workspaceId, own.scenario, own.base, projection, {}, companyA)).rejects.toThrow("même société");
    });
  });

  it("copie et N+1 conservent la société de la base, le JSON et l'empreinte figés", async () => {
    const original = (await inCompany(companyA, () => getScenario(workspaceId, scenarioA)))!;
    const projection = project(original.base, original.scenario.firstMonth, original.scenario.lastMonth, original.hypotheses, conv);
    const chained = chainBase({ id: original.scenario.id, name: original.scenario.name, firstMonth: original.scenario.firstMonth, lastMonth: original.scenario.lastMonth, conventions: conv }, original.base, original.hypotheses, projection, "2026-11-21", "2027-12");
    expect(chained.kind).toBe("value");
    if (chained.kind !== "value") throw new Error("Base dérivée fictive indisponible");
    await expect(inCompany(companyB, () => createScenario(workspaceId, actor, { ...input, firstMonth: "2027-01", lastMonth: "2027-12" }, chained.base, conv))).rejects.toThrow("Scénario parent indisponible pour cette société");
    await inCompany(companyA, async () => {
      const copyId = (await duplicateScenario(workspaceId, actor, scenarioA, "Copie A"))!;
      const copy = (await getScenario(workspaceId, copyId))!;
      expect(copy.companyId).toBe(companyA);
      expect(copy.scenario.baseId).toBe(original.scenario.baseId);
      expect(copy.baseHash).toBe(hashA);
      expect(copy.hypotheses[0].id).not.toBe(original.hypotheses[0].id);
      const childId = await createScenario(workspaceId, actor, { ...input, name: "Budget suivant A", firstMonth: "2027-01", lastMonth: "2027-12" }, chained.base, conv);
      const child = (await getScenario(workspaceId, childId))!;
      expect(child.companyId).toBe(companyA);
      expect(child.base.origin?.scenarioId).toBe(scenarioA);
      expect(child.base.syncId).toBe(syncA);
      await renameCompany(workspaceId, actor, companyA, { name: "Périmètre A renommé" });
      const unchanged = (await getScenario(workspaceId, scenarioA))!;
      expect(unchanged.company?.name).toBe("Périmètre A renommé");
      expect(unchanged.scenario.status).toBe("fige");
      expect(canonicalJson(unchanged.base)).toBe(snapshotA);
      expect(unchanged.baseHash).toBe(hashA);
      expect(sha256(canonicalJson(unchanged.base))).toBe(hashA);
      expect(await withWorkspace(workspaceId, (tx) => tx.select({ companyId: budgetBase.companyId }).from(budgetBase).where(eq(budgetBase.id, unchanged.scenario.baseId)))).toEqual([{ companyId: companyA }]);
      expect((await listBudgets(workspaceId)).map((budget) => budget.name)).toEqual(["Budget A"]);
    });
  });
});
