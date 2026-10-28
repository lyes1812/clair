import { describe, expect, it } from "vitest";
import { buildRestructuring, type RestructuringModel, type RestructuringScenario } from "@/lib/restructuring/model";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";

// Calculs manuels exclusivement fictifs, sans source métier ni accès base.
const base = (salaryCents = 10_000): BaseSnapshot => ({
  currency: "EUR", refMonth: "2026-09", syncId: "lecture-fictive", readAt: "2026-10-01T10:00:00.000Z",
  contracts: [{
    contractKey: "contrat-fictif", externalId: "fictif", label: "Collaborateur fictif", service: "SERVICE", serviceNd: null,
    startDate: "2024-01-01", endDate: null, counted: true, etp4: 10_000, etpNd: null,
    base: { salaryCents, refBrutCents: 10_000, refCotisationsCents: 0 }, baseNd: null,
  }], actuals: [], refMasse: salaryCents, refBaseCost: salaryCents, etpNote: null,
});
const scenario = (id: string, hypotheses: Hypothesis[] = [], snapshot = base()): RestructuringScenario => ({
  id, name: `Scénario fictif ${id}`, status: "brouillon", firstMonth: "2026-10", lastMonth: "2026-12",
  baseHash: "meme-base-fictive", base: snapshot, hypotheses, conventions: { prorata: "calendaire" },
});
const departure = (exitCost: Extract<Hypothesis, { kind: "depart" }>["exitCost"] = { mode: "charge", costCents: 10_000 }): Hypothesis => ({
  id: "depart-fictif", kind: "depart", label: "Départ fictif", contractKey: "contrat-fictif", lastPaidDate: "2026-10-31", exitCost,
});
const hire = (changes: Partial<Extract<Hypothesis, { kind: "embauche" }>> = {}): Hypothesis => ({
  id: "remplacement-fictif", kind: "embauche", label: "Remplacement fictif", service: "SERVICE", start: "2026-11-01", end: null,
  grossFullTimeCents: 4_000, quotaBps: 10_000, chargesBps: 0, counted: true, replaces: "depart-fictif", ...changes,
});
const oneOff = (id: string, month: string, costCents: number, nonRecurring = true): Hypothesis => ({ id, kind: "ponctuel", label: `Coût fictif ${id}`, month, amount: { mode: "charge", costCents }, service: null, nonRecurring });
const month = (model: RestructuringModel, key: string) => model.months.find((entry) => entry.month === key)!;

describe("deux scénarios explicitement choisis et compatibles", () => {
  it("ne choisit pas de référence implicite ni le scénario lui-même", () => {
    expect(buildRestructuring(null, null)).toMatchObject({ kind: "nd", months: [], reason: expect.stringContaining("explicitement") });
    expect(buildRestructuring(scenario("a"), null).kind).toBe("nd");
    expect(buildRestructuring(scenario("a"), scenario("a"))).toMatchObject({ kind: "nd", reason: expect.stringContaining("distincts"), months: [] });
    expect(buildRestructuring(null, scenario("b")).payback.month).toBeNull();
  });

  it.each(["base", "horizon", "prorata"])("refuse %s différent et conseille une duplication, sans comparaison partielle", (difference) => {
    const a = scenario("a"), b = scenario("b");
    if (difference === "base") b.baseHash = "autre-base";
    if (difference === "horizon") b.lastMonth = "2027-01";
    if (difference === "prorata") b.conventions.prorata = "ouvres";
    const model = buildRestructuring(a, b);
    expect(model.kind).toBe("nd"); expect(model.months).toEqual([]);
    expect(model.reason).toContain("dupliquer");
    expect(Object.values(model.totals).every((metric) => metric.value === null)).toBe(true);
  });

  it("refuse une base sans empreinte et un horizon invalide ou inversé", () => {
    const a = scenario("a"), b = scenario("b");
    a.baseHash = b.baseHash = "";
    expect(buildRestructuring(a, b).kind).toBe("nd");
    a.baseHash = b.baseHash = "base";
    a.firstMonth = b.firstMonth = "2026-13";
    expect(buildRestructuring(a, b).kind).toBe("nd");
    a.firstMonth = b.firstMonth = "2027-01";
    expect(buildRestructuring(a, b).kind).toBe("nd");
  });

  it("compare aussi deux scénarios figés, sans exiger une modification de la référence", () => {
    const a = scenario("a"), b = scenario("b"); a.status = b.status = "fige";
    const model = buildRestructuring(a, b);
    expect(model.kind).toBe("value"); expect(model.totals.savings.value).toBe(0);
    expect(model.payback.month).toBeNull(); expect(model.payback.reason).toContain("Aucun déficit");
  });
});

