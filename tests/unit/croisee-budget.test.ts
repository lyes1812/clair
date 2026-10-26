import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlocksChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChBudget";
import type { CroiseeContext, ScenarioLoad } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { STEP_LABELS, type Cascade } from "@/lib/budget/cascade";
import { landing, project, type Landing } from "@/lib/budget/engine";
import type { Retraite } from "@/lib/budget/lot3";
import { bridge, budgetSeries, type Layer, type Point, type Series } from "@/lib/budget/series";
import type { BaseContract, BaseSnapshot } from "@/lib/budget/types";
import { aggregate, alignedSeries, reelVersion, val } from "@/lib/budget/versions";
import { glossaryEntry } from "@/lib/glossary";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { cellView, yearMonths, type CroiseeTable } from "@/lib/viz/croisee";
import {
  BUDGET_CHART_IDS,
  BUDGET_CX_TERMS,
  BUDGET_TABLE_IDS,
  buildBudget,
  buildEffets,
  cascadeOf,
  EFFETS_CHART_IDS,
  EFFETS_CX_TERMS,
  EFFETS_TABLE_IDS,
  loadBudgetInput,
  loadEffetsInput,
  zoomReason,
  type BudgetChapterInput,
  type EffetsInput,
} from "@/lib/viz/croisee-budget";

// Chapitres 06 · Budget & prévisions et 08 · Effets d'évolution : entrées fictives écrites à la main, valeurs de référence calculées
// à la main (centimes, dix-millièmes d'ETP). Aucune donnée réelle.
const sp = (s: string) => s.replace(/[\u00a0\u202f]/g, " "); // espaces insécables → espace
const Y26 = yearMonths(2026);
const series = (key: string, label: string, pts: Record<string, number | string>, layer: (m: string) => Layer = () => "reel", etp: (m: string) => number | null = () => null): Series => ({
  key,
  label,
  points: new Map(Object.entries(pts).map(([m, v]): [string, Point] => [m, typeof v === "number" ? { month: m, kind: "value", cost: v, etp4: etp(m), etpNd: etp(m) === null ? "sans ETP" : null, layer: layer(m) } : { month: m, kind: "nd", reason: v }])),
});
const table = (m: { tables: CroiseeTable[] }, id: string) => {
  const t = m.tables.find((x) => x.id === id);
  if (!t) throw new Error(`tableau ${id} absent`);
  return t;
};
const tile = (m: { tiles: { id: string }[] }, id: string) => m.tiles.find((t) => t.id === id) as ReturnType<typeof buildBudget>["tiles"][number];

// --- Jeu de référence du chapitre 06 -----------------------------------------------------------------------------------------------
// Période : janvier → mars 2026. Réalisé : 10 000,00 €, 10 500,00 €, 11 000,00 € (31 500,00 €).
// Budget saisi « Budget test » : janvier 10 200,00 €, février non saisi, mars 10 500,00 €, avril → décembre 11 000,00 €.
// Scénario « Scénario test » : réel figé janvier → mars (mêmes montants), projection avril → décembre à 11 200,00 €.
const live = series("reel", "Réalisé", { "2026-01": 1_000_000, "2026-02": 1_050_000, "2026-03": 1_100_000 });
const amounts: Record<string, number | null> = Object.fromEntries(Y26.map((m) => [m, m === "2026-01" ? 1_020_000 : m === "2026-02" ? null : m === "2026-03" ? 1_050_000 : 1_100_000]));
const budget = budgetSeries("budget-b1", "Budget saisi « Budget test »", "2026", amounts);
const scen = series("s1", "Scénario « Scénario test »", Object.fromEntries(Y26.map((m) => [m, m === "2026-01" ? 1_000_000 : m === "2026-02" ? 1_050_000 : m === "2026-03" ? 1_100_000 : 1_120_000])), (m) => (m <= "2026-03" ? "reel" : "projete"));
// Atterrissage : 31 500,00 € réels + 9 × 11 200,00 € = 100 800,00 € projetés = 132 300,00 €.
const land: Landing = { kind: "value", year: "2026", actual: 3_150_000, prior: 0, projected: 10_080_000, actualMonths: Y26.slice(0, 3), priorMonths: [], projectedMonths: Y26.slice(3), total: 13_230_000 };
// Éléments non récurrents : 800,00 € déjà comptabilisés, 1 500,00 € prévus → retraité 132 300 − 2 300 = 130 000,00 €.
const ret: Retraite = {
  kind: "value",
  year: "2026",
  atterrissage: 13_230_000,
  rows: [
    { label: "Coûts de sortie (hypothèses de départ)", realised: 0, projected: 150_000 },
    { label: "Prime exceptionnelle", realised: 80_000, projected: 0 },
  ],
  realised: 80_000,
  projected: 150_000,
  total: 230_000,
  retraite: 13_000_000,
};
const HREFS = { hypotheses: "/e/demo/studio-rh/hypotheses", comparaison: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=resultat&sous=comparaison&annee=2026", atterrissage: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=resultat&sous=atterrissage", postes: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=postes", embauches: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=embauches" };

