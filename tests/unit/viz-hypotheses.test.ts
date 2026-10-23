import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { landing as landingOf, project } from "@/lib/budget/engine";
import { formatEuros } from "@/lib/money";
import { measures as measuresOf, sensitivities, type Retraite, type SensitivityRow } from "@/lib/budget/lot3";
import { bridge, budgetSeries, scenarioSeries, shifted, type Bridge, type Layer as SeriesLayer, type Point, type Series } from "@/lib/budget/series";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseContract, BaseSnapshot, Hypothesis, ProjectedMonth, Projection } from "@/lib/budget/types";
import {
  affichageOf,
  bridgeWaterfall,
  comparisonSeries,
  costSeries,
  distinctColors,
  etpSeries,
  gapSeries,
  hasValues,
  headcountSeries,
  hiresByMonth,
  landingParts,
  landingWaterfall,
  layerSpans,
  measuresBars,
  monthAxis,
  natureChart,
  ndMonthsNote,
  ndReadings,
  readingStyle,
  retraiteWaterfall,
  sensitivityBars,
  showCharts,
  showTables,
  withAffichage,
  type RowIn,
} from "@/lib/viz/hypotheses";
import { ComparisonView } from "@/app/e/[slug]/studio-rh/hypotheses/ComparisonView";
import { EmbauchesView } from "@/app/e/[slug]/studio-rh/hypotheses/EmbauchesView";
import { LandingView, variantOptions } from "@/app/e/[slug]/studio-rh/hypotheses/LandingView";
import { ProjectionView } from "@/app/e/[slug]/studio-rh/hypotheses/ProjectionView";

// Adaptateurs « résultat du moteur → série de graphique » des écrans de résultat des hypothèses budgétaires :
// cas de référence écrits à la main (montants en centimes). Aucun adaptateur ne recalcule le moteur.

describe("affichage (Afficher tout / Graphique / Tableau)", () => {
  it("valeur inconnue ou absente : « tout » ; les trois valeurs connues passent", () => {
    expect(affichageOf("graphique")).toBe("graphique");
    expect(affichageOf("tableau")).toBe("tableau");
    expect(affichageOf("tout")).toBe("tout");
    expect(affichageOf(undefined)).toBe("tout");
    expect(affichageOf("")).toBe("tout");
    expect(affichageOf("n'importe quoi")).toBe("tout");
  });
  it("« tout » n'est pas écrit dans l'adresse ; les autres s'ajoutent avec le bon séparateur", () => {
    expect(withAffichage("/x?scenario=1", "tout")).toBe("/x?scenario=1");
    expect(withAffichage("/x?scenario=1&vue=embauches", "tableau")).toBe("/x?scenario=1&vue=embauches&affichage=tableau");
    expect(withAffichage("/x", "graphique")).toBe("/x?affichage=graphique");
  });
  it("graphiques masqués par « tableau », tableaux masqués par « graphique »", () => {
    expect([showCharts("tout"), showCharts("graphique"), showCharts("tableau")]).toEqual([true, true, false]);
    expect([showTables("tout"), showTables("graphique"), showTables("tableau")]).toEqual([true, false, true]);
  });
});

describe("axe des mois", () => {
  it("une seule année : « janv. », titres complets", () => {
    expect(monthAxis(["2026-01", "2026-02", "2026-08"])).toEqual({ categories: ["janv.", "févr.", "août"], titles: ["janvier 2026", "février 2026", "août 2026"] });
  });
  it("deux années : l'année sur deux chiffres suit le mois", () => {
    expect(monthAxis(["2026-11", "2026-12", "2027-01"]).categories).toEqual(["nov. 26", "déc. 26", "janv. 27"]);
  });
});

// Deux mois réels (le deuxième sans ETP), un mois projeté, un mois projeté n.d.
const rows: RowIn[] = [
  { month: "2026-08", layer: "reel", cost: 700000, headcount: 3, etp4: 25000, nd: null, etpNd: null },
  { month: "2026-09", layer: "reel", cost: 700000, headcount: 3, etp4: null, nd: null, etpNd: "quotité absente" },
  { month: "2026-10", layer: "projete", cost: 1065000, headcount: 3, etp4: 25000, nd: null, etpNd: null },
  { month: "2026-11", layer: "projete", cost: null, headcount: null, etp4: null, nd: "C : base n.d.", etpNd: null },
];

describe("projection : coût, effectif et ETP par mois", () => {
  it("coût : une série par origine, valeur seulement sur ses mois, « sans objet » ailleurs, raison du mois n.d.", () => {
    const [reel, projete] = costSeries(rows);
    expect(costSeries(rows).map((s) => s.key)).toEqual(["reel", "projete"]);
    expect(reel.values).toEqual([700000, 700000, null, null]);
    expect(reel.reasons).toEqual([null, null, "sans objet : mois projeté par ce scénario", "sans objet : mois projeté par ce scénario"]);
    expect(projete.values).toEqual([null, null, 1065000, null]);
    expect(projete.reasons).toEqual(["sans objet : mois réel (paie lue)", "sans objet : mois réel (paie lue)", null, "C : base n.d."]);
    // Un graphique en barres n'a ni pointillés ni aire.
    expect(reel).not.toHaveProperty("dashed");
  });
  it("une série « scénario parent » n'existe que si un mois en vient", () => {
    const withParent: RowIn[] = [{ month: "2026-07", layer: "parent", cost: 650000, headcount: 3, etp4: 24000, nd: null, etpNd: null }, ...rows];
    expect(costSeries(withParent).map((s) => s.key)).toEqual(["reel", "parent", "projete"]);
    expect(costSeries(withParent)[1].values).toEqual([650000, null, null, null, null]);
  });
  it("effectif : mois n.d. = raison du mois ; courbes : réel plein, projeté en pointillés avec aire", () => {
    const [reel, projete] = headcountSeries(rows);
    expect(reel.values).toEqual([3, 3, null, null]);
    expect(projete.values).toEqual([null, null, 3, null]);
    expect(projete.reasons?.[3]).toBe("C : base n.d.");
    expect([reel.dashed, reel.area, projete.dashed, projete.area]).toEqual([false, false, true, true]);
  });
  it("ETP : un ETP n.d. d'un mois valide garde sa raison, le mois n.d. garde celle du mois ; jamais zéro", () => {
    const [reel, projete] = etpSeries(rows);
    expect(reel.values).toEqual([25000, null, null, null]);
    expect(reel.reasons?.[1]).toBe("quotité absente");
    expect(projete.values).toEqual([null, null, 25000, null]);
    expect(projete.reasons?.[3]).toBe("C : base n.d.");
    expect(hasValues(etpSeries(rows))).toBe(true);
    expect(hasValues(etpSeries([rows[3]]))).toBe(false);
  });
  it("note des mois n.d. : raison suivie de ses mois", () => {
    expect(ndMonthsNote(rows)).toBe("C : base n.d. (2026-11)");
    expect(ndMonthsNote(rows.slice(0, 3))).toBeNull();
  });
});

