import { describe, expect, it } from "vitest";
import {
  buildCashPlan, emptyCashPlan, flowFromForm, mondayOf, occurrences, openSupplierItems, parseCashPlan, startFromForm,
  type CashFlow, type CashPlanSettings, type PlanStart, type SupplierLine,
} from "@/lib/restructuring/crisis/cashplan";

// Cas de référence écrit à la main (société fictive). Départ le mercredi 04/03/2026, solde saisi de 20 000,00 €.
// Semaine 1 : lundi 02/03 → dimanche 08/03 ; semaine 13 : 25/05 → 31/05.
const flow = (id: string, patch: Partial<CashFlow>): CashFlow => ({ id, label: `Flux fictif ${id}`, category: "other", direction: "out", amountCents: 1, date: "2026-03-05", recurrence: "once", until: null, ...patch });
const FLOWS: CashFlow[] = [
  flow("A", { category: "customers", direction: "in", amountCents: 500_000, date: "2026-03-06" }),                      // S1 : +5 000,00
  flow("B", { category: "payroll", amountCents: 1_200_000, date: "2026-01-31", recurrence: "monthly" }),                // 31/03 (S5), 30/04 (S9), 31/05 (S13)
  flow("C", { category: "suppliers", amountCents: 10_000, date: "2026-03-04", recurrence: "weekly" }),                  // 12 mercredis, de S2 à S13 (le 04/03 est exclu)
  flow("D", { category: "social", amountCents: 900_000, date: "2026-03-16" }),                                          // S3 : −9 000,00
  flow("E", { amountCents: 300_000, date: "2026-03-04" }),                                                              // le jour du départ : hors plan
  flow("F", { direction: "in", amountCents: 100_000, date: "2026-06-01" }),                                             // après la semaine 13 : hors plan
  flow("G", { direction: "in", amountCents: 50_000, date: "2026-03-09", recurrence: "weekly", until: "2026-03-23" }),   // S2, S3, S4
];
const START: PlanStart = { date: "2026-03-04", cents: 2_000_000, source: "saisi" };
const settings = (patch: Partial<CashPlanSettings> = {}): CashPlanSettings => ({ ...emptyCashPlan(), flows: FLOWS, ...patch });
const plan = (patch: Partial<CashPlanSettings> = {}, start: PlanStart = START) => {
  const result = buildCashPlan(start, "sans objet", settings(patch));
  if (result.kind !== "value") throw new Error(result.reason);
  return result;
};

