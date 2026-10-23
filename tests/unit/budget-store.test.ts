import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { budgetBase, budgetHypothesis, budgetScenario, organization, user } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { addHypotheses, addHypothesis, applyChanges, BudgetError, createScenario, deleteBudget, deleteHypothesis, deleteScenario, duplicateScenario, freezeScenario, getBudget, getScenario, importHypotheses, listBudgets, saveBudget } from "@/lib/budget/store";
import { project } from "@/lib/budget/engine";
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
    // Réattribution de l'auteur d'un scénario figé, de sa base ou de ses hypothèses : refusée par la base.
    const U2 = `${U}-2`;
    await db.insert(user).values({ id: U2, name: "Autre", email: `${U2}@test.invalid` });
    const baseId = (await getScenario(W, id))!.scenario.baseId;
    await expect(withWorkspace(W, (tx) => tx.update(budgetScenario).set({ frozenBy: U2 }).where(sql`id = ${id}`))).rejects.toThrow();
    await expect(withWorkspace(W, (tx) => tx.update(budgetHypothesis).set({ createdBy: U2 }).where(sql`scenario_id = ${id}`))).rejects.toThrow();
    await expect(withWorkspace(W, (tx) => tx.update(budgetBase).set({ createdBy: U2 }).where(sql`id = ${baseId}`))).rejects.toThrow();
    await db.delete(user).where(sql`id = ${U2}`);
    await db.delete(user).where(sql`id = ${U}`);
    const after = (await getScenario(W, id))!;
    expect(after.scenario).toMatchObject({ status: "fige", createdBy: null, frozenBy: null });
    expect(after.hypotheses).toHaveLength(1);
  });
  it("budget saisi : mois vide conservé n.d. (null), modification, refus d'un mois hors de l'année, suppression", async () => {
    const id = await saveBudget(W, actor, { name: "Budget 2026", year: "2026", amounts: { "2026-01": 1000000, "2026-02": null } });
    expect((await getBudget(W, id))?.amounts).toEqual({ "2026-01": 1000000, "2026-02": null });
    await saveBudget(W, actor, { id, name: "Budget 2026 v2", year: "2026", amounts: { "2026-01": 1000000, "2026-02": 0 } });
    expect(await getBudget(W, id)).toMatchObject({ name: "Budget 2026 v2", amounts: { "2026-02": 0 }, currency: "EUR" });
    await expect(saveBudget(W, actor, { name: "X", year: "2026", amounts: { "2027-01": 1 } })).rejects.toThrow("hors de l'année");
    await expect(saveBudget(W, actor, { name: "X", year: "2026", amounts: { "2026-01": -1 } })).rejects.toThrow();
    expect((await listBudgets(W)).map((b) => b.name)).toContain("Budget 2026 v2");
    await deleteBudget(W, id);
    await expect(deleteBudget(W, id)).rejects.toThrow("Budget introuvable");
  });
  it("gel refusé tant qu'un mois projeté est n.d. (base à compléter)", async () => {
    const nd: BaseSnapshot = { ...base, refBaseCost: null, contracts: [{ ...base.contracts[0], base: null, baseNd: "entré le 2026-09-16 : mois de référence incomplet" }] };
    const id = await createScenario(W, actor, { name: "U", kind: "budget", firstMonth: "2026-10", lastMonth: "2026-10" }, nd, conv);
    await expect(freezeScenario(W, actor, id)).rejects.toThrow("projection n.d. pour 2026-10");
  });
});

