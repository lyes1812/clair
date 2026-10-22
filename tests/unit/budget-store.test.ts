import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { budgetBase, budgetHypothesis, budgetScenario, organization, user } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { addHypothesis, BudgetError, createScenario, deleteHypothesis, deleteScenario, duplicateScenario, freezeScenario, getScenario } from "@/lib/budget/store";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";

// Module 5 : garde-fous du stockage (base PostgreSQL de test, rôle non superutilisateur).
const W = `test-ws-budget-${Date.now()}`;
const actor = null as unknown as string;
const base: BaseSnapshot = {
  currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05", refMasse: 420000, refBaseCost: 420000, etpNote: null,
  contracts: [{ contractKey: "A", externalId: "A", label: "A", service: "TECH", serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, base: { salaryCents: 300000, refBrutCents: 300000, refCotisationsCents: 120000 }, baseNd: null }],
  actuals: [],
};
const conv = { prorata: "calendaire" as const };
const uuid = () => crypto.randomUUID();
const aug = (id: string, label: string, from = "2026-11"): Hypothesis => ({ id, kind: "augmentation", label, from, rateBps: 200, scope: { kind: "global" } });

beforeAll(async () => {
  await db.insert(organization).values({ id: W, name: "Budget", slug: W, createdAt: new Date() });
});
afterAll(async () => {
  // Suppression de l'espace avec des scénarios figés : les cascades ne sont pas bloquées.
  await db.delete(organization).where(sql`id = ${W}`);
  expect((await db.execute(sql`select count(*)::int n from organization where id = ${W}`)).rows[0]).toEqual({ n: 0 });
  await pool.end();
});

describe("scénarios : gel, duplication, base figée", () => {
  it("ajout contrôlé par le moteur, gel définitif, refus en base d'une hypothèse sur un scénario figé", async () => {
    const id = await createScenario(W, actor, { name: "S", kind: "budget", firstMonth: "2026-10", lastMonth: "2026-12" }, base, conv);
    const g = aug(uuid(), "Générale");
    await addHypothesis(W, actor, id, g);
    await expect(addHypothesis(W, actor, id, aug(uuid(), "Doublon"))).rejects.toThrow(BudgetError);
    await freezeScenario(W, actor, id);
    await expect(addHypothesis(W, actor, id, aug(uuid(), "Après gel", "2026-12"))).rejects.toThrow("Scénario figé");
    await expect(deleteHypothesis(W, id, g.id)).rejects.toThrow("Scénario figé");
    await expect(deleteScenario(W, id)).rejects.toThrow("Scénario figé");
    // Contournement direct : le déclencheur refuse aussi.
    const h = aug(uuid(), "Direct", "2026-12");
    await expect(withWorkspace(W, (tx) => tx.insert(budgetHypothesis).values({ id: h.id, workspaceId: W, scenarioId: id, kind: h.kind, data: h, currency: "EUR" }))).rejects.toThrow();
    // La copie est un brouillon indépendant avec les mêmes hypothèses.
    const copy = (await duplicateScenario(W, actor, id, "Copie"))!;
    const c = await getScenario(W, copy);
    expect(c?.scenario.status).toBe("brouillon");
    expect(c?.hypotheses.map((x) => x.label)).toEqual(["Générale"]);
    expect(c?.hypotheses[0].id).not.toBe(g.id);
  });
  it("base figée : modification refusée par la base, empreinte revérifiée ; suppression d'un brouillon avec sa base orpheline", async () => {
    const id = await createScenario(W, actor, { name: "T", kind: "simulation", firstMonth: "2026-10", lastMonth: "2026-12" }, base, conv);
    const full = (await getScenario(W, id))!;
    await expect(withWorkspace(W, (tx) => tx.update(budgetBase).set({ refMonth: "2026-08" }).where(sql`id = ${full.scenario.baseId}`))).rejects.toThrow();
    await deleteScenario(W, id);
    const left = await withWorkspace(W, (tx) => tx.select({ id: budgetBase.id }).from(budgetBase).where(sql`id = ${full.scenario.baseId}`));
    expect(left).toHaveLength(0);
    await expect(deleteHypothesis(W, id, uuid())).rejects.toThrow("Scénario introuvable");
  });
  it("base corrigée à 0 € (contrat non payé) acceptée ; suppressions concurrentes de l'original et de sa copie : base supprimée", async () => {
    const nd: BaseSnapshot = { ...base, refBaseCost: null, contracts: [{ ...base.contracts[0], base: null, baseNd: "entré le 2026-09-16 : mois de référence incomplet" }] };
    const id = await createScenario(W, actor, { name: "Z", kind: "budget", firstMonth: "2026-10", lastMonth: "2026-10" }, nd, conv);
    await addHypothesis(W, actor, id, { id: uuid(), kind: "base", label: "Congé sans solde", contractKey: "A", salaryCents: 0, chargesBps: 0 });
    const copy = (await duplicateScenario(W, actor, id, "Z2"))!;
    const baseId = (await getScenario(W, id))!.scenario.baseId;
    await Promise.all([deleteScenario(W, id), deleteScenario(W, copy)]);
    expect(await withWorkspace(W, (tx) => tx.select({ id: budgetBase.id }).from(budgetBase).where(sql`id = ${baseId}`))).toHaveLength(0);
  });
  it("scénario figé : suppression directe refusée par la RLS ; auteur supprimable (colonnes d'auteur mises à NULL)", async () => {
    const U = `test-user-budget-${Date.now()}`;
    await db.insert(user).values({ id: U, name: "Auteur", email: `${U}@test.invalid` });
    const id = await createScenario(W, U, { name: "F", kind: "budget", firstMonth: "2026-10", lastMonth: "2026-12" }, base, conv);
    await addHypothesis(W, U, id, aug(uuid(), "Générale"));
    await freezeScenario(W, U, id);
    expect(await withWorkspace(W, (tx) => tx.delete(budgetHypothesis).where(sql`scenario_id = ${id}`).returning({ id: budgetHypothesis.id }))).toHaveLength(0);
    expect(await withWorkspace(W, (tx) => tx.delete(budgetScenario).where(sql`id = ${id}`).returning({ id: budgetScenario.id }))).toHaveLength(0);
    await db.delete(user).where(sql`id = ${U}`);
    const after = (await getScenario(W, id))!;
    expect(after.scenario).toMatchObject({ status: "fige", createdBy: null, frozenBy: null });
    expect(after.hypotheses).toHaveLength(1);
  });
  it("gel refusé tant qu'un mois projeté est n.d. (base à compléter)", async () => {
    const nd: BaseSnapshot = { ...base, refBaseCost: null, contracts: [{ ...base.contracts[0], base: null, baseNd: "entré le 2026-09-16 : mois de référence incomplet" }] };
    const id = await createScenario(W, actor, { name: "U", kind: "budget", firstMonth: "2026-10", lastMonth: "2026-10" }, nd, conv);
    await expect(freezeScenario(W, actor, id)).rejects.toThrow("projection n.d. pour 2026-10");
  });
});
