import { ComparisonPicker } from "@/app/e/[slug]/studio-rh/hypotheses/ComparisonPicker";
import { ActualNonRecurringStatus, type ActualStatusItem } from "@/app/e/[slug]/studio-rh/hypotheses/LandingView";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/db/workspace-scope", () => ({ withWorkspace: () => { throw new Error("Accès base interdit dans ce test fictif"); } }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: () => { throw new Error("Accès utilisateur interdit dans ce test fictif"); } }));
vi.mock("@/lib/connectors/sync", () => ({ lastSync: () => { throw new Error("Lecture source interdite dans ce test fictif"); }, activeSync: () => { throw new Error("Lecture source interdite dans ce test fictif"); } }));
import { landing as landingOf, project } from "@/lib/budget/engine";
import { GLOSSARY, glossaryEntry } from "@/lib/glossary";
import { GLOSSARY_HYPOTHESES, HYP_TERMS } from "@/lib/glossary/hypotheses";
import { formatMoneyDisplay } from "@/lib/money-display";

describe("Atterrissage — statut générique des coûts passés", () => {
  it("garde chaque élément visible sans montant et expose tous les blocages sans identité ni note libre", () => {
    const status = { amountMissing: true, sourceMismatch: false, monthUnavailable: false, legacyOverlap: false };
    const items: ActualStatusItem[] = [
      { ...status, kind: "rupture-conventionnelle", month: "2026-01", sourceMismatch: true },
      { ...status, kind: "tuilage", month: "2026-03" },
      { ...status, kind: "tuilage", month: "2026-06", legacyOverlap: true },
    ];
    const enriched = items.map((item) => ({ ...item, contractKeys: ["IDENTITE_FICTIVE_PRIVEE"], note: "JUSTIFICATIF_FICTIF_PRIVE", chargedCents: 123456 }));
    const html = renderToStaticMarkup(h(ActualNonRecurringStatus, { items: enriched }));
    expect(html.match(/<li /g)).toHaveLength(3);
    expect(html).toContain("Rupture conventionnelle · Janvier 2026");
    expect(html).toContain("Tuilage · Mars 2026");
    expect(html).toContain("Tuilage · Juin 2026");
    expect(html.match(/montant chargé à renseigner/g)).toHaveLength(3);
    expect(html).toContain("lecture différente de la base figée");
    expect(html).toContain("rapprochement nécessaire");
    expect(html).not.toMatch(/IDENTITE_FICTIVE_PRIVEE|JUSTIFICATIF_FICTIF_PRIVE|123456/);
  });
  it("ne promet aucun inventaire en l’absence de déclaration et distingue le montant renseigné", () => {
    expect(renderToStaticMarkup(h(ActualNonRecurringStatus, { items: [] }))).toBe("");
    const html = renderToStaticMarkup(h(ActualNonRecurringStatus, { items: [{ kind: "autre", month: "2026-02", amountMissing: false, sourceMismatch: false, monthUnavailable: false, legacyOverlap: false }] }));
    expect(html).toContain("montant chargé renseigné");
    expect(html).not.toContain("n.d.");
  });
});
const displayEuros = (cents: number) => formatMoneyDisplay(cents, "eur");
import { measures as measuresOf, sensitivities, type Retraite, type SensitivityRow } from "@/lib/budget/lot3";
import { bridge, budgetSeries, scenarioSeries, shifted, type Bridge, type Layer as SeriesLayer, type Point, type Series } from "@/lib/budget/series";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseContract, BaseSnapshot, Hypothesis, ProjectedMonth, Projection } from "@/lib/budget/types";
import {
  affichageOf,
  bridgeWaterfall,
  comparisonSeries,
  contributionsChart,
  costSeries,
  distinctColors,
  etpSeries,
  frDates,
  gapSeries,
  groupColor,
  hasNd,
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
  NATURES,
  retraiteWaterfall,
  savingTone,
  sensitivityBars,
  showCharts,
  showTables,
  slugOf,
  TONE_ORDER,
  withAffichage,
  yearSpan,
  type RowIn,
} from "@/lib/viz/hypotheses";
import { ComparisonView } from "@/app/e/[slug]/studio-rh/hypotheses/ComparisonView";
import { EmbauchesView } from "@/app/e/[slug]/studio-rh/hypotheses/EmbauchesView";
import { ACTUAL_SHOWN, LandingView, variantOptions } from "@/app/e/[slug]/studio-rh/hypotheses/LandingView";
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