function budgetInput(over: Partial<Extract<BudgetChapterInput, { kind: "value" }>> = {}): BudgetChapterInput {
  return {
    kind: "value",
    year: 2026,
    months: ["2026-01", "2026-02", "2026-03"],
    labels: { period: "janvier → mars 2026", prev: "janvier → mars 2025" },
    filtered: false,
    hrefs: HREFS,
    live: { kind: "value", series: live },
    budget: { kind: "value", name: "Budget test", series: budget },
    scenario: { kind: "value", name: "Scénario test", refMonth: "2026-03", series: scen, landing: land, retraite: ret },
    // Partition écrite à la main (voir croisee-cohortes.test.ts) : 1 seulement N-1, 2 seulement N, 2 dans les deux, lignes sans contrat.
    cohorts: {
      kind: "value",
      onlyPrev: { count: 1, prev: 100_000, cur: 0, delta: -100_000 },
      onlyCur: { count: 2, prev: 0, cur: 150_000, delta: 150_000 },
      both: { count: 2, prev: 250_000, cur: 255_000, delta: 5_000 },
      outside: { prev: 1_000, cur: 2_500, delta: 1_500 },
      total: { count: 5, prev: 351_000, cur: 407_500, delta: 56_500 },
    },
    ...over,
  };
}

describe("buildBudget — réalisé, budget et écart sur la période", () => {
  const m = buildBudget(budgetInput());

  it("six cartes, dans l'ordre : réalisé, budget, écart, atterrissage, écart annuel, retraité", () => {
    expect(m.tiles.map((t) => t.id)).toEqual(["realise", "budget", "ecart", "atterrissage", "ecart-annuel", "retraite"]);
    expect(m.nd).toBeNull();
  });

  it("réalisé 31 500,00 € ; budget des mois saisis 10 200 + 10 500 = 20 700,00 €, février exclu et nommé", () => {
    expect(sp(tile(m, "realise").value.text)).toBe("31 500,00 €");
    expect(sp(tile(m, "budget").value.text)).toBe("20 700,00 €");
    expect(tile(m, "budget").note).toBe("Comparé sur 2 mois ; sans montant de budget, exclus : févr. 2026");
  });

  it("écart sur janvier et mars : (10 000 + 11 000) − 20 700 = +300,00 € ; 300 ÷ 20 700 = +1,45 % ; défavorable, en rouge", () => {
    const t = tile(m, "ecart");
    expect(sp(t.value.text)).toBe("+300,00 €");
    expect(t.valueTone).toBe("bad");
    expect(sp(t.variations![0].text!)).toBe("+1,45 % · défavorable");
    expect(t.variations![1]).toMatchObject({ label: "Réalisé des mois comparés" });
    expect(sp(t.variations![1].text!)).toBe("21 000,00 €");
    // Mini-courbe : écart de janvier −200,00 €, février sans budget (null, jamais 0), mars +500,00 €.
    expect(t.spark?.values).toEqual([-20_000, null, 50_000]);
    expect(m.trend).toBe(true);
  });

  it("tableau exact des cartes : chaque mois, février n.d. avec sa raison, total des mois comparés = carte", () => {
    const t = table(m, BUDGET_TABLE_IDS.mensuel);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Janvier 2026", 1_000_000, 1_020_000, -20_000],
      ["Février 2026", 1_050_000, { nd: "montant du budget non saisi : mois exclu de l'écart" }, { nd: "montant du budget non saisi : mois exclu de l'écart" }],
      ["Mars 2026", 1_100_000, 1_050_000, 50_000],
    ]);
    expect(t.foot?.cells).toEqual(["Total des 2 mois avec budget", 2_100_000, 2_070_000, 30_000]);
    expect(t.notes).toEqual(["Sans montant de budget, exclus de l'écart : févr. 2026."]);
    // Un n.d. s'écrit « n.d. » jusqu'à l'écran, jamais 0.
    expect(cellView(t.rows[1].cells[2], t.columns[2]).text).toBe("n.d.");
    expect(sp(cellView(t.foot!.cells[3], t.columns[3]).text)).toBe("+300,00 €");
  });
});

describe("buildBudget — douze mois : scénario, réalisé, budget (comme Hypothèses › Comparaison)", () => {
  const m = buildBudget(budgetInput());
  const c = m.charts.find((x) => x.id === BUDGET_CHART_IDS.douzeMois)!;

  it("courbes : scénario (réel figé puis projection), réalisé, budget ; un mois absent reste null avec sa raison", () => {
    expect(c.kind).toBe("courbe");
    expect(c.tableId).toBe(BUDGET_TABLE_IDS.douzeMois);
    expect(c.series.map((s) => s.key)).toEqual(["s1", "reel", "budget-b1"]);
    expect(c.series[0].values).toEqual([1_000_000, 1_050_000, 1_100_000, ...Array(9).fill(1_120_000)]);
    expect(c.series[1].values).toEqual([1_000_000, 1_050_000, 1_100_000, ...Array(9).fill(null)]);
    expect(c.series[1].reasons?.[3]).toBe("mois non couvert par cette lecture");
    expect(c.series[2].values[1]).toBeNull();
    expect(c.series[2].reasons?.[1]).toBe("montant du budget non saisi");
    // Aucune couleur codée en dur : teintes de série seulement.
    for (const s of c.series) expect(s.color).toMatch(/^var\(--chart-\d\)$/);
  });

  it("tableau exact : origine du mois, écart scénario − budget au centime ; février n.d. avec la raison du budget", () => {
    const t = table(m, BUDGET_TABLE_IDS.douzeMois);
    expect(t.rows).toHaveLength(12);
    expect(t.rows[0].cells).toEqual(["Janvier 2026", "réel", 1_000_000, 1_000_000, 1_020_000, -20_000]);
    expect(t.rows[1].cells[5]).toEqual({ nd: "budget : montant du budget non saisi" });
    // Avril : projection 11 200,00 € face au budget 11 000,00 € → +200,00 €.
    expect(t.rows[3].cells).toEqual(["Avril 2026", "projeté", 1_120_000, { nd: "mois non couvert par cette lecture" }, 1_100_000, 20_000]);
    expect(t.notes).toEqual(["Origine des mois du scénario : réel janv.–mars ; projeté avr.–déc."]);
  });
});

