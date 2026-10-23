import { describe, expect, it } from "vitest";
import { landing, presence, project, roundDiv } from "@/lib/budget/engine";
import { DEFAULT_CATEGORY_NATURES } from "@/lib/budget/categories";
import type { BaseContract, BaseSnapshot, Hypothesis, ProjectedMonth } from "@/lib/budget/types";

// Module 5 — moteur de projection : cas écrits à la main (montants en centimes).
const contract = (key: string, over: Partial<BaseContract>): BaseContract => ({
  contractKey: key, externalId: key, label: key, service: null, serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, base: null, baseNd: null, ...over,
});
// A : salaire 3 000,00 €, brut total 3 300,00 €, cotisations 1 320,00 € → taux 40 %.
// B : salaire 2 000,00 €, cotisations 900,00 € sur 2 000,00 € → 45 % ; mi-temps.
// C : entrée le 16 septembre → base n.d.
const base: BaseSnapshot = {
  currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05",
  contracts: [
    contract("A", { service: "TECH", base: { salaryCents: 300000, refBrutCents: 330000, refCotisationsCents: 132000 } }),
    contract("B", { service: "SALES", etp4: 5000, base: { salaryCents: 200000, refBrutCents: 200000, refCotisationsCents: 90000 } }),
    contract("C", { service: "TECH", startDate: "2026-09-16", baseNd: "entré le 2026-09-16 : mois de référence incomplet" }),
  ],
  actuals: Array.from({ length: 9 }, (_, i) => ({ month: `2026-0${i + 1}`, kind: "value" as const, brut: 500000, cotisations: 200000, masse: 700000, headcount: 3, etp4: 25000, etpNd: null })),
  refMasse: 700000, refBaseCost: null, etpNote: null,
};
const fixC: Hypothesis = { id: "fixC", kind: "base", label: "Base de C", contractKey: "C", salaryCents: 250000, chargesBps: 4200 };
const conv = { prorata: "calendaire" as const };
const month = (p: ReturnType<typeof project>, m: string) => {
  if (p.kind !== "value") throw new Error(p.errors.join(" ; "));
  return p.months.find((x) => x.month === m)! as Extract<ProjectedMonth, { kind: "value" }>;
};
const by = (pm: Extract<ProjectedMonth, { kind: "value" }>, id: string | null, key?: string) => pm.contributions.filter((c) => c.hypothesisId === id && (!key || c.contractKey === key));

describe("arrondi et prorata", () => {
  it("demi-centime à l'écart de zéro", () => {
    expect([roundDiv(5n, 2n), roundDiv(-5n, 2n), roundDiv(4n, 3n), roundDiv(-4n, 3n), roundDiv(7n, -2n)]).toEqual([3, -3, 1, -1, -4]);
  });
  it("jours calendaires : arrivée le 16 d'un mois de 30 jours = 15/30 ; février bissextile depuis le 15 = 15/29 ; « aucun » = mois entier", () => {
    expect(presence("2026-11", "2026-11-16", null, "calendaire")).toEqual({ n: 15n, d: 30n });
    expect(presence("2028-02", "2028-02-15", null, "calendaire")).toEqual({ n: 15n, d: 29n });
    expect(presence("2027-02", "2027-01-01", "2027-02-10", "calendaire")).toEqual({ n: 10n, d: 28n });
    expect(presence("2026-11", "2026-11-16", null, "aucun")).toEqual({ n: 1n, d: 1n });
    expect(presence("2026-12", "2026-10-01", "2026-11-30", "calendaire")).toEqual({ n: 0n, d: 1n });
  });
});

