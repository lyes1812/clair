import { describe, expect, it } from "vitest";
import { buildFinanceProjection, emptyFinanceSettings, FinanceError, MAX_FINANCE_CENTS, parseFinanceSettings } from "@/lib/finance/plans";
import type { FinanceActuals, FinanceCell, FinanceMonth, FinancePlan, FinanceSettings } from "@/lib/finance/types";

const ID = "11111111-1111-4111-8111-111111111111";
const RH = "22222222-2222-4222-8222-222222222222";
const cell = (cents: number | null, reason: string | null = null): FinanceCell => ({ cents, reason });
const plan = (over: Partial<FinancePlan> = {}): FinancePlan => ({
  id: ID, name: "Budget fictif", kind: "budget", year: 2026, currency: "EUR", firstForecastMonth: null,
  cells: { "2026-01": { revenue: 100000, "other-income": 10000, personnel: 30000, "other-expenses": 20000 } },
  personnelSource: "manual", rhScenarioId: null, updatedAt: "2026-01-01T12:00:00.000Z", ...over,
});
const settings = (over: Partial<FinanceSettings> = {}): FinanceSettings => ({ ...emptyFinanceSettings(), plans: [plan()], ...over });
const actual = (month: string, incomplete = false): FinanceMonth => ({
  month, lineCount: 5,
  cells: { revenue: cell(90000), "other-income": cell(0), personnel: cell(20000), "other-expenses": incomplete ? cell(null, "Compte fictif sans montant") : cell(10000) },
  result: incomplete ? cell(null, "Réel incomplet") : cell(60000),
});
const actuals = (...months: FinanceMonth[]): FinanceActuals => ({ months, accounts: [] });

