import { describe, expect, it } from "vitest";
import { project } from "@/lib/budget/engine";
import { cascadePersons, etpCascade, masseByRubric } from "@/lib/budget/cascade";
import { monthsOfYear, scenarioVersion, type MonthFacts, type Version } from "@/lib/budget/versions";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";

// Analyse des écarts — cascade d'ETP et contributions par rubrique : cas écrits à la main.
const ver = (label: string, year: string, presence: Record<string, Record<string, number>>): Version => {
  const months = new Map<string, MonthFacts>();
  for (const m of monthsOfYear(year, "01", "12")) {
    const map = Object.fromEntries(Object.entries(presence).filter(([, byMonth]) => byMonth[m] !== undefined).map(([k, byMonth]) => [k, byMonth[m]]));
    months.set(m, { month: m, people: { kind: "value", map } } as unknown as MonthFacts);
  }
  return { key: label, label, kind: "scenario", year, months };
};
const span = (year: string, from: number, to: number, etp4: number) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [`${year}-${String(from + i).padStart(2, "0")}`, etp4]));

describe("cascade d'ETP entre 2025 et 2026 (12 mois)", () => {
  // P1 : toute l'année à 1 ETP, les deux années. P2 : entré en juillet 2025 (6 mois), plein en 2026. P3 : nouveau en octobre 2026 à 0,8.
  // P4 : présent de janvier à mars 2025 seulement. P5 : présent toute 2025, parti fin août 2026 (8 mois). P6 : 0,5 en 2025, 1 en 2026.
  const a = ver("2025", "2025", { P1: span("2025", 1, 12, 10000), P2: span("2025", 7, 12, 10000), P4: span("2025", 1, 3, 10000), P5: span("2025", 1, 12, 10000), P6: span("2025", 1, 12, 5000) });
  const b = ver("2026", "2026", { P1: span("2026", 1, 12, 10000), P2: span("2026", 1, 12, 10000), P3: span("2026", 10, 12, 8000), P5: span("2026", 1, 8, 10000), P6: span("2026", 1, 12, 10000) });
  const c = etpCascade(a, b, monthsOfYear("2025", "01", "12"), monthsOfYear("2026", "01", "12"));
  it("ETP moyen 3,25 → 3,87 : entrées nouvelles +0,20, effet report +0,50, sorties −0,25, effet déport −0,33, changement d'ETP +0,50 ; résiduel nul", () => {
    if (c.kind !== "value") throw new Error(c.reason);
    // A : (120 000 + 60 000 + 30 000 + 120 000 + 60 000) ÷ 12 = 32 500 ; B : (120 000 + 120 000 + 24 000 + 80 000 + 120 000) ÷ 12 = 38 666,67 → 38 667.
    expect(c.start).toBe(32500);
    expect(c.end).toBe(38667);
    expect(c.steps.map((s) => [s.id, s.etp4])).toEqual([["entrees-new", 2000], ["entrees-report", 5000], ["sorties", -2500], ["sorties-deport", -3333], ["etp-change", 5000]]);
    expect(c.steps.reduce((s, x) => s + x.etp4, 0)).toBe(c.end - c.start);
    expect(c.residual).toBe(0);
  });
  it("chaque contribution se rattache à ses salariés", () => {
    if (c.kind !== "value") throw new Error(c.reason);
    const who = Object.fromEntries(c.steps.map((s) => [s.id, s.people]));
    expect(who["entrees-new"]).toEqual([{ key: "P3", etp4: 2000 }]);
    expect(who["entrees-report"]).toEqual([{ key: "P2", etp4: 5000 }]);
    expect(who.sorties).toEqual([{ key: "P4", etp4: -2500 }]);
    expect(who["sorties-deport"]).toEqual([{ key: "P5", etp4: -3333 }]);
    expect(who["etp-change"]).toEqual([{ key: "P6", etp4: 5000 }]);
  });
  it("sous-période (juillet à décembre) : P4 et P2 se lisent sur les mois choisis", () => {
    const s = etpCascade(a, b, monthsOfYear("2025", "07", "12"), monthsOfYear("2026", "07", "12"));
    if (s.kind !== "value") throw new Error(s.reason);
    // A (6 mois) : P1 60 000 + P2 60 000 + P5 60 000 + P6 30 000 = 210 000 ÷ 6 = 35 000. B : P1 60 000 + P2 60 000 + P3 24 000 + P5 20 000 (juillet-août) + P6 60 000 = 224 000 ÷ 6 = 37 333,33.
    expect(s.start).toBe(35000);
    expect(s.end).toBe(37333);
    expect(s.steps.reduce((x, y) => x + y.etp4, 0)).toBe(s.end - s.start);
    expect(s.residual).toBe(0);
  });
  it("personnes distinctes de chaque palier (seuil de confidentialité) : contrats reliés par le lien, un contrat non relié compté à part, une embauche prévue comptée à part", () => {
    if (c.kind !== "value") throw new Error(c.reason);
    // Lien contrat → personne : P1 et P6 sont deux contrats d'une même personne « a » ; P5 n'est relié à personne (il ne protège jamais).
    const link = new Map([["P1", "a"], ["P6", "a"], ["P2", "b"], ["P3", "c"], ["P4", "d"]]);
    expect(cascadePersons(c, link)).toEqual([
      { persons: ["c"], unlinked: 0, hires: 0 }, // entrées nouvelles : P3
      { persons: ["b"], unlinked: 0, hires: 0 }, // effet report : P2
      { persons: ["d"], unlinked: 0, hires: 0 }, // sorties : P4
      { persons: [], unlinked: 1, hires: 0 }, // effet déport : P5, non relié
      { persons: ["a"], unlinked: 0, hires: 0 }, // changement d'ETP : P6 (même personne que P1)
    ]);
    expect(cascadePersons(c, new Map())).toEqual(Array(5).fill({ persons: [], unlinked: 1, hires: 0 })); // sans lien : rien n'est dénombré
    // Une embauche prévue d'un scénario (clé « embauche:… » du moteur de projection) ne décrit personne de réel : ni reliée ni non reliée,
    // comptée à part. Ici deux embauches à 0,5 d'octobre à décembre 2026 s'ajoutent à P3 dans les entrées nouvelles : +0,45 au lieu de +0,20.
    const b2 = ver("2026", "2026", { P1: span("2026", 1, 12, 10000), P2: span("2026", 1, 12, 10000), P3: span("2026", 10, 12, 8000), P5: span("2026", 1, 8, 10000), P6: span("2026", 1, 12, 10000), "embauche:h1": span("2026", 10, 12, 5000), "embauche:h2": span("2026", 10, 12, 5000) });
    const c2 = etpCascade(a, b2, monthsOfYear("2025", "01", "12"), monthsOfYear("2026", "01", "12"));
    if (c2.kind !== "value") throw new Error(c2.reason);
    expect(c2.steps[0].etp4).toBe(4500); // (24 000 + 15 000 + 15 000) ÷ 12 = 4 500
    expect(cascadePersons(c2, link)[0]).toEqual({ persons: ["c"], unlinked: 0, hires: 2 });
    expect(cascadePersons(c2, new Map())[0]).toEqual({ persons: [], unlinked: 1, hires: 2 }); // P3 non relié ; les embauches restent à part
  });
  it("un mois n.d. d'une version rend l'analyse n.d. (composition jamais supposée) ; périodes de longueur différente refusées", () => {
    const bad = ver("2026", "2026", { P1: span("2026", 1, 12, 10000) });
    bad.months.set("2026-05", { month: "2026-05", people: { kind: "nd", reason: "2 contrats sans quotité" } } as unknown as MonthFacts);
    expect(etpCascade(a, bad, monthsOfYear("2025", "01", "12"), monthsOfYear("2026", "01", "12"))).toEqual({ kind: "nd", reason: "2026, 2026-05 : 2 contrats sans quotité" });
    expect(etpCascade(a, b, monthsOfYear("2025", "01", "06"), monthsOfYear("2026", "01", "12")).kind).toBe("nd");
  });
});