describe("projection", () => {
  it("base n.d. d'un contrat présent : mois n.d. avec la raison, jamais 0", () => {
    const p = project(base, "2026-10", "2026-12", [], conv);
    expect(p.kind === "value" && p.months[0]).toMatchObject({ kind: "nd", reasons: [expect.stringContaining("C : base n.d. (entré le 2026-09-16")] });
  });
  it("octobre : A 3 000 + 1 200 ; B 2 000 + 900 ; C corrigé 2 500 + 1 050 → 10 650,00 € ; 3 présents, 2,5 ETP", () => {
    const o = month(project(base, "2026-10", "2026-12", [fixC], conv), "2026-10");
    expect(o).toMatchObject({ brut: 750000, charges: 315000, cost: 1065000, headcount: 3, etp4: 25000 });
    expect(by(o, "fixC")[0]).toMatchObject({ kind: "base", brut: 250000, charges: 105000 });
  });
  it("augmentations : TECH 3 % (prime sur le global 2 % le même mois) puis 1 % global composé en décembre", () => {
    const hyps: Hypothesis[] = [
      fixC,
      { id: "g2", kind: "augmentation", label: "Générale 2 %", from: "2026-11", rateBps: 200, scope: { kind: "global" } },
      { id: "t3", kind: "augmentation", label: "TECH 3 %", from: "2026-11", rateBps: 300, scope: { kind: "service", service: "TECH" } },
      { id: "g1", kind: "augmentation", label: "Générale 1 %", from: "2026-12", rateBps: 100, scope: { kind: "global" } },
    ];
    const p = project(base, "2026-10", "2026-12", hyps, conv);
    const n = month(p, "2026-11");
    // A : 3 090,00 € + 1 236,00 € ; B : 2 040,00 € + 918,00 € ; C : 2 575,00 € + 1 081,50 €.
    expect(by(n, "t3", "A")[0]).toMatchObject({ brut: 9000, charges: 3600 });
    expect(by(n, "g2", "A")).toHaveLength(0);
    expect(by(n, "g2", "B")[0]).toMatchObject({ brut: 4000, charges: 1800 });
    expect(by(n, "t3", "C")[0]).toMatchObject({ brut: 7500, charges: 3150 });
    expect(n.cost).toBe(309000 + 123600 + 204000 + 91800 + 257500 + 108150);
    const d = month(p, "2026-12");
    // Décembre : A 3 120,90 € + 1 248,36 € ; B 2 060,40 € + 927,18 € ; C 2 600,75 € + 1 092,315 → 1 092,32 €.
    expect(by(d, "g1", "A")[0]).toMatchObject({ brut: 3090, charges: 1236 });
    expect(by(d, "g1", "C")[0]).toMatchObject({ brut: 2575, charges: 1082 });
    expect(d.cost).toBe(312090 + 124836 + 206040 + 92718 + 260075 + 109232);
    for (const m of [n, d]) expect(m.contributions.reduce((s, c) => s + c.cost, 0)).toBe(m.cost);
  });
  it("départ de B le 15 novembre (coûts de sortie 1 000 € brut à 20 %) remplacé par une embauche à 80 % le 16", () => {
    const hyps: Hypothesis[] = [
      fixC,
      { id: "dB", kind: "depart", label: "Départ B", contractKey: "B", lastPaidDate: "2026-11-15", exitCost: { mode: "brut", brutCents: 100000, chargesBps: 2000 } },
      { id: "h", kind: "embauche", label: "Remplaçant B", service: "SALES", start: "2026-11-16", end: null, grossFullTimeCents: 360000, quotaBps: 8000, chargesBps: 4500, counted: true, replaces: "dB" },
    ];
    const p = project(base, "2026-10", "2026-12", hyps, conv);
    const n = month(p, "2026-11");
    // B : base 2 000 + 900, départ −1 000 − 450 (15/30) ; sortie 1 000 + 200 ; embauche 3 600 × 80 % × 15/30 = 1 440 + 648.
    expect(by(n, "dB", "B").map((c) => [c.kind, c.brut, c.charges])).toEqual([["depart", -100000, -45000], ["sortie", 100000, 20000]]);
    expect(by(n, "h")[0]).toMatchObject({ kind: "embauche", brut: 144000, charges: 64800 });
    expect(n).toMatchObject({ cost: 1065000 - 145000 + 120000 + 208800, headcount: 3, etp4: 28000 });
    const d = month(p, "2026-12");
    expect(by(d, null, "B")).toHaveLength(0);
    expect(by(d, "h")[0]).toMatchObject({ brut: 288000, charges: 129600 });
    expect(d.cost).toBe(420000 + 355000 + 417600);
  });
  it("fin de contrat connue (CDD) : présence jusqu'au dernier jour payé, sans hypothèse", () => {
    const b2 = { ...base, contracts: base.contracts.map((c) => (c.contractKey === "A" ? { ...c, endDate: "2026-10-10" } : c)) };
    const o = month(project(b2, "2026-10", "2026-11", [fixC], conv), "2026-10");
    // A : 3 000 × 10/31 = 967,74 € ; charges 1 200 × 10/31 = 387,10 €.
    expect(o.contributions.find((c) => c.kind === "fin-contrat")).toMatchObject({ hypothesisId: null, brut: 96774 - 300000, charges: 38710 - 120000 });
    expect(o.headcount).toBe(2);
  });
  it("élément ponctuel en coût chargé : coût compté, brut et charges n.d. (non ventilés)", () => {
    const o = month(project(base, "2026-10", "2026-10", [fixC, { id: "p", kind: "ponctuel", label: "Primes objectifs", month: "2026-10", amount: { mode: "charge", costCents: 50000 }, service: null }], conv), "2026-10");
    expect(o).toMatchObject({ brut: null, charges: null, cost: 1115000 });
  });
  it("refus : augmentations de même niveau le même mois, mois d'effet avant la bascule, contrat inconnu", () => {
    const g = (id: string, from: string): Hypothesis => ({ id, kind: "augmentation", label: id, from, rateBps: 100, scope: { kind: "global" } });
    expect(project(base, "2026-10", "2026-12", [fixC, g("x", "2026-11"), g("y", "2026-11")], conv)).toMatchObject({ kind: "error", errors: [expect.stringContaining("en conflit en 2026-11")] });
    expect(project(base, "2026-10", "2026-12", [g("x", "2026-09")], conv)).toMatchObject({ kind: "error" });
    expect(project(base, "2026-10", "2026-12", [{ id: "d", kind: "depart", label: "d", contractKey: "Z", lastPaidDate: "2026-11-01", exitCost: null }], conv)).toMatchObject({ kind: "error" });
  });
  it("refus : départ après la fin de contrat connue ou avant l'entrée ; augmentation ciblant une hypothèse qui n'est pas une embauche", () => {
    const cdd = { ...base, contracts: base.contracts.map((c) => (c.contractKey === "A" ? { ...c, endDate: "2026-11-30" } : c)) };
    const dep = (d: string): Hypothesis => ({ id: "dA", kind: "depart", label: "Départ A", contractKey: "A", lastPaidDate: d, exitCost: null });
    expect(project(cdd, "2026-10", "2027-03", [fixC, dep("2027-03-31")], conv)).toMatchObject({ kind: "error", errors: [expect.stringContaining("fin de contrat connue le 2026-11-30")] });
    expect(project(cdd, "2026-10", "2027-03", [fixC, dep("2026-11-15")], conv).kind).toBe("value");
    const late = { ...base, contracts: base.contracts.map((c) => (c.contractKey === "A" ? { ...c, startDate: "2026-11-10" } : c)) };
    expect(project(late, "2026-10", "2026-12", [fixC, dep("2026-11-05")], conv)).toMatchObject({ kind: "error", errors: [expect.stringContaining("antérieur à l'entrée")] });
    const p: Hypothesis = { id: "p1", kind: "ponctuel", label: "Prime", month: "2026-10", amount: { mode: "charge", costCents: 100 }, service: null };
    const aug: Hypothesis = { id: "x", kind: "augmentation", label: "Cible fausse", from: "2026-10", rateBps: 1000, scope: { kind: "contrat", key: "embauche:p1" } };
    expect(project(base, "2026-10", "2026-12", [fixC, p, aug], conv)).toMatchObject({ kind: "error", errors: [expect.stringContaining("contrat ou embauche ciblé inconnu")] });
  });
  it("contrat entré après le mois de référence (base saisie) : présent à partir de son entrée, ligne « Entrée » ; compté fin de mois", () => {
    const late = { ...base, contracts: [...base.contracts, contract("D", { startDate: "2026-11-11", etp4: 10000, baseNd: "entré le 2026-11-11, après le mois de référence : base à saisir" })] };
    const fixD: Hypothesis = { id: "fixD", kind: "base", label: "Base de D", contractKey: "D", salaryCents: 300000, chargesBps: 4000 };
    const p = project(late, "2026-10", "2026-12", [fixC, fixD], conv);
    expect(month(p, "2026-10").contributions.filter((c) => c.contractKey === "D")).toHaveLength(0);
    // Novembre : 20 jours sur 30 → 2 000 € + 800 € ; ligne base 4 200 € et entrée −1 400 €.
    const n = month(p, "2026-11");
    expect(n.contributions.filter((c) => c.contractKey === "D").map((c) => [c.kind, c.cost])).toEqual([["base", 420000], ["entree", -140000]]);
    expect(n).toMatchObject({ cost: 1065000 + 280000, headcount: 4, etp4: 35000 });
  });
  it("entrée et départ le même mois : deux lignes successives (Entrée −1 400 €, Départ −1 400 €) ; pas d'augmentation générale pour un contrat entré après la base", () => {
    const late = { ...base, contracts: [...base.contracts, contract("D", { startDate: "2026-11-11", baseNd: "entré après" })] };
    const fixD: Hypothesis = { id: "fixD", kind: "base", label: "Base de D", contractKey: "D", salaryCents: 300000, chargesBps: 4000 };
    const depD: Hypothesis = { id: "dD", kind: "depart", label: "Départ D", contractKey: "D", lastPaidDate: "2026-11-20", exitCost: null };
    const g: Hypothesis = { id: "g", kind: "augmentation", label: "Générale", from: "2026-11", rateBps: 1000, scope: { kind: "global" } };
    const n = month(project(late, "2026-10", "2026-12", [fixC, fixD, depD, g], conv), "2026-11");
    expect(n.contributions.filter((c) => c.contractKey === "D").map((c) => [c.kind, c.cost])).toEqual([["base", 420000], ["entree", -140000], ["depart", -140000]]);
  });
  it("atterrissage 2026 = réel janvier–septembre (9 × 7 000 €) + octobre–décembre projetés", () => {
    const p = project(base, "2026-10", "2026-12", [fixC], conv);
    expect(landing(base, p, "2026")).toMatchObject({ kind: "value", actual: 6300000, projected: 3 * 1065000, total: 6300000 + 3195000 });
    expect(landing(base, project(base, "2026-10", "2026-11", [fixC], conv), "2026")).toMatchObject({ kind: "nd", reason: expect.stringContaining("2026-12 : hors de l'horizon") });
  });
});