describe("formats de dates", () => {
  it("jour ISO → jj/mm/aaaa, mois ISO → « novembre 2026 », plage de mois comprise", () => {
    expect(frDates("entré le 2026-09-16 : mois de référence incomplet")).toBe("entré le 16/09/2026 : mois de référence incomplet");
    expect(frDates("C : base n.d. (2026-01 → 2026-12)")).toBe("C : base n.d. (janvier 2026 → décembre 2026)");
    expect(frDates("du 2026-11-16 au 2026-12-31, puis 2027-01")).toBe("du 16/11/2026 au 31/12/2026, puis janvier 2027");
  });
  it("« de » devant avril, août ou octobre s'élide ; devant les autres mois, il reste", () => {
    expect(frDates("paie de 2026-04 non clôturée")).toBe("paie d'avril 2026 non clôturée");
    expect(frDates("salaire de 2026-08 nul")).toBe("salaire d'août 2026 nul");
    expect(frDates("De 2026-10 à 2026-11")).toBe("D'octobre 2026 à novembre 2026");
    expect(frDates("paie de 2026-11 et de 2026-03")).toBe("paie de novembre 2026 et de mars 2026");
    // Un jour reste un jour : « de 12/10/2026 », pas d'élision.
    expect(frDates("départ de 2026-10-12")).toBe("départ de 12/10/2026");
  });
  it("ce qui ressemble à une date sans en être une reste intact (mois ou jour hors calendrier, identifiant, numéro accolé)", () => {
    expect(frDates("2026-13")).toBe("2026-13");
    expect(frDates("2026-11-45")).toBe("2026-11-45");
    expect(frDates("2026-02-31")).toBe("2026-02-31");
    expect(frDates("2028-02-29")).toBe("29/02/2028");
    expect(frDates("contrat C-2026-11 et ref2026-11")).toBe("contrat C-2026-11 et ref2026-11");
    expect(frDates("aucune date ici")).toBe("aucune date ici");
  });
  it("années couvertes : une seule, ou première–dernière", () => {
    expect(yearSpan(["2026-10", "2026-11", "2026-12"])).toBe("2026");
    expect(yearSpan(["2026-11", "2026-12", "2027-01"])).toBe("2026–2027");
    expect(yearSpan([])).toBe("");
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
    // Un seul format de date à l'écran : le mois s'écrit « novembre 2026 », jamais « 2026-11 ».
    expect(ndMonthsNote(rows)).toBe("C : base n.d. (novembre 2026)");
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
  it("contributing : vrai seulement quand le moteur a au moins une contribution de cette nature ce mois-là (jamais le mois n.d.)", () => {
    // Séries : base, augmentation, embauche, sortie, départ ; mois : octobre, novembre (n.d.), décembre (base seule).
    expect(chart.contributing).toEqual([
      [true, false, true],
      [true, false, false],
      [true, false, false],
      [true, false, false],
      [true, false, false],
    ]);
  });
  it("une date ISO dans la raison d'un mois n.d. s'écrit en français", () => {
    const m: ProjectedMonth[] = [{ month: "2026-10", kind: "nd", reasons: ["C : entré le 2026-09-16"] }, val("2026-11", [contrib("base", 100)])];
    expect(natureChart(m).series[0].reasons).toEqual(["C : entré le 16/09/2026", null]);
  });
});

describe("contributions seules (sans la base)", () => {
  const months: ProjectedMonth[] = [
    val("2026-10", [contrib("base", 700000), contrib("base", 300000), contrib("augmentation", 30000), contrib("embauche", 250000), contrib("depart", -120000), contrib("fin-contrat", -5000), contrib("sortie", 50000)]),
    { month: "2026-11", kind: "nd", reasons: ["C : base n.d.", "D : base n.d."] },
    val("2026-12", [contrib("base", 1000000)]),
  ];
  const full = natureChart(months);
  const only = contributionsChart(full);
  it("seule la base est retirée : mêmes séries, mêmes teintes, mêmes valeurs du moteur (centimes)", () => {
    expect(only.series.map((s) => s.key)).toEqual(["augmentation", "embauche", "sortie", "depart"]);
    expect(only.series.map((s) => s.color)).toEqual(full.series.slice(1).map((s) => s.color));
    expect(only.series.map((s) => s.values)).toEqual([[30000, null, 0], [250000, null, 0], [50000, null, 0], [-125000, null, 0]]);
    expect(only.categories).toEqual(["oct.", "nov.", "déc."]);
    expect(only.titles).toEqual(["octobre 2026", "novembre 2026", "décembre 2026"]);
  });
  it("base + contributions = coût du mois du moteur : 1 000 000 + (30 000 + 250 000 + 50 000 − 125 000) = 1 205 000", () => {
    const at = (c: number) => full.series.find((s) => s.key === "base")!.values[c]! + only.series.reduce((t, s) => t + (s.values[c] ?? 0), 0);
    expect([at(0), at(2)]).toEqual([1205000, 1000000]);
  });
  it("la raison du mois n.d., portée par la base dans le graphique complet, passe à la première série restante (la colonne reste hachurée avec sa raison)", () => {
    expect(only.series[0].reasons).toEqual([null, "C : base n.d. ; D : base n.d.", null]);
    expect(only.series[1].reasons).toEqual([null, null, null]);
    expect(only.series.every((s) => s.values[1] === null)).toBe(true);
  });
  it("le tableau « — » reste aligné sur les séries restantes", () => {
    expect(only.contributing).toEqual([[true, false, false], [true, false, false], [true, false, false], [true, false, false]]);
  });
  it("base seule : aucune série, on le dit à l'écran plutôt que de tracer une échelle vide", () => {
    expect(contributionsChart(natureChart([val("2026-10", [contrib("base", 100)])])).series).toEqual([]);
    expect(contributionsChart(natureChart([{ month: "2026-10", kind: "nd", reasons: ["x"] }])).series).toEqual([]);
  });
  it("moteur : augmentations 0 (aucune contribution), 290,50 € puis 399,91 € ; base 10 650,00 € écartée", () => {
    const c = contributionsChart(natureChart(projOf(hyps).months));
    expect(c.series.map((s) => [s.key, s.values])).toEqual([["augmentation", [0, 29050, 39991]]]);
    expect(c.contributing).toEqual([[false, true, true]]);
  });
});

// Clarté relative des huit teintes, relue dans charts.css (la source de la palette) : cas de référence des tests de teintes.
const CSS = readFileSync("src/styles/charts.css", "utf8");
const hexOf = (n: number | string) => new RegExp(`--chart-${n}:\\s*#([0-9a-fA-F]{6})`).exec(CSS)?.[1] ?? "";
const luminance = (hex: string) => {
  const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const tintNo = (c: string) => Number(/--chart-(\d)/.exec(c)![1]);
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(hexOf(tintNo(a))), luminance(hexOf(tintNo(b)))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe("teintes des natures de contribution", () => {
  it("une teinte déjà prise est remplacée par la teinte libre la plus éloignée en clarté de ses voisines (la plus claire si la voisine est foncée)", () => {
    // Rangs de clarté (du plus sombre au plus clair) : 2, 4, 5, 1, 7, 3, 6, 8. La 4 (bleu foncé) est prise deux fois : voisine = la 4,
    // la teinte libre la plus éloignée est la 8 (la plus claire).
    expect(distinctColors(["var(--chart-2)", "var(--chart-4)", "var(--chart-4)"])).toEqual(["var(--chart-2)", "var(--chart-4)", "var(--chart-8)"]);
    // Voisines des deux côtés (2 devant, 8 derrière) : écarts de rang 1→(3, 4), 7→(4, 3) : les teintes 1 et 7 sont à égalité (min 3), la première gagne.
    expect(distinctColors(["var(--chart-2)", "var(--chart-2)", "var(--chart-8)"])).toEqual(["var(--chart-2)", "var(--chart-1)", "var(--chart-8)"]);
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
    // Base 2, quotité 8, coûts de sortie 5 et congé non payé 7 gardent leur teinte préférée ; l'entrée (8 déjà pris par la quotité) passe
    // à la 6 : entre ses voisines (5 devant, 7 derrière), c'est la teinte libre la plus éloignée en clarté.
    expect(colors).toEqual(["var(--chart-2)", "var(--chart-8)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)"]);
  });
  it("toutes les teintes sont des var(--chart-N) de la charte : jamais une couleur écrite en dur", () => {
    for (const n of NATURES) expect(n.color).toMatch(/^var\(--chart-[1-8]\)$/);
    for (let i = 0; i < 20; i++) expect(groupColor(i)).toMatch(/^var\(--chart-[1-8]\)$/);
  });
  it("la palette de charts.css : huit teintes, rangées de la plus sombre à la plus claire dans cet ordre (garde TONE_ORDER exact)", () => {
    const byLight = [1, 2, 3, 4, 5, 6, 7, 8].sort((a, b) => luminance(hexOf(a)) - luminance(hexOf(b)));
    expect(byLight).toEqual(TONE_ORDER);
    // Cas écrits à la main : le noir pur est à 0, le blanc pur à 1 ; la 2 (navy) est la plus sombre, la 8 la plus claire.
    expect(luminance("000000")).toBe(0);
    expect(luminance("ffffff")).toBeCloseTo(1, 10);
    expect(TONE_ORDER[0]).toBe(2);
    expect(TONE_ORDER.at(-1)).toBe(8);
  });
  it("natures les plus fréquentes (base, augmentations, embauches, éléments ponctuels, coûts de sortie) : deux voisines de la pile ont au moins 2,9:1 de clarté", () => {
    const color = (k: string) => NATURES.find((n) => n.key === k)!.color;
    const chain = ["base", "augmentation", "embauche", "ponctuel", "sortie"];
    for (let i = 1; i < chain.length; i++) expect(contrast(color(chain[i - 1]), color(chain[i])), `${chain[i - 1]} / ${chain[i]}`).toBeGreaterThanOrEqual(2.9);
    // Les natures positives sont toutes distinctes (la pile ne répète une teinte qu'entre natures rares, de part et d'autre de l'axe).
    const positives = ["base", "augmentation", "quotite", "embauche", "ponctuel", "enveloppe", "sortie"].map(color);
    expect(new Set(positives).size).toBe(positives.length);
  });
  it("groupes d'embauches : les six premiers groupes voisins ont au moins 2,9:1 de clarté, la suite recommence après huit", () => {
    for (let i = 1; i < 6; i++) expect(contrast(groupColor(i - 1), groupColor(i)), `groupes ${i - 1} / ${i}`).toBeGreaterThanOrEqual(2.9);
    expect(groupColor(0)).toBe("var(--chart-1)");
    expect(groupColor(8)).toBe(groupColor(0));
    expect(new Set(Array.from({ length: 8 }, (_, i) => groupColor(i))).size).toBe(8);
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
    expect(r).toEqual({ key: "reel", name: "Réel courant", values: [90000, 95000, null], reasons: [null, null, "mois non couvert par cette lecture"], color: "var(--chart-2)", dashed: false, area: false });
  });
  it("écart = scénario − lecture comparée, seulement quand les deux mois ont une valeur ; la raison nomme la lecture absente", () => {
    const [g] = gapSeries(sc, [reel], M3);
    expect(g.name).toBe("Révisé T4 − Réel courant");
    expect(g.values).toEqual([10000, null, null]);
    expect(g.reasons).toEqual([null, "Révisé T4 : paie non clôturée", "Réel courant : mois non couvert par cette lecture"]);
  });
  it("note des mois sans valeur : une phrase par lecture, raison suivie de ses mois", () => {
    expect(ndReadings([sc, reel], M3)).toEqual(["Révisé T4 : paie non clôturée (février 2026)", "Réel courant : mois non couvert par cette lecture (mars 2026)"]);
  });
  it("style : N-1 gris-bleu, budget saisi bleu clair, scénario comparé bleu foncé, tous en pointillés ; repli par rang parmi les teintes lisibles en trait fin", () => {
    expect(readingStyle("n1", "sc", 1)).toEqual({ color: "var(--chart-7)", dashed: true, area: false });
    expect(readingStyle("budget-ab12cd34", "sc", 2)).toMatchObject({ color: "var(--chart-3)", dashed: true });
    expect(readingStyle("scenario-ab12cd34", "sc", 3)).toMatchObject({ color: "var(--chart-4)", dashed: true });
    // Repli : rang 9 → quatrième teinte de repli par modulo (9 mod 4 = 1) → la 7.
    expect(readingStyle("autre", "sc", 9)).toMatchObject({ color: "var(--chart-7)", dashed: true });
  });
  it("deux budgets comparés ne partagent pas leur teinte (la courbe et la barre d'écart d'une même lecture gardent la même)", () => {
    const b1 = series("budget-aa", "Budget A", [pt("2026-01", 90000)]);
    const b2 = series("budget-bb", "Budget B", [pt("2026-01", 95000)]);
    expect(comparisonSeries(sc, [b1, b2], M3).map((x) => x.color)).toEqual(["var(--chart-1)", "var(--chart-3)", "var(--chart-4)"]);
    expect(gapSeries(sc, [b1, b2], M3).map((x) => x.color)).toEqual(["var(--chart-3)", "var(--chart-4)"]);
  });
  it("une courbe fine reste lisible : toute teinte de lecture a au moins 3:1 sur fond blanc (ni la 6 ni la 8, trop pâles)", () => {
    const onWhite = (c: string) => 1.05 / (luminance(hexOf(tintNo(c))) + 0.05);
    const all = [sc, reel, series("n1", "N-1", []), series("budget-a", "B", []), series("scenario-a", "S", []), ...Array.from({ length: 8 }, (_, i) => series(`x${i}`, "X", []))];
    for (const [i, r] of all.entries()) {
      const color = readingStyle(r.key, "sc-1", i).color;
      expect(onWhite(color), `${r.key} ${color}`).toBeGreaterThanOrEqual(3);
    }
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
  // Les cellules gardent un span monétaire : assertions ci-dessous sur le texte visible et la classe de tendance.
  return html.replace(/<span class="money-display"[^>]*>([^<]*)<\/span>/g, "$1");
};

describe("ProjectionView rendue", () => {
  const proj = projOf(hyps);
  const render = (affichage?: string, p: Projection = proj, month = "") => clean(renderToStaticMarkup(h(ProjectionView, { slug: "demo", scenario, base, proj: p, landing: landingOf(base, p, "2026"), month, affichage })));
  it("tout : tuiles, lecture graphique (coût, effectif, ETP, nature) et tableaux", () => {
    const html = render();
    for (const id of ["proj-affichage", "proj-tile-landing", "proj-tile-horizon", "proj-tile-headcount", "proj-chart", "proj-chart-effectif", "proj-chart-etp", "proj-chart-nature", "proj-table", "proj-categories"]) expect(html).toContain(`data-testid="${id}"`);
    // Atterrissage : 63 000,00 + (10 650,00 + 10 940,50 + 11 049,91) ; les valeurs de tuile ne changent pas.
    expect(html).toContain("Coût projeté");
    expect(html).toContain('data-view="tout" selected=""');
  });
  it("tableau par nature : mêmes montants que le graphique (base 10 650,00 € ; augmentations 0, 290,50 €, 399,91 €) et coût du mois du moteur en dernière ligne", () => {
    const html = render("tableau");
    expect(html).toContain('data-testid="proj-nature-table"');
    const row = (k: string) => html.slice(html.indexOf(`data-nature="${k}"`), html.indexOf("</tr>", html.indexOf(`data-nature="${k}"`)));
    for (const v of [1065000, 1065000, 1065000]) expect(row("base")).toContain(displayEuros(v));
    // Octobre : aucune augmentation n'existe encore, le tableau écrit « — » (et non 0,00 €) avec sa raison au survol.
    for (const v of [29050, 39991]) expect(row("augmentation")).toContain(displayEuros(v));
    expect(row("augmentation")).not.toContain(`>${displayEuros(0)}</td>`);
    expect(row("augmentation")).toContain('title="aucune contribution de cette nature ce mois-là">—</td>');
    const foot = html.slice(html.indexOf('data-testid="proj-nature-total"'));
    for (const v of [1065000, 1094050, 1104991]) expect(foot.slice(0, 700)).toContain(displayEuros(v));
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
  it("second graphique « Contributions seules » sous celui par nature : sans la base, mêmes natures ; absent de l'affichage Tableau", () => {
    const g = render("graphique");
    expect(g.indexOf('data-testid="proj-chart-nature"')).toBeGreaterThan(-1);
    expect(g.indexOf('data-testid="proj-chart-contributions"')).toBeGreaterThan(g.indexOf('data-testid="proj-chart-nature"'));
    expect(g).toContain("<h2>Contributions hors base</h2>");
    expect(g).toContain("octobre 2026 → décembre 2026 · €");
    expect(render("tableau")).not.toContain('data-testid="proj-chart-contributions"');
    // Base seule (aucune hypothèse de contribution) : pas de graphique, une phrase.
    const none = render("graphique", projOf([fixC]));
    expect(none).not.toContain('data-testid="proj-chart-contributions"');
    expect(none).toContain('data-testid="proj-chart-contributions-vide"');
  });
  it("lignes de total identifiées (classe total) : coût du mois par nature, total d'un mois, total des lignes", () => {
    const html = render("tout", proj, "2026-11");
    expect(html).toContain('<tr class="total" data-testid="proj-nature-total">');
    expect(html).toContain('<tr class="total" data-testid="proj-detail-total">');
    expect(html).toMatch(/<tr class="total"><td colSpan="4">Total<\/td>/);
  });
  it("effectif écrit en personnes, jamais un nombre nu accolé à l'ETP ; une seule catégorie : pas de colonne Total en double", () => {
    const html = render();
    expect(html).toMatch(/\d+ personnes? · \d+,\d{2} ETP/);
    expect(html).not.toMatch(/>\d+ · \d/);
    expect(html).toContain('data-testid="proj-categories-table"');
    expect(html).not.toContain('data-col="total"');
  });
  it("date ISO d'une raison n.d. : écrite en français, jamais « 2026-09-16 »", () => {
    const ndProj = project(base, "2026-10", "2026-12", [], conv);
    const html = render("graphique", ndProj);
    expect(html).toContain("entré le 16/09/2026");
    expect(html).not.toContain("2026-09-16");
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
    expect(html).toContain("réel figé ou projeté par le scénario parent avant octobre 2026, projeté ensuite");
    // Base non dérivée : la ligne de contexte ne parle pas d'un scénario parent.
    expect(render()).not.toContain("projeté par le scénario parent avant");
    expect(render()).toContain("réel figé avant octobre 2026, projeté ensuite · €");
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
  it("ligne de total de l'année identifiée (classe total)", () => {
    expect(render("tableau")).toContain('<tr class="total" data-testid="cmp-total">');
  });
  it("l'origine des mois du scénario (9 mois réels figés puis 3 mois projetés) est lue par les lecteurs d'écran, plus écrite sous la courbe", () => {
    const html = render("graphique");
    expect(html).toContain("Origine des mois de Révisé T4 : réel janv.–sept. ; projeté oct.–déc.");
    expect(html).not.toContain("Origine des mois du scénario (trait plein bleu)");
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
    return { hrefBase: "/e/demo/studio-rh/hypotheses", scenarioId: scenario.id, year: "2026", landing, retraite: reference, measures: measuresOf(base, "2026-10", "2026-12", hs, conv, "2026"), sens: rows, options, chosen, affichage, actualHidden: ACTUAL_SHOWN };
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
  it("lignes de total identifiées ; dernier jour payé en jj/mm/aaaa (jamais ISO)", () => {
    const t = render("tableau");
    expect(t).toContain('<tr class="total" data-testid="atr-nonrec-total">');
    expect(t).toContain("20/11/2026");
    expect(t).not.toContain("2026-11-20");
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
    expect(render()).toContain(`réel janv.–sept. ${displayEuros(6300000)} + projeté oct.–déc. ${displayEuros(2908333)}`);
    expect(retraiteWaterfall(retraite)).toMatchObject({ kind: "value", start: 9208333, steps: [{ label: "Prévu", value: -100000 }], end: 9108333 });
  });
  it("mesures : plus de note sous le graphique ; un départ sans remplaçant lié est écrit « sans remplacement » dans le tableau", () => {
    const m = (replacement: number | null) => ({ id: "d", label: "Départ", who: "B", lastPaidDate: "2026-11-20", avoided: 800000, exit: 100000, replacement, replacementLabel: replacement === null ? null : "Rempl", net: 700000 - (replacement ?? 0), fullYear: { kind: "value" as const, cents: 1 } });
    const withRows = (rows: ReturnType<typeof m>[], affichage = "tout") => clean(renderToStaticMarkup(h(LandingView, { ...props(affichage), measures: { kind: "value" as const, year: "2026", rows } })));
    expect(withRows([m(300000), m(null)])).not.toContain("Départ sans remplaçant lié : pas de barre");
    expect(withRows([m(null)])).toContain("sans remplacement");
    expect(withRows([m(300000)])).toContain("Rempl");
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
  it("graphique : titre « Postes par mois d'arrivée … — 2026 » (nom de l'axe et année), un seul titre, hauteur réduite quand le maximum est petit", () => {
    const html = render();
    expect(html).toContain("Postes par mois d&#x27;arrivée, par catégorie de contrat — 2026");
    expect(html).not.toContain("Embauches par mois de début");
    expect(html).not.toContain("Axe vertical : nombre de postes");
    expect(html).toContain('height="210"');
  });
  it("ligne Total du tableau par mois en pied de tableau, classe total : 1 poste en octobre, 1 en novembre, 3 au total (le stage de 2027 est compté)", () => {
    const html = render();
    expect(html).toContain('<tfoot><tr class="total" data-testid="emb-by-month-total"><td>Total</td><td class="num">1</td><td class="num">1</td><td class="num">—</td><td class="num">3</td></tr></tfoot>');
  });
  it("dates de la liste en jj/mm/aaaa (une date ne se coupe pas) ; fin de poste en ligne d'appoint ; aucune date ISO", () => {
    const html = render({ affichage: "tableau", hypotheses: [hire("a", { start: "2026-11-16", end: "2026-12-31", category: "cdd" })] });
    expect(html).toContain('<td class="hr-date">16/11/2026<span class="hr-line">fin 31/12/2026</span></td>');
    expect(html).not.toContain("2026-11-16");
    expect(html).not.toContain("2026-12-31");
  });
  it("liste : neuf colonnes (effectif, remplacement et fin en lignes d'appoint) avec taux de charges et suppression", () => {
    const html = render({ affichage: "tableau", canEdit: true });
    const head = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
    expect(head.match(/<th[ >]/g)).toHaveLength(9);
    expect(head).toContain("Taux de charges");
    expect(html).toContain("compté dans l&#x27;effectif");
    expect(html).toContain('data-testid="hyp-delete-a"');
  });
  it("regroupements n.d. : une seule note avec les deux raisons (plus de lignes italiques répétées)", () => {
    const html = render();
    expect(html.match(/data-testid="emb-group-nd"/g)).toHaveLength(1);
    const note = html.slice(html.indexOf('data-testid="emb-group-nd"'), html.indexOf("</p>", html.indexOf('data-testid="emb-group-nd"')));
    expect(note).toContain("par métier (aucun poste n&#x27;a de métier renseigné)");
    expect(note).toContain("par motif d&#x27;embauche (aucun poste n&#x27;a de motif d&#x27;embauche renseigné)");
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
  it("plus de huit groupes : la répétition des teintes est dite en une ligne sous le graphique ; huit au plus : rien", () => {
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

// --- Lot 10 : univers bleu / blanc / noir, tendances de coût en rouge / vert, moins de narratif, définitions au glossaire.
const HYP_DIR = "src/app/e/[slug]/studio-rh/hypotheses";
const ZONE_FILES = [`${HYP_DIR}/ProjectionView.tsx`, `${HYP_DIR}/ComparisonView.tsx`, `${HYP_DIR}/LandingView.tsx`, `${HYP_DIR}/EmbauchesView.tsx`, "src/styles/hypotheses-resultat.css", "src/lib/viz/hypotheses.ts", "src/lib/glossary/hypotheses.ts"];
const countOf = (html: string, needle: string) => html.split(needle).length - 1;
const linkTo = (id: string) => `href="/e/demo/glossaire#def-${id}"`;
const tdOf = (html: string, month: string, col: string) => {
  const row = html.slice(html.indexOf(`data-month="${month}"`), html.indexOf("</tr>", html.indexOf(`data-month="${month}"`)));
  const at = row.indexOf(`data-col="${col}"`);
  return row.slice(row.lastIndexOf("<td", at), row.indexOf("</td>", at) + 5);
};

describe("lot 10 : renvois vers le glossaire", () => {
  it("slugOf : l'espace client d'une adresse d'écran ; null si l'adresse n'a pas cette forme", () => {
    expect(slugOf("/e/demo/studio-rh/hypotheses")).toBe("demo");
    expect(slugOf("/e/mon-espace/studio-rh/hypotheses?scenario=1")).toBe("mon-espace");
    expect(slugOf("/studio-rh/hypotheses")).toBeNull();
    expect(slugOf("")).toBeNull();
  });
  it("chaque identifiant cité par les écrans existe au glossaire, et les identifiants du glossaire sont uniques", () => {
    for (const [name, id] of Object.entries(HYP_TERMS)) expect(glossaryEntry(id), `${name} → ${id}`).toBeDefined();
    const ids = GLOSSARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("les entrées de la famille sont complètes : terme, définition en français de produit, une seule ligne de formule", () => {
    expect(GLOSSARY_HYPOTHESES.length).toBeGreaterThanOrEqual(12);
    for (const e of GLOSSARY_HYPOTHESES) {
      expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(e.family).toBe("Hypothèses budgétaires");
      expect(e.term.length).toBeGreaterThan(3);
      expect(e.definition.length, e.id).toBeGreaterThan(80);
      expect(e.definition + e.term, e.id).not.toMatch(/outil observé|cahier|webinaire|\btu\b|\btoi\b|Lecture graphique/i);
      if (e.formula) expect(e.formula).not.toContain("\n");
    }
  });
  it("le texte retiré des écrans existe au glossaire (déplacé, pas supprimé)", () => {
    const text = (id: string) => glossaryEntry(id)!.definition;
    expect(text("cout-nature")).toContain("« — » signifie qu'aucune contribution de cette nature");
    expect(text("cout-nature")).toContain("se retire du coût du mois");
    expect(text("contributions-hors-base")).toContain("sans la base");
    expect(text("contributions-hors-base")).toContain("sur leur propre échelle");
    expect(text("projection")).toContain("coût chargé");
    expect(text("projection-graphiques")).toContain("trait plein pour les mois réels, pointillés pour les mois projetés");
    expect(text("origine-mois")).toContain("réel janv.–sept. ; projeté oct.–déc.");
    expect(text("comparaison")).toContain("Un total est n.d. dès qu'un de ses mois l'est");
    expect(text("origine-mois")).toContain("projeté — scénario « X »");
    expect(text("comparaison-graphiques")).toContain("pas de barre quand l'une des deux lectures est n.d. ce mois-là");
    expect(text("pont")).toContain("effet de structure");
    expect(text("atterrissage-cascades")).toContain("chaque barre ajoute un ensemble de mois");
    expect(text("retraite")).toContain("Déjà en comptabilité");
    expect(text("mesures")).toContain("Économie nette = paie évitée − coûts de sortie − coût du remplaçant lié");
    expect(text("mesures-lecture")).toContain("sans remplaçant");
    expect(text("sensibilites-lecture")).toContain("points de %");
    expect(text("sensibilites-lecture")).toContain("calculée seule, sans être enregistrée");
    expect(text("embauches-calendrier")).toContain("Un poste est compté le mois de son premier jour payé");
    expect(text("embauches-calendrier")).toContain("Au-delà de huit groupes, les teintes se répètent");
    expect(text("categories")).toContain("corrigée salarié par salarié");
  });
});

describe("lot 10 : projection sans narratif", () => {
  const proj = projOf(hyps);
  const render = (affichage?: string, month = "") => clean(renderToStaticMarkup(h(ProjectionView, { slug: "demo", scenario, base, proj, landing: landingOf(base, proj, "2026"), month, affichage })));
  it("aucune phrase de lecture ni de méthode : ni « Lecture graphique », ni note d'axe, d'origine ou de hachure, ni pied de tableau explicatif", () => {
    const html = render("tout", "2026-11");
    for (const gone of ["Lecture graphique", "Axe vertical depuis zéro", "Colonne hachurée : mois n.d.", "Pointillés : mois projetés", "Chaque barre additionne", "Même graphique sans la base", "Montants exacts :", "Un montant négatif se retire", "Somme des contributions du moteur", "Catégorie proposée depuis la nature du contrat", "chaque euro remontant à une hypothèse visible", "Définition</a>", 'href="#def-']) expect(html, gone).not.toContain(gone);
  });
  it("un « ? » par panneau et par tuile, vers la bonne définition", () => {
    const html = render("tout", "2026-11");
    for (const id of [HYP_TERMS.projectionGraphiques, HYP_TERMS.coutNature, HYP_TERMS.contributionsHorsBase, HYP_TERMS.atterrissage, HYP_TERMS.coutProjete, HYP_TERMS.effectif, HYP_TERMS.projection, HYP_TERMS.categories, HYP_TERMS.contribution]) expect(html, id).toContain(linkTo(id));
    // Nature : un « ? » sur le panneau du graphique, un autre sur celui du tableau.
    expect(countOf(html, linkTo(HYP_TERMS.coutNature))).toBe(2);
  });
  it("une seule ligne de contexte sous le contrôle d'affichage ; aucune tendance rouge / vert (rien n'est un écart de coût ici)", () => {
    const html = render();
    expect(countOf(html, 'class="hr-context"')).toBe(1);
    expect(html).toContain("janvier 2026 → décembre 2026 · réel figé avant octobre 2026, projeté ensuite · €");
    expect(html).not.toMatch(/trend-(bad|good)|hr-trend-legend|tile-trend/);
  });
  it("mois n.d. : la légende n.d. (une seule) et les raisons restent écrites ; sans mois n.d., aucune légende", () => {
    const nd = clean(renderToStaticMarkup(h(ProjectionView, { slug: "demo", scenario, base, proj: project(base, "2026-10", "2026-12", [], conv), landing: landingOf(base, project(base, "2026-10", "2026-12", [], conv), "2026"), month: "", affichage: "graphique" })));
    expect(countOf(nd, 'data-testid="hr-nd-key"')).toBe(1);
    expect(nd).toContain('data-testid="proj-chart-nd"');
    expect(nd).toContain("n.d. : C : base n.d.");
    expect(render("graphique")).not.toContain('data-testid="hr-nd-key"');
  });
  it("brut ou charges n.d. d'un mois projeté : une seule ligne courte (la règle complète est au glossaire)", () => {
    // Prime ponctuelle saisie en coût chargé (1 000,00 €) : non ventilée entre brut et charges.
    const prime: Hypothesis = { id: "e1", kind: "ponctuel", label: "Prime", month: "2026-11", amount: { mode: "charge", costCents: 100000 }, service: null };
    const p = projOf([fixC, prime]);
    const html = clean(renderToStaticMarkup(h(ProjectionView, { slug: "demo", scenario, base, proj: p, landing: landingOf(base, p, "2026"), month: "", affichage: "tableau" })));
    expect(html).toContain('data-testid="proj-brut-nd"');
    expect(html).not.toContain("un élément saisi en coût chargé n'est pas ventilé entre brut et charges ; le coût employeur reste exact");
  });
});

describe("lot 10 : comparaison, écarts de coût en rouge et vert", () => {
  const ptE = (month: string, cost: number, etp4: number): Point => ({ month, kind: "value", cost, etp4, etpNd: null, layer: "projete" });
  const YEAR = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  // Scénario : 1 000,00 € par mois, sauf février 1 200,00 € (total 12 200,00 €, 2,5 ETP). Budget : 1 000,00 € par mois, sauf janvier 900,00 €,
  // février 1 300,00 € et mars 950,00 € (total 12 150,00 €, 2,0 ETP). Écart de l'année : +50,00 € ; janv.–mars : 3 200,00 − 3 150,00 = +50,00 €.
  const principal12 = series("sc-1", "Scénario", YEAR.map((m) => ptE(m, m === "2026-02" ? 120000 : 100000, 25000)));
  const budget12 = series("budget-aa", "Budget", YEAR.map((m) => ptE(m, m === "2026-01" ? 90000 : m === "2026-02" ? 130000 : m === "2026-03" ? 95000 : 100000, 20000)));
  const render = (over: Partial<Parameters<typeof ComparisonView>[0]> = {}) =>
    clean(renderToStaticMarkup(h(ComparisonView, { hrefBase: "/e/demo/studio-rh/hypotheses", scenarioId: scenario.id, years: ["2026"], year: "2026", principal: principal12, compared: [budget12], options: [], selected: ["budget:aa"], refMonth: "2026-03", ...over })));
  it("mois par mois : écart positif = coût en hausse (rouge, flèche ▲), négatif = baisse (vert), nul = neutre ; le signe reste écrit", () => {
    const html = render({ affichage: "tableau" });
    expect(tdOf(html, "2026-01", "budget-aa-ecart")).toBe(`<td class="num hr-gap trend-bad" data-col="budget-aa-ecart">+${displayEuros(10000)}</td>`);
    expect(tdOf(html, "2026-02", "budget-aa-ecart")).toBe(`<td class="num hr-gap trend-good" data-col="budget-aa-ecart">${displayEuros(-10000)}</td>`);
    expect(tdOf(html, "2026-03", "budget-aa-ecart")).toBe(`<td class="num hr-gap trend-bad" data-col="budget-aa-ecart">+${displayEuros(5000)}</td>`);
    expect(tdOf(html, "2026-04", "budget-aa-ecart")).toBe(`<td class="num" data-col="budget-aa-ecart">${displayEuros(0)}</td>`);
    // Le total de l'année : 12 200,00 € contre 12 150,00 €, +50,00 €.
    expect(html).toContain(`<td class="num hr-gap trend-bad" data-col="budget-aa-ecart">+${displayEuros(5000)}</td></tr></tfoot>`);
  });
  it("tuile d'écart : fond et valeur rouges pour +50,00 €, le texte garde le signe ; les « mêmes mois » portent aussi la tendance", () => {
    const html = render();
    const tile = html.slice(html.indexOf('data-testid="cmp-tile-budget-aa"') - 60, html.indexOf("</dl>"));
    expect(tile).toContain('class="hr-tile tile-trend-bad"');
    expect(tile).toContain(`<dd class="hr-gap trend-bad">+${displayEuros(5000)} · +`);
    expect(tile).toContain(`<span class="hr-gap trend-bad">+${displayEuros(5000)} · +`);
    // Un écart négatif donne le vert : le budget passe au-dessus du scénario.
    const low = render({ compared: [series("budget-aa", "Budget", YEAR.map((m) => ptE(m, 110000, 20000)))] });
    expect(low).toContain('class="hr-tile tile-trend-good"');
    // Scénario 12 200,00 € contre 13 200,00 € : −1 000,00 €.
    expect(low).toContain(`<dd class="hr-gap trend-good">${displayEuros(-100000)} · `);
  });
  it("pont d'écart : la raison n.d. de l'effet de structure reste écrite, dans la colonne du tableau, ou sous les cascades quand le tableau n'est pas affiché", () => {
    const graph = render({ affichage: "graphique" });
    expect(graph).toContain('data-testid="cmp-bridge-nd"');
    expect(graph).toContain("n.d. : effet de structure, non calculé (données individuelles datées des deux lectures requises).");
    expect(render()).not.toContain('data-testid="cmp-bridge-nd"');
    const table = render({ affichage: "tableau" });
    expect(table).not.toContain('data-testid="cmp-bridge-nd"');
    expect(table).toContain("n.d. — non calculé : données individuelles datées des deux lectures requises");
  });
  it("pont d'écart : volume +3 037,50 € (rouge), coût moyen −2 987,50 € (vert), cascade en euros avec hausse / baisse de coût", () => {
    const html = render();
    expect(html).toContain(`<td class="num hr-gap trend-bad" data-col="delta">+${displayEuros(5000)}</td>`);
    expect(html).toContain(`<td class="num hr-gap trend-bad" data-col="volume">+${displayEuros(303750)}</td>`);
    expect(html).toContain(`<td class="num hr-gap trend-good" data-col="cout-moyen">${displayEuros(-298750)}</td>`);
    expect(html).toContain("Hausse de coût");
    expect(html).toContain("Baisse de coût");
  });
  it("une seule légende rouge / vert, seulement quand une lecture est comparée ; elle renvoie aux tendances financières", () => {
    const html = render();
    expect(countOf(html, 'data-testid="hr-trend-legend"')).toBe(1);
    expect(html).toContain("Coût en hausse");
    expect(html).toContain("Coût en baisse");
    expect(html).toContain(linkTo(HYP_TERMS.tendances));
    expect(render({ compared: [], selected: [] })).not.toContain("hr-trend-legend");
  });
  it("sans phrase de lecture : ni note de courbe ni note d'écart, ni définition en ligne ; un « ? » par panneau", () => {
    const html = render();
    for (const gone of ["Origine des mois du scénario", "Courbe interrompue : mois sans valeur", "Écart = coût du scénario", "positif = au-dessus", "Un total est n.d. dès qu'un de ses mois l'est", "L'effet de structure n'est pas calculé : il demande", "Montants exacts :", "Volume et coût moyen.", 'href="#def-']) expect(html, gone).not.toContain(gone);
    for (const id of [HYP_TERMS.comparaison, HYP_TERMS.comparaisonGraphiques, HYP_TERMS.origineMois, HYP_TERMS.pont]) expect(html, id).toContain(linkTo(id));
    expect(html).toContain("2026 · coût employeur mensuel · Scénario face à Budget · €");
  });
  it("n.d. : légende et raison écrites sous les graphiques quand une lecture n'a pas tous ses mois ; sinon rien", () => {
    const partial = series("budget-aa", "Budget", [ptE("2026-01", 90000, 20000)]);
    const html = render({ compared: [partial], affichage: "graphique" });
    expect(countOf(html, 'data-testid="hr-nd-key"')).toBe(1);
    expect(html).toContain('data-testid="cmp-chart-nd"');
    expect(html).toContain("n.d. : Budget : mois non couvert par cette lecture");
    expect(render({ affichage: "graphique" })).not.toContain('data-testid="hr-nd-key"');
  });
});

describe("lot 10 : atterrissage, mesures et sensibilités", () => {
  const dep: Hypothesis = { id: "dB", kind: "depart", label: "Départ de B", contractKey: "B", lastPaidDate: "2026-11-20", exitCost: { mode: "charge", costCents: 100000 }, motif: "Rupture conventionnelle" };
  const hs: Hypothesis[] = [fixC, dep];
  const props = (affichage?: string) => {
    const options = variantOptions(hs);
    const chosen = [{ value: options[0].value, delta: "5" }];
    const { reference, landing, rows } = sensitivities(base, "2026-10", "2026-12", hs, conv, "2026", [{ hypothesisId: "dB", kind: "jours" as const, delta: 5 }]);
    return { hrefBase: "/e/demo/studio-rh/hypotheses", scenarioId: scenario.id, year: "2026", landing, retraite: reference, measures: measuresOf(base, "2026-10", "2026-12", hs, conv, "2026"), sens: rows, options, chosen, affichage, actualHidden: ACTUAL_SHOWN };
  };
  const render = (affichage?: string) => clean(renderToStaticMarkup(h(LandingView, props(affichage))));
  it("savingTone : une économie positive est une baisse de coût (vert), négative une hausse (rouge), nulle ou n.d. neutre", () => {
    expect([savingTone(286667), savingTone(-1), savingTone(0), savingTone(null), savingTone(undefined)]).toEqual(["good", "bad", "flat", "flat", "flat"]);
  });
  it("sensibilité : décaler le départ de B de 5 jours (novembre payé 25/30 au lieu de 20/30 de 2 900,00 € : 2 416,67 − 1 933,33 = +483,34 €) hausse le coût : effet en rouge, avec son signe", () => {
    const html = render("tableau");
    expect(html).toContain(`<td class="num hr-gap trend-bad" data-col="effect">+${displayEuros(48334)}</td>`);
    expect(html).toContain(`<td class="num hr-gap trend-bad" data-col="retraite">+${displayEuros(48334)}</td>`);
    // L'atterrissage après variation est un montant, pas un écart : neutre.
    expect(html).toContain('<td class="num" data-col="total">');
  });
  it("mesures : économie nette de B 2 866,67 € = économie, en vert ; le montant de paie évitée et les coûts de sortie restent neutres", () => {
    const html = render("tableau");
    expect(html).toContain(`<td class="num hr-gap trend-good" data-col="net">${displayEuros(286667)}</td>`);
    expect(html).toContain('<td class="num" data-col="avoided">');
    expect(html).toContain('<td class="num" data-col="exit">');
  });
  it("une seule légende rouge / vert, présente seulement s'il y a un effet ou une économie à lire", () => {
    expect(countOf(render(), 'data-testid="hr-trend-legend"')).toBe(1);
    const empty = clean(renderToStaticMarkup(h(LandingView, { ...props(), measures: { kind: "value" as const, year: "2026", rows: [] }, sens: [] })));
    expect(empty).not.toContain("hr-trend-legend");
  });
  it("les cascades de composition (réel + projeté, retraité) restent bleues et grises : ni « Hausse de coût » ni « Baisse de coût »", () => {
    const html = render("graphique");
    expect(html).toContain('data-testid="atr-wf-atterrissage"');
    expect(html).not.toContain("Hausse de coût");
    expect(html).not.toContain("Baisse de coût");
    expect(html).not.toMatch(/var\(--(bad|good)\)/);
  });
  it("sans phrase de lecture ni formule ; un « ? » par panneau, sur la colonne Économie nette, sur la cascade et sur le champ Valeur", () => {
    const html = render();
    for (const gone of ["Éléments déjà en comptabilité : saisis à la main", "Économie nette = paie évitée", "Valeur : jours (décalage de date)", "Chaque barre ajoute un ensemble de mois", "Éléments non récurrents retirés de l'atterrissage", "Les numéros sont ceux des variations", "Départ sans remplaçant lié : pas de barre", "Économie nette : définition ci-dessous", 'href="#def-', "Définition</a>"]) expect(html, gone).not.toContain(gone);
    for (const id of [HYP_TERMS.retraite, HYP_TERMS.atterrissage, HYP_TERMS.cascades, HYP_TERMS.mesures, HYP_TERMS.mesuresLecture, HYP_TERMS.sensibilites, HYP_TERMS.sensibilitesLecture, HYP_TERMS.tendances]) expect(html, id).toContain(linkTo(id));
    expect(html).toContain("Chaque départ est évalué seul · €");
    expect(countOf(html, 'class="hr-context"')).toBe(1);
  });
  it("le rouge de la légende vient des classes de tendance : aucun rouge ni vert écrit dans les graphiques de cet écran", () => {
    expect(render("graphique")).not.toMatch(/#c4302b|#138a55|rgb\(/i);
  });
});

describe("lot 10 : embauches prévisionnelles sans narratif", () => {
  const hire = (id: string, over: Partial<Extract<Hypothesis, { kind: "embauche" }>>): Hypothesis => ({
    id, kind: "embauche", label: `Poste ${id}`, service: "TECH", start: "2026-10-01", end: null, grossFullTimeCents: 300000, quotaBps: 10000, chargesBps: 4200, counted: true, category: "cdi", replaces: null, ...over,
  });
  const hs = [hire("a", {}), hire("b", { start: "2026-11-01", category: "cdd" })];
  const render = (affichage?: string, canEdit = true) => clean(renderToStaticMarkup(h(EmbauchesView, { slug: "demo", scenario, base, hypotheses: hs, canEdit, par: "", affichage })));
  it("ni note d'axe, ni explication sous le titre, ni règle du formulaire : un « ? » sur le panneau du graphique et un sur la liste", () => {
    const html = render();
    for (const gone of ["Un poste est compté le mois de son premier jour payé", "Axe vertical : nombre de postes", "Classées par date d'arrivée", "Chaque poste devient une hypothèse distincte", "ils ne sont jamais confondus avec des collaborateurs réels.", 'href="#def-', "règle</a>"]) expect(html, gone).not.toContain(gone);
    expect(html).toContain(linkTo(HYP_TERMS.embauchesCalendrier));
    expect(html).toContain(linkTo(HYP_TERMS.embauchePostes));
    expect(html).toContain("Postes futurs du scénario, distincts des collaborateurs réels · 2026");
  });
  it("le formulaire d'ajout reste ouvert avec son intitulé (les tests de parcours le cherchent) ; aucune tendance rouge / vert", () => {
    const html = render();
    expect(html).toContain("<summary>Ajouter une embauche (un ou plusieurs postes, par centre de coûts)</summary>");
    expect(html).not.toMatch(/trend-(bad|good)|hr-trend-legend/);
  });
});

describe("lot 10 : couleurs de la zone", () => {
  const hsl = (hex: string) => {
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0 };
    const d = max - min;
    const s = d / (1 - Math.abs(2 * l - 1));
    const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (hue * 60 + 360) % 360, s };
  };
  it("le calcul de teinte reconnaît le bleu, le gris, le rouge et le vert (cas écrits à la main)", () => {
    expect(hsl("155cff").h).toBeCloseTo(222, 0);
    expect(hsl("6c7280").s).toBeLessThan(0.1);
    expect(hsl("c4302b").h).toBeLessThan(10);
    expect(hsl("138a55").h).toBeCloseTo(153, 0);
  });
  it("aucune couleur écrite en dur hors du blanc, du gris et du bleu : ni rouge, vert, ambre, violet ni notation rgb / hsl", () => {
    let seen = 0;
    for (const f of ZONE_FILES) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
        seen += 1;
        const { h: hue, s: sat } = hsl(m[1]);
        expect(sat < 0.2 || (hue >= 200 && hue <= 250), `${f} : #${m[1]}`).toBe(true);
      }
      expect(src, f).not.toMatch(/\brgba?\(|\bhsla?\(/);
    }
    expect(seen).toBeGreaterThan(0);
  });
  it("le rouge et le vert ne viennent que des tendances de coût : jamais sur la projection ni sur les embauches", () => {
    for (const f of [`${HYP_DIR}/ProjectionView.tsx`, `${HYP_DIR}/EmbauchesView.tsx`, "src/styles/hypotheses-resultat.css"].slice(0, 2)) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/costTone|trendClass|--bad\b|--good\b|trend-(good|bad)/);
    }
    // Les écrans qui lisent des écarts de coût passent par costTone / trendClass (jamais une classe de couleur écrite à la main).
    for (const f of [`${HYP_DIR}/ComparisonView.tsx`, `${HYP_DIR}/LandingView.tsx`]) expect(readFileSync(f, "utf8"), f).toMatch(/costTone|savingTone/);
  });
});


describe("sélecteur replié des lectures de comparaison", () => {
  const options = [
    { value: "reel", label: "Réel courant" },
    { value: "n1", label: "N-1" },
    { value: "budget:budget-fictif", label: "Budget saisi" },
    { value: "scenario:scenario-fictif", label: "Scénario comparé" },
  ];
  const renderPicker = (selected: string[]) => renderToStaticMarkup(h(ComparisonPicker, { options, selected }));
  it("liste repliée au départ et compteur des cases cochées conservé dans le résumé", () => {
    const html = renderPicker(["reel", "n1"]);
    const details = /<details[^>]*data-testid="cmp-picker"[^>]*>/.exec(html)?.[0] ?? "";
    expect(details).not.toBe("");
    expect(details).not.toMatch(/\bopen(?:=|\s|>)/);
    const summary = /<summary[^>]*>[\s\S]*?<\/summary>/.exec(html)?.[0] ?? "";
    expect(summary).toContain("Comparer avec");
    expect(summary).toContain('data-testid="cmp-selected-count">2 sélectionnées');
    expect(html).toContain("Comparer avec (3 lectures au plus)");
  });
  it("les quatre libellés, noms et valeurs natifs restent présents pour soumettre les mêmes cmp", () => {
    const html = renderPicker(["reel", "budget:budget-fictif"]);
    const inputs = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((match) => match[0]);
    expect(inputs).toHaveLength(4);
    options.forEach((option) => {
      const input = inputs.find((element) => element.includes(`value="${option.value}"`));
      expect(input).toContain('name="cmp"');
      expect(html).toContain(`<span>${option.label}</span>`);
      expect(input?.includes('checked=""')).toBe(["reel", "budget:budget-fictif"].includes(option.value));
    });
  });
  it("au maximum de trois lectures, on peut décocher les choix actifs et les autres restent désactivés", () => {
    const html = renderPicker(["reel", "n1", "budget:budget-fictif"]);
    const inputs = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((match) => match[0]);
    expect(inputs.filter((input) => input.includes('disabled=""'))).toHaveLength(1);
    expect(inputs.find((input) => input.includes('value="scenario:scenario-fictif"'))).toContain('disabled=""');
    expect(inputs.filter((input) => input.includes('checked=""')).every((input) => !input.includes('disabled=""'))).toBe(true);
    expect(html).toContain('data-testid="cmp-selected-count">3 sélectionnées');
  });
});
