import { describe, expect, it } from "vitest";
import { landing, presence, project, roundDiv } from "@/lib/budget/engine";
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
  const r = buildBase({ input, kpi, refMonth: "2026-09", lastMonth: "2026-12", syncId: "sync-test", readAt: "2026-10-21" });
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
    const r1 = buildBase({ input, kpi, refMonth: "2026-01", lastMonth: "2026-03", syncId: "s", readAt: "2026-10-21" });
    const b1 = r1.kind === "value" ? r1.base : null;
    expect(b1?.contracts.map((c) => c.externalId.slice(-3)).sort()).toEqual(["001", "002", "004", "005", "006", "007", "008"]);
    expect(b1?.contracts.find((c) => c.externalId.endsWith("004"))).toMatchObject({ base: null, baseNd: "entré le 2026-02-15, après le mois de référence : base à saisir", etp4: 10000 });
    expect(b1?.etpNote).toContain("quotités PayFit à la date de lecture");
    const extra = { ...lines[0], key: "extra", month: "2026-09", accountId: "641100", debitCents: 0, creditCents: null, contractId: "TEST-A-CONTRACT-001", analytic: [{ type: "Service", code: "TEST-SVC-Z", value: "Z" }] as never };
    const r2 = buildBase({ input: { ...input, lines: [...lines, extra] }, kpi, refMonth: "2026-09", lastMonth: "2026-12", syncId: "s", readAt: "2026-10-21" });
    expect(r2.kind === "value" && r2.base.contracts.find((c) => c.externalId.endsWith("001"))).toMatchObject({ service: null, serviceNd: expect.stringContaining("plusieurs services") });
  });
  it("mois de référence hors lecture ou non clos : refus avec la raison", () => {
    expect(buildBase({ input, kpi, refMonth: "2026-10", lastMonth: "2026-12", syncId: "s", readAt: "2026-10-21" })).toMatchObject({ kind: "nd", reason: expect.stringContaining("hors de la lecture") });
    expect(buildBase({ input: { ...input, openMonths: ["2026-09"] }, kpi, refMonth: "2026-09", lastMonth: "2026-12", syncId: "s", readAt: "2026-10-21" })).toMatchObject({ kind: "nd", reason: expect.stringContaining("non clôturée") });
  });
});