describe("base figée sur le journal PayFit fictif (profil A, référence septembre 2026)", async () => {
  const { buildBase } = await import("@/lib/budget/base");
  const { createPayFitClient, readPayFit } = await import("@/lib/connectors/payfit/client");
  const { createFixtureFetch } = await import("@/lib/connectors/payfit/fixture");
  const { payfitFixtureBuild, PAYFIT_MONTHS } = await import("./helpers/rh");
  const { kpiInput, DSN_ABSENCES } = await import("./helpers/kpi");
  const { DEFAULT_PREFIXES } = await import("@/lib/payroll/grid");
  const read = await readPayFit(createPayFitClient("fixture-A-1", { fetchImpl: createFixtureFetch("fixture-A-1"), minIntervalMs: 0 }), PAYFIT_MONTHS);
  const lines = read.records
    .filter((r) => r.collection === "ledger_lines")
    .map((r) => ({ key: r.key, month: String(r.data.month), accountId: String(r.data.accountId), accountName: (r.data.accountName as string) ?? null, debitCents: r.data.debitCents as number | null, creditCents: r.data.creditCents as number | null, contractId: (r.data.contractId as string) ?? null, analytic: r.data.analyticCodes as never }));
  const input = { lines, months: PAYFIT_MONTHS, openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "Service" };
  const kpi = kpiInput(await payfitFixtureBuild(), DSN_ABSENCES);
  const r = buildBase({ input, kpi, refMonth: "2026-09", lastMonth: "2026-12", syncId: "sync-test", readAt: "2026-10-21", conventions: conv, categoryNatures: DEFAULT_CATEGORY_NATURES });
  const b = r.kind === "value" ? r.base : null;
  it("7 contrats présents fin septembre (003, CDD fini en 2025, exclu) ; base = 90 % du brut (10 % de primes sur objectif exclus), charges au taux observé", () => {
    expect(b?.contracts.map((c) => c.externalId.slice(-3)).sort()).toEqual(["001", "002", "004", "005", "006", "007", "008"]);
    const c = (n: string) => b!.contracts.find((x) => x.externalId.endsWith(n))!;
    // 001 : brut 3 000 €, dont 300 € de primes ; cotisations 1 200 € → base 2 700 € à 40 %.
    expect(c("001")).toMatchObject({ service: "TEST-SVC-B", counted: true, etp4: 10000, base: { salaryCents: 270000, refBrutCents: 300000, refCotisationsCents: 120000 }, baseNd: null });
    expect(c("008")).toMatchObject({ service: "TEST-SVC-C", etp4: 5000, base: { salaryCents: 112500, refBrutCents: 125000, refCotisationsCents: 25000 } });
    // Masse de septembre 24 600 € = 18 730 € de brut + 5 870 € de cotisations ; base : 16 857 € + 5 283 € = 22 140 €.
    expect(b).toMatchObject({ refMonth: "2026-09", refMasse: 2460000, refBaseCost: 2214000 });
    expect(b!.actuals.find((a) => a.month === "2026-09")).toMatchObject({ kind: "value", masse: 2460000, etp4: 61000 });
  });
  it("projection sans hypothèse : octobre = base des 7 contrats, 22 140,00 €, 7 présents, 6,1 ETP", () => {
    const p = project(b!, "2026-10", "2026-12", [], conv);
    expect(month(p, "2026-10")).toMatchObject({ brut: 1685700, charges: 528300, cost: 2214000, headcount: 7, etp4: 61000 });
  });
  it("référence janvier 2026 : 004, entré le 15 février et connu de PayFit, est repris avec une base à saisir ; contrat sur deux services → non ventilé", () => {
    const r1 = buildBase({ input, kpi, refMonth: "2026-01", lastMonth: "2026-03", syncId: "s", readAt: "2026-10-21", conventions: conv, categoryNatures: DEFAULT_CATEGORY_NATURES });
    const b1 = r1.kind === "value" ? r1.base : null;
    expect(b1?.contracts.map((c) => c.externalId.slice(-3)).sort()).toEqual(["001", "002", "004", "005", "006", "007", "008"]);
    expect(b1?.contracts.find((c) => c.externalId.endsWith("004"))).toMatchObject({ base: null, baseNd: "entré le 2026-02-15, après le mois de référence : base à saisir", etp4: 10000 });
    expect(b1?.etpNote).toContain("quotités PayFit à la date de lecture");
    // Horizon arrêté en janvier : 004 (entrée en février) est gardé pour une base dérivée, hors des contrats projetés.
    const r0 = buildBase({ input, kpi, refMonth: "2026-01", lastMonth: "2026-01", syncId: "s", readAt: "2026-10-21", conventions: conv, categoryNatures: DEFAULT_CATEGORY_NATURES });
    expect(r0.kind === "value" && [r0.base.contracts.length, r0.base.upcoming?.map((c) => c.externalId.slice(-3))]).toEqual([6, ["004"]]);
    // Rapprochement de janvier sur les seuls contrats présents fin janvier : pas de prime en janvier, base = masse.
    expect(b1).toMatchObject({ refMasse: 1953000, refBaseCost: 1953000 });
    const extra = { ...lines[0], key: "extra", month: "2026-09", accountId: "641100", debitCents: 0, creditCents: null, contractId: "TEST-A-CONTRACT-001", analytic: [{ type: "Service", code: "TEST-SVC-Z", value: "Z" }] as never };
    const r2 = buildBase({ input: { ...input, lines: [...lines, extra] }, kpi, refMonth: "2026-09", lastMonth: "2026-12", syncId: "s", readAt: "2026-10-21", conventions: conv, categoryNatures: DEFAULT_CATEGORY_NATURES });
    expect(r2.kind === "value" && r2.base.contracts.find((c) => c.externalId.endsWith("001"))).toMatchObject({ service: null, serviceNd: expect.stringContaining("plusieurs services") });
  });
  it("mois de référence hors lecture ou non clos : refus avec la raison", () => {
    expect(buildBase({ input, kpi, refMonth: "2026-10", lastMonth: "2026-12", syncId: "s", readAt: "2026-10-21", conventions: conv, categoryNatures: DEFAULT_CATEGORY_NATURES })).toMatchObject({ kind: "nd", reason: expect.stringContaining("hors de la lecture") });
    expect(buildBase({ input: { ...input, openMonths: ["2026-09"] }, kpi, refMonth: "2026-09", lastMonth: "2026-12", syncId: "s", readAt: "2026-10-21", conventions: conv, categoryNatures: DEFAULT_CATEGORY_NATURES })).toMatchObject({ kind: "nd", reason: expect.stringContaining("non clôturée") });
  });
});