describe("coûts, remplacements et économies sans double compte", () => {
  it("calcule le cas manuel : coût référence 300, projet 280, économie 20 EUR, point mort décembre", () => {
    const model = buildRestructuring(scenario("a"), scenario("b", [departure(), hire()]));
    expect(model.kind).toBe("value");
    expect(model.months.map((entry) => [entry.month, entry.referenceCost.value, entry.proposalCost.value, entry.savings.value, entry.cumulative.value])).toEqual([
      ["2026-10", 10_000, 20_000, -10_000, -10_000], ["2026-11", 10_000, 4_000, 6_000, -4_000], ["2026-12", 10_000, 4_000, 6_000, 2_000],
    ]);
    expect(model.totals).toEqual({
      referenceCost: { value: 30_000, reason: null }, proposalCost: { value: 28_000, reason: null }, savings: { value: 2_000, reason: null },
      transitionCost: { value: 10_000, reason: null }, exitCost: { value: 10_000, reason: null }, replacementCost: { value: 8_000, reason: null },
    });
    expect(model.payback.month).toBe("2026-12");
    expect(model.endEtpDelta).toEqual({ value: 0, reason: null });
  });

  it("conserve le tuilage dans le remplacement et la transition, sans le soustraire une deuxième fois", () => {
    const model = buildRestructuring(scenario("a"), scenario("b", [departure(), hire({ start: "2026-10-16", grossFullTimeCents: 6_200 })]));
    // Octobre : 100 salaire + 100 sortie + 32 remplacement (16/31 × 62 EUR).
    expect(month(model, "2026-10").proposalCost.value).toBe(23_200);
    expect(model.totals.proposalCost.value).toBe(35_600);
    expect(model.totals.savings.value).toBe(-5_600);
    expect(model.totals.transitionCost.value).toBe(13_200);
    expect(model.totals.replacementCost.value).toBe(15_600);
    expect(model.totals.savings.value).toBe(model.totals.referenceCost.value! - model.totals.proposalCost.value!);
    expect(model.payback.month).toBeNull();
  });

  it("isole la transition différentielle, mais présente les sorties absolues du projet", () => {
    const model = buildRestructuring(scenario("a", [departure({ mode: "charge", costCents: 5_000 })]), scenario("b", [departure()]));
    expect(model.totals.referenceCost.value).toBe(15_000);
    expect(model.totals.proposalCost.value).toBe(20_000);
    expect(model.totals.savings.value).toBe(-5_000);
    expect(model.totals.transitionCost.value).toBe(5_000);
    expect(model.totals.exitCost.value).toBe(10_000);
    expect(model.totals.replacementCost.value).toBe(0);
  });

  it("rassemble plusieurs départs dans une seule comparaison, sans additionner des effets contrefactuels par salarié", () => {
    const snapshot = base();
    snapshot.contracts.push({ ...snapshot.contracts[0], contractKey: "deuxieme-fictif", externalId: "fictif-2", label: "Second fictif" });
    const second: Hypothesis = { ...departure({ mode: "charge", costCents: 0 }), id: "depart-2", kind: "depart", contractKey: "deuxieme-fictif", lastPaidDate: "2026-11-30" } as Hypothesis;
    const model = buildRestructuring(scenario("a", [], snapshot), scenario("b", [departure({ mode: "charge", costCents: 0 }), second], snapshot));
    expect(model.months.map((entry) => entry.savings.value)).toEqual([0, 10_000, 20_000]);
    expect(model.totals.savings.value).toBe(30_000);
    expect(model.endEtpDelta.value).toBe(20_000);
  });

  it("inclut les augmentations et changements de quotité d’un remplaçant, et pas les embauches non liées", () => {
    const hyps: Hypothesis[] = [departure({ mode: "charge", costCents: 0 }), hire(), hire({ id: "embauche-autonome", replaces: null, grossFullTimeCents: 1_000 }),
      { id: "augmentation-remplacant", kind: "augmentation", label: "Augmentation fictive", from: "2026-12", rateBps: 1_000, scope: { kind: "contrat", key: "embauche:remplacement-fictif" } },
      { id: "quotite-remplacant", kind: "changement", label: "Quotité fictive", contractKey: "embauche:remplacement-fictif", from: "2026-12", quotaBps: 5_000 }];
    const model = buildRestructuring(scenario("a"), scenario("b", hyps));
    expect(month(model, "2026-11").replacementCost.value).toBe(4_000);
    expect(month(model, "2026-12").replacementCost.value).toBe(2_200);
    expect(month(model, "2026-12").proposalCost.value).toBe(3_200);
    expect(model.totals.replacementCost.value).toBe(6_200);
  });

  it("respecte les fins de contrat connues : aucune économie inventée au-delà de leur coût de référence", () => {
    const snapshot = base(); snapshot.contracts[0].endDate = "2026-11-30";
    const model = buildRestructuring(scenario("a", [], snapshot), scenario("b", [departure({ mode: "charge", costCents: 0 })], snapshot));
    expect(model.months.map((entry) => entry.savings.value)).toEqual([0, 10_000, 0]);
    expect(model.totals.savings.value).toBe(10_000);
    expect(model.endEtpDelta.value).toBe(0);
  });

  it("réutilise le montant brut et le taux saisis, sans règle d’indemnité calculée", () => {
    const model = buildRestructuring(scenario("a"), scenario("b", [departure({ mode: "brut", brutCents: 10_001, chargesBps: 2_500 })]));
    expect(model.totals.exitCost.value).toBe(12_501);
    expect(model.totals.transitionCost.value).toBe(12_501);
  });
});