describe("lot 4 : saisie groupée et reprise d'hypothèses", () => {
  const horizon = { firstMonth: "2026-10", lastMonth: "2026-12" };
  const depart = (): Hypothesis => ({ id: uuid(), kind: "depart", label: "Départ A", contractKey: "A", lastPaidDate: "2026-11-15", exitCost: null, motif: "Rupture conventionnelle" });
  const hireOf = (replaces: string | null): Hypothesis => ({ id: uuid(), kind: "embauche", label: "Remplaçant A", service: "TECH", start: "2026-11-16", end: null, grossFullTimeCents: 300000, quotaBps: 10000, chargesBps: 4000, counted: true, category: "cdi", replaces });
  const hypsOf = async (id: string) => (await getScenario(W, id))!.hypotheses;

  it("tout ou rien : un doublon (deux augmentations générales le même mois) annule le lot entier et le message le nomme", async () => {
    const id = await createScenario(W, actor, { name: "Lot 4 atomique", kind: "budget", ...horizon }, base, conv);
    await expect(addHypotheses(W, actor, id, [aug(uuid(), "Première", "2026-11"), aug(uuid(), "Doublon", "2026-11")], "all")).rejects.toThrow(/Rien n'a été enregistré\. Doublon : /);
    expect(await hypsOf(id)).toHaveLength(0);
    const ok = await addHypotheses(W, actor, id, [aug(uuid(), "Novembre", "2026-11"), aug(uuid(), "Décembre", "2026-12")], "all");
    expect(ok.added.map((h) => h.label)).toEqual(["Novembre", "Décembre"]);
    expect((await hypsOf(id)).map((h) => h.label).sort()).toEqual(["Décembre", "Novembre"]);
  });
  it("mode « valid » : la ligne acceptée est enregistrée, la refusée est rendue avec sa raison", async () => {
    const id = await createScenario(W, actor, { name: "Lot 4 partiel", kind: "budget", ...horizon }, base, conv);
    const r = await addHypotheses(W, actor, id, [aug(uuid(), "Générale", "2026-11"), aug(uuid(), "Doublon", "2026-11")], "valid");
    expect(r.added.map((h) => h.label)).toEqual(["Générale"]);
    expect(r.skipped.map((x) => x.label)).toEqual(["Doublon"]);
    expect(r.skipped[0].reason.length).toBeGreaterThan(0);
    expect(await hypsOf(id)).toHaveLength(1);
  });
  it("reprise dans un scénario de même base : départ, embauche qui le remplace et augmentation reprises avec de nouveaux identifiants et le lien remplacé", async () => {
    const src = await createScenario(W, actor, { name: "Source", kind: "revise", ...horizon }, base, conv);
    const d = depart();
    await addHypotheses(W, actor, src, [d, hireOf(d.id), aug(uuid(), "Générale", "2026-12")], "all");
    const dst = await createScenario(W, actor, { name: "Cible", kind: "budget", ...horizon }, base, conv);
    const r = await importHypotheses(W, actor, dst, src, new Set(["depart", "embauche", "augmentation"]));
    expect(r.added).toHaveLength(3);
    expect(r.skipped).toEqual([]);
    const got = await hypsOf(dst);
    const newDep = got.find((h) => h.kind === "depart")!;
    const newHire = got.find((h) => h.kind === "embauche");
    expect(newDep.id).not.toBe(d.id);
    expect(newHire?.kind === "embauche" && newHire.replaces).toBe(newDep.id);
    expect(newDep).toMatchObject({ motif: "Rupture conventionnelle", lastPaidDate: "2026-11-15" });
  });
  it("reprise dans un scénario dont la base n'a pas le contrat : départ non repris (raison donnée), embauche reprise sans lien « remplace » (note), augmentation reprise", async () => {
    const src = await createScenario(W, actor, { name: "Source 2", kind: "revise", ...horizon }, base, conv);
    const d = depart();
    await addHypotheses(W, actor, src, [d, hireOf(d.id), aug(uuid(), "Générale", "2026-12")], "all");
    const other: BaseSnapshot = { ...base, contracts: [{ ...base.contracts[0], contractKey: "B", externalId: "B", label: "B" }] };
    const dst = await createScenario(W, actor, { name: "Cible 2", kind: "budget", ...horizon }, other, conv);
    const r = await importHypotheses(W, actor, dst, src, new Set(["depart", "embauche", "augmentation"]));
    expect(r.added.map((h) => h.label).sort()).toEqual(["Générale", "Remplaçant A"]);
    expect(r.skipped.map((x) => x.label)).toEqual(["Départ A"]);
    expect(r.notes).toEqual(["« Remplaçant A » : lien « remplace » retiré, le départ visé n'est pas repris."]);
    const hire = (await hypsOf(dst)).find((h) => h.kind === "embauche");
    expect(hire?.kind === "embauche" && hire.replaces).toBeNull();
  });
  it("reprise refusée : même scénario, source inconnue, aucun type choisi, cible figée", async () => {
    const a = await createScenario(W, actor, { name: "A4", kind: "budget", ...horizon }, base, conv);
    const b = await createScenario(W, actor, { name: "B4", kind: "budget", ...horizon }, base, conv);
    await expect(importHypotheses(W, actor, a, a, new Set(["depart"]))).rejects.toThrow("Choisissez un autre scénario");
    await expect(importHypotheses(W, actor, a, uuid(), new Set(["depart"]))).rejects.toThrow("Scénario source introuvable");
    await expect(importHypotheses(W, actor, a, b, new Set())).rejects.toThrow("au moins un type");
    await freezeScenario(W, actor, a);
    await expect(importHypotheses(W, actor, a, b, new Set(["depart"]))).rejects.toThrow("Scénario figé");
    await expect(addHypotheses(W, actor, a, [aug(uuid(), "Après gel")], "all")).rejects.toThrow("Scénario figé");
  });
});

describe("lot 5 : grilles et duplication avec liens vers des embauches", () => {
  const horizon = { firstMonth: "2026-10", lastMonth: "2026-12" };
  const env = (label: string, target: string, monthly: Record<string, number>): Hypothesis => ({ id: uuid(), kind: "enveloppe", label, axis: "service", target, monthly, chargesBps: null });
  it("applyChanges : remplacement, ajout et suppression en une transaction ; un scénario final incalculable annule tout", async () => {
    const id = await createScenario(W, actor, { name: "Grille", kind: "budget", ...horizon }, base, conv);
    const a = aug(uuid(), "Taux novembre", "2026-11");
    const e1 = env("Enveloppe TECH", "TECH", { "2026-11": 100000 });
    await applyChanges(W, actor, id, { put: [a, e1], remove: [] });
    expect((await getScenario(W, id))!.hypotheses.map((h) => h.label).sort()).toEqual(["Enveloppe TECH", "Taux novembre"]);
    // remplace l'enveloppe (même identifiant, autres mois) et retire l'augmentation
    const e1b = { ...e1, monthly: { "2026-12": 55555 } } as Hypothesis;
    const r = await applyChanges(W, actor, id, { put: [e1b], remove: [a.id] });
    expect(r).toEqual({ put: 1, removed: 1 });
    const after = await hypsOf2(id);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: e1.id, kind: "enveloppe", monthly: { "2026-12": 55555 } });
    // incalculable (même cible deux fois) : rien ne change, l'enveloppe existante est conservée
    await expect(applyChanges(W, actor, id, { put: [env("Doublon", "TECH", { "2026-11": 1 })], remove: [] })).rejects.toThrow(/déjà l'enveloppe du centre de coûts TECH/);
    expect(await hypsOf2(id)).toHaveLength(1);
    // suppression d'une hypothèse inexistante : refusée
    await expect(applyChanges(W, actor, id, { put: [], remove: [uuid()] })).rejects.toThrow("n'existe plus");
    await freezeScenario(W, actor, id);
    await expect(applyChanges(W, actor, id, { put: [aug(uuid(), "Après gel", "2026-12")], remove: [] })).rejects.toThrow("Scénario figé");
  });
  it("augmentation par statut : enregistrée avec son périmètre, conservée à la duplication ; un statut absent de la base figée n'est jamais deviné", async () => {
    const st: BaseSnapshot = { ...base, contracts: base.contracts.map((c) => ({ ...c, executive: true })) };
    const id = await createScenario(W, actor, { name: "Statut", kind: "budget", ...horizon }, st, conv);
    const dir: Hypothesis = { id: uuid(), kind: "augmentation", label: "Cadres dirigeants 4 %", from: "2026-11", rateBps: 400, scope: { kind: "statut", executive: true } };
    await addHypothesis(W, actor, id, dir);
    const s = (await getScenario(W, id))!;
    expect(s.base.contracts[0].executive).toBe(true);
    expect(s.hypotheses[0]).toMatchObject({ kind: "augmentation", scope: { kind: "statut", executive: true } });
    // A cadre dirigeant : 3 000 × 4 % = 120,00 € brut, 1 200 × 4 % = 48,00 € de charges → 4 200 + 168 = 4 368,00 €
    const p = project(s.base, "2026-10", "2026-11", s.hypotheses, s.scenario.conventions);
    expect(p.kind === "value" && p.months[1]).toMatchObject({ kind: "value", cost: 436800 });
    const copy = (await getScenario(W, (await duplicateScenario(W, actor, id, "Copie statut"))!))!;
    expect(copy.hypotheses[0]).toMatchObject({ kind: "augmentation", scope: { kind: "statut", executive: true } });
    expect(copy.base.contracts[0].executive).toBe(true);
    // Base figée sans statut (scénario antérieur) : l'augmentation par statut ne touche personne, aucun coût inventé.
    const old = await createScenario(W, actor, { name: "Ancienne base", kind: "budget", ...horizon }, base, conv);
    await addHypothesis(W, actor, old, { ...dir, id: uuid() });
    const o = (await getScenario(W, old))!;
    const po = project(o.base, "2026-10", "2026-11", o.hypotheses, o.scenario.conventions);
    expect(po.kind === "value" && po.months[1]).toMatchObject({ kind: "value", cost: 420000 });
  });
  it("duplication : une prime, une catégorie, un changement et une augmentation visant une embauche suivent la copie de l'embauche (la projection de la copie reste calculable)", async () => {
    const id = await createScenario(W, actor, { name: "Source liens", kind: "budget", ...horizon }, base, conv);
    const hire: Hypothesis = { id: uuid(), kind: "embauche", label: "Dév", service: "TECH", start: "2026-11-01", end: null, grossFullTimeCents: 400000, quotaBps: 5000, chargesBps: 2000, counted: true, category: "cdi", replaces: null };
    const key = `embauche:${hire.id}`;
    const dep: Hypothesis = { id: uuid(), kind: "depart", label: "Départ A", contractKey: "A", lastPaidDate: "2026-12-15", exitCost: null };
    const linked: Hypothesis[] = [
      { id: uuid(), kind: "augmentation", label: "Aug embauche", from: "2026-12", rateBps: 300, scope: { kind: "contrat", key } },
      { id: uuid(), kind: "ponctuel", label: "Prime embauche", month: "2026-12", amount: { mode: "charge", costCents: 50000 }, service: null, contractKey: key },
      { id: uuid(), kind: "categorie", label: "Catégorie embauche", contractKey: key, category: "cdd" },
      { id: uuid(), kind: "changement", label: "Quotité embauche", contractKey: key, from: "2026-12", quotaBps: 10000 },
    ];
    await addHypotheses(W, actor, id, [dep, { ...hire, replaces: dep.id } as Hypothesis, ...linked], "all");
    const copy = (await duplicateScenario(W, actor, id, "Copie liens"))!;
    const c = (await getScenario(W, copy))!;
    expect(c.hypotheses).toHaveLength(6);
    const newHire = c.hypotheses.find((h) => h.kind === "embauche")!;
    expect(newHire.id).not.toBe(hire.id);
    const newKey = `embauche:${newHire.id}`;
    for (const label of ["Prime embauche", "Catégorie embauche", "Quotité embauche"]) {
      const h = c.hypotheses.find((x) => x.label === label)!;
      expect(h.kind === "ponctuel" || h.kind === "categorie" || h.kind === "changement" ? h.contractKey : null).toBe(newKey);
    }
    const a2 = c.hypotheses.find((x) => x.label === "Aug embauche")!;
    expect(a2.kind === "augmentation" && a2.scope).toEqual({ kind: "contrat", key: newKey });
    expect(project(c.base, c.scenario.firstMonth, c.scenario.lastMonth, c.hypotheses, c.scenario.conventions).kind).toBe("value");
  });
});
const hypsOf2 = async (id: string) => (await getScenario(W, id))!.hypotheses;