describe("lot 2 : comparaisons, pont volume / coût moyen, base dérivée (cas écrits à la main)", async () => {
  const { budgetSeries, bridge, gap, scenarioSeries, shifted, total } = await import("@/lib/budget/series");
  const { chainBase } = await import("@/lib/budget/chain");
  const one = (key: string, cost: number, etp4: number | null, month = "2026-10") => ({ key, label: key, points: new Map([[month, { month, kind: "value" as const, cost, etp4, etpNd: null, layer: "projete" as const }]]) });
  it("pont : 3 ETP pour 10 000 € contre 2 ETP pour 7 000 € → volume +3 500 €, coût moyen −500 €, somme = +3 000 €", () => {
    expect(bridge(one("a", 1000000, 30000), one("b", 700000, 20000), ["2026-10"])).toEqual({ kind: "value", a: { cost: 1000000, etpMonths4: 30000 }, b: { cost: 700000, etpMonths4: 20000 }, delta: 300000, volume: 350000, averageCost: -50000 });
    // Demi-centime : volume 3 500,005 € arrondi à 3 500,01 € ; le coût moyen porte le reste (−500,02 €).
    expect(bridge(one("a", 1000000, 30000), one("b", 700001, 20000), ["2026-10"])).toMatchObject({ volume: 350001, averageCost: -50002, delta: 299999 });
    expect(bridge(one("a", 1000000, null), one("b", 700000, 20000), ["2026-10"])).toMatchObject({ kind: "nd", reason: expect.stringContaining("ETP n.d.") });
  });
  it("budget saisi : un mois non saisi rend le total n.d. ; écart en € et en % du budget", () => {
    const amounts = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, "0")}`, 1000000])) as Record<string, number | null>;
    const b = budgetSeries("b", "Budget 2026", "2026", amounts);
    expect(total(b, ["2026-01", "2026-02"])).toEqual({ kind: "value", cost: 2000000 });
    expect(total(budgetSeries("b", "B", "2026", { ...amounts, "2026-02": null }), ["2026-01", "2026-02"])).toEqual({ kind: "nd", reason: "montant du budget non saisi (2026-02)" });
    expect(bridge(one("a", 1, 10000, "2026-01"), b, ["2026-01", "2026-02", "2026-03"])).toMatchObject({ kind: "nd" });
    expect(gap(one("s", 1100000, null, "2026-01"), b, ["2026-01"])).toEqual({ kind: "value", a: 1100000, b: 1000000, delta: 100000, pct: { num: 100000, den: 1000000 } });
  });
  it("raisons groupées : mois consécutifs en plage", async () => {
    const { groupReasons } = await import("@/lib/budget/series");
    expect(groupReasons([{ month: "2026-11", reason: "x" }, { month: "2026-12", reason: "x" }, { month: "2027-01", reason: "x" }, { month: "2027-03", reason: "x" }, { month: "2026-05", reason: "y" }])).toBe("x (2026-11 → 2027-01, 2027-03) ; y (2026-05)");
  });
  it("base dérivée : écart coût projeté de décembre − base ventilé par nature ; contrat connu à venir repris avec base à saisir", () => {
    const hyps: Hypothesis[] = [
      fixC,
      { id: "pon", kind: "ponctuel", label: "Primes", month: "2026-12", amount: { mode: "charge", costCents: 500000 }, service: null },
      { id: "h2", kind: "embauche", label: "Recrue", service: "TECH", start: "2026-12-16", end: null, grossFullTimeCents: 300000, quotaBps: 10000, chargesBps: 4000, counted: true, replaces: null },
      { id: "dB", kind: "depart", label: "Départ B", contractKey: "B", lastPaidDate: "2026-12-10", exitCost: { mode: "brut", brutCents: 100000, chargesBps: 2000 } },
    ];
    const b2 = { ...base, upcoming: [contract("U", { startDate: "2027-03-01", baseNd: "à venir" })] };
    const pr = project(b2, "2026-10", "2026-12", hyps, conv);
    const r = chainBase({ id: "P", name: "Révisé", firstMonth: "2026-10", lastMonth: "2026-12", conventions: conv }, b2, hyps, pr, "2026-10-23", "2027-12");
    if (r.kind !== "value") throw new Error(r.reason);
    // Décembre : A 4 200 + B 10/31 (645,16 + 290,32 = 935,48) + C 3 550 + recrue 16/31 (1 548,39 + 619,35) + primes 5 000 + sortie B 1 200
    // = 17 053,22 € ; base dérivée : A 4 200 + C 3 550 + recrue mois complet 4 200 = 11 950 €.
    expect(r.base).toMatchObject({ refMasse: 1705322, refBaseCost: 1195000 });
    expect(r.base.origin?.gap).toEqual([
      { label: "éléments ponctuels de 2026-12", cost: 500000 },
      { label: "coûts de sortie de 2026-12", cost: 120000 },
      { label: "contrats sortis en 2026-12 (non repris)", cost: 93548 },
      { label: "prorata d'entrée en 2026-12 des contrats repris", cost: -203226 },
    ]);
    expect(r.base.contracts.find((c) => c.contractKey === "U")).toMatchObject({ base: null, baseNd: "entré le 2027-03-01, après le mois de référence : base à saisir" });
    const child = project(r.base, "2027-01", "2027-12", [], conv);
    expect(child.kind === "value" && child.months[0]).toMatchObject({ kind: "value", cost: 1195000 });
    expect(child.kind === "value" && child.months[2]).toMatchObject({ kind: "nd" });
    const short = chainBase({ id: "P", name: "Révisé", firstMonth: "2026-10", lastMonth: "2026-12", conventions: conv }, b2, hyps, pr, "2026-10-23", "2027-02");
    expect(short.kind === "value" && short.base.upcoming?.map((c) => c.contractKey)).toEqual(["U"]);
  });
  it("base dérivée : brut du mois complet nul avec charges non nulles → base n.d. à saisir (rien n'est perdu) ; base parent ancienne sans contrats à venir signalée", () => {
    const tiny: Hypothesis = { id: "t", kind: "embauche", label: "Micro", service: null, start: "2026-10-01", end: null, grossFullTimeCents: 1000, quotaBps: 1, chargesBps: 100000, counted: false, replaces: null };
    // Brut = 10 € × 0,01 % = 0,001 € → 0 ; charges = 0,001 € × 1 000 % = 0,01 € → 1 centime.
    const pr = project(base, "2026-10", "2026-12", [fixC, tiny], conv);
    const r = chainBase({ id: "P", name: "P", firstMonth: "2026-10", lastMonth: "2026-12", conventions: conv }, base, [fixC, tiny], pr, "2026-10-23", "2027-12");
    expect(r.kind === "value" && r.base.contracts.find((c) => c.contractKey === "embauche:t")).toMatchObject({ base: null, baseNd: expect.stringContaining("charges non nulles") });
    expect(r.kind === "value" && r.base.origin?.notCarried).toContain("contrats PayFit commençant après l'horizon du parent non connus (base du parent figée avant leur conservation) : vérifiez les entrées à venir");
  });
  it("N-1 : série décalée de 12 mois", () => {
    const s = shifted(one("s", 5, 1, "2025-10"), 12, "n1", "N-1");
    expect(s.points.get("2026-10")).toMatchObject({ month: "2026-10", cost: 5 });
  });
  it("base dérivée fin décembre (simulateur N+1) : A augmenté de 2 %, B parti, C corrigé, embauche reprise en mois complet", () => {
    const hyps: Hypothesis[] = [
      fixC,
      { id: "g2", kind: "augmentation", label: "Générale 2 %", from: "2026-11", rateBps: 200, scope: { kind: "global" } },
      { id: "dB", kind: "depart", label: "Départ B", contractKey: "B", lastPaidDate: "2026-11-15", exitCost: null },
      { id: "h", kind: "embauche", label: "Remplaçant B", service: "SALES", start: "2026-11-16", end: null, grossFullTimeCents: 360000, quotaBps: 8000, chargesBps: 4500, counted: true, replaces: "dB" },
      { id: "dA", kind: "depart", label: "Départ A 2027", contractKey: "A", lastPaidDate: "2027-02-28", exitCost: null },
    ];
    const parent = { id: "P", name: "Révisé", firstMonth: "2026-10", lastMonth: "2026-12", conventions: conv };
    const modern: BaseSnapshot = { ...base, upcoming: [] }; // base récente : contrats à venir conservés (aucun ici)
    const pr = project(base, "2026-10", "2026-12", hyps.slice(0, 4), conv);
    const r = chainBase(parent, modern, hyps.slice(0, 4), pr, "2026-10-23", "2027-12");
    if (r.kind !== "value") throw new Error(r.reason);
    const c = (k: string) => r.base.contracts.find((x) => x.contractKey === k);
    // A : 3 000 € × 1,02 = 3 060 € au taux 40 % ; C : 2 500 € × 1,02 = 2 550 € à 42 % ; embauche : 3 600 € × 80 % = 2 880 € à 45 %.
    // Base dérivée = brut et charges exacts du mois complet de décembre (taux = charges ÷ brut).
    expect(c("A")?.base).toEqual({ salaryCents: 306000, refBrutCents: 306000, refCotisationsCents: 122400 });
    expect(c("B")).toBeUndefined();
    expect(c("C")?.base).toEqual({ salaryCents: 255000, refBrutCents: 255000, refCotisationsCents: 107100 });
    expect(c("embauche:h")).toMatchObject({ base: { salaryCents: 288000, refBrutCents: 288000, refCotisationsCents: 129600 }, etp4: 8000, service: "SALES", startDate: "2026-11-16" });
    // Décembre du parent = 4 284 € + 3 621 € + 4 176 € = 12 081 € = base dérivée (aucun élément ponctuel).
    expect(r.base).toMatchObject({ refMonth: "2026-12", refMasse: 1208100, refBaseCost: 1208100, origin: { scenarioName: "Révisé", month: "2026-12", notCarried: [], gap: [] } });
    const child = project(r.base, "2027-01", "2027-12", [], conv);
    expect(month(child, "2027-01")).toMatchObject({ cost: 1208100, headcount: 3, etp4: 28000 });
    // Atterrissage 2027 = 12 × 12 081 € ; atterrissage 2026 vu du budget N+1 = réel janv.–sept. + projeté du parent.
    expect(landing(r.base, child, "2027")).toMatchObject({ kind: "value", total: 12 * 1208100, prior: 0 });
    // Parent : octobre 10 650 € ; novembre A 4 284 € + B 1 479 € (15/30, après 2 %) + C 3 621 € + embauche 2 088 € (15/30)
    // = 11 472 € ; décembre 12 081 €.
    expect(landing(r.base, child, "2026")).toMatchObject({ kind: "value", actual: 6300000, priorMonths: ["2026-10", "2026-11", "2026-12"], prior: 1065000 + 1147200 + 1208100 });
    const n1 = shifted(scenarioSeries("c", "Budget 2027", r.base, child), 12, "n1", "N-1");
    expect(n1.points.get("2027-12")).toMatchObject({ cost: 1208100, layer: "projete-parent" });
    // Un départ postérieur à décembre n'est pas repris : signalé.
    const r2 = chainBase(parent, modern, hyps, project(base, "2026-10", "2026-12", hyps, conv), "2026-10-23", "2027-12");
    expect(r2.kind === "value" && r2.base.contracts.find((x) => x.contractKey === "A")?.base?.salaryCents).toBe(306000);
    expect(r2.kind === "value" && r2.base.origin?.notCarried).toEqual(["départ « Départ A 2027 » du 2027-02-28 (postérieur à 2026-12)"]);
    // Départ le 31 décembre : le contrat n'est plus présent en janvier, il n'est pas repris.
    const h3 = [...hyps.slice(0, 4), { ...hyps[4], lastPaidDate: "2026-12-31" } as Hypothesis];
    const r3 = chainBase(parent, modern, h3, project(base, "2026-10", "2026-12", h3, conv), "2026-10-23", "2027-12");
    expect(r3.kind === "value" && r3.base.contracts.map((x) => x.contractKey)).toEqual(["C", "embauche:h"].sort((x, y) => x.localeCompare(y)) && expect.not.arrayContaining(["A"]));
  });
});

describe("lot 3 : atterrissage retraité, mesures de management, sensibilités (cas écrits à la main)", async () => {
  const { retraite, measures, sensitivities } = await import("@/lib/budget/lot3");
  // Base de test ci-dessus : A 4 200 €, B 2 900 €, C corrigé 3 550 € par mois. Départ de B le 15/11 (sortie 1 000 € brut à
  // 20 %), remplaçant à 80 % de 3 600 € (charges 45 %) arrivé le 11/11 : recouvrement du 11 au 15 novembre (5 jours).
  const hyps: Hypothesis[] = [
    fixC,
    { id: "dB", kind: "depart", label: "Départ B", contractKey: "B", lastPaidDate: "2026-11-15", exitCost: { mode: "brut", brutCents: 100000, chargesBps: 2000 } },
    { id: "h", kind: "embauche", label: "Remplaçant B", service: "SALES", start: "2026-11-11", end: null, grossFullTimeCents: 360000, quotaBps: 8000, chargesBps: 4500, counted: true, replaces: "dB" },
    { id: "pon", kind: "ponctuel", label: "Prime exceptionnelle", month: "2026-12", amount: { mode: "charge", costCents: 30000 }, service: null, nonRecurring: true },
    { id: "rea", kind: "realise", label: "Rupture conventionnelle", category: "Ruptures", month: "2026-03", costCents: 50000 },
  ];
  const proj = project(base, "2026-10", "2026-12", hyps, conv);
  it("atterrissage retraité : 9 906 000 − (500 + 1 200 + 696 + 300 = 2 696 €) = 96 364,00 €", () => {
    // Projeté : octobre 10 650 € ; novembre 13 184 € (A 4 200 + B 1 450 + C 3 550 + sortie 1 200 + remplaçant 2 784) ; décembre 12 226 €.
    expect(landing(base, proj, "2026")).toMatchObject({ kind: "value", actual: 6300000, projected: 1065000 + 1318400 + 1222600 });
    const r = retraite(base, proj, hyps, "2026");
    expect(r).toMatchObject({ kind: "value", atterrissage: 9906000, realised: 50000, projected: 120000 + 69600 + 30000, total: 269600, retraite: 9636400 });
    expect(r.kind === "value" && r.rows.map((x) => [x.label, x.realised, x.projected])).toEqual([
      ["Coûts de sortie (hypothèses de départ)", 0, 120000],
      ["Éléments ponctuels non récurrents", 0, 30000],
      ["Ruptures", 50000, 0],
      ["Tuilages (coût de l'entrant pendant le recouvrement)", 0, 69600],
    ]);
  });
  it("hypothèse « réalisé » sur un mois à venir : refusée ; elle ne change pas la projection", () => {
    expect(project(base, "2026-10", "2026-12", [fixC, { id: "r", kind: "realise", label: "x", category: "c", month: "2026-11", costCents: 1 }], conv)).toMatchObject({ kind: "error", errors: [expect.stringContaining("n'est pas un mois réalisé")] });
    const sans = project(base, "2026-10", "2026-12", hyps.filter((h) => h.kind !== "realise"), conv);
    expect(landing(base, sans, "2026")).toEqual(landing(base, proj, "2026"));
  });
  it("mesure de management du départ de B : paie évitée 4 350 € (novembre 1 450 + décembre 2 900), sortie 1 200 €, remplaçant 6 960 € → net −3 810 € ; année pleine 12 × (2 900 − 4 176) = −15 312 €", () => {
    const m = measures(base, "2026-10", "2026-12", hyps, conv, "2026");
    expect(m).toMatchObject({ kind: "value", rows: [{ id: "dB", avoided: 435000, exit: 120000, replacement: 696000, net: -381000, fullYear: { kind: "value", cents: -1531200 } }] });
  });
  it("sensibilités : départ décalé de +10 jours → atterrissage +966,67 € (B payé 25/30 en novembre), retraité −425,33 € (tuilage 15 jours : +1 392 €)", () => {
    const s = sensitivities(base, "2026-10", "2026-12", hyps, conv, "2026", [
      { hypothesisId: "dB", kind: "jours", delta: 10 },
      { hypothesisId: "dB", kind: "sortie-pct", delta: 1000 },
      { hypothesisId: "pon", kind: "pct", delta: -5000 },
      { hypothesisId: "dB", kind: "taux", delta: 5 },
    ]);
    expect(s.rows[0].effect).toEqual({ kind: "value", atterrissage: 96667, retraite: 96667 - 139200, total: 9906000 + 96667 });
    // Coûts de sortie +10 % : +120 € chargés ; retraité inchangé (coût non récurrent retiré en entier).
    expect(s.rows[1].effect).toMatchObject({ kind: "value", atterrissage: 12000, retraite: 0 });
    // Prime exceptionnelle −50 % : −150 € ; retraité inchangé.
    expect(s.rows[2].effect).toMatchObject({ kind: "value", atterrissage: -15000, retraite: 0 });
    expect(s.rows[3].effect).toMatchObject({ kind: "nd", reason: expect.stringContaining("non applicable") });
  });
});

describe("jours ouvrés, congé non payé, entrée en cours de mois, catégories (cas écrits à la main)", async () => {
  const { easter, holidays, workdays } = await import("@/lib/budget/calendar");
  const ouvres = { prorata: "ouvres" as const };
  it("Pâques et jours fériés mobiles : 2026-04-05, 2027-03-28, 2028-04-16, 2029-04-01", () => {
    expect([2026, 2027, 2028, 2029].map(easter)).toEqual(["2026-04-05", "2027-03-28", "2028-04-16", "2029-04-01"]);
    // 2026 : lundi de Pâques 6 avril, Ascension 14 mai, lundi de Pentecôte 25 mai.
    expect([...holidays(2026)].sort()).toEqual(["2026-01-01", "2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-25", "2026-07-14", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25"]);
    expect([...holidays(2028)].filter((d) => d.startsWith("2028-04") || d.startsWith("2028-05-25") || d.startsWith("2028-06")).sort()).toEqual(["2028-04-17", "2028-05-25", "2028-06-05"]);
  });
  it("jours ouvrés 2026 : septembre 22, octobre 22, novembre 20 (11 novembre férié), décembre 22 (25 décembre férié)", () => {
    expect(["2026-09", "2026-10", "2026-11", "2026-12"].map((m) => workdays(`${m}-01`, `${m}-${m === "2026-09" || m === "2026-11" ? 30 : 31}`))).toEqual([22, 22, 20, 22]);
    expect(workdays("2026-09-07", "2026-09-30")).toBe(18);
  });
  it("embauche le 16 novembre 2026 en jours ouvrés : 11 jours ouvrés sur 20 (16 au 30 novembre, 11 novembre déjà passé)", () => {
    const h: Hypothesis = { id: "h", kind: "embauche", label: "Recrue", service: null, start: "2026-11-16", end: null, grossFullTimeCents: 200000, quotaBps: 10000, chargesBps: 5000, counted: true, replaces: null, category: "cdi" };
    const n = month(project(base, "2026-10", "2026-12", [fixC, h], ouvres), "2026-11");
    // 16–20 (5) + 23–27 (5) + 30 (1) = 11 jours ouvrés : brut 2 000 € × 11/20 = 1 100 € ; charges 550 € → 1 650 €.
    expect(n.contributions.find((c) => c.hypothesisId === "h")).toMatchObject({ brut: 110000, charges: 55000 });
    expect(n.byCategory).toMatchObject({ cdi: { headcount: 1, etp4: 10000 } });
  });
  it("congé non payé du 26 octobre au 25 novembre (salaire 0), contrat A à 4 200 € : jours ouvrés → octobre 3 245,45 €, novembre 630,00 €", () => {
    const ab: Hypothesis = { id: "ab", kind: "absence", label: "Congé de naissance", contractKey: "A", from: "2026-10-26", to: "2026-11-25", paidBps: 0 };
    const p = project(base, "2026-10", "2026-12", [fixC, ab], ouvres);
    // Octobre : 5 jours ouvrés non payés (26–30) sur 22 → payé 17/22 ; novembre : 17 jours ouvrés non payés sur 20 → payé 3/20.
    const a = (m: string) => month(p, m).contributions.filter((c) => c.contractKey === "A").reduce((s, c) => s + c.cost, 0);
    expect([a("2026-10"), a("2026-11"), a("2026-12")]).toEqual([324545, 63000, 420000]);
    // Novembre : contribution « absence » = 630,00 € − 4 200,00 € = −3 570,00 € (brut −2 550,00 € ; charges −1 020,00 €).
    expect(month(p, "2026-11").contributions.find((c) => c.kind === "absence")).toMatchObject({ hypothesisId: "ab", brut: -255000, charges: -102000, cost: -357000 });
    expect(month(p, "2026-11")).toMatchObject({ headcount: 3 }); // en congé non payé, le salarié reste dans l'effectif
    // Calendaire : octobre 6/31 non payé (26–31) → 25/31 payé = 3 387,09 € (brut 2 419,35 + charges 967,74).
    const pc = project(base, "2026-10", "2026-12", [fixC, ab], conv);
    expect(month(pc, "2026-10").contributions.filter((c) => c.contractKey === "A").reduce((s, c) => s + c.cost, 0)).toBe(241935 + 96774);
  });
  it("congé payé à 50 % et départ le même mois : réductions successives, somme exacte", () => {
    const ab: Hypothesis = { id: "ab", kind: "absence", label: "Mi-temps thérapeutique", contractKey: "A", from: "2026-10-01", to: "2026-10-31", paidBps: 5000 };
    const dep: Hypothesis = { id: "d", kind: "depart", label: "Départ A", contractKey: "A", lastPaidDate: "2026-10-15", exitCost: null, motif: "Rupture conventionnelle" };
    const o = month(project(base, "2026-10", "2026-10", [fixC, ab, dep], conv), "2026-10");
    // Départ : 15/31 de 4 200 ; absence : moitié de cette présence.
    const a = o.contributions.filter((c) => c.contractKey === "A");
    expect(a.map((c) => c.kind)).toEqual(["base", "depart", "absence"]);
    expect(a.reduce((s, c) => s + c.cost, 0)).toBe(Math.round((300000 * 15) / 31 / 2) + Math.round((120000 * 15) / 31 / 2));
    expect(o.contributions.reduce((s, c) => s + c.cost, 0)).toBe(o.cost);
    const dbl = project(base, "2026-10", "2026-10", [fixC, ab, { ...ab, id: "ab2", from: "2026-10-20" }], conv);
    expect(dbl.kind === "error" && dbl.errors.some((e) => e.includes("chevauche"))).toBe(true);
  });
  it("catégories : proposée par la nature, corrigée par hypothèse (apprentie codée CDD) ; effectif et ETP par catégorie", () => {
    const b3 = { ...base, contracts: [contract("A", { service: "TECH", category: "cdi", base: { salaryCents: 300000, refBrutCents: 330000, refCotisationsCents: 132000 } }), contract("B", { category: "cdd", etp4: 10000, base: { salaryCents: 200000, refBrutCents: 200000, refCotisationsCents: 12400 } }), contract("S", { category: "stagiaire", etp4: 5000, base: { salaryCents: 60000, refBrutCents: 60000, refCotisationsCents: 3000 } }), contract("N", { category: null, base: { salaryCents: 10000, refBrutCents: 10000, refCotisationsCents: 0 } })] };
    const sans = month(project(b3, "2026-10", "2026-10", [], conv), "2026-10");
    expect(sans.byCategory).toEqual({ cdi: { headcount: 1, etp4: 10000 }, cdd: { headcount: 1, etp4: 10000 }, stagiaire: { headcount: 1, etp4: 5000 }, nc: { headcount: 1, etp4: 10000 } });
    const avec = month(project(b3, "2026-10", "2026-10", [{ id: "c", kind: "categorie", label: "Apprentie", contractKey: "B", category: "apprenti" }], conv), "2026-10");
    expect(avec.byCategory).toMatchObject({ apprenti: { headcount: 1, etp4: 10000 } });
    expect(avec.byCategory?.cdd).toBeUndefined();
  });
  it("base d'un contrat entré le 7 septembre (ouvrés) : salaire de septembre 1 800 € ramené au mois complet = 1 800 × 22/18 = 2 200 € ; note de reconstitution", async () => {
    const { buildBase } = await import("@/lib/budget/base");
    const { payfitFixtureBuild, PAYFIT_MONTHS } = await import("./helpers/rh");
    const { kpiInput, DSN_ABSENCES } = await import("./helpers/kpi");
    const { DEFAULT_PREFIXES } = await import("@/lib/payroll/grid");
    const data = await payfitFixtureBuild();
    const c4 = data.contracts.find((c) => c.externalId.endsWith("004"))!;
    // Contrat 004 de la fixture : entrée le 15 février 2026 ; on le fait entrer le 7 septembre 2026 pour ce cas.
    const moved = { ...data, contracts: data.contracts.map((c) => (c === c4 ? { ...c, startDate: "2026-09-07" } : c)) };
    const line = (acc: string, debit: number | null, credit: number | null) => ({ key: `k${acc}${debit}`, month: "2026-09", accountId: acc, accountName: "x", debitCents: debit, creditCents: credit, contractId: c4.externalId, analytic: [] as never });
    const lines = [line("641100", 180000, null), line("645100", 72000, null)];
    const input = { lines, months: PAYFIT_MONTHS, openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: null };
    const r = buildBase({ input, kpi: kpiInput(moved, DSN_ABSENCES), refMonth: "2026-09", lastMonth: "2026-12", syncId: "s", readAt: "2026-10-21", conventions: ouvres, categoryNatures: DEFAULT_CATEGORY_NATURES });
    expect(r.kind).toBe("value");
    if (r.kind !== "value") return;
    const c = r.base.contracts.find((x) => x.externalId === c4.externalId)!;
    expect(c.base).toEqual({ salaryCents: 220000, refBrutCents: 180000, refCotisationsCents: 72000 });
    expect(c.baseNote).toContain("÷ 18/22 jours ouvrés");
    expect(c.baseNd).toBeNull();
  });
});