describe("n.d. distinct d’un zéro et bornes entières", () => {
  it("un coût de sortie null bloque son mois, les cumuls suivants et les totaux, jamais la paie connue des autres mois", () => {
    const model = buildRestructuring(scenario("a"), scenario("b", [departure(null)]));
    expect(model.kind).toBe("value");
    expect(month(model, "2026-10").proposalCost).toMatchObject({ value: null, reason: expect.stringContaining("exitCost") });
    expect(month(model, "2026-10").exitCost.value).toBeNull();
    expect(month(model, "2026-11").proposalCost.value).toBe(0);
    expect(month(model, "2026-11").savings.value).toBe(10_000);
    expect(model.months.every((entry) => entry.cumulative.value === null)).toBe(true);
    expect(model.totals.proposalCost.value).toBeNull(); expect(model.totals.savings.value).toBeNull();
    expect(model.totals.referenceCost.value).toBe(30_000);
    expect(model.payback).toMatchObject({ month: null, reason: expect.stringContaining("n.d.") });
    expect(model.warnings.join(" ")).toContain("absence de saisie n’est pas un zéro");
  });

  it("un zéro explicitement saisi autorise le calcul sans inventer de montant", () => {
    const model = buildRestructuring(scenario("a"), scenario("b", [departure({ mode: "charge", costCents: 0 })]));
    expect(model.totals.exitCost.value).toBe(0); expect(model.totals.savings.value).toBe(20_000);
    expect(model.totals.proposalCost.value).toBe(10_000);
    expect(model.payback.month).toBeNull(); expect(model.payback.reason).toContain("Aucun déficit");
    expect(model.endEtpDelta.value).toBe(10_000);
  });

  it("le coût non saisi dans la référence rend le gain n.d., sans masquer les sorties connues du projet", () => {
    const model = buildRestructuring(scenario("a", [departure(null)]), scenario("b", [departure()]));
    expect(month(model, "2026-10").referenceCost.value).toBeNull();
    expect(month(model, "2026-10").proposalCost.value).toBe(20_000);
    expect(month(model, "2026-10").transitionCost.value).toBeNull();
    expect(model.totals.savings.value).toBeNull(); expect(model.totals.exitCost.value).toBe(10_000);
  });

  it("un coût de sortie hors horizon reste hors calcul, avec un avertissement", () => {
    const late: Hypothesis = { ...departure(null), kind: "depart", lastPaidDate: "2027-01-31" } as Hypothesis;
    const model = buildRestructuring(scenario("a"), scenario("b", [late]));
    expect(model.totals.savings.value).toBe(0);
    expect(model.warnings.join(" ")).toContain("après l’horizon");
  });

  it("ne transforme pas le contrefactuel n.d. en économie connue après la sortie", () => {
    const snapshot = base(); snapshot.contracts[0].base = null; snapshot.contracts[0].baseNd = "Base fictive absente";
    const model = buildRestructuring(scenario("a", [], snapshot), scenario("b", [departure({ mode: "charge", costCents: 0 })], snapshot));
    expect(month(model, "2026-12").referenceCost.value).toBeNull();
    expect(month(model, "2026-12").proposalCost.value).toBe(0);
    expect(month(model, "2026-12").savings.value).toBeNull();
    expect(model.totals.savings.value).toBeNull(); expect(model.payback.month).toBeNull();
  });

  it("un ETP absent ne rend pas n.d. une paie connue, mais rend le delta de stock n.d.", () => {
    const snapshot = base(); snapshot.contracts[0].etp4 = null; snapshot.contracts[0].etpNd = "Quotité fictive absente";
    const model = buildRestructuring(scenario("a", [], snapshot), scenario("b", [], snapshot));
    expect(model.totals.referenceCost.value).toBe(30_000);
    expect(model.totals.savings.value).toBe(0);
    expect(month(model, "2026-12").referenceEtp4.value).toBeNull();
    expect(model.endEtpDelta.value).toBeNull();
  });

  it("rend n.d. un mois dépassant les entiers sûrs", () => {
    const snapshot = base(Number.MAX_SAFE_INTEGER);
    const model = buildRestructuring(scenario("a", [], snapshot), scenario("b", [oneOff("extra", "2026-10", 1)], snapshot));
    expect(month(model, "2026-10").proposalCost.value).toBeNull();
    expect(model.totals.proposalCost.value).toBeNull(); expect(model.totals.savings.value).toBeNull();
  });

  it("contrôle séparément les différences et cumuls débordants", () => {
    const snapshot = base(0), a = scenario("a", [oneOff("max", "2026-10", Number.MAX_SAFE_INTEGER)], snapshot);
    const b = scenario("b", [oneOff("negatif", "2026-10", -1)], snapshot);
    a.lastMonth = b.lastMonth = "2026-10";
    const model = buildRestructuring(a, b);
    expect(model.totals.referenceCost.value).toBe(Number.MAX_SAFE_INTEGER);
    expect(model.totals.proposalCost.value).toBe(-1);
    expect(month(model, "2026-10").savings.value).toBeNull();
    expect(month(model, "2026-10").transitionCost.value).toBeNull();
    expect(model.payback.month).toBeNull();
    const c = scenario("c", [], base(Number.MAX_SAFE_INTEGER)), d = scenario("d", [], c.base);
    const totals = buildRestructuring(c, d);
    expect(totals.totals.referenceCost.value).toBeNull(); expect(totals.totals.proposalCost.value).toBeNull();
    expect(totals.totals.savings.value).toBe(0);
    d.hypotheses = [{ id: "base-zero", kind: "base", label: "Base fictive nulle", contractKey: "contrat-fictif", salaryCents: 0, chargesBps: 0 }];
    const cumulative = buildRestructuring(c, d);
    expect(cumulative.months.map((entry) => entry.savings.value)).toEqual(Array(3).fill(Number.MAX_SAFE_INTEGER));
    expect(cumulative.months.map((entry) => entry.cumulative.value)).toEqual([Number.MAX_SAFE_INTEGER, null, null]);
    expect(cumulative.totals.savings.value).toBeNull(); expect(cumulative.payback.month).toBeNull();
  });

  it("refuse un agrégat devenu inexact après des contributions pourtant entières et un résultat final sûr", () => {
    const snapshot = base(Number.MAX_SAFE_INTEGER);
    snapshot.contracts.push({ ...snapshot.contracts[0], contractKey: "deuxieme-fictif", base: { salaryCents: 2, refBrutCents: 10_000, refCotisationsCents: 0 } });
    const a = scenario("a", [oneOff("annulation", "2026-10", -2)], snapshot), b = scenario("b", a.hypotheses, snapshot);
    a.lastMonth = b.lastMonth = "2026-10";
    const model = buildRestructuring(a, b);
    expect(month(model, "2026-10").referenceCost).toMatchObject({ value: null, reason: expect.stringContaining("incohérent") });
  });

  it("une projection refusée ou un montant fractionnaire ne produit pas de comparaison partielle", () => {
    const invalid: Hypothesis = { ...departure(), kind: "depart", contractKey: "inconnu" } as Hypothesis;
    expect(buildRestructuring(scenario("a"), scenario("b", [invalid]))).toMatchObject({ kind: "nd", months: [] });
    expect(buildRestructuring(scenario("a"), scenario("b", [oneOff("fraction", "2026-10", 0.5)]))).toMatchObject({ kind: "value", totals: { proposalCost: { value: null } } });
  });
});