describe("buildBudget — atterrissage, atterrissage retraité, écart annuel", () => {
  const m = buildBudget(budgetInput());

  it("atterrissage 132 300,00 € ; budget de l'année hors février : 10 200 + 10 500 + 9 × 11 000 = 119 700,00 €", () => {
    const t = tile(m, "atterrissage");
    expect(sp(t.value.text)).toBe("132 300,00 €");
    expect(t.variations![0].label).toBe("Budget saisi « Budget test »");
    expect(sp(t.variations![0].text!)).toBe("119 700,00 €");
    expect(sp(t.note!)).toBe("Réel janv.–mars : 31 500,00 € · Projeté avr.–déc. : 100 800,00 €");
  });

  it("écart annuel sur les onze mois avec budget : (132 300 − 10 500) − 119 700 = +2 100,00 € ; 2 100 ÷ 119 700 = +1,75 %", () => {
    const t = tile(m, "ecart-annuel");
    expect(sp(t.value.text)).toBe("+2 100,00 €");
    expect(t.valueTone).toBe("bad");
    expect(sp(t.variations![0].text!)).toBe("+1,75 % · défavorable");
    expect(t.note).toBe("Comparé sur 11 mois ; sans montant de budget, exclus : févr. 2026");
  });

  it("retraité : 132 300 − 800 − 1 500 = 130 000,00 €", () => {
    const t = tile(m, "retraite");
    expect(sp(t.value.text)).toBe("130 000,00 €");
    expect(t.variations!.map((v) => [v.label, sp(v.text!)])).toEqual([["Non récurrents retirés", "2 300,00 €"], ["Déjà comptabilisés", "800,00 €"], ["Prévus", "1 500,00 €"]]);
  });

  it("sans élément non récurrent : lignes à 0 (jamais « −0 »), pas de cascade du retraité, mention écrite", () => {
    const z = buildBudget(budgetInput({ scenario: { kind: "value", name: "Scénario test", refMonth: "2026-03", series: scen, landing: land, retraite: { kind: "value", year: "2026", atterrissage: 13_230_000, rows: [], realised: 0, projected: 0, total: 0, retraite: 13_230_000 } } }));
    const t = table(z, BUDGET_TABLE_IDS.atterrissage);
    expect(Object.is(t.rows[3].cells[1], 0)).toBe(true);
    expect(Object.is(t.rows[4].cells[1], 0)).toBe(true);
    expect(z.charts.some((c) => c.id === BUDGET_CHART_IDS.retraite)).toBe(false);
    expect(z.blocks.find((b) => b.id === "atterrissage")!.notes).toEqual(["Aucun élément non récurrent saisi ni prévu."]);
    expect(z.tables.some((x) => x.id === BUDGET_TABLE_IDS.nonRecurrents)).toBe(false);
  });

  it("tableau exact des cascades : composantes, éléments retirés (négatifs), retraité en pied ; la somme se vérifie", () => {
    const t = table(m, BUDGET_TABLE_IDS.atterrissage);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Réel janv.–mars", 3_150_000],
      ["Projeté avr.–déc.", 10_080_000],
      ["Atterrissage 2026", 13_230_000],
      ["Éléments non récurrents déjà comptabilisés", -80_000],
      ["Éléments non récurrents prévus (hypothèses)", -150_000],
    ]);
    expect(t.foot?.cells).toEqual(["Atterrissage retraité 2026", 13_000_000]);
    const nr = table(m, BUDGET_TABLE_IDS.nonRecurrents);
    expect(nr.rows.map((r) => r.cells)).toEqual([
      ["Coûts de sortie (hypothèses de départ)", 0, 150_000, 150_000],
      ["Prime exceptionnelle", 80_000, 0, 80_000],
    ]);
    expect(nr.foot?.cells).toEqual(["Total retiré de l'atterrissage", 80_000, 150_000, 230_000]);
  });

  it("cascades : mêmes montants que le tableau, réel puis projection, puis retraité", () => {
    const a = cascadeOf(m.charts.find((x) => x.id === BUDGET_CHART_IDS.atterrissage)!);
    expect(a).toEqual({ startLabel: "Réel janv.–mars", endLabel: "Atterrissage 2026", start: 3_150_000, end: 13_230_000, steps: [{ label: "Projeté avr.–déc.", value: 10_080_000 }] });
    const r = cascadeOf(m.charts.find((x) => x.id === BUDGET_CHART_IDS.retraite)!);
    expect(r).toEqual({ startLabel: "Atterrissage 2026", endLabel: "Retraité 2026", start: 13_230_000, end: 13_000_000, steps: [{ label: "Déjà comptabilisé", value: -80_000 }, { label: "Prévu", value: -150_000 }] });
    for (const id of [BUDGET_CHART_IDS.atterrissage, BUDGET_CHART_IDS.retraite]) expect(m.charts.find((x) => x.id === id)!.tableId).toBe(BUDGET_TABLE_IDS.atterrissage);
  });

  it("tableau atterrissage face au budget : mêmes mois que le budget, écart en pied", () => {
    const t = table(m, BUDGET_TABLE_IDS.annuel);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Atterrissage 2026", "11 mois avec budget", 12_180_000, ""],
      ["Budget saisi « Budget test »", "11 mois avec budget", 11_970_000, ""],
    ]);
    expect(t.foot?.cells).toEqual(["Écart atterrissage − budget", "11 mois avec budget", "", 210_000]);
  });
});