// Mois construits à la main : octobre (valeur), novembre (n.d.), décembre (base seule).
const contrib = (kind: ProjectedMonth extends infer M ? (M extends { contributions: (infer C)[] } ? C extends { kind: infer K } ? K : never : never) : never, cost: number) =>
  ({ hypothesisId: null, kind, label: kind, contractKey: null, who: "X", service: null, brut: null, charges: null, cost }) as Extract<ProjectedMonth, { kind: "value" }>["contributions"][number];
const val = (month: string, contributions: ReturnType<typeof contrib>[]): ProjectedMonth => ({
  month, kind: "value", brut: null, charges: null, cost: contributions.reduce((s, c) => s + c.cost, 0), headcount: 3, etp4: 25000, etpNd: null, contributions,
});

describe("projection : coût par nature de contribution", () => {
  const months: ProjectedMonth[] = [
    val("2026-10", [contrib("base", 700000), contrib("base", 300000), contrib("augmentation", 30000), contrib("embauche", 250000), contrib("depart", -120000), contrib("fin-contrat", -5000), contrib("sortie", 50000)]),
    { month: "2026-11", kind: "nd", reasons: ["C : base n.d.", "D : base n.d."] },
    val("2026-12", [contrib("base", 1000000)]),
  ];
  const chart = natureChart(months);
  it("séries dans l'ordre des natures, seulement celles qui existent ; départ et fin de contrat connue réunis", () => {
    expect(chart.series.map((s) => s.key)).toEqual(["base", "augmentation", "embauche", "sortie", "depart"]);
    expect(chart.categories).toEqual(["oct.", "nov.", "déc."]);
    const at = (k: string) => chart.series.find((s) => s.key === k)!.values;
    expect(at("base")).toEqual([1000000, null, 1000000]);
    expect(at("augmentation")).toEqual([30000, null, 0]);
    expect(at("embauche")).toEqual([250000, null, 0]);
    expect(at("sortie")).toEqual([50000, null, 0]);
    expect(at("depart")).toEqual([-125000, null, 0]);
  });
  it("la somme des natures d'un mois égale son coût (1 205 000 puis 1 000 000) ; le mois n.d. n'a aucune valeur", () => {
    const sum = (c: number) => chart.series.reduce((s, x) => s + (x.values[c] ?? 0), 0);
    expect([sum(0), sum(2)]).toEqual([1205000, 1000000]);
    expect(chart.series.every((s) => s.values[1] === null)).toBe(true);
  });
  it("la raison du mois n.d. est portée par la première série, une seule fois", () => {
    expect(chart.series[0].reasons).toEqual([null, "C : base n.d. ; D : base n.d.", null]);
    expect(chart.series[1].reasons).toEqual([null, null, null]);
  });
  it("aucune contribution (tous les mois n.d.) : aucune série", () => {
    expect(natureChart([{ month: "2026-10", kind: "nd", reasons: ["x"] }]).series).toEqual([]);
  });
});