describe("Cap 13 : trésorerie à 13 semaines, plan de base", () => {
  it("13 semaines calendaires à partir du lundi de la semaine de départ", () => {
    const p = plan();
    expect(p.weeks).toHaveLength(13);
    expect([p.weeks[0].from, p.weeks[0].to]).toEqual(["2026-03-02", "2026-03-08"]);
    expect([p.weeks[12].from, p.weeks[12].to, p.horizonEnd]).toEqual(["2026-05-25", "2026-05-31", "2026-05-31"]);
    expect([mondayOf("2026-03-04"), mondayOf("2026-03-02"), mondayOf("2026-03-08")]).toEqual(["2026-03-02", "2026-03-02", "2026-03-02"]);
  });
  it("cas de référence : soldes de fin de semaine", () => {
    expect(plan().weeks.map((w) => w.closing)).toEqual([
      2_500_000, 2_540_000, 1_680_000, 1_720_000, 510_000, 500_000, 490_000, 480_000, -730_000, -740_000, -750_000, -760_000, -1_970_000,
    ]);
  });
  it("cas de référence : encaissements et décaissements par catégorie, total = variation du solde", () => {
    const p = plan();
    expect(Object.fromEntries(p.rows.map((r) => [`${r.direction}:${r.category}`, r.total]))).toEqual({ "in:customers": 500_000, "in:other": 150_000, "out:suppliers": 120_000, "out:payroll": 3_600_000, "out:social": 900_000 });
    expect(p.rows.map((r) => r.direction)).toEqual(["in", "in", "out", "out", "out"]);
    const net = p.weeks.reduce((sum, w) => sum + w.net, 0);
    expect(net).toBe(650_000 - 4_620_000);
    expect(START.cents + net).toBe(p.weeks[12].closing);
    expect(p.weeks[4]).toMatchObject({ inflow: 0, outflow: 1_210_000 });
  });
  it("chaque euro remonte à une ligne saisie et à sa date", () => {
    const p = plan();
    expect(p.weeks[2].contributions.map((c) => [c.flowId, c.date, c.cents])).toEqual([["D", "2026-03-16", -900_000], ["G", "2026-03-16", 50_000], ["C", "2026-03-18", -10_000]]);
    for (const week of p.weeks) expect(week.contributions.reduce((sum, c) => sum + c.cents, 0)).toBe(week.net);
  });
  it("point bas et rupture : sans découvert saisi, le seuil est zéro et l’écran peut le dire", () => {
    const p = plan();
    expect(p.lowPoint).toEqual({ week: 13, cents: -1_970_000 });
    expect(p.floor).toEqual({ cents: 0, source: "zero" });
    expect(p.rupture).toEqual({ week: 9, from: "2026-04-27", to: "2026-05-03", cents: -730_000 });
  });
  it("le découvert autorisé saisi déplace ou supprime la rupture", () => {
    expect(plan({ overdraftCents: 800_000 }).rupture?.week).toBe(13);
    expect(plan({ overdraftCents: 800_000 }).floor).toEqual({ cents: -800_000, source: "decouvert" });
    expect(plan({ overdraftCents: 2_000_000 }).rupture).toBeNull();
    expect(plan({ overdraftCents: 0 }).rupture?.week).toBe(9);
  });
  it("les lignes sans occurrence sont listées avec leur raison, jamais déplacées", () => {
    expect(plan().ignored.map((i) => [i.flowId, i.reason.split(" :")[0]])).toEqual([
      ["E", "date antérieure ou égale à la date de départ"], ["F", "date postérieure à la treizième semaine"],
    ]);
    const ended = plan({ flows: [flow("H", { recurrence: "weekly", date: "2026-01-05", until: "2026-03-04" })] });
    expect(ended.ignored[0].reason).toContain("terminée");
    expect(ended.weeks.every((w) => w.closing === START.cents)).toBe(true);
  });
  it("un flux mensuel du 31 revient le dernier jour des mois courts", () => {
    expect(occurrences(flow("M", { date: "2026-01-31", recurrence: "monthly" }), "2026-01-31", "2026-04-30")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(occurrences(flow("W", { date: "2026-03-04", recurrence: "weekly", until: "2026-03-18" }), "2026-03-04", "2026-05-31")).toEqual(["2026-03-11", "2026-03-18"]);
  });
  it("solde de départ négatif : signalé avant tout flux", () => {
    const p = plan({ flows: [] }, { date: "2026-03-04", cents: -50_000, source: "fec" });
    expect(p.startBelowFloor).toBe(true);
    expect(p.rupture?.week).toBe(1);
    expect(plan({ flows: [], overdraftCents: 100_000 }, { date: "2026-03-04", cents: -50_000, source: "fec" }).startBelowFloor).toBe(false);
  });
  it("sans solde de départ : n.d. avec la raison donnée, aucun plan à zéro", () => {
    expect(buildCashPlan(null, "Aucun solde de départ.", settings())).toEqual({ kind: "nd", reason: "Aucun solde de départ." });
    expect(buildCashPlan({ date: "04/03/2026", cents: 0, source: "saisi" }, "x", settings()).kind).toBe("nd");
  });
});

describe("Cap 13 : paramètre stocké et saisies du plan", () => {
  const stored = { revision: 3, start: { date: "2026-03-04", cents: -1200 }, overdraftCents: 500_000, flows: [FLOWS[0], FLOWS[6]] };
  it("lecture stricte : une valeur invalide rend l’ensemble illisible", () => {
    expect(parseCashPlan(stored)).toEqual(stored);
    expect(parseCashPlan(emptyCashPlan())).toEqual(emptyCashPlan());
    for (const broken of [
      { ...stored, flows: [{ ...FLOWS[0], amountCents: 0 }] }, { ...stored, flows: [{ ...FLOWS[0], category: "inconnue" }] },
      { ...stored, flows: [FLOWS[0], FLOWS[0]] }, { ...stored, flows: [{ ...FLOWS[0], until: "2026-12-31" }] },
      { ...stored, flows: [{ ...FLOWS[6], until: "2026-03-01" }] }, { ...stored, overdraftCents: -1 }, { ...stored, start: { date: "2026-02-30", cents: 0 } },
      { ...stored, revision: -1 }, { ...stored, flows: [{ ...FLOWS[0], amountCents: 100_000_000_001 }] }, null, [],
    ]) expect(parseCashPlan(broken)).toBeNull();
  });
  const form = (entries: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.set(k, v); return f; };
  const valid = { label: "Loyer fictif", category: "suppliers", direction: "out", amount: "1 500,50", date: "2026-03-10", recurrence: "monthly", until: "" };
  it("ligne de flux : montant en euros converti en centimes, sens séparé du montant", () => {
    expect(flowFromForm(form(valid), "id-1")).toEqual({ id: "id-1", label: "Loyer fictif", category: "suppliers", direction: "out", amountCents: 150_050, date: "2026-03-10", recurrence: "monthly", until: null });
    expect(flowFromForm(form({ ...valid, until: "2026-06-10" }), "id-2").until).toBe("2026-06-10");
  });
  it("ligne de flux : saisies refusées avec leur raison", () => {
    for (const [patch, message] of [
      [{ label: "" }, "Libellé"], [{ category: "" }, "catégorie"], [{ direction: "" }, "Encaissement"], [{ amount: "-5" }, "positif"], [{ amount: "0" }, "positif"],
      [{ amount: "" }, "positif"], [{ date: "10/03/2026" }, "Date"], [{ recurrence: "annuel" }, "Ponctuel"], [{ until: "2026-03-01" }, "date de fin"],
      [{ recurrence: "once", until: "2026-06-10" }, "récurrent"],
    ] as const) expect(() => flowFromForm(form({ ...valid, ...patch }), "id")).toThrow(message);
  });
  it("solde de départ : date et montant ensemble ou aucun ; un champ vide n’est pas un zéro", () => {
    expect(startFromForm(form({ startDate: "", startAmount: "", overdraft: "" }))).toEqual({ start: null, overdraftCents: null });
    expect(startFromForm(form({ startDate: "2026-03-04", startAmount: "-1 250,75", overdraft: "0" }))).toEqual({ start: { date: "2026-03-04", cents: -125_075 }, overdraftCents: 0 });
    expect(() => startFromForm(form({ startDate: "2026-03-04", startAmount: "", overdraft: "" }))).toThrow("ensemble");
    expect(() => startFromForm(form({ startDate: "", startAmount: "100", overdraft: "" }))).toThrow("ensemble");
    expect(() => startFromForm(form({ startDate: "", startAmount: "", overdraft: "-10" }))).toThrow("Découvert");
  });
});

describe("Cap 13 : factures fournisseurs non lettrées, proposées à la saisie", () => {
  const line = (patch: Partial<SupplierLine>): SupplierLine => ({ accountId: "401000", auxiliary: "F001", auxiliaryLabel: "Tiers fictif F001", date: "2026-01-20", pieceRef: "P1", pieceDate: "2026-01-18", debitCents: 0, creditCents: 0, letteringKnown: true, lettering: null, letteringDate: null, ...patch });
  const LINES = [
    line({ creditCents: 1_000_000, lettering: "AA", letteringDate: "2026-02-05" }), // facture lettrée le 05/02
    line({ date: "2026-02-05", debitCents: 1_000_000, lettering: "AA", letteringDate: "2026-02-05", pieceRef: "R1" }),
    line({ date: "2026-02-10", creditCents: 600_000, pieceRef: "P2", pieceDate: "2026-02-08" }), // ouverte
    line({ date: "2026-02-12", debitCents: 50_000, auxiliary: "F002", auxiliaryLabel: "Tiers fictif F002", pieceRef: "AC1" }), // acompte non lettré
    line({ date: "2026-03-01", creditCents: 999_900, pieceRef: "P3" }), // après la date
  ];
  it("ouvert = non lettré, ou lettré après la date ; montant positif = dû", () => {
    const open = openSupplierItems(LINES, "2026-02-28");
    if (open.kind !== "value") throw new Error(open.reason);
    expect(open.items.map((i) => [i.pieceRef, i.cents])).toEqual([["P2", 600_000], ["AC1", -50_000]]);
    expect([open.count, open.totalCents]).toEqual([2, 550_000]);
  });
  it("à une date antérieure au lettrage, la facture est encore ouverte", () => {
    const open = openSupplierItems(LINES, "2026-01-31");
    expect(open.kind === "value" && open.items.map((i) => [i.pieceRef, i.cents])).toEqual([["P1", 1_000_000]]);
  });
  it("lettrage non lu à l’import : n.d., jamais « tout est ouvert »", () => {
    expect(openSupplierItems([line({ creditCents: 100, letteringKnown: false })], "2026-02-28")).toEqual({ kind: "nd", reason: expect.stringContaining("lettrage") });
    expect(openSupplierItems([line({ creditCents: null })], "2026-02-28").kind).toBe("nd");
    expect(openSupplierItems([], "2026-02-28")).toEqual({ kind: "value", items: [], count: 0, totalCents: 0 });
  });
});