describe("validation des plans financiers", () => {
  it("vide sans montants inventés ; copies indépendantes du réglage et de l'entrée", () => {
    expect(emptyFinanceSettings()).toEqual({ version: 1, revision: 0, mappings: [], plans: [] });
    const input = settings();
    const parsed = parseFinanceSettings(input)!;
    parsed.plans[0].cells["2026-01"].revenue = 1;
    expect(input.plans[0].cells["2026-01"].revenue).toBe(100000);
    expect(emptyFinanceSettings().plans).toEqual([]);
  });
  it("bornes exactes des comptes et montants ; compte ou identifiant de plan dupliqué refusé", () => {
    const mappings = Array.from({ length: 256 }, (_, i) => ({ account: `6${i}`, row: "other-expenses" as const }));
    expect(parseFinanceSettings(settings({ mappings }))).not.toBeNull();
    expect(parseFinanceSettings(settings({ mappings: [...mappings, { account: "7999", row: "revenue" }] }))).toBeNull();
    expect(parseFinanceSettings(settings({ mappings: [mappings[0], mappings[0]] }))).toBeNull();
    for (const account of ["501", "801", "6-01", "6" + "a".repeat(20), " 601"]) expect(parseFinanceSettings(settings({ mappings: [{ account, row: "revenue" }] }))).toBeNull();
    expect(parseFinanceSettings(settings({ mappings: [{ account: "7A12", row: "revenue" }] }))).not.toBeNull();
    expect(parseFinanceSettings(settings({ plans: [plan(), plan({ id: ID.toUpperCase() })] }))).toBeNull();
    for (const amount of [MAX_FINANCE_CENTS, -MAX_FINANCE_CENTS, 0]) expect(parseFinanceSettings(settings({ plans: [plan({ cells: { "2026-01": { revenue: amount } } })] }))).not.toBeNull();
    for (const amount of [MAX_FINANCE_CENTS + 1, -MAX_FINANCE_CENTS - 1, Number.NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1]) expect(parseFinanceSettings(settings({ plans: [plan({ cells: { "2026-01": { revenue: amount } } })] }))).toBeNull();
  });
  it("refuse les clés inconnues à chaque étage, les mauvais types et les mois hors de l'année", () => {
    const input = settings();
    for (const bad of [null, [], { ...input, hidden: 1 }, { ...input, version: 2 }, { ...input, revision: -1 }, { ...input, revision: 1.5 },
      { ...input, mappings: [{ account: "601", row: "revenue", label: "extra" }] },
      { ...input, plans: [{ ...plan(), extra: true }] },
      { ...input, plans: [plan({ cells: { "2026-01": { revenue: 1, unknown: 2 } } as FinancePlan["cells"] })] },
      { ...input, plans: [plan({ cells: { "2025-12": { revenue: 1 } } })] },
      { ...input, plans: [plan({ cells: { "2026-13": { revenue: 1 } } })] },
    ]) expect(parseFinanceSettings(bad)).toBeNull();
  });
  it("au plus douze plans, devise EUR, noms et années bornés, UUID et date de modification valides", () => {
    const plans = Array.from({ length: 12 }, (_, i) => plan({ id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111` }));
    expect(parseFinanceSettings(settings({ plans }))).not.toBeNull();
    expect(parseFinanceSettings(settings({ plans: [...plans, plan({ id: RH })] }))).toBeNull();
    for (const over of [{ id: "not-uuid" }, { name: " " }, { name: "x".repeat(121) }, { year: 1999 }, { year: 2101 }, { currency: "USD" }, { updatedAt: "invalid" }]) {
      expect(parseFinanceSettings(settings({ plans: [{ ...plan(), ...over } as FinancePlan] }))).toBeNull();
    }
    expect(parseFinanceSettings(settings({ plans: [plan({ name: "x".repeat(120), year: 2000, cells: {} })] }))).not.toBeNull();
    expect(parseFinanceSettings(settings({ plans: [plan({ year: 2100, cells: {} })] }))).not.toBeNull();
  });
  it("impose une bascule explicite dans l'année et une référence RH uniquement avec la source RH", () => {
    for (const over of [{ firstForecastMonth: "2026-10" }, { kind: "forecast", firstForecastMonth: null }, { kind: "forecast", firstForecastMonth: "2027-01" }, { personnelSource: "rh", rhScenarioId: null }, { personnelSource: "manual", rhScenarioId: RH }, { personnelSource: "rh", rhScenarioId: "invalid" }]) {
      expect(parseFinanceSettings(settings({ plans: [{ ...plan(), ...over } as FinancePlan] }))).toBeNull();
    }
    expect(parseFinanceSettings(settings({ plans: [plan({ kind: "forecast", firstForecastMonth: "2026-10", personnelSource: "rh", rhScenarioId: RH })] }))).not.toBeNull();
  });
});

describe("projection financière exacte et origine de chaque mois", () => {
  it("budget : hypothèses sur douze mois, résultat 100000+10000−30000−20000=60000 ; un mois absent reste n.d.", () => {
    const output = buildFinanceProjection(actuals(actual("2026-01")), plan(), []);
    expect(output).toHaveLength(12);
    expect(output[0]).toMatchObject({ month: "2026-01", origin: "plan", personnelOrigin: "manual", result: cell(60000), cells: { revenue: cell(100000) } });
    expect(output[1].cells.revenue.cents).toBeNull();
    expect(output[1].result.cents).toBeNull();
    expect(output[1].cells.revenue.reason).toBeTruthy();
  });
  it("forecast : le passé partiel ou absent reste réel n.d. ; la bascule explicite applique le plan même si du réel existe après", () => {
    const input = plan({ kind: "forecast", firstForecastMonth: "2026-10", cells: {
      "2026-09": { revenue: 777, "other-income": 777, personnel: 777, "other-expenses": 777 },
      "2026-10": { revenue: 100000, "other-income": 10000, personnel: 30000, "other-expenses": 20000 },
    } });
    const source = actuals(actual("2026-01"), actual("2026-09", true), actual("2026-10"));
    const before = JSON.stringify({ source, input });
    const output = buildFinanceProjection(source, input, []);
    expect(output[0]).toMatchObject({ origin: "actual", personnelOrigin: "accounting", result: cell(60000) });
    expect(output[8]).toMatchObject({ origin: "actual", cells: { revenue: cell(90000), "other-expenses": cell(null, "Compte fictif sans montant") }, result: cell(null, "Réel incomplet") });
    expect(output[1]).toMatchObject({ origin: "actual", lineCount: 0, cells: { revenue: { cents: null } } });
    expect(output[9]).toMatchObject({ origin: "plan", result: cell(60000), cells: { revenue: cell(100000) } });
    expect(JSON.stringify({ source, input })).toBe(before);
  });
  it("RH : remplace seulement le personnel des mois de plan ; conserve revenu et réel, y compris un personnel réel incomplet", () => {
    const input = plan({ kind: "forecast", firstForecastMonth: "2026-10", personnelSource: "rh", rhScenarioId: RH,
      cells: { "2026-10": { revenue: 100000, "other-income": 10000, personnel: 99999, "other-expenses": 20000 } } });
    const september = actual("2026-09");
    september.cells.personnel = cell(null, "Personnel réel incomplet");
    const output = buildFinanceProjection(actuals(september), input, [{ month: "2026-09", cell: cell(1) }, { month: "2026-10", cell: cell(12345) }]);
    expect(output[8].cells.personnel).toEqual(cell(null, "Personnel réel incomplet"));
    expect(output[8].personnelOrigin).toBe("accounting");
    expect(output[9]).toMatchObject({ origin: "plan", personnelOrigin: "rh", cells: { revenue: cell(100000), personnel: cell(12345) }, result: cell(77655) });
    const budget = buildFinanceProjection(actuals(), plan({ personnelSource: "rh", rhScenarioId: RH }), [{ month: "2026-01", cell: cell(12345) }]);
    expect(budget[0].cells.personnel).toEqual(cell(12345));
  });
  it("RH manquant, doublonné ou invalide : n.d. sans reprendre un nom de contrat ni revenir à la valeur manuelle", () => {
    const input = plan({ personnelSource: "rh", rhScenarioId: RH });
    const outputs = [
      buildFinanceProjection(actuals(), input, []),
      buildFinanceProjection(actuals(), input, [{ month: "2026-01", cell: cell(null, "Contrat FICTIF_PERSONNEL : base manquante") }]),
      buildFinanceProjection(actuals(), input, [{ month: "2026-01", cell: cell(1) }, { month: "2026-01", cell: cell(2) }]),
      buildFinanceProjection(actuals(), input, [{ month: "2026-01", cell: cell(Infinity) }]),
    ];
    for (const output of outputs) {
      expect(output[0].cells.personnel).toEqual(cell(null, "Projection RH indisponible pour ce mois."));
      expect(output[0].result.cents).toBeNull();
      expect(JSON.stringify(output)).not.toContain("FICTIF_PERSONNEL");
    }
  });
  it("un zéro saisi reste un zéro ; aucun arrondi des centimes, et plan invalide refusé", () => {
    const output = buildFinanceProjection(actuals(), plan({ cells: { "2026-01": { revenue: 101, "other-income": 0, personnel: 1, "other-expenses": 0 } } }), []);
    expect(output[0].result).toEqual(cell(100));
    expect(output[0].cells["other-income"]).toEqual(cell(0));
    expect(() => buildFinanceProjection(actuals(), plan({ firstForecastMonth: "2026-10" }), [])).toThrow(FinanceError);
  });
});