describe("buildBudget — personnes observées et blocs Prévu", () => {
  const m = buildBudget(budgetInput());

  it("tableau : trois groupes, lignes sans contrat, total ; colonne N vide (sans objet) pour « seulement N-1 »", () => {
    const t = table(m, BUDGET_TABLE_IDS.personnes);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Observées seulement en N-1", 1, 100_000, "", -100_000],
      ["Observées seulement en N", 2, "", 150_000, 150_000],
      ["Observées dans les deux périodes", 2, 250_000, 255_000, 5_000],
      ["Lignes du journal sans contrat", "", 1_000, 2_500, 1_500],
    ]);
    expect(t.foot?.cells).toEqual(["Total", 5, 351_000, 407_500, 56_500]);
    expect(cellView(t.rows[0].cells[3], t.columns[3]).text).toBe("—");
  });

  it("plan de départs, noria, coût d'intégration : « Prévu » avec raison et renvoi vers Hypothèses budgétaires", () => {
    expect(m.prevu.map((p) => p.id)).toEqual(["budget-plan", "budget-noria", "budget-integration"]);
    for (const p of m.prevu) {
      expect(p.reason.length).toBeGreaterThan(10);
      expect(p.links[0].href).toMatch(/^\/e\/demo\/studio-rh\/hypotheses/);
    }
  });
});

describe("buildBudget — un n.d. reste n.d. jusqu'au tableau et au graphique", () => {
  const nd = series("reel", "Réalisé", { "2026-01": 1_000_000, "2026-02": 1_050_000, "2026-03": "paie non clôturée à la lecture" });
  const m = buildBudget(budgetInput({ live: { kind: "value", series: nd } }));

  it("réalisé et écart n.d. avec la raison (mois écrit en toutes lettres), jamais 0", () => {
    expect(tile(m, "realise").value).toEqual({ text: "n.d.", kind: "nd", reason: "paie non clôturée à la lecture (mars 2026)" });
    expect(tile(m, "ecart").value.kind).toBe("nd");
    expect(tile(m, "ecart").value.reason).toContain("paie non clôturée à la lecture");
    const t = table(m, BUDGET_TABLE_IDS.mensuel);
    expect(t.rows[2].cells).toEqual(["Mars 2026", { nd: "paie non clôturée à la lecture" }, 1_050_000, { nd: "paie non clôturée à la lecture" }]);
    expect(t.foot?.cells[3]).toMatchObject({ nd: expect.stringContaining("paie non clôturée") });
  });

  it("graphique : null et raison pour mars, la courbe est coupée (jamais un point à 0)", () => {
    const c = m.charts.find((x) => x.id === BUDGET_CHART_IDS.douzeMois)!;
    expect(c.series[1].values[2]).toBeNull();
    expect(c.series[1].reasons?.[2]).toBe("paie non clôturée à la lecture");
  });

  it("budget absent : budget, écart, écart annuel n.d. avec la raison ; pas de tableau annuel ; la courbe du budget n'est pas tracée", () => {
    const a = buildBudget(budgetInput({ budget: { kind: "absent", reason: "aucun budget saisi pour 2026" } }));
    for (const id of ["budget", "ecart"]) expect(tile(a, id).value).toEqual({ text: "n.d.", kind: "nd", reason: "aucun budget saisi pour 2026" });
    expect(tile(a, "ecart-annuel").value).toEqual({ text: "n.d.", kind: "nd", reason: "aucun budget saisi pour 2026" });
    expect(a.tables.some((t) => t.id === BUDGET_TABLE_IDS.annuel)).toBe(false);
    expect(a.charts.find((x) => x.id === BUDGET_CHART_IDS.douzeMois)!.series.map((s) => s.key)).toEqual(["s1", "reel"]);
    expect(table(a, BUDGET_TABLE_IDS.mensuel).foot?.cells).toEqual(["Total de la période", 3_150_000, { nd: "aucun budget saisi pour 2026" }, { nd: "aucun budget saisi pour 2026" }]);
  });

  it("filtre de service : budget et scénario globaux n.d. « non filtrable par service », limite écrite", () => {
    const f = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" } }));
    expect(tile(f, "budget").value.reason).toBe("budget saisi global : non filtrable par service");
    expect(tile(f, "atterrissage").value.reason).toBe("scénario global : non filtrable par service");
    expect(f.blocks.find((b) => b.id === "prevision")!.nd[0].reason).toBe("scénario global : non filtrable par service");
    expect(f.charts).toHaveLength(0);
    expect(f.limits[0]).toContain("non filtrables par service");
    expect(sp(tile(f, "realise").value.text)).toBe("31 500,00 €");
  });

  it("période n.d. : le chapitre entier est n.d. avec sa raison et l'action", () => {
    const n = buildBudget({ kind: "nd", reason: "aucun mois clos à la date de référence", action: { href: "/e/demo/donnees", label: "Données" } });
    expect(n.nd).toEqual({ reason: "Aucun mois clos à la date de référence", action: { href: "/e/demo/donnees", label: "Données" } });
    expect(n.tiles).toHaveLength(0);
  });
});