describe("point mort sur l’horizon modélisé", () => {
  it("ne retient pas un point mort temporaire reperdu ensuite et accepte un horizon pluriannuel", () => {
    const a = scenario("a"), b = scenario("b", [departure({ mode: "charge", costCents: 0 }), oneOff("initial", "2026-10", 5_000), oneOff("second", "2026-12", 20_000)]);
    a.lastMonth = b.lastMonth = "2027-01";
    const model = buildRestructuring(a, b);
    expect(model.months.map((entry) => entry.cumulative.value)).toEqual([-5_000, 5_000, -5_000, 5_000]);
    expect(model.payback.month).toBe("2027-01");
  });

  it("considère l’équilibre exact durable comme le point mort, sans délai journalier inventé", () => {
    const model = buildRestructuring(scenario("a"), scenario("b", [departure({ mode: "charge", costCents: 20_000 })]));
    expect(model.months.map((entry) => entry.cumulative.value)).toEqual([-20_000, -10_000, 0]);
    expect(model.payback.month).toBe("2026-12");
    expect(Object.keys(model.payback)).toEqual(["month", "reason"]);
  });

  it("un déficit encore négatif à la fin signifie non atteint sur l’horizon, pas jamais atteint", () => {
    const model = buildRestructuring(scenario("a"), scenario("b", [departure({ mode: "charge", costCents: 30_000 })]));
    expect(model.payback.month).toBeNull(); expect(model.payback.reason).toContain("sur l’horizon comparé");
    expect(model.totals.savings.value).toBe(-10_000);
  });

  it("ne modifie ni les deux scénarios ni leurs bases et garde un résultat déterministe", () => {
    const a = scenario("a"), b = scenario("b", [departure(), hire()]);
    const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } };
    const before = JSON.stringify([a, b]); freeze(a); freeze(b);
    expect(buildRestructuring(a, b)).toEqual(buildRestructuring(a, b));
    expect(JSON.stringify([a, b])).toBe(before);
  });
});