describe("contributions de la masse salariale par rubrique", () => {
  const contract = (key: string, over: Partial<BaseContract>): BaseContract => ({ contractKey: key, externalId: key, label: key, service: "TECH", serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, base: { salaryCents: 300000, refBrutCents: 300000, refCotisationsCents: 120000 }, baseNd: null, ...over });
  const base: BaseSnapshot = { currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05", contracts: [contract("A", {})], actuals: [], refMasse: 420000, refBaseCost: 420000, etpNote: null };
  const build = (hyps: Hypothesis[]) => scenarioVersion("v", "Révisé", "2026", base, project(base, "2026-10", "2026-12", hyps, { prorata: "calendaire" }), null, null, null);
  it("prime de décembre 1 000 € brut + 30 % : écart de 1 300,00 € = primes +1 000 + charges +300, résiduel nul", () => {
    const r = masseByRubric(build([]), build([{ id: "p", kind: "ponctuel", label: "Prime", month: "2026-12", amount: { mode: "brut", brutCents: 100000, chargesBps: 3000 }, service: null }]), monthsOfYear("2026", "10", "12"), monthsOfYear("2026", "10", "12"));
    if (r.kind !== "value") throw new Error(r.reason);
    expect(r.start).toBe(3 * 420000);
    expect(r.end).toBe(3 * 420000 + 130000);
    expect(Object.fromEntries(r.steps.map((s) => [s.key, s.delta]))).toEqual({ remun: 0, primes: 100000, indemnites: 0, autres: 0, charges: 30000, nonventile: 0 });
    expect(r.residual).toBe(0);
  });
  it("réel figé sans ventilation : chaque rubrique est n.d. avec sa raison, l'écart total reste affiché et le résiduel porte tout l'écart non expliqué", () => {
    const frozen = (brut: number) => scenarioVersion("v", "Révisé", "2026", { ...base, actuals: [{ month: "2026-09", kind: "value", brut, cotisations: 120000, masse: brut + 120000, headcount: 1, etp4: 10000, etpNd: null }] }, project(base, "2026-10", "2026-12", [], { prorata: "calendaire" }), null, null, null);
    const r = masseByRubric(frozen(300000), frozen(310000), ["2026-09"], ["2026-09"]);
    if (r.kind !== "value") throw new Error(r.reason);
    expect([r.start, r.end, r.residual]).toEqual([420000, 430000, 10000]);
    expect(r.steps.find((s) => s.key === "remun")).toMatchObject({ delta: null, reason: "Révisé : 2026-09 : journal de paie courant indisponible" });
    expect(r.steps.find((s) => s.key === "charges")).toMatchObject({ delta: 0, reason: null });
  });
});