// --- Chapitre 08 · Effets d'évolution ---------------------------------------------------------------------------------------------
// N-1 (janvier → février 2025) : 2 800,00 € par mois, 1 ETP fin de mois → 5 600,00 € pour 2 ETP-mois.
// N (janvier → février 2026) : 4 340,00 € par mois, 1,5 ETP → 8 680,00 € pour 3 ETP-mois.
// Écart +3 080,00 € ; effet volume = (3 − 2) × 5 600 ÷ 2 = +2 800,00 € ; effet coût moyen = 3 080 − 2 800 = +280,00 €.
const N1 = series("n1", "Réel PayFit 2025", { "2026-01": 280_000, "2026-02": 280_000 }, () => "reel", () => 10_000);
const N = series("n", "Réel PayFit 2026", { "2026-01": 434_000, "2026-02": 434_000 }, () => "reel", () => 15_000);
const PONT = bridge(N, N1, ["2026-01", "2026-02"]);
const CASCADE: Cascade = {
  kind: "value",
  months: 2,
  start: 10_000,
  end: 15_000,
  steps: [
    { id: "entrees-new", label: STEP_LABELS["entrees-new"], etp4: 5_000, people: [] },
    { id: "entrees-report", label: STEP_LABELS["entrees-report"], etp4: 0, people: [] },
    { id: "sorties", label: STEP_LABELS.sorties, etp4: 0, people: [] },
    { id: "sorties-deport", label: STEP_LABELS["sorties-deport"], etp4: 0, people: [] },
    { id: "etp-change", label: STEP_LABELS["etp-change"], etp4: 0, people: [] },
  ],
  residual: 0,
};
const effetsInput = (over: Partial<Extract<EffetsInput, { kind: "value" }>> = {}): EffetsInput => ({
  kind: "value",
  year: 2026,
  labels: { period: "janvier → février 2026", prev: "janvier → février 2025" },
  pont: PONT,
  cascade: CASCADE,
  etp: { cur: { kind: "value", num: 30_000, den: 20_000 }, prev: { kind: "value", num: 20_000, den: 20_000 } },
  hrefs: { analyse: "/e/demo/studio-rh/masse-salariale/analyse?v1=reel%3A2025&v2=reel%3A2026&de=01&a=02", embauches: "/e/demo/studio-rh/hypotheses", globales: "/e/demo/studio-rh/hypotheses", fixeVariable: "/x?chapitre=fixe-variable" },
  ...over,
});

describe("buildEffets — pont volume / coût moyen (cas de référence)", () => {
  it("le pont du module budgétaire donne les montants calculés à la main", () => {
    expect(PONT).toEqual({ kind: "value", a: { cost: 868_000, etpMonths4: 30_000 }, b: { cost: 560_000, etpMonths4: 20_000 }, delta: 308_000, volume: 280_000, averageCost: 28_000 });
  });

  const m = buildEffets(effetsInput());

  it("cartes : écart +3 080,00 €, effet volume +2 800,00 €, effet coût moyen +280,00 € (rouge : coût en hausse) ; ETP 1,50 contre 1,00 (neutre)", () => {
    expect(m.tiles.map((t) => t.id)).toEqual(["ecart", "volume", "cout-moyen", "etp"]);
    expect(m.tiles.slice(0, 3).map((t) => sp(t.value.text))).toEqual(["+3 080,00 €", "+2 800,00 €", "+280,00 €"]);
    expect(m.tiles.slice(0, 3).map((t) => t.valueTone)).toEqual(["bad", "bad", "bad"]);
    const etp = tile(m, "etp");
    expect(etp.value.text).toBe("1,50 ETP");
    expect(etp.cost).toBeFalsy();
    expect(etp.variations!.map((v) => [v.label, v.text, v.tone])).toEqual([["N-1", "1,00 ETP", "flat"], ["Écart", "+0,50 ETP", "flat"]]);
  });

  it("tableau du pont : départ, effets, écart total, arrivée ; la somme des effets égale l'écart", () => {
    const t = table(m, EFFETS_TABLE_IDS.pont);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Masse salariale chargée N-1 (janvier → février 2025)", 560_000, ""],
      ["Effet volume", "", 280_000],
      ["Effet coût moyen", "", 28_000],
      ["Écart total", "", 308_000],
    ]);
    expect(t.foot?.cells).toEqual(["Masse salariale chargée N (janvier → février 2026)", 868_000, ""]);
    // Coût par ETP-mois : 5 600 ÷ 2 = 2 800,00 € ; 8 680 ÷ 3 = 2 893,333… → 2 893,33 € (arrondi au centime).
    expect(table(m, EFFETS_TABLE_IDS.pontBase).rows.map((r) => r.cells)).toEqual([
      ["N-1 (janvier → février 2025)", 560_000, 20_000, 280_000],
      ["N (janvier → février 2026)", 868_000, 30_000, 289_333],
    ]);
  });

  it("cascade en euros (tendance de coût) et cascade d'ETP (neutre), chacune avec son tableau exact", () => {
    const pont = m.charts.find((c) => c.id === EFFETS_CHART_IDS.pont)!;
    expect(pont).toMatchObject({ kind: "cascade", unit: "eur", trend: "cost", tableId: EFFETS_TABLE_IDS.pont });
    expect(cascadeOf(pont)).toEqual({ startLabel: "N-1 (janvier → février 2025)", endLabel: "N (janvier → février 2026)", start: 560_000, end: 868_000, steps: [{ label: "Effet volume", value: 280_000 }, { label: "Effet coût moyen", value: 28_000 }] });
    const etp = m.charts.find((c) => c.id === EFFETS_CHART_IDS.etp)!;
    expect(etp).toMatchObject({ kind: "cascade", unit: "etp", tableId: EFFETS_TABLE_IDS.etp });
    expect(etp.trend).toBeUndefined();
    expect(etp.series[0].values).toEqual([10_000, 5_000, 0, 0, 0, 0, 15_000]);
    const t = table(m, EFFETS_TABLE_IDS.etp);
    expect(t.rows[0].cells).toEqual(["ETP moyen N-1 (janvier → février 2025)", 10_000, ""]);
    expect(t.rows.at(-1)!.cells).toEqual(["Écart total", "", 5_000]);
    expect(t.foot?.cells).toEqual(["ETP moyen N (janvier → février 2026)", 15_000, ""]);
    expect(t.columns.some((c) => c.costTrend)).toBe(false);
  });

  it("tuilages, effet de structure, hausses de base, masse / niveau / report : « Prévu » avec raison", () => {
    expect(m.prevu.map((p) => p.id)).toEqual(["effets-tuilages", "effets-structure", "effets-hausses", "effets-masse-niveau-report"]);
    expect(m.prevu.find((p) => p.id === "effets-structure")!.reason).toContain("classifications et changements individuels datés absents");
    // La place de l'effet de structure est écrite une fois, sous le tableau du pont (elle part aussi dans les exports).
    expect(table(m, EFFETS_TABLE_IDS.pont).notes).toEqual(["Effet de structure (mix) non isolé : compris dans l'effet coût moyen."]);
    expect(table(m, EFFETS_TABLE_IDS.pont).title).toBe("Pont de la masse salariale chargée, de N-1 (janvier → février 2025) à N (janvier → février 2026)");
  });

  it("pont et cascade n.d. : cartes n.d. avec la raison (mois en toutes lettres), aucun graphique, bloc n.d.", () => {
    const n = buildEffets(effetsInput({ pont: { kind: "nd", reason: "Réel PayFit 2026 : ETP n.d. (2026-02)" }, cascade: { kind: "nd", reason: "service des collaborateurs non historisé" } }));
    expect(n.tiles.slice(0, 3).map((t) => t.value)).toEqual(Array(3).fill({ text: "n.d.", kind: "nd", reason: "Réel PayFit 2026 : ETP n.d. (février 2026)" }));
    expect(n.charts).toHaveLength(0);
    expect(n.tables).toHaveLength(0);
    expect(n.blocks.map((b) => b.nd[0]?.reason)).toEqual(["Réel PayFit 2026 : ETP n.d. (février 2026)", "service des collaborateurs non historisé"]);
  });
});

