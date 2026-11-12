import { describe, expect, it } from "vitest";
import {
  buildCashPlan, buildScenarioPlan, emptyCashPlan, flowFromForm, measureFromForm, mondayOf, occurrences, openSupplierItems, parseCashPlan, scenarioNameFromForm, startFromForm,
  type CashFlow, type CashPlanSettings, type Measure, type PlanStart, type Scenario, type SupplierLine,
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
    expect(parseCashPlan(stored)).toEqual({ ...stored, scenarios: [] }); // plan enregistré avant les scénarios
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

// Cas de référence écrit à la main, sur le plan de base ci-dessus :
//  - report de 4 semaines de l'URSSAF (9 000,00 du 16/03, S3 → 13/04, S7) ;
//  - étalement des salaires (3 × 12 000,00 = 36 000,00) en 4 échéances mensuelles de 9 000,00 à partir du 15/04 :
//    15/04 (S7), 15/05 (S11), 15/06 et 15/07 après la semaine 13 → 18 000,00 reportés ;
//  - cession d'actif de 10 000,00 le 28/04 (S9).
describe("Cap 13 : scénarios comparés au plan de base", () => {
  const MEASURES: Measure[] = [
    { id: "m1", kind: "report", flowId: "D", weeks: 4 },
    { id: "m2", kind: "etalement", flowId: "B", count: 4, frequency: "monthly", firstDate: "2026-04-15" },
    { id: "m3", kind: "encaissement", label: "Cession fictive", nature: "cession", amountCents: 1_000_000, date: "2026-04-28" },
  ];
  const scenario = (measures: Measure[] = MEASURES): Scenario => ({ id: "s1", name: "Scénario fictif", measures });
  const run = (measures: Measure[] = MEASURES, patch: Partial<CashPlanSettings> = {}) => {
    const base = buildCashPlan(START, "sans objet", settings(patch));
    const result = buildScenarioPlan(base, settings(patch), scenario(measures));
    if (result.kind !== "value" || base.kind !== "value") throw new Error("plan non calculable");
    return { base, result };
  };
  it("cas de référence : soldes de fin de semaine du scénario", () => {
    expect(run().result.plan.weeks.map((w) => w.closing)).toEqual([
      2_500_000, 2_540_000, 2_580_000, 2_620_000, 2_610_000, 2_600_000, 790_000, 780_000, 1_770_000, 1_760_000, 850_000, 840_000, 830_000,
    ]);
  });
  it("cas de référence : point bas, rupture, écarts et montant reporté après la semaine 13", () => {
    const { base, result } = run();
    expect(result.plan.lowPoint).toEqual({ week: 8, cents: 780_000 });
    expect(result.lowPointDelta).toBe(780_000 - -1_970_000);
    expect(result.plan.rupture).toBeNull();
    expect(result.baseRupture?.week).toBe(9);
    expect(result.beyondCents).toBe(1_800_000);
    expect(result.comparison[12]).toEqual({ week: 13, base: -1_970_000, scenario: 830_000, delta: 2_800_000 });
    for (const c of result.comparison) expect(c.delta).toBe(c.scenario - c.base);
    // Ce que le scénario gagne en fin de plan = encaissement exceptionnel + décaissements sortis de l'horizon.
    expect(result.comparison[12].delta).toBe(1_000_000 + result.beyondCents);
    expect(base.weeks.map((w) => w.closing)[12]).toBe(-1_970_000); // le plan de base n'est pas modifié
  });
  it("chaque montant du scénario remonte à sa mesure et à la ligne de base", () => {
    const week7 = run().result.plan.weeks[6].contributions;
    expect(week7.map((c) => [c.flowId, c.measureId, c.date, c.cents])).toEqual([["D", "m1", "2026-04-13", -900_000], ["B", "m2", "2026-04-15", -900_000], ["C", null, "2026-04-15", -10_000]]);
    expect(week7[0].label).toContain("reporté de 4 sem., prévu le 16/03/2026");
    expect(week7[1].label).toContain("échéance 1/4");
    const week9 = run().result.plan.weeks[8];
    expect(week9.contributions.find((c) => c.measureId === "m3")).toMatchObject({ flowId: null, cents: 1_000_000 });
    expect(run().result.plan.rows.find((r) => r.category === "exceptional")).toMatchObject({ direction: "in", label: "Exceptionnels", total: 1_000_000 });
  });
  it("étalement : échéances égales, reliquat d’arrondi sur la dernière, total conservé", () => {
    const flows = [flow("X", { amountCents: 100_000, date: "2026-03-10" })];
    const { result } = run([{ id: "m", kind: "etalement", flowId: "X", count: 3, frequency: "weekly", firstDate: "2026-03-17" }], { flows });
    const parts = result.plan.weeks.flatMap((w) => w.contributions).map((c) => [c.date, c.cents]);
    expect(parts).toEqual([["2026-03-17", -33_333], ["2026-03-24", -33_333], ["2026-03-31", -33_334]]);
    expect(result.beyondCents).toBe(0);
  });
  it("un report au-delà de la semaine 13 sort du plan mais reste compté comme dû", () => {
    const { result } = run([{ id: "m", kind: "report", flowId: "C", weeks: 12 }]);
    expect(result.outcomes[0]).toMatchObject({ inapplicable: null, beyondCents: 120_000 });
    expect(result.plan.rows.some((r) => r.category === "suppliers")).toBe(false);
    expect(result.comparison[12].delta).toBe(120_000);
  });
  it("une mesure qui ne peut pas s’appliquer entièrement n’est pas appliquée, avec sa raison", () => {
    const { base, result } = run([
      { id: "a", kind: "report", flowId: "supprimée", weeks: 2 },
      { id: "b", kind: "report", flowId: "A", weeks: 2 },
      { id: "c", kind: "etalement", flowId: "E", count: 2, frequency: "weekly", firstDate: "2026-03-20" },
      { id: "d", kind: "etalement", flowId: "D", count: 2, frequency: "weekly", firstDate: "2026-03-04" },
      { id: "e", kind: "encaissement", label: "Trop tôt", nature: "autre", amountCents: 5, date: "2026-03-04" },
      { id: "f", kind: "encaissement", label: "Trop tard", nature: "apport", amountCents: 5, date: "2026-06-01" },
    ]);
    expect(result.outcomes.map((o) => o.inapplicable?.split(" :")[0])).toEqual([
      "la ligne visée a été supprimée du plan de base", "la ligne visée est un encaissement",
      "la ligne visée n’a aucune occurrence dans les 13 semaines", "première échéance antérieure ou égale à la date de départ",
      "date antérieure ou égale à la date de départ", "date postérieure à la treizième semaine",
    ]);
    expect(result.plan.weeks.map((w) => w.closing)).toEqual(base.weeks.map((w) => w.closing));
    expect(result.beyondCents).toBe(0);
  });
  it("un scénario sans mesure est identique au plan de base ; sans plan de base, n.d.", () => {
    const { result } = run([]);
    expect(result.comparison.every((c) => c.delta === 0)).toBe(true);
    expect(buildScenarioPlan({ kind: "nd", reason: "Aucun solde de départ." }, settings(), scenario())).toEqual({ kind: "nd", reason: "Aucun solde de départ." });
  });
  it("paramètre stocké : scénarios lus strictement, une ligne ne porte qu’une mesure par scénario", () => {
    const stored = { ...emptyCashPlan(), flows: FLOWS, scenarios: [scenario()] };
    expect(parseCashPlan(stored)).toEqual(stored);
    const withMeasures = (measures: unknown[]) => parseCashPlan({ ...stored, scenarios: [{ id: "s1", name: "S", measures }] });
    expect(withMeasures([MEASURES[0], { id: "m9", kind: "etalement", flowId: "D", count: 2, frequency: "weekly", firstDate: "2026-04-01" }])).toBeNull();
    expect(withMeasures([{ ...MEASURES[0], weeks: 0 }])).toBeNull();
    expect(withMeasures([{ ...MEASURES[1], count: 1 }])).toBeNull();
    expect(withMeasures([{ ...MEASURES[2], nature: "inconnue" }])).toBeNull();
    expect(withMeasures([MEASURES[0], MEASURES[0]])).toBeNull();
    expect(parseCashPlan({ ...stored, scenarios: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, measures: [] })) })).toBeNull();
    expect(parseCashPlan({ ...stored, scenarios: [{ id: "s1", name: "", measures: [] }] })).toBeNull();
  });
  const form = (entries: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(entries)) f.set(k, v); return f; };
  it("saisie des mesures : chaque type validé, refus avec sa raison", () => {
    expect(measureFromForm(form({ kind: "report", flowId: "D", weeks: "4" }), "id")).toEqual({ id: "id", kind: "report", flowId: "D", weeks: 4 });
    expect(measureFromForm(form({ kind: "etalement", flowId: "B", count: "4", frequency: "monthly", firstDate: "2026-04-15" }), "id")).toEqual({ id: "id", kind: "etalement", flowId: "B", count: 4, frequency: "monthly", firstDate: "2026-04-15" });
    expect(measureFromForm(form({ kind: "encaissement", label: "Cession fictive", nature: "cession", amount: "10 000", date: "2026-04-28" }), "id")).toEqual({ id: "id", kind: "encaissement", label: "Cession fictive", nature: "cession", amountCents: 1_000_000, date: "2026-04-28" });
    for (const [entries, message] of [
      [{ kind: "report", flowId: "D", weeks: "0" }, "1 à 52"], [{ kind: "report", flowId: "D", weeks: "2,5" }, "1 à 52"], [{ kind: "report", flowId: "", weeks: "2" }, "ligne"],
      [{ kind: "etalement", flowId: "B", count: "1", frequency: "monthly", firstDate: "2026-04-15" }, "2 à 60"], [{ kind: "etalement", flowId: "B", count: "3", frequency: "annuel", firstDate: "2026-04-15" }, "fréquence"],
      [{ kind: "etalement", flowId: "B", count: "3", frequency: "weekly", firstDate: "" }, "première échéance"], [{ kind: "encaissement", label: "x", nature: "", amount: "5", date: "2026-04-28" }, "nature"],
      [{ kind: "encaissement", label: "x", nature: "cession", amount: "0", date: "2026-04-28" }, "positif"], [{ kind: "autre" }, "inconnu"],
    ] as const) expect(() => measureFromForm(form(entries), "id")).toThrow(message);
    expect(scenarioNameFromForm(form({ name: "  Moratoire fictif " }))).toBe("Moratoire fictif");
    expect(() => scenarioNameFromForm(form({ name: "" }))).toThrow("Nom");
  });
});