describe("teintes des natures de contribution", () => {
  it("une teinte déjà prise par une autre série présente est remplacée par la première teinte libre", () => {
    // Préférences : base 2, quotité 4, congé non payé 4 (déjà pris) → la première teinte libre est la 1.
    expect(distinctColors(["var(--chart-2)", "var(--chart-4)", "var(--chart-4)"])).toEqual(["var(--chart-2)", "var(--chart-4)", "var(--chart-1)"]);
    // Rien ne change quand les préférences sont distinctes.
    expect(distinctColors(["var(--chart-2)", "var(--chart-1)"])).toEqual(["var(--chart-2)", "var(--chart-1)"]);
    expect(distinctColors([])).toEqual([]);
  });
  it("les huit teintes sont prises : la teinte préférée se répète plutôt que de sortir de la charte", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`);
    expect(distinctColors([...eight, "var(--chart-3)"])).toEqual([...eight, "var(--chart-3)"]);
  });
  it("quotité et congé non payé présents ensemble : deux séries, deux teintes ; coûts de sortie et entrée après la base de même", () => {
    const m: ProjectedMonth[] = [val("2026-10", [contrib("base", 1000000), contrib("quotite", -20000), contrib("absence", -10000), contrib("sortie", 50000), contrib("entree", -30000)])];
    const c = natureChart(m);
    expect(c.series.map((s) => s.key)).toEqual(["base", "quotite", "sortie", "entree", "absence"]);
    const colors = c.series.map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
    // Les natures qui gardent leur teinte préférée : base 2, quotité 4, coûts de sortie 8.
    expect(colors.slice(0, 3)).toEqual(["var(--chart-2)", "var(--chart-4)", "var(--chart-8)"]);
  });
});

// Moteur réel : base de la suite budget.test.ts (A 3 000 + 1 200, B 2 000 + 900, C corrigé 2 500 + 1 050 → 10 650,00 € par mois).
const contract = (key: string, over: Partial<BaseContract>): BaseContract => ({
  contractKey: key, externalId: key, label: key, service: null, serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, base: null, baseNd: null, ...over,
});
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
const conv = { prorata: "calendaire" as const };
const fixC: Hypothesis = { id: "fixC", kind: "base", label: "Base de C", contractKey: "C", salaryCents: 250000, chargesBps: 4200 };
const hyps: Hypothesis[] = [
  fixC,
  { id: "g2", kind: "augmentation", label: "Générale 2 %", from: "2026-11", rateBps: 200, scope: { kind: "global" } },
  { id: "t3", kind: "augmentation", label: "TECH 3 %", from: "2026-11", rateBps: 300, scope: { kind: "service", service: "TECH" } },
  { id: "g1", kind: "augmentation", label: "Générale 1 %", from: "2026-12", rateBps: 100, scope: { kind: "global" } },
];
const projOf = (hs: Hypothesis[], last = "2026-12") => {
  const p = project(base, "2026-10", last, hs, conv);
  if (p.kind !== "value") throw new Error(p.errors.join(" ; "));
  return p;
};

describe("projection du moteur : natures de contribution", () => {
  it("octobre, novembre, décembre : base 10 650,00 € ; augmentations 290,50 € en novembre (A 126,00 + B 58,00 + C 106,50) puis 399,91 € en décembre", () => {
    const p = projOf(hyps);
    const c = natureChart(p.months);
    expect(c.series.map((s) => s.key)).toEqual(["base", "augmentation"]);
    expect(c.series[0].values).toEqual([1065000, 1065000, 1065000]);
    expect(c.series[1].values).toEqual([0, 29050, 39991]);
    // La somme des natures égale le coût que le moteur donne à chaque mois.
    p.months.forEach((m, i) => {
      if (m.kind === "value") expect(c.series.reduce((s, x) => s + (x.values[i] ?? 0), 0)).toBe(m.cost);
    });
  });
  it("départ de B le 20 novembre (20/30 de 2 900,00 € = 1 933,33 € payés) : −966,67 € en novembre, base de B retirée de décembre", () => {
    const dep: Hypothesis = { id: "dB", kind: "depart", label: "Départ de B", contractKey: "B", lastPaidDate: "2026-11-20", exitCost: null };
    const p = projOf([fixC, dep]);
    const c = natureChart(p.months);
    const at = (k: string) => c.series.find((s) => s.key === k)!.values;
    expect(at("depart")).toEqual([0, -96667, 0]);
    // Décembre : base de A (4 200,00 €) et de C (3 550,00 €) seulement ; B n'est plus présent.
    expect(at("base")).toEqual([1065000, 1065000, 775000]);
    p.months.forEach((m, i) => {
      if (m.kind === "value") expect(c.series.reduce((s, x) => s + (x.values[i] ?? 0), 0)).toBe(m.cost);
    });
  });
});

describe("embauches par mois de début", () => {
  const months = ["2026-10", "2026-11", "2026-12"];
  const data = hiresByMonth(
    [
      { start: "2026-10-01", group: "CDI" },
      { start: "2026-11-15", group: "CDI" },
      { start: "2026-11-01", group: "Apprenti" },
      { start: "2027-02-01", group: "CDI" },
    ],
    months,
  );
  it("groupes triés, nombre de postes par groupe et par mois, totaux par mois", () => {
    expect(data.groups).toEqual(["Apprenti", "CDI"]);
    expect(data.counts).toEqual([[0, 1, 0], [1, 1, 0]]);
    expect(data.totals).toEqual([1, 2, 0]);
  });
  it("un poste qui commence hors des mois affichés n'est pas tracé mais reste compté dans le total du groupe", () => {
    expect(data.outside).toBe(1);
    expect(data.groupTotals).toEqual([1, 3]);
  });
  it("une série par groupe, teinte stable par rang, valeurs entières", () => {
    expect(data.series).toEqual([
      { key: "g0", name: "Apprenti", color: "var(--chart-1)", values: [0, 1, 0] },
      { key: "g1", name: "CDI", color: "var(--chart-2)", values: [1, 1, 0] },
    ]);
  });
  it("tri français : « Édition » entre « Alpha » et « Zeta »", () => {
    expect(hiresByMonth([{ start: "2026-10-01", group: "Zeta" }, { start: "2026-10-01", group: "Édition" }, { start: "2026-10-01", group: "Alpha" }], months).groups).toEqual(["Alpha", "Édition", "Zeta"]);
  });
  it("aucun poste : aucun groupe", () => {
    expect(hiresByMonth([], months)).toMatchObject({ groups: [], series: [], outside: 0, totals: [0, 0, 0] });
  });
});

// Trois mois : le scénario (février n.d.), le réel courant (mars non couvert).
const pt = (month: string, cost: number): Point => ({ month, kind: "value", cost, etp4: null, etpNd: null, layer: "projete" });
const series = (key: string, label: string, points: Point[]): Series => ({ key, label, points: new Map(points.map((p) => [p.month, p])) });
const M3 = ["2026-01", "2026-02", "2026-03"];
const sc = series("sc-1", "Révisé T4", [pt("2026-01", 100000), { month: "2026-02", kind: "nd", reason: "paie non clôturée" }, pt("2026-03", 120000)]);
const reel = series("reel", "Réel courant", [pt("2026-01", 90000), pt("2026-02", 95000)]);

describe("comparaison : courbes et écarts mensuels", () => {
  it("courbes : valeur par mois, n.d. avec sa raison, mois non couvert nommé ; style par lecture", () => {
    const [p, r] = comparisonSeries(sc, [reel], M3);
    expect(p).toEqual({ key: "sc-1", name: "Révisé T4", values: [100000, null, 120000], reasons: [null, "paie non clôturée", null], color: "var(--chart-1)", dashed: false, area: true });
    expect(r).toEqual({ key: "reel", name: "Réel courant", values: [90000, 95000, null], reasons: [null, null, "mois non couvert par cette lecture"], color: "var(--chart-ink)", dashed: false, area: false });
  });
  it("écart = scénario − lecture comparée, seulement quand les deux mois ont une valeur ; la raison nomme la lecture absente", () => {
    const [g] = gapSeries(sc, [reel], M3);
    expect(g.name).toBe("Révisé T4 − Réel courant");
    expect(g.values).toEqual([10000, null, null]);
    expect(g.reasons).toEqual([null, "Révisé T4 : paie non clôturée", "Réel courant : mois non couvert par cette lecture"]);
  });
  it("note des mois sans valeur : une phrase par lecture, raison suivie de ses mois", () => {
    expect(ndReadings([sc, reel], M3)).toEqual(["Révisé T4 : paie non clôturée (2026-02)", "Réel courant : mois non couvert par cette lecture (2026-03)"]);
  });
  it("style : N-1 en pointillés, budget et scénario comparé en pointillés de teintes distinctes, repli par rang", () => {
    expect(readingStyle("n1", "sc", 1)).toEqual({ color: "var(--chart-2)", dashed: true, area: false });
    expect(readingStyle("budget-ab12cd34", "sc", 2)).toMatchObject({ color: "var(--chart-3)", dashed: true });
    expect(readingStyle("scenario-ab12cd34", "sc", 3)).toMatchObject({ color: "var(--chart-6)", dashed: true });
    expect(readingStyle("autre", "sc", 9)).toMatchObject({ color: "var(--chart-2)", dashed: true });
  });
  it("origine des mois d'un scénario : réel, puis projeté ; un mois sans valeur coupe la plage", () => {
    const at = (month: string, layer: SeriesLayer): Point => ({ month, kind: "value", cost: 100000, etp4: null, etpNd: null, layer });
    const s2 = series("s", "S", [at("2026-01", "reel"), at("2026-02", "reel"), { month: "2026-03", kind: "nd", reason: "x" }, at("2026-04", "projete"), at("2026-05", "projete")]);
    expect(layerSpans(s2, ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"])).toBe("réel janv.–févr. ; projeté avr.–mai");
    const s3 = series("s", "S", [at("2026-01", "reel"), { month: "2026-02", kind: "nd", reason: "x" }, at("2026-03", "reel")]);
    expect(layerSpans(s3, M3)).toBe("réel janv. ; réel mars");
    const s4 = series("s", "S", [at("2026-01", "projete-parent"), at("2026-02", "projete")]);
    expect(layerSpans(s4, M3)).toBe("projeté par le scénario parent janv. ; projeté févr.");
    expect(layerSpans(series("s", "S", []), M3)).toBe("");
  });
  it("N-1 décalé de 12 mois : le point de janvier 2027 est celui de janvier 2026", () => {
    const n1 = shifted(series("sc-1", "S", [pt("2026-01", 100000)]), 12, "n1", "N-1");
    expect(comparisonSeries(series("p", "P", []), [n1], ["2027-01"])[1].values).toEqual([100000]);
  });
});

describe("cascades : atterrissage, retraité, pont", () => {
  const months = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `2026-${String(a + i).padStart(2, "0")}`);
  it("réel janv.–sept. 63 000,00 € + projeté oct.–déc. 32 000,00 € = 95 000,00 €", () => {
    expect(landingWaterfall({ kind: "value", year: "2026", actual: 6300000, prior: 0, projected: 3200000, total: 9500000, actualMonths: months(1, 9), priorMonths: [], projectedMonths: months(10, 12) })).toEqual({
      kind: "value", startLabel: "Réel janv.–sept.", start: 6300000, steps: [{ label: "Projeté oct.–déc.", value: 3200000 }], endLabel: "Atterrissage 2026", end: 9500000,
    });
  });
  it("base dérivée : une étape de plus pour les mois projetés par le scénario parent", () => {
    const w = landingWaterfall({ kind: "value", year: "2026", actual: 4200000, prior: 2100000, projected: 3200000, total: 9500000, actualMonths: months(1, 6), priorMonths: months(7, 9), projectedMonths: months(10, 12) });
    expect(w).toMatchObject({ kind: "value", start: 4200000, steps: [{ label: "Projeté (parent)", value: 2100000 }, { label: "Projeté oct.–déc.", value: 3200000 }], end: 9500000 });
  });
  it("atterrissage n.d. : la raison ; composantes qui ne s'additionnent pas : n.d. ; une seule composante : pas de cascade", () => {
    expect(landingWaterfall({ kind: "nd", year: "2026", reason: "2026-11 : base n.d." })).toEqual({ kind: "nd", reason: "2026-11 : base n.d." });
    expect(landingWaterfall({ kind: "value", year: "2026", actual: 100, prior: 0, projected: 50, total: 999, actualMonths: ["2026-01"], priorMonths: [], projectedMonths: ["2026-02"] }).kind).toBe("nd");
    const only = landingWaterfall({ kind: "value", year: "2026", actual: 0, prior: 0, projected: 3195000, total: 3195000, actualMonths: [], priorMonths: [], projectedMonths: months(1, 12) });
    expect(only).toMatchObject({ kind: "vide", text: expect.stringContaining("entièrement projeté") });
  });
  it("atterrissage du moteur : réel 63 000,00 € + projeté 31 950,00 € (3 × 10 650,00 €) = 94 950,00 €", () => {
    const p = projOf([fixC]);
    const l = landingOf(base, p, "2026");
    expect(landingWaterfall(l)).toMatchObject({ kind: "value", start: 6300000, steps: [{ value: 3195000 }], end: 9495000 });
  });
  it("retraité : atterrissage 95 000,00 − 1 000,00 déjà comptabilisés − 500,00 prévus = 93 500,00 €", () => {
    const r: Retraite = { kind: "value", year: "2026", atterrissage: 9500000, rows: [], realised: 100000, projected: 50000, total: 150000, retraite: 9350000 };
    expect(retraiteWaterfall(r)).toEqual({
      kind: "value", startLabel: "Atterrissage 2026", start: 9500000, steps: [{ label: "Déjà comptabilisé", value: -100000 }, { label: "Prévu", value: -50000 }], endLabel: "Retraité 2026", end: 9350000,
    });
    expect(retraiteWaterfall({ ...r, realised: 0, projected: 50000, total: 50000, retraite: 9450000 })).toMatchObject({ steps: [{ label: "Prévu", value: -50000 }], end: 9450000 });
  });
  it("retraité sans élément non récurrent : pas de cascade, on le dit ; n.d. : la raison", () => {
    expect(retraiteWaterfall({ kind: "value", year: "2026", atterrissage: 100, rows: [], realised: 0, projected: 0, total: 0, retraite: 100 })).toMatchObject({ kind: "vide", text: expect.stringContaining("égale l'atterrissage") });
    expect(retraiteWaterfall({ kind: "nd", year: "2026", reason: "raison" })).toEqual({ kind: "nd", reason: "raison" });
  });
  it("pont : lecture comparée 10 000,00 € + volume 2 500,00 € + coût moyen 500,00 € = scénario 13 000,00 €", () => {
    // Scénario : 2 mois à 6 500,00 € pour 2,5 ETP (5,0 ETP-mois) ; lecture comparée : 2 mois à 5 000,00 € pour 2,0 ETP (4,0 ETP-mois).
    const withEtp = (k: string, l: string, cost: number, etp4: number) => series(k, l, ["2026-01", "2026-02"].map((m) => ({ ...pt(m, cost), etp4 })));
    const b = bridge(withEtp("s", "Scénario", 650000, 25000), withEtp("c", "Comparé", 500000, 20000), ["2026-01", "2026-02"]);
    expect(b).toMatchObject({ kind: "value", delta: 300000, volume: 250000, averageCost: 50000 });
    expect(bridgeWaterfall(b, "Scénario", "Comparé")).toEqual({
      kind: "value", startLabel: "Comparé", start: 1000000, steps: [{ label: "Effet volume", value: 250000 }, { label: "Effet coût moyen", value: 50000 }], endLabel: "Scénario", end: 1300000,
    });
    const nd: Bridge = { kind: "nd", reason: "ETP n.d." };
    expect(bridgeWaterfall(nd, "A", "B")).toEqual({ kind: "nd", reason: "ETP n.d." });
  });
});

describe("atterrissage : mesures et sensibilités", () => {
  const full = { kind: "value" as const, cents: 1 };
  const a = { id: "d1", label: "Départ A", who: "A", lastPaidDate: "2026-11-20", avoided: 800000, exit: 100000, replacement: 300000, replacementLabel: "Rempl", net: 400000, fullYear: full };
  const b = { id: "d2", label: "Départ B", who: "B", lastPaidDate: "2026-12-01", avoided: 500000, exit: 0, replacement: null, replacementLabel: null, net: 500000, fullYear: full };
  it("une série par effet ; économie nette = paie évitée − sortie − remplaçant (400 000 puis 500 000) ; sans remplaçant : pas de barre, raison", () => {
    const r = measuresBars({ kind: "value", year: "2026", rows: [a, b] });
    if (r.kind !== "value") throw new Error("attendu : value");
    expect(r.series.map((s) => s.key)).toEqual(["avoided", "exit", "replacement", "net"]);
    expect(r.categories).toEqual(["Départ A", "Départ B"]);
    expect(r.titles).toEqual(["Départ A · A", "Départ B · B"]);
    expect(r.series[3].values).toEqual([800000 - 100000 - 300000, 500000]);
    expect(r.series[2].values).toEqual([300000, null]);
    expect(r.series[2].reasons).toEqual([null, "sans remplaçant lié"]);
  });
  it("aucun remplaçant : la série « Coût du remplaçant » n'existe pas ; n.d. et liste vide se disent", () => {
    const r = measuresBars({ kind: "value", year: "2026", rows: [b] });
    expect(r.kind === "value" && r.series.map((s) => s.key)).toEqual(["avoided", "exit", "net"]);
    expect(measuresBars({ kind: "nd", year: "2026", reason: "mois n.d. : 2026-11" })).toEqual({ kind: "nd", reason: "mois n.d. : 2026-11" });
    expect(measuresBars({ kind: "value", year: "2026", rows: [] })).toMatchObject({ kind: "vide" });
  });
  it("sensibilités : numérotées comme le tableau, n.d. avec la raison, retraité n.d. distingué", () => {
    const v = { hypothesisId: "x", kind: "jours" as const, delta: 10 };
    const rows: SensitivityRow[] = [
      { variant: v, label: "Départ — décalage en jours +10", effect: { kind: "value", atterrissage: -20000, retraite: -20000, total: 9475000 } },
      { variant: v, label: "Embauche — décalage en jours +5", effect: { kind: "nd", reason: "variation refusée : arrivée antérieure à la bascule" } },
      { variant: v, label: "Ponctuel — variation du montant, en % +5", effect: { kind: "value", atterrissage: 5000, retraite: null, total: 9500000 } },
    ];
    const r = sensitivityBars(rows);
    if (r.kind !== "value") throw new Error("attendu : value");
    expect(r.categories).toEqual(["1", "2", "3"]);
    expect(r.titles[1]).toBe("Variation 2 : Embauche — décalage en jours +5");
    expect(r.series[0].values).toEqual([-20000, null, 5000]);
    expect(r.series[0].reasons).toEqual([null, "variation refusée : arrivée antérieure à la bascule", null]);
    expect(r.series[1].values).toEqual([-20000, null, null]);
    expect(r.series[1].reasons).toEqual([null, "variation refusée : arrivée antérieure à la bascule", "atterrissage retraité n.d. pour cette lecture"]);
    expect(sensitivityBars([])).toMatchObject({ kind: "vide" });
  });
});

// --- Écrans rendus côté serveur : les trois affichages, sans erreur, sans « NaN » ni « undefined », avec les repères attendus.
const scenario = { id: "11111111-1111-1111-1111-111111111111", name: "Révisé T4", kind: "revise", status: "brouillon", firstMonth: "2026-10", lastMonth: "2026-12" } as unknown as ScenarioRow;
const clean = (html: string) => {
  expect(html).not.toContain("NaN");
  expect(html).not.toContain("undefined");
  expect(html).not.toContain("[object");
  return html;
};

describe("ProjectionView rendue", () => {
  const proj = projOf(hyps);
  const render = (affichage?: string, p: Projection = proj, month = "") => clean(renderToStaticMarkup(h(ProjectionView, { slug: "demo", scenario, base, proj: p, landing: landingOf(base, p, "2026"), month, affichage })));
  it("tout : tuiles, lecture graphique (coût, effectif, ETP, nature) et tableaux", () => {
    const html = render();
    for (const id of ["proj-affichage", "proj-tile-landing", "proj-tile-horizon", "proj-tile-headcount", "proj-chart", "proj-chart-effectif", "proj-chart-etp", "proj-chart-nature", "proj-table", "proj-categories"]) expect(html).toContain(`data-testid="${id}"`);
    // Atterrissage : 63 000,00 + (10 650,00 + 10 940,50 + 11 049,91) ; les valeurs de tuile ne changent pas.
    expect(html).toContain("Coût projeté");
    expect(html).toContain("aria-current=\"page\"");
  });
  it("tableau par nature : mêmes montants que le graphique (base 10 650,00 € ; augmentations 0, 290,50 €, 399,91 €) et coût du mois du moteur en dernière ligne", () => {
    const html = render("tableau");
    expect(html).toContain('data-testid="proj-nature-table"');
    const row = (k: string) => html.slice(html.indexOf(`data-nature="${k}"`), html.indexOf("</tr>", html.indexOf(`data-nature="${k}"`)));
    for (const v of [1065000, 1065000, 1065000]) expect(row("base")).toContain(formatEuros(v));
    for (const v of [0, 29050, 39991]) expect(row("augmentation")).toContain(formatEuros(v));
    const foot = html.slice(html.indexOf('data-testid="proj-nature-total"'));
    for (const v of [1065000, 1094050, 1104991]) expect(foot.slice(0, 700)).toContain(formatEuros(v));
    // Les graphiques seuls n'ont pas ce tableau ; une projection n.d. n'a pas de nature à lister.
    expect(render("graphique")).not.toContain('data-testid="proj-nature-table"');
    expect(render("tableau", project(base, "2026-10", "2026-12", [], conv))).not.toContain('data-testid="proj-nature-table"');
  });
  it("graphique : pas de tableau ; tableau : pas de graphique ; la bascule garde l'affichage dans l'adresse", () => {
    const g = render("graphique");
    expect(g).toContain('data-testid="proj-chart"');
    expect(g).not.toContain('data-testid="proj-table"');
    expect(g).toContain("affichage=tableau");
    const t = render("tableau");
    expect(t).toContain('data-testid="proj-table"');
    expect(t).not.toContain('data-testid="proj-chart"');
    expect(t).toContain("&amp;affichage=tableau#proj-detail");
  });
  it("mois n.d. : colonne hachurée avec la raison, jamais un coût", () => {
    const ndProj = project(base, "2026-10", "2026-12", [], conv);
    const html = render("graphique", ndProj);
    expect(html).toContain('data-testid="proj-nd"');
    expect(html).toContain("C : base n.d.");
    expect(html).toContain("n.d.");
  });
  it("mois ouvert : conservé dans l'adresse de la bascule ; valeur d'adresse invalide ignorée", () => {
    expect(render(undefined, proj, "2026-11")).toContain("mois=2026-11");
    expect(render(undefined, proj, "x\"><script>")).not.toContain("<script>");
  });
  it("base dérivée : les mois projetés par le scénario parent forment leur propre série, avec la raison d'un ETP n.d.", () => {
    const prior = ["2026-07", "2026-08", "2026-09"].map((month) => ({ month, kind: "value" as const, cost: 650000, brut: null, charges: null, headcount: 3, etp4: null, etpNd: "quotité non reprise", source: "projeté — scénario « P »" }));
    const derived: BaseSnapshot = { ...base, actuals: base.actuals.slice(0, 6), prior };
    const p = project(derived, "2026-10", "2026-12", [fixC], conv);
    const html = clean(renderToStaticMarkup(h(ProjectionView, { slug: "demo", scenario, base: derived, proj: p, landing: landingOf(derived, p, "2026"), month: "", affichage: "graphique" })));
    expect(html).toContain("Projeté par le scénario parent");
    // Les 3 mois du parent (3 × 6 500,00 €) + 6 mois réels + 3 mois projetés = 12 colonnes de coût.
    expect(html).toContain("12 mois dont 6 projetés");
    expect(html).toContain("réel figé de la base ou projeté par le scénario parent");
    // Base non dérivée : la phrase ne parle pas d'un scénario parent.
    expect(render()).not.toContain("réel figé de la base ou projeté");
    expect(render()).toContain("réel figé de la base ;");
  });
  it("projection refusée : message d'erreur seul", () => {
    const html = render("graphique", { kind: "error", errors: ["« X » : refusé"] });
    expect(html).toContain('data-testid="proj-error"');
    expect(html).not.toContain('data-testid="proj-chart"');
  });
});

describe("ComparisonView rendue", () => {
  const proj = projOf(hyps);
  const principal = scenarioSeries("11111111-1111-1111-1111-111111111111", "Révisé T4", base, proj);
  const props = (affichage?: string) => ({
    hrefBase: "/e/demo/studio-rh/hypotheses", scenarioId: scenario.id, years: ["2026"], year: "2026", principal,
    compared: [shifted(principal, 12, "n1", "N-1"), budgetSeries("budget-aaaaaaaa", "Budget « B26 »", "2026", { "2026-01": 700000, "2026-02": null })],
    options: [{ value: "reel", label: "Réel courant" }, { value: "n1", label: "N-1" }], selected: ["n1", "budget:aaaaaaaa-0000"], refMonth: "2026-09", affichage,
  });
  const render = (affichage?: string) => clean(renderToStaticMarkup(h(ComparisonView, props(affichage))));
  it("tout : courbes, écarts par mois, tableaux et ponts ; budget non saisi = mois n.d. avec raison", () => {
    const html = render();
    for (const id of ["cmp-affichage", "cmp-form", "cmp-lecture", "cmp-chart", "cmp-chart-ecart", "cmp-table", "cmp-bridge"]) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain("montant du budget non saisi");
  });
  it("graphique : courbes seulement (les cases à cocher restent) ; tableau : tableaux seulement", () => {
    const g = render("graphique");
    expect(g).toContain('data-testid="cmp-chart"');
    expect(g).not.toContain('data-testid="cmp-table"');
    expect(g).toContain('name="affichage" value="graphique"');
    const t = render("tableau");
    expect(t).toContain('data-testid="cmp-table"');
    expect(t).not.toContain('data-testid="cmp-chart"');
    expect(t).toContain('data-testid="cmp-form"');
  });
  it("le trait du scénario dit l'origine de ses mois : 9 mois réels figés puis 3 mois projetés", () => {
    expect(render("graphique")).toContain("Origine des mois du scénario (trait plein bleu) : réel janv.–sept. ; projeté oct.–déc.");
  });
  it("la bascule conserve l'année et les lectures choisies (valeurs encodées)", () => {
    expect(render()).toContain("annee=2026&amp;cmp=n1&amp;cmp=budget%3Aaaaaaaaa-0000");
  });
  it("sans lecture comparée : la courbe du scénario seule, pas de graphique d'écart", () => {
    const html = clean(renderToStaticMarkup(h(ComparisonView, { ...props(), compared: [], selected: [] })));
    expect(html).toContain('data-testid="cmp-chart"');
    expect(html).not.toContain('data-testid="cmp-chart-ecart"');
  });
});

describe("LandingView rendue", () => {
  const dep: Hypothesis = { id: "dB", kind: "depart", label: "Départ de B", contractKey: "B", lastPaidDate: "2026-11-20", exitCost: { mode: "charge", costCents: 100000 }, motif: "Rupture conventionnelle" };
  const hs: Hypothesis[] = [fixC, dep];
  const props = (affichage?: string) => {
    const options = variantOptions(hs);
    const chosen = [{ value: options[0].value, delta: "5" }];
    const variants = [{ hypothesisId: "dB", kind: "jours" as const, delta: 5 }];
    const { reference, landing, rows } = sensitivities(base, "2026-10", "2026-12", hs, conv, "2026", variants);
    return { hrefBase: "/e/demo/studio-rh/hypotheses", scenarioId: scenario.id, year: "2026", landing, retraite: reference, measures: measuresOf(base, "2026-10", "2026-12", hs, conv, "2026"), sens: rows, options, chosen, affichage };
  };
  const render = (affichage?: string) => clean(renderToStaticMarkup(h(LandingView, props(affichage))));
  it("tout : cascades, graphiques des mesures et des sensibilités, et les trois tableaux", () => {
    const html = render();
    for (const id of ["atr-affichage", "atr-retraite", "atr-wf-atterrissage", "atr-wf-retraite", "atr-chart-mesures", "atr-chart-sens", "atr-nonrec", "atr-measures-table", "atr-sens-table", "atr-sens-form"]) expect(html).toContain(`data-testid="${id}"`);
  });
  it("graphique : plus de tableau, le formulaire de sensibilité reste ; tableau : plus de graphique", () => {
    const g = render("graphique");
    expect(g).toContain('data-testid="atr-wf-atterrissage"');
    expect(g).not.toContain('data-testid="atr-sens-table"');
    expect(g).toContain('data-testid="atr-sens-form"');
    expect(g).toContain('name="affichage" value="graphique"');
    const t = render("tableau");
    expect(t).toContain('data-testid="atr-sens-table"');
    expect(t).not.toContain('data-testid="atr-wf-atterrissage"');
    expect(t).not.toContain('data-testid="atr-chart-sens"');
  });
  it("la bascule conserve les variations choisies", () => {
    expect(render()).toMatch(/sv=dB%7Cjours&amp;sd=5/);
  });
  it("moteur : octobre 10 650,00 € + novembre 10 683,33 € (départ de B le 20, coûts de sortie 1 000,00 €) + décembre 7 750,00 € = 29 083,33 € projetés ; atterrissage 92 083,33 €", () => {
    const { landing, retraite } = props();
    expect(landing).toMatchObject({ kind: "value", actual: 6300000, projected: 2908333, total: 9208333 });
    expect(retraite).toMatchObject({ kind: "value", atterrissage: 9208333, realised: 0, projected: 100000, retraite: 9108333 });
    // Cascades : réel 63 000,00 € puis projeté 29 083,33 € ; atterrissage moins 1 000,00 € de coûts de sortie prévus.
    expect(landingWaterfall(landing)).toMatchObject({ kind: "value", start: 6300000, steps: [{ value: 2908333 }], end: 9208333 });
    if (landing.kind !== "value") throw new Error("attendu : value");
    expect(landingParts(landing)).toEqual([
      { label: "Réel janv.–sept.", value: 6300000, text: "réel" },
      { label: "Projeté oct.–déc.", value: 2908333, text: "projeté (aucun mois réel dans l'année)" },
    ]);
    // Le pied de la tuile d'atterrissage écrit les mêmes montants que la cascade : le tableau exact qui l'accompagne.
    expect(render()).toContain(`réel janv.–sept. ${formatEuros(6300000)} + projeté oct.–déc. ${formatEuros(2908333)}`);
    expect(retraiteWaterfall(retraite)).toMatchObject({ kind: "value", start: 9208333, steps: [{ label: "Prévu", value: -100000 }], end: 9108333 });
  });
  it("mesures : la note sur le coût du remplaçant n'apparaît que s'il existe un départ avec remplaçant lié", () => {
    const m = (replacement: number | null) => ({ id: "d", label: "Départ", who: "B", lastPaidDate: "2026-11-20", avoided: 800000, exit: 100000, replacement, replacementLabel: replacement === null ? null : "Rempl", net: 700000 - (replacement ?? 0), fullYear: { kind: "value" as const, cents: 1 } });
    const withRows = (rows: ReturnType<typeof m>[]) => clean(renderToStaticMarkup(h(LandingView, { ...props("graphique"), measures: { kind: "value" as const, year: "2026", rows } })));
    expect(withRows([m(300000), m(null)])).toContain("Départ sans remplaçant lié : pas de barre");
    expect(withRows([m(null)])).not.toContain("Départ sans remplaçant lié");
  });
  it("moteur : paie évitée de B 3 866,67 € (8 700,00 − 4 833,33), coûts de sortie 1 000,00 €, économie nette 2 866,67 €", () => {
    const bars = measuresBars(props().measures);
    if (bars.kind !== "value") throw new Error("attendu : value");
    expect(bars.series.map((s) => [s.key, s.values[0]])).toEqual([["avoided", 386667], ["exit", 100000], ["net", 286667]]);
  });
});

describe("EmbauchesView rendue", () => {
  const hire = (id: string, over: Partial<Extract<Hypothesis, { kind: "embauche" }>>): Hypothesis => ({
    id, kind: "embauche", label: `Poste ${id}`, service: "TECH", start: "2026-10-01", end: null, grossFullTimeCents: 300000, quotaBps: 10000, chargesBps: 4200, counted: true, category: "cdi", replaces: null, ...over,
  });
  // Deux postes dans l'horizon (CDI en octobre, CDD en novembre) et un stage qui commence en mars 2027 (hors des mois affichés).
  const hs = [hire("a", {}), hire("b", { start: "2026-11-01", category: "cdd" }), hire("c", { start: "2027-03-01", category: "stagiaire" })];
  const render = (over: { par?: string; affichage?: string; hypotheses?: Hypothesis[]; canEdit?: boolean } = {}) =>
    clean(renderToStaticMarkup(h(EmbauchesView, { slug: "demo", scenario, base, hypotheses: over.hypotheses ?? hs, canEdit: over.canEdit ?? false, par: over.par ?? "", affichage: over.affichage })));
  it("tout : graphique par mois, tableau exact par groupe avec total, liste des postes", () => {
    const html = render();
    for (const id of ["emb-affichage", "emb-chart", "emb-bars", "emb-group", "emb-by-month", "emb-list", "emb-table"]) expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain('data-group="CDI"');
    expect(html).toContain("Embauches prévisionnelles");
    // Le stage de mars 2027 n'est pas dans les mois mais il est compté dans le total ; la note le dit.
    expect(html).toContain("commence hors des mois affichés");
  });
  it("regroupement : catégorie par défaut ; métier et motif n.d. avec leur raison quand aucun poste ne les renseigne", () => {
    const html = render();
    expect(html).toContain('aria-current="true" data-group-by="categorie"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("aucun poste n&#x27;a de métier renseigné");
    expect(html).toContain("aucun poste n&#x27;a de motif d&#x27;embauche renseigné");
    expect(html).toContain('data-testid="emb-group-nd"');
  });
  it("métier renseigné sur un poste : le regroupement par métier est proposé (lien), le poste sans métier forme « Non renseigné »", () => {
    const html = render({ par: "metier", hypotheses: [hire("a", { metier: "Développeur" }), hire("b", { start: "2026-11-01" })] });
    expect(html).toContain('aria-current="true" data-group-by="metier"');
    expect(html).not.toContain("aucun poste n&#x27;a de métier renseigné");
    expect(html).toContain('data-group="Développeur"');
    expect(html).toContain('data-group="Non renseigné"');
  });
  it("graphique : pas de liste ni de formulaire ; tableau : pas de graphique, la liste reste", () => {
    const g = render({ affichage: "graphique", canEdit: true });
    expect(g).toContain('data-testid="emb-bars"');
    expect(g).not.toContain('data-testid="emb-list"');
    expect(g).toContain("&amp;affichage=graphique");
    const t = render({ affichage: "tableau" });
    expect(t).toContain('data-testid="emb-list"');
    expect(t).not.toContain('data-testid="emb-bars"');
    expect(t).not.toContain('data-testid="emb-by-month"');
  });
  it("plus de huit groupes : la répétition des teintes est dite sous le graphique ; huit au plus : rien", () => {
    const many = Array.from({ length: 9 }, (_, i) => hire(`s${i}`, { service: `Service ${i}` }));
    expect(render({ par: "service", hypotheses: many })).toContain("Plus de huit groupes");
    expect(render({ par: "service", hypotheses: many.slice(0, 8) })).not.toContain("Plus de huit groupes");
  });
  it("aucun poste : on le dit, sans graphique ; la liste classe les postes par date d'arrivée", () => {
    const none = render({ hypotheses: [] });
    expect(none).toContain("Aucune embauche prévisionnelle.");
    expect(none).not.toContain('data-testid="emb-bars"');
    const sorted = render({ affichage: "tableau", hypotheses: [hire("z", { start: "2026-12-01" }), hire("a", { start: "2026-10-01" })] });
    expect(sorted.indexOf('data-hyp="Poste a"')).toBeLessThan(sorted.indexOf('data-hyp="Poste z"'));
  });
});