// --- Lecture : les mêmes fonctions que les écrans existants -----------------------------------------------------------------------
// Journal fictif : contrats « contrat-alpha » (service TECH, présent les deux années), « contrat-beta » (SALES, les deux années),
// « contrat-gamma » (TECH, entré en 2026). Comptes : 641100 salaires (brut), 645 cotisations.
const L = (key: string, month: string, accountId: string, debit: number, contractId: string, service: string): LedgerLine => ({ key, month, accountId, accountName: null, debitCents: debit, creditCents: null, contractId, analytic: [{ type: "SERVICE", code: service, value: service }] });
const MONTHS = ["2025-01", "2025-02", "2026-01", "2026-02"];
const lines: LedgerLine[] = MONTHS.flatMap((m) => [
  L(`${m}-a1`, m, "641100", m < "2026" ? 200_000 : 210_000, "contrat-alpha", "TECH"),
  L(`${m}-a2`, m, "645", m < "2026" ? 80_000 : 84_000, "contrat-alpha", "TECH"),
  L(`${m}-b1`, m, "641100", 150_000, "contrat-beta", "SALES"),
  L(`${m}-b2`, m, "645", 60_000, "contrat-beta", "SALES"),
  ...(m < "2026" ? [] : [L(`${m}-g1`, m, "641100", 100_000, "contrat-gamma", "TECH"), L(`${m}-g2`, m, "645", 40_000, "contrat-gamma", "TECH")]),
]);
const journal: JournalInput = { lines, months: MONTHS, openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "SERVICE" };
// ETP de fin de mois du service TECH : 1 ETP en 2025, 1,5 ETP en 2026 (contrat-gamma à mi-temps).
const etpOf = (months: string[]) => months.map((month) => ({ month, etp4: month < "2026" ? 10_000 : 15_000, reason: null }));
const A: BaseContract = { contractKey: "payfit:x", externalId: "x", label: "x", service: null, serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, base: { salaryCents: 300_000, refBrutCents: 300_000, refCotisationsCents: 120_000 }, baseNd: null };
// Base figée sur février 2026 (6 440,00 € par mois réels), projection mars → décembre : 4 200,00 € par mois.
const baseSnap: BaseSnapshot = { currency: "EUR", refMonth: "2026-02", syncId: "s", readAt: "2026-03-05", contracts: [A], actuals: ["2026-01", "2026-02"].map((month) => ({ month, kind: "value" as const, brut: 460_000, cotisations: 184_000, masse: 644_000, headcount: 3, etp4: 25_000, etpNd: null })), refMasse: 644_000, refBaseCost: 420_000, etpNote: null };
const proj = project(baseSnap, "2026-03", "2026-12", [], { prorata: "calendaire" });

// kpiInput : référentiel RH simulé ; non nul seulement pour les versions filtrées par service (ETP du service lu par pay.etp).
function fakeCtx(service: string | undefined, kpiInput: unknown = null): CroiseeContext {
  const scenario: ScenarioLoad = { kind: "value", full: { scenario: { id: "s1", name: "Scénario test", firstMonth: "2026-03", lastMonth: "2026-12" }, base: baseSnap, baseHash: "h", hypotheses: [] } as never, proj };
  return {
    slug: "demo",
    canEdit: true,
    period: { year: 2026, from: "01", to: "02", years: [2025, 2026], last: "02", months: ["2026-01", "2026-02"], notices: [] },
    periodNd: null,
    prevMonths: ["2025-01", "2025-02"],
    labels: { period: "janvier → février 2026", prev: "janvier → février 2025" },
    service: { axis: "SERVICE", value: service, label: service ?? "Tous les services", options: [], reason: null },
    budget: { selected: { id: "b1-0000-0000", name: "Budget test", year: "2026", amounts: Object.fromEntries(Y26.map((m) => [m, m === "2026-01" ? 600_000 : m === "2026-02" ? null : 450_000])) } as never, explicit: false, options: [], reason: null },
    scenario: { selected: { scenario: { id: "s1" } } as never, explicit: false, options: [], reason: null },
    state: { service: service ?? null },
    href: (patch = {}) => `/x?${new URLSearchParams(Object.entries(patch).filter(([, v]) => v) as [string, string][]).toString()}`,
    load: {
      payroll: async () => ({ input: journal, kpi: { input: kpiInput }, etp: (months: string[]) => etpOf(months), unavailable: null, source: "payfit" }) as never,
      scenario: async () => scenario,
    },
  } as unknown as CroiseeContext;
}

