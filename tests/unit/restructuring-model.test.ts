import { describe, expect, it } from "vitest";
import { buildRestructuring, nonRecurringBreakdown, type BreakdownId, type RestructuringModel, type RestructuringScenario } from "@/lib/restructuring/model";
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

describe("détail des éléments non récurrents déjà compris dans le projet", () => {
  const detail = (input: RestructuringScenario | null, id: BreakdownId) => nonRecurringBreakdown(input).find((row) => row.id === id)!;
  const departureFor = (id: string, contractKey: string, motif: string | undefined, costCents: number | null, date = "2026-10-31"): Hypothesis => ({
    id, kind: "depart", label: "Libellé fictif sans effet sur le classement", contractKey, lastPaidDate: date, motif,
    exitCost: costCents === null ? null : { mode: "charge", costCents },
  });
  const withContracts = (count: number, salaryCents = 10_000): BaseSnapshot => {
    const snapshot = base(salaryCents);
    snapshot.contracts = Array.from({ length: count }, (_, i) => ({ ...snapshot.contracts[0], contractKey: `fictif-${i}`, externalId: `fictif-${i}` }));
    return snapshot;
  };

  it("retourne les quatre catégories n.d. sans scénario, puis refuse les projections invalides sans faux zéros", () => {
    const rows = nonRecurringBreakdown(null);
    expect(rows.map((row) => row.id)).toEqual(["licenciement", "rupture-conventionnelle", "autres-departs", "autres-non-recurrents"]);
    expect(rows.every((row) => row.total.value === null && row.months.length === 0 && row.events === 0)).toBe(true);
    const invalid = scenario("b", [departureFor("inconnu", "absent", "Licenciement", 100)]);
    const refused = nonRecurringBreakdown(invalid);
    expect(refused.every((row) => row.total.value === null && row.months.length === 3 && row.months.every((month) => month.amount.value === null))).toBe(true);
    expect(detail(invalid, "licenciement").events).toBe(1);
  });

  it("classe seulement le motif normalisé et reprend les charges exactes du moteur une fois", () => {
    const snapshot = withContracts(4);
    const rc: Hypothesis = { ...departureFor("rc", "fictif-1", "  RUPTURE   CONVENTIONNELLE individuelle  ", 0), kind: "depart", exitCost: { mode: "brut", brutCents: 10_001, chargesBps: 2_500 } } as Hypothesis;
    const misleading: Hypothesis = { ...departureFor("autre-2", "fictif-3", undefined, 7_000), label: "Licenciement — rupture conventionnelle" };
    const input = scenario("b", [departureFor("lic", "fictif-0", " LÍCENCIEMENT économique ", 10_000), rc, departureFor("autre-1", "fictif-2", "Démission", 5_000), misleading], snapshot);
    const rows = nonRecurringBreakdown(input);
    expect(rows.map((row) => [row.id, row.events, row.total.value])).toEqual([
      ["licenciement", 1, 10_000], ["rupture-conventionnelle", 1, 12_501], ["autres-departs", 2, 12_000], ["autres-non-recurrents", 0, 0],
    ]);
    expect(rows.every((row) => row.months.map((month) => month.month).join(",") === "2026-10,2026-11,2026-12")).toBe(true);
    expect(detail(input, "rupture-conventionnelle").months.map((month) => month.amount.value)).toEqual([12_501, 0, 0]);
    expect(rows.reduce((total, row) => total + row.total.value!, 0)).toBe(buildRestructuring(scenario("a", [], snapshot), input).totals.transitionCost.value);
  });

  it("un coût absent rend seulement sa catégorie et son mois n.d., tandis qu’un zéro explicite reste un zéro", () => {
    const snapshot = withContracts(2);
    const input = scenario("b", [departureFor("lic", "fictif-0", "Licenciement", null), departureFor("rc", "fictif-1", "Rupture conventionnelle", 0)], snapshot);
    const unknown = detail(input, "licenciement"), zero = detail(input, "rupture-conventionnelle");
    expect(unknown.events).toBe(1); expect(unknown.months[0].amount).toMatchObject({ value: null, reason: expect.stringContaining("exitCost") });
    expect(unknown.months.slice(1).map((month) => month.amount.value)).toEqual([0, 0]); expect(unknown.total.value).toBeNull();
    expect(zero.events).toBe(1); expect(zero.total.value).toBe(0); expect(zero.months.every((month) => month.amount.value === 0)).toBe(true);
    expect(detail(input, "autres-non-recurrents").total.value).toBe(0);
  });

  it("compte le tuilage, le ponctuel et l’enveloppe par hypothèse distincte, sans doubler les coûts de sortie ni les économies", () => {
    const env: Hypothesis = { id: "enveloppe-fictive", kind: "enveloppe", label: "Enveloppe fictive", axis: "service", target: "SERVICE", monthly: { "2026-10": 200, "2026-11": 300 }, chargesBps: 2_500, nonRecurring: true };
    const dep: Hypothesis = { ...departure(), kind: "depart", motif: "Licenciement" } as Hypothesis;
    const input = scenario("b", [dep, hire({ start: "2026-10-16", grossFullTimeCents: 6_200 }), oneOff("ponctuel", "2026-10", 100), env, oneOff("zero", "2026-10", 0), oneOff("recurrent", "2026-10", 1_000, false)]);
    const rows = nonRecurringBreakdown(input), other = detail(input, "autres-non-recurrents");
    // Tuilage 3 200 + ponctuel 100 + enveloppe chargée 250 + 375 = 3 925 centimes.
    expect(other.events).toBe(3); expect(other.total.value).toBe(3_925);
    expect(other.months.map((month) => month.amount.value)).toEqual([3_550, 375, 0]);
    const model = buildRestructuring(scenario("a"), input);
    expect(rows.reduce((total, row) => total + row.total.value!, 0)).toBe(13_925);
    expect(model.totals.transitionCost.value).toBe(13_925);
    expect(model.totals.proposalCost.value).toBe(37_325);
    expect(model.totals.savings.value).toBe(-7_325);
    expect(model.totals.referenceCost.value! - model.totals.proposalCost.value!).toBe(model.totals.savings.value);
  });

  it("propage un mois n.d. du moteur aux quatre catégories sans transformer l’absence de contribution en zéro", () => {
    const snapshot = base(); snapshot.contracts[0].base = null;
    const input = scenario("b", [{ ...departure(), kind: "depart", motif: "Licenciement" } as Hypothesis], snapshot);
    const rows = nonRecurringBreakdown(input);
    expect(rows.every((row) => row.months[0].amount.value === null && row.total.value === null)).toBe(true);
    expect(rows.every((row) => row.months.slice(1).every((month) => month.amount.value === 0))).toBe(true);
    expect(detail(input, "licenciement").events).toBe(1);
  });

  it("borne les sommes catégorielles sur plusieurs mois sans arrondi flottant ni total partiel", () => {
    const snapshot = withContracts(2, 0);
    const input = scenario("b", [departureFor("lic-1", "fictif-0", "Licenciement", Number.MAX_SAFE_INTEGER), departureFor("lic-2", "fictif-1", "Licenciement", Number.MAX_SAFE_INTEGER, "2026-11-30")], snapshot);
    const row = detail(input, "licenciement");
    expect(row.events).toBe(2); expect(row.months.map((month) => month.amount.value)).toEqual([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0]);
    expect(row.total).toMatchObject({ value: null, reason: expect.stringContaining("entiers sûrs") });
    expect(detail(input, "autres-departs").total.value).toBe(0);
    const invalid = scenario("b", [oneOff("fraction", "2026-10", 0.5)]);
    expect(nonRecurringBreakdown(invalid).every((entry) => entry.months[0].amount.value === null && entry.total.value === null)).toBe(true);
  });

  it("ne compte pas les départs hors horizon et ne devine pas une catégorie depuis une abréviation", () => {
    const snapshot = withContracts(2);
    const input = scenario("b", [departureFor("tardif", "fictif-0", "Licenciement", null, "2027-01-31"), departureFor("rc-abrege", "fictif-1", "RC", 50)], snapshot);
    expect(detail(input, "licenciement").events).toBe(0); expect(detail(input, "licenciement").total.value).toBe(0);
    expect(detail(input, "rupture-conventionnelle").events).toBe(0);
    expect(detail(input, "autres-departs").total.value).toBe(50);
  });

  it("conserve les remboursements non récurrents et ne compte pas une hypothèse à montant nul comme coût effectif", () => {
    const input = scenario("b", [oneOff("credit", "2026-10", -100), oneOff("nul", "2026-11", 0)]);
    const row = detail(input, "autres-non-recurrents");
    expect(row.events).toBe(1); expect(row.total.value).toBe(-100);
    expect(row.months.map((month) => month.amount.value)).toEqual([-100, 0, 0]);
  });

  it("laisse le scénario intact et retourne un résultat déterministe", () => {
    const input = scenario("b", [departure(), hire()]);
    const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } };
    const before = JSON.stringify(input); freeze(input);
    expect(nonRecurringBreakdown(input)).toEqual(nonRecurringBreakdown(input));
    expect(JSON.stringify(input)).toBe(before);
  });
});