describe("loadBudgetInput — lectures du contexte et fonctions existantes", () => {
  it("réalisé du journal, budget saisi, atterrissage du moteur, personnes observées (zoomOf + partition) ; aucune identité dans le modèle", async () => {
    const input = await loadBudgetInput(fakeCtx(undefined));
    if (input.kind !== "value") throw new Error(input.reason);
    // Atterrissage : 2 × 6 440,00 € réels + 10 × 4 200,00 € projetés = 54 880,00 € (même calcul que Hypothèses › Atterrissage).
    expect(input.scenario.kind === "value" && input.scenario.landing).toEqual(landing(baseSnap, proj, "2026"));
    expect(input.scenario.kind === "value" && input.scenario.landing.kind === "value" && input.scenario.landing.total).toBe(5_488_000);
    // N : alpha 2 × 2 940 ; beta 2 × 2 100 ; gamma 2 × 1 400 → gamma seulement en N ; alpha et beta dans les deux.
    expect(input.cohorts).toEqual({
      kind: "value",
      onlyPrev: { count: 0, prev: 0, cur: 0, delta: 0 },
      onlyCur: { count: 1, prev: 0, cur: 280_000, delta: 280_000 },
      both: { count: 2, prev: 980_000, cur: 1_008_000, delta: 28_000 },
      outside: null,
      total: { count: 3, prev: 980_000, cur: 1_288_000, delta: 308_000 },
    });
    const m = buildBudget(input);
    // Réalisé janvier + février : 2 × 6 440,00 € = 12 880,00 € ; budget de janvier seul : 6 000,00 € ; écart +440,00 € ; 440 ÷ 6 000 = +7,33 %.
    expect(sp(tile(m, "realise").value.text)).toBe("12 880,00 €");
    expect(sp(tile(m, "budget").value.text)).toBe("6 000,00 €");
    expect(sp(tile(m, "ecart").value.text)).toBe("+440,00 €");
    expect(sp(tile(m, "ecart").variations![0].text!)).toBe("+7,33 % · défavorable");
    // Écart annuel, onze mois avec budget : (54 880 − 6 440) − (6 000 + 10 × 4 500) = 48 440 − 51 000 = −2 560,00 € ; −5,02 % ; favorable, en vert.
    expect(sp(tile(m, "ecart-annuel").value.text)).toBe("−2 560,00 €");
    expect(tile(m, "ecart-annuel").valueTone).toBe("good");
    expect(sp(tile(m, "ecart-annuel").variations![0].text!)).toBe("−5,02 % · favorable");
    expect(JSON.stringify(m)).not.toMatch(/contrat-(alpha|beta|gamma)|payfit:x/);
  });

  it("N-1 hors de la lecture : personnes observées n.d., raison regroupée par mois (jamais une partition partielle)", async () => {
    const input = await loadBudgetInput({ ...fakeCtx(undefined), prevMonths: ["2024-01", "2024-02"] } as CroiseeContext);
    if (input.kind !== "value") throw new Error(input.reason);
    expect(input.cohorts).toEqual({ kind: "nd", reason: "N-1 : janv. 2024, févr. 2024 : mois hors de la lecture PayFit appliquée" });
    const m = buildBudget(input);
    expect(m.blocks.find((b) => b.id === "personnes")!.nd[0].reason).toBe("N-1 : janv. 2024, févr. 2024 : mois hors de la lecture PayFit appliquée");
    expect(m.tables.some((t) => t.id === BUDGET_TABLE_IDS.personnes)).toBe(false);
  });

  it("zoomReason : regroupe les mois d'une même raison ; un texte d'une autre forme reste inchangé", () => {
    expect(zoomReason("2025-01 : paie non clôturée à la lecture ; 2025-03 : paie non clôturée à la lecture ; 2025-02 : ligne sans montant")).toBe("janv. 2025, mars 2025 : paie non clôturée à la lecture ; févr. 2025 : ligne sans montant");
    expect(zoomReason("journal de paie indisponible")).toBe("journal de paie indisponible");
  });

  it("filtre de service TECH : réalisé et personnes du service ; budget et scénario n.d.", async () => {
    const input = await loadBudgetInput(fakeCtx("TECH"));
    if (input.kind !== "value") throw new Error(input.reason);
    expect(input.budget).toEqual({ kind: "na", reason: "budget saisi global : non filtrable par service" });
    expect(input.scenario).toEqual({ kind: "na", reason: "scénario global : non filtrable par service" });
    // TECH, N : alpha 2 × 2 940 + gamma 2 × 1 400 = 8 680,00 €.
    expect(sp(tile(buildBudget(input), "realise").value.text)).toBe("8 680,00 €");
    expect(input.cohorts.kind === "value" && input.cohorts.total).toEqual({ count: 2, prev: 560_000, cur: 868_000, delta: 308_000 });
  });
});

describe("loadEffetsInput — mêmes versions et même pont que l'Analyse des écarts", () => {
  it("service TECH : pont identique à celui de l'Analyse des écarts (réel N-1 → réel N, mêmes mois, même filtre)", async () => {
    const input = await loadEffetsInput(fakeCtx("TECH", {}));
    if (input.kind !== "value") throw new Error(input.reason);
    // Calcul de l'Analyse des écarts (analyse/page.tsx) avec les mêmes versions.
    const etpService = (m: string) => val(etpOf([m])[0].etp4);
    const a = reelVersion("reel:2025", "Réel PayFit 2025", "2025", journal, {} as never, { value: "TECH" }, etpService);
    const b = reelVersion("reel:2026", "Réel PayFit 2026", "2026", journal, {} as never, { value: "TECH" }, etpService);
    const monthsA = ["2025-01", "2025-02"];
    const monthsB = ["2026-01", "2026-02"];
    expect(input.pont).toEqual(bridge(alignedSeries(b, monthsB, monthsA), alignedSeries(a, monthsA, monthsA), monthsA));
    expect(input.pont).toEqual(PONT.kind === "value" ? { ...PONT } : null);
    expect(input.etp).toEqual({ cur: aggregate(b, monthsB, "etp"), prev: aggregate(a, monthsA, "etp") });
    // Composition par salarié non historisée par service : la cascade d'ETP est n.d., avec la raison du module.
    expect(input.cascade.kind).toBe("nd");
    expect(input.hrefs.analyse).toBe("/e/demo/studio-rh/masse-salariale/analyse?v1=reel%3A2025&v2=reel%3A2026&de=01&a=02&service=TECH");
  });
});

// --- Rendu (composant synchrone BlocksChapter, modèle construit à la main) --------------------------------------------------------
describe("rendu du chapitre", () => {
  const render = (m: ReturnType<typeof buildBudget>, affichage: "tout" | "graphique" | "tableau" = "tout") => sp(renderToStaticMarkup(h(BlocksChapter, { model: m, slug: "demo", affichage, tableauHref: "/x?affichage=tableau" })));

  it("06 : cartes, blocs ancrés, graphiques et tableaux exacts, blocs Prévu ; n.d. écrit", () => {
    const out = render(buildBudget(budgetInput({ live: { kind: "value", series: series("reel", "Réalisé", { "2026-01": 1_000_000, "2026-02": 1_050_000, "2026-03": "paie non clôturée à la lecture" }) } })));
    for (const id of ["realise", "budget", "ecart", "atterrissage", "ecart-annuel", "retraite"]) expect(out).toContain(`data-testid="cx-tile-budget-${id}"`);
    for (const id of Object.values(BUDGET_TABLE_IDS)) expect(out).toContain(`data-testid="cx-table-${id}"`);
    for (const id of Object.values(BUDGET_CHART_IDS)) expect(out).toContain(`data-testid="cx-chart-${id}"`);
    for (const id of ["ecart", "prevision", "atterrissage", "personnes", "prevu"]) expect(out).toContain(`id="cx-budget-${id}"`);
    for (const id of ["budget-plan", "budget-noria", "budget-integration"]) expect(out).toContain(`data-testid="cx-prevu-${id}"`);
    expect(out).toContain("n.d.");
    expect(out).toContain("paie non clôturée à la lecture");
    expect(out).toContain('data-testid="ms-trend-legend"');
  });

  it("affichage « Graphiques » : pas de tableau, accès au tableau exact ; « Tableaux » : pas de graphique", () => {
    const m = buildBudget(budgetInput());
    const g = render(m, "graphique");
    expect(g).not.toContain('data-testid="cx-table-');
    expect(g).toContain('data-testid="cx-chart-budget-douze-mois"');
    expect(g).toContain("Afficher le tableau exact");
    const t = render(m, "tableau");
    expect(t).not.toContain('data-testid="cx-chart-');
    expect(t).toContain('data-testid="cx-table-budget-douze-mois"');
  });

  it("chapitre n.d. : une seule mention avec la raison et l'action", () => {
    const out = render(buildBudget({ kind: "nd", reason: "aucun mois clos", action: { href: "/e/demo/donnees", label: "Données" } }));
    expect(out).toContain('data-testid="cx-budget-nd"');
    expect(out).toContain("Aucun mois clos");
    expect(out).toContain('href="/e/demo/donnees"');
  });

  it("08 : cartes, cascades et leurs tableaux, Prévu", () => {
    const out = render(buildEffets(effetsInput()));
    for (const id of ["ecart", "volume", "cout-moyen", "etp"]) expect(out).toContain(`data-testid="cx-tile-effets-${id}"`);
    for (const id of Object.values(EFFETS_TABLE_IDS)) expect(out).toContain(`data-testid="cx-table-${id}"`);
    for (const id of Object.values(EFFETS_CHART_IDS)) expect(out).toContain(`data-testid="cx-chart-${id}"`);
    expect(out).toContain('data-testid="cx-prevu-effets-tuilages"');
    expect(out).toContain('id="cx-effets-decomposition"');
  });
});

describe("glossaire", () => {
  it("chaque identifiant de glossaire des deux chapitres existe", () => {
    const ids = new Set<string>([...Object.values(BUDGET_CX_TERMS), ...Object.values(EFFETS_CX_TERMS)]);
    for (const m of [buildBudget(budgetInput()), buildEffets(effetsInput())]) {
      for (const t of m.tables) for (const id of [...(t.terms ?? []), ...t.columns.flatMap((c) => (c.term ? [c.term] : []))]) ids.add(id);
      for (const t of m.tiles) if (t.term) ids.add(t.term);
      for (const b of m.blocks) if (b.term) ids.add(b.term);
      for (const p of m.prevu) if (p.term) ids.add(p.term);
    }
    for (const id of ids) expect(glossaryEntry(id), id).toBeTruthy();
  });
});
