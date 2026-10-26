import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlocksChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChBudget";
import type { CroiseeContext, ScenarioLoad } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { STEP_LABELS, type Cascade } from "@/lib/budget/cascade";
import { landing, project, type Landing } from "@/lib/budget/engine";
import type { Retraite } from "@/lib/budget/lot3";
import { bridge, budgetSeries, type Layer, type Point, type Series } from "@/lib/budget/series";
import type { BaseContract, BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { aggregate, alignedSeries, reelVersion, val } from "@/lib/budget/versions";
import { glossaryEntry } from "@/lib/glossary";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { cellView, yearMonths, type CroiseeTable } from "@/lib/viz/croisee";
import {
  BUDGET_CHART_IDS,
  BUDGET_CX_TERMS,
  BUDGET_TABLE_IDS,
  budgetModel,
  buildBudget,
  buildEffets,
  cascadeOf,
  EFFETS_CHART_IDS,
  EFFETS_CX_TERMS,
  EFFETS_TABLE_IDS,
  effetsModel,
  loadBudgetInput,
  loadEffetsInput,
  paidSizes,
  publicProjectionReasons,
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
// Contributeurs fictifs des éléments non récurrents : 1 hypothèse « réalisé » (prime), 1 contrat (coûts de sortie).
const NR1 = { realised: 1, projected: 1 };
type ScenarioIn = Extract<Extract<BudgetChapterInput, { kind: "value" }>["scenario"], { kind: "value" }>;
const scenarioOf = (over: Partial<ScenarioIn> = {}): ScenarioIn => ({ kind: "value", name: "Scénario test", refMonth: "2026-03", series: scen, landing: land, retraite: ret, contributors: NR1, ...over });
const HREFS = { hypotheses: "/e/demo/studio-rh/hypotheses", comparaison: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=resultat&sous=comparaison&annee=2026", atterrissage: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=resultat&sous=atterrissage", postes: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=postes", embauches: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=embauches", parametres: "/e/demo/parametres#croisee" };
// Seuil de confidentialité 1 : aucun groupe n'est sous le seuil (cas de base) ; les cas de masquage sont plus bas.
const SEUIL_1 = { kind: "set" as const, value: 1 };

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
    scenario: scenarioOf(),
    // Partition écrite à la main (voir croisee-cohortes.test.ts) : 1 seulement N-1, 2 seulement N, 2 dans les deux, lignes sans contrat.
    cohorts: {
      kind: "value",
      onlyPrev: { count: 1, prev: 100_000, cur: 0, delta: -100_000 },
      onlyCur: { count: 2, prev: 0, cur: 150_000, delta: 150_000 },
      both: { count: 2, prev: 250_000, cur: 255_000, delta: 5_000 },
      outside: { prev: 1_000, cur: 2_500, delta: 1_500 },
      total: { count: 5, prev: 351_000, cur: 407_500, delta: 56_500 },
    },
    confidentialite: SEUIL_1,
    serviceSizes: null,
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

  it("mois exclus : « Budget des 2 mois avec budget » porte le réalisé de janvier et mars (10 000 + 11 000 = 21 000,00 €) ; 21 000 − 20 700 = +300,00 € = carte Écart", () => {
    const b = tile(m, "budget");
    expect(b.label).toBe("Budget des 2 mois avec budget");
    expect(b.variations!.map((v) => [v.label, sp(v.text!), v.tone])).toEqual([["Réalisé des mois comparés", "21 000,00 €", "flat"]]);
    // Valeur − Référence = Écart, sur les mêmes mois : 2 100 000 − 2 070 000 = 30 000 centimes.
    expect(sp(tile(m, "ecart").value.text)).toBe("+300,00 €");
    // La carte « Réalisé » couvre toute la période (31 500,00 €) : elle garde son libellé.
    expect(tile(m, "realise").label).toBe("Réalisé");
    // Un seul endroit pour le réalisé des mois comparés : la carte du budget.
    expect(tile(m, "ecart").variations!.map((v) => v.label)).toEqual(["Écart (%)"]);
  });

  it("aucun mois exclu : « Budget de la période », sans ligne de réalisé (la carte « Réalisé » porte sur les mêmes mois)", () => {
    const full = budgetSeries("budget-b1", "Budget saisi « Budget test »", "2026", Object.fromEntries(Y26.map((x) => [x, 1_000_000])));
    const f = buildBudget(budgetInput({ budget: { kind: "value", name: "Budget test", series: full } }));
    // Budget 3 × 10 000,00 € = 30 000,00 € ; écart 31 500 − 30 000 = +1 500,00 €.
    expect(tile(f, "budget").label).toBe("Budget de la période");
    expect(tile(f, "budget").variations).toBeUndefined();
    expect(sp(tile(f, "budget").value.text)).toBe("30 000,00 €");
    expect(sp(tile(f, "ecart").value.text)).toBe("+1 500,00 €");
  });

  it("un seul mois avec budget (janvier) : « Budget du mois avec budget » 10 200,00 €, réalisé de janvier 10 000,00 €, écart −200,00 €", () => {
    const jan = budgetSeries("budget-b1", "Budget saisi « Budget test »", "2026", { "2026-01": 1_020_000 });
    const one = buildBudget(budgetInput({ budget: { kind: "value", name: "Budget test", series: jan } }));
    expect(tile(one, "budget").label).toBe("Budget du mois avec budget");
    expect(sp(tile(one, "budget").value.text)).toBe("10 200,00 €");
    expect(tile(one, "budget").variations!.map((v) => [v.label, sp(v.text!)])).toEqual([["Réalisé des mois comparés", "10 000,00 €"]]);
    expect(sp(tile(one, "ecart").value.text)).toBe("−200,00 €");
    expect(table(one, BUDGET_TABLE_IDS.mensuel).foot?.cells).toEqual(["Total du mois avec budget", 1_000_000, 1_020_000, -20_000]);
  });

  it("mois exclus et réalisé n.d. d'un mois comparé : la ligne est n.d. avec la raison, jamais 0", () => {
    const r = series("reel", "Réalisé", { "2026-01": 1_000_000, "2026-02": 1_050_000, "2026-03": "paie non clôturée à la lecture" });
    const n = buildBudget(budgetInput({ live: { kind: "value", series: r } }));
    expect(tile(n, "budget").label).toBe("Budget des 2 mois avec budget");
    expect(tile(n, "budget").variations).toEqual([{ label: "Réalisé des mois comparés", text: null, reason: "paie non clôturée à la lecture (mars 2026)", tone: "flat" }]);
  });

  it("écart sur janvier et mars : (10 000 + 11 000) − 20 700 = +300,00 € ; 300 ÷ 20 700 = +1,45 % ; défavorable, en rouge", () => {
    const t = tile(m, "ecart");
    expect(sp(t.value.text)).toBe("+300,00 €");
    expect(t.valueTone).toBe("bad");
    expect(sp(t.variations![0].text!)).toBe("+1,45 % · défavorable");
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

  it("atterrissage 132 300,00 € (douze mois) ; budget de l'année hors février : 10 200 + 10 500 + 9 × 11 000 = 119 700,00 € (11 mois) ; atterrissage des mêmes mois : 132 300 − 10 500 = 121 800,00 €", () => {
    const t = tile(m, "atterrissage");
    expect(sp(t.value.text)).toBe("132 300,00 €");
    expect(t.sub).toBe("Scénario « Scénario test » · douze mois");
    expect(t.variations!.map((v) => [v.label, sp(v.text!)])).toEqual([
      ["Budget saisi « Budget test » (11 mois)", "119 700,00 €"],
      ["Atterrissage 2026, mois avec budget (11 mois)", "121 800,00 €"],
    ]);
    expect(sp(t.note!)).toBe("Réel janv.–mars : 31 500,00 € · Projeté avr.–déc. : 100 800,00 € ; sans montant de budget, exclus : févr. 2026");
  });

  it("écart annuel sur les onze mois avec budget : 121 800 − 119 700 = +2 100,00 € ; 2 100 ÷ 119 700 = +1,75 % (valeur − référence = écart, comme la carte d'atterrissage)", () => {
    const t = tile(m, "ecart-annuel");
    expect(sp(t.value.text)).toBe("+2 100,00 €");
    expect(t.valueTone).toBe("bad");
    expect(t.sub).toBe("Atterrissage − budget saisi « Budget test », 11 mois comparés");
    expect(sp(t.variations![0].text!)).toBe("+1,75 % · défavorable");
    expect(t.note).toBe("Sans montant de budget, exclus : févr. 2026");
  });

  it("budget saisi pour les douze mois : libellés sans nombre de mois, une seule ligne d'atterrissage face au budget", () => {
    const full = budgetSeries("budget-b1", "Budget saisi « Budget test »", "2026", Object.fromEntries(Y26.map((x) => [x, 1_100_000])));
    const f = buildBudget(budgetInput({ budget: { kind: "value", name: "Budget test", series: full } }));
    const t = tile(f, "atterrissage");
    expect(t.variations!.map((v) => v.label)).toEqual(["Budget saisi « Budget test »"]);
    expect(sp(t.note!)).toBe("Réel janv.–mars : 31 500,00 € · Projeté avr.–déc. : 100 800,00 €");
    // 132 300 − 12 × 11 000 = +300,00 €.
    expect(table(f, BUDGET_TABLE_IDS.annuel).rows.map((r) => r.cells)).toEqual([["Atterrissage 2026", "Douze mois", 13_230_000, "Budget saisi « Budget test »", 13_200_000, 30_000]]);
  });

  it("retraité : 132 300 − 800 − 1 500 = 130 000,00 €", () => {
    const t = tile(m, "retraite");
    expect(sp(t.value.text)).toBe("130 000,00 €");
    expect(t.variations!.map((v) => [v.label, sp(v.text!)])).toEqual([["Non récurrents retirés", "2 300,00 €"], ["Déjà comptabilisés", "800,00 €"], ["Prévus", "1 500,00 €"]]);
  });

  it("sans élément non récurrent : lignes à 0 (jamais « −0 »), pas de cascade du retraité, mention écrite", () => {
    const z = buildBudget(budgetInput({ scenario: scenarioOf({ retraite: { kind: "value", year: "2026", atterrissage: 13_230_000, rows: [], realised: 0, projected: 0, total: 0, retraite: 13_230_000 }, contributors: { realised: 0, projected: 0 } }) }));
    const t = table(z, BUDGET_TABLE_IDS.atterrissage);
    expect(Object.is(t.rows[3].cells[1], 0)).toBe(true);
    expect(Object.is(t.rows[4].cells[1], 0)).toBe(true);
    expect(z.charts.some((c) => c.id === BUDGET_CHART_IDS.retraite)).toBe(false);
    // La raison écrite est celle de la cascade (retraiteWaterfall) : le graphique ne disparaît jamais sans phrase.
    expect(z.blocks.find((b) => b.id === "atterrissage")!.notes).toEqual(["Aucun élément non récurrent : l'atterrissage retraité 2026 égale l'atterrissage."]);
  });

  it("des lignes non récurrentes à 0 : même phrase (cascade « vide »), pas de cascade du retraité", () => {
    const z = buildBudget(budgetInput({ scenario: scenarioOf({ retraite: { kind: "value", year: "2026", atterrissage: 13_230_000, rows: [{ label: "Saisie annulée", realised: 0, projected: 0 }], realised: 0, projected: 0, total: 0, retraite: 13_230_000 }, contributors: { realised: 0, projected: 0 } }) }));
    expect(z.charts.some((c) => c.id === BUDGET_CHART_IDS.retraite)).toBe(false);
    expect(z.blocks.find((b) => b.id === "atterrissage")!.notes).toEqual(["Aucun élément non récurrent : l'atterrissage retraité 2026 égale l'atterrissage."]);
  });

  it("atterrissage entièrement réel : la cascade n'est pas tracée et la phrase le dit", () => {
    const real: Landing = { kind: "value", year: "2026", actual: 13_230_000, prior: 0, projected: 0, actualMonths: Y26, priorMonths: [], projectedMonths: [], total: 13_230_000 };
    const z = buildBudget(budgetInput({ scenario: scenarioOf({ refMonth: "2026-12", landing: real }) }));
    expect(z.charts.some((c) => c.id === BUDGET_CHART_IDS.atterrissage)).toBe(false);
    expect(z.blocks.find((b) => b.id === "atterrissage")!.notes).toEqual(["L'atterrissage 2026 est entièrement réel : une cascade n'apporterait rien de plus que le total."]);
  });

  it("atterrissage n.d. : les deux cascades le sont pour la même raison, une seule mention n.d. du bloc", () => {
    const why = "2026-11 : 1 contrat sans base de projection (détail dans Hypothèses budgétaires)";
    const z = buildBudget(budgetInput({ scenario: scenarioOf({ landing: { kind: "nd", year: "2026", reason: why }, retraite: { kind: "nd", year: "2026", reason: why } }) }));
    expect(z.charts.filter((c) => c.kind === "cascade")).toHaveLength(0);
    expect(z.blocks.find((b) => b.id === "atterrissage")!.nd).toEqual([{ label: "Cascades de l'atterrissage et du retraité", reason: "novembre 2026 : 1 contrat sans base de projection (détail dans Hypothèses budgétaires)" }]);
    expect(tile(z, "atterrissage").value.reason).toBe("novembre 2026 : 1 contrat sans base de projection (détail dans Hypothèses budgétaires)");
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
    // Libellés saisis des éléments non récurrents (texte libre, motifs de départ) : non repris, le détail reste dans Hypothèses.
    expect(JSON.stringify(m)).not.toContain("Prime exceptionnelle");
    expect(m.blocks.find((b) => b.id === "atterrissage")!.links).toEqual([{ href: HREFS.atterrissage, label: "Atterrissage et éléments non récurrents dans Hypothèses budgétaires" }]);
  });

  it("Hypothèses › Atterrissage montre une autre année que la période : pas de lien", () => {
    const z = buildBudget(budgetInput({ hrefs: { ...HREFS, atterrissage: null } }));
    expect(z.blocks.find((b) => b.id === "atterrissage")!.links).toEqual([]);
  });

  it("cascades : mêmes montants que le tableau, réel puis projection, puis retraité", () => {
    const a = cascadeOf(m.charts.find((x) => x.id === BUDGET_CHART_IDS.atterrissage)!);
    expect(a).toEqual({ startLabel: "Réel janv.–mars", endLabel: "Atterrissage 2026", start: 3_150_000, end: 13_230_000, steps: [{ label: "Projeté avr.–déc.", value: 10_080_000 }] });
    const r = cascadeOf(m.charts.find((x) => x.id === BUDGET_CHART_IDS.retraite)!);
    expect(r).toEqual({ startLabel: "Atterrissage 2026", endLabel: "Retraité 2026", start: 13_230_000, end: 13_000_000, steps: [{ label: "Déjà comptabilisé", value: -80_000 }, { label: "Prévu", value: -150_000 }] });
    for (const id of [BUDGET_CHART_IDS.atterrissage, BUDGET_CHART_IDS.retraite]) expect(m.charts.find((x) => x.id === id)!.tableId).toBe(BUDGET_TABLE_IDS.atterrissage);
  });

  it("tableau atterrissage face au budget : douze mois sur leur ligne ; mêmes mois que le budget : valeur − référence = écart", () => {
    const t = table(m, BUDGET_TABLE_IDS.annuel);
    expect(t.columns.map((c) => c.header)).toEqual(["Lecture", "Mois comparés", "Valeur", "Comparé à", "Référence", "Écart"]);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Atterrissage 2026", "Douze mois", 13_230_000, "", "", ""],
      // 121 800,00 − 119 700,00 = +2 100,00 €.
      ["Atterrissage 2026, mois avec budget", "11 mois avec budget (sans montant de budget, exclus : févr. 2026)", 12_180_000, "Budget saisi « Budget test »", 11_970_000, 210_000],
    ]);
    expect(t.foot).toBeUndefined();
  });
});

describe("buildBudget — contrats observés et blocs Prévu", () => {
  const m = buildBudget(budgetInput());

  it("tableau : trois groupes de contrats, lignes sans contrat, total ; colonne N vide (sans objet) pour « seulement N-1 »", () => {
    const t = table(m, BUDGET_TABLE_IDS.personnes);
    expect(t.title).toBe("Écart de masse lié aux contrats observés, janvier → mars 2026 face à janvier → mars 2025");
    expect(t.columns.map((c) => c.header)).toEqual(["Groupe", "Contrats", "Coût N-1 (janvier → mars 2025)", "Coût N (janvier → mars 2026)", "Contribution à l'écart"]);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Contrats observés seulement en N-1", 1, 100_000, "", -100_000],
      ["Contrats observés seulement en N", 2, "", 150_000, 150_000],
      ["Contrats observés dans les deux périodes", 2, 250_000, 255_000, 5_000],
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

describe("buildBudget — seuil de confidentialité", () => {
  const ND2 = { nd: "non affiché (seuil de confidentialité : 2 personnes)" };

  it("seuil non défini : bloc des contrats observés n.d. avec la raison et le lien vers les Paramètres ; le reste du chapitre est affiché", () => {
    const m = buildBudget(budgetInput({ confidentialite: { kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" } }));
    expect(m.blocks.find((b) => b.id === "personnes")!.nd).toEqual([{ label: "Contrats observés", reason: "seuil de confidentialité non défini (Paramètres)", action: { href: "/e/demo/parametres#croisee", label: "Paramètres" } }]);
    expect(m.tables.some((t) => t.id === BUDGET_TABLE_IDS.personnes)).toBe(false);
    expect(sp(tile(m, "realise").value.text)).toBe("31 500,00 €");
  });

  it("seuil 2 : « seulement N-1 » (1 contrat) masqué ; masquage secondaire de « seulement N » et des lignes sans contrat ; total inchangé", () => {
    const t = table(buildBudget(budgetInput({ confidentialite: { kind: "set", value: 2 } })), BUDGET_TABLE_IDS.personnes);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Contrats observés seulement en N-1", ND2, ND2, "", ND2],
      ["Contrats observés seulement en N", ND2, "", ND2, ND2],
      ["Contrats observés dans les deux périodes", 2, 250_000, 255_000, 5_000],
      ["Lignes du journal sans contrat", "", ND2, ND2, ND2],
    ]);
    // Le total n'est jamais masqué ; aucune valeur masquée ne se retrouve par différence d'une colonne (au moins deux n.d. par colonne).
    expect(t.foot?.cells).toEqual(["Total", 5, 351_000, 407_500, 56_500]);
    for (const j of [1, 2, 3, 4]) expect(t.rows.filter((r) => typeof r.cells[j] === "object").length, `colonne ${j}`).not.toBe(1);
  });

  it("filtre de service : un mois de 1 contrat masqué, le plus petit autre mois aussi ; total de la période affiché", () => {
    // Service : 3 contrats en janvier, 1 en février, 3 en mars, 4 distincts sur la période ; seuil 2. Février masqué ; secondaire :
    // janvier (10 000,00 €, plus petit que mars 11 000,00 €). Réalisé de la période : 31 500,00 €.
    const m = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, confidentialite: { kind: "set", value: 2 }, serviceSizes: { months: [3, 1, 3], period: 4 } }));
    const t = table(m, BUDGET_TABLE_IDS.mensuel);
    expect(t.rows.map((r) => r.cells[1])).toEqual([ND2, ND2, 1_100_000]);
    expect(t.foot?.cells[1]).toBe(3_150_000);
    expect(sp(tile(m, "realise").value.text)).toBe("31 500,00 €");
    // Service de 1 contrat sur la période : carte et tableau n.d.
    const one = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, confidentialite: { kind: "set", value: 2 }, serviceSizes: { months: [1, 1, 1], period: 1 } }));
    expect(tile(one, "realise").value.reason).toBe("non affiché : service de moins de 2 contrats rémunérés (seuil de confidentialité)");
    expect(table(one, BUDGET_TABLE_IDS.mensuel).foot?.cells[1]).toEqual({ nd: "non affiché : service de moins de 2 contrats rémunérés (seuil de confidentialité)" });
  });

  it("sans filtre : le réalisé de toute l'entreprise n'est jamais masqué", () => {
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 50 } }));
    expect(table(m, BUDGET_TABLE_IDS.mensuel).rows.map((r) => r.cells[1])).toEqual([1_000_000, 1_050_000, 1_100_000]);
  });
});

// Éléments non récurrents : déjà comptabilisés 800,00 € (ret.realised), prévus 1 500,00 € (ret.projected), somme 2 300,00 €,
// retraité 130 000,00 €. Seuls les contributeurs changent d'un cas à l'autre.
describe("buildBudget — seuil de confidentialité des éléments non récurrents", () => {
  const ND2 = "non affiché (seuil de confidentialité : 2 personnes)";
  const ND3 = "non affiché (seuil de confidentialité : 3 personnes)";
  const lines = (m: ReturnType<typeof buildBudget>) => tile(m, "retraite").variations!.map((v) => [v.label, v.text === null ? null : sp(v.text), v.reason ?? null]);
  const nrRows = (m: ReturnType<typeof buildBudget>) => table(m, BUDGET_TABLE_IDS.atterrissage).rows.slice(3).map((r) => r.cells);
  const att = (m: ReturnType<typeof buildBudget>) => m.blocks.find((b) => b.id === "atterrissage")!;

  it("seuil 2, 1 hypothèse « réalisé » et 1 contrat aux coûts prévus : les deux totaux n.d. ; somme et retraité affichés ; cascade du retraité non tracée", () => {
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 2 } }));
    expect(lines(m)).toEqual([
      ["Non récurrents retirés", "2 300,00 €", null],
      ["Déjà comptabilisés", null, ND2],
      ["Prévus", null, ND2],
    ]);
    expect(sp(tile(m, "retraite").value.text)).toBe("130 000,00 €");
    expect(m.tileNd).toContain(`Déjà comptabilisés, Prévus : ${ND2}`);
    // Tableau exact : les deux lignes n.d. avec la même raison ; atterrissage et retraité inchangés.
    expect(nrRows(m)).toEqual([
      ["Éléments non récurrents déjà comptabilisés", { nd: ND2 }],
      ["Éléments non récurrents prévus (hypothèses)", { nd: ND2 }],
    ]);
    expect(table(m, BUDGET_TABLE_IDS.atterrissage).foot?.cells).toEqual(["Atterrissage retraité 2026", 13_000_000]);
    expect(m.charts.some((c) => c.id === BUDGET_CHART_IDS.retraite)).toBe(false);
    expect(m.charts.some((c) => c.id === BUDGET_CHART_IDS.atterrissage)).toBe(true);
    expect(att(m).nd).toEqual([{ label: "Éléments non récurrents déjà comptabilisés et prévus, cascade du retraité", reason: ND2 }]);
  });

  it("seuil 3, 2 hypothèses « réalisé » et 4 contrats : « Déjà comptabilisés » sous le seuil, « Prévus » masqué en second (sinon 2 300 − 1 500 = 800)", () => {
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 3 }, scenario: scenarioOf({ contributors: { realised: 2, projected: 4 } }) }));
    expect(lines(m).slice(1)).toEqual([
      ["Déjà comptabilisés", null, ND3],
      ["Prévus", null, ND3],
    ]);
  });

  it("seuil 2, 2 hypothèses et 3 contrats : rien n'est masqué, la cascade du retraité est tracée", () => {
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 2 }, scenario: scenarioOf({ contributors: { realised: 2, projected: 3 } }) }));
    expect(lines(m)).toEqual([
      ["Non récurrents retirés", "2 300,00 €", null],
      ["Déjà comptabilisés", "800,00 €", null],
      ["Prévus", "1 500,00 €", null],
    ]);
    expect(nrRows(m)).toEqual([
      ["Éléments non récurrents déjà comptabilisés", -80_000],
      ["Éléments non récurrents prévus (hypothèses)", -150_000],
    ]);
    expect(m.charts.some((c) => c.id === BUDGET_CHART_IDS.retraite)).toBe(true);
    expect(att(m).nd).toEqual([]);
  });

  it("seuil non défini : les deux totaux n.d. avec la raison, une mention du bloc avec le lien vers les Paramètres", () => {
    const why = "seuil de confidentialité non défini (Paramètres)";
    const m = buildBudget(budgetInput({ confidentialite: { kind: "nd", reason: why } }));
    expect(lines(m).slice(1)).toEqual([
      ["Déjà comptabilisés", null, why],
      ["Prévus", null, why],
    ]);
    expect(nrRows(m).map((r) => r[1])).toEqual([{ nd: why }, { nd: why }]);
    expect(att(m).nd).toEqual([{ label: "Éléments non récurrents déjà comptabilisés et prévus, cascade du retraité", reason: why, action: { href: "/e/demo/parametres#croisee", label: "Paramètres" } }]);
    expect(m.charts.some((c) => c.id === BUDGET_CHART_IDS.retraite)).toBe(false);
  });

  it("seuil 3, contributeurs qui se compensent (2 hypothèses, somme 0) et aucun prévu : n.d. sans la phrase « Aucun élément non récurrent », qui dirait 0", () => {
    const zero: Retraite = { kind: "value", year: "2026", atterrissage: 13_230_000, rows: [], realised: 0, projected: 0, total: 0, retraite: 13_230_000 };
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 3 }, scenario: scenarioOf({ retraite: zero, contributors: { realised: 2, projected: 0 } }) }));
    expect(lines(m).slice(1)).toEqual([
      ["Déjà comptabilisés", null, ND3],
      ["Prévus", null, ND3],
    ]);
    expect(att(m).notes).toEqual([]);
    expect(att(m).nd).toEqual([{ label: "Éléments non récurrents déjà comptabilisés et prévus", reason: ND3 }]);
  });

  it("contributeurs des prévus non dénombrés : « Prévus » non vérifiable, « Déjà comptabilisés » masqué en second", () => {
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 2 }, scenario: scenarioOf({ contributors: { realised: 5, projected: null } }) }));
    expect(lines(m).slice(1)).toEqual([
      ["Déjà comptabilisés", null, ND2],
      ["Prévus", null, "effectif du groupe non dénombré : seuil de confidentialité non vérifiable"],
    ]);
  });

  it("rendu : la mention n.d. du bloc Atterrissage et le lien vers les Paramètres sont écrits", () => {
    const out = sp(renderToStaticMarkup(h(BlocksChapter, { model: buildBudget(budgetInput({ confidentialite: { kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" } })), slug: "demo", affichage: "tout", tableauHref: "/x" })));
    expect(out).toContain('data-testid="cx-budget-atterrissage-nd"');
    expect(out).toContain("Éléments non récurrents déjà comptabilisés et prévus, cascade du retraité");
    expect(out).toContain('href="/e/demo/parametres#croisee"');
    expect(out).not.toContain('data-testid="cx-chart-budget-retraite-cascade"');
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
    const f = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, serviceSizes: { months: [3, 3, 3], period: 3 } }));
    expect(tile(f, "budget").value.reason).toBe("budget saisi global : non filtrable par service");
    expect(tile(f, "atterrissage").value.reason).toBe("scénario global : non filtrable par service");
    expect(f.blocks.find((b) => b.id === "prevision")!.nd[0].reason).toBe("scénario global : non filtrable par service");
    expect(f.charts).toHaveLength(0);
    expect(f.limits[0]).toContain("non filtrables par service");
    expect(sp(tile(f, "realise").value.text)).toBe("31 500,00 €");
    // Effectif du service non dénombré : le seuil ne peut pas être vérifié, le réalisé n'est pas affiché.
    const u = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" } }));
    expect(tile(u, "realise").value.reason).toBe("effectif du groupe non dénombré : seuil de confidentialité non vérifiable");
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
  masse: { cur: { kind: "value", num: 868_000, den: 1 }, prev: { kind: "value", num: 560_000, den: 1 } },
  pont: PONT,
  cascade: CASCADE,
  etp: { cur: { kind: "value", num: 30_000, den: 20_000 }, prev: { kind: "value", num: 20_000, den: 20_000 } },
  confidentialite: SEUIL_1,
  serviceSizes: null,
  hrefs: { analyse: "/e/demo/studio-rh/masse-salariale/analyse?v1=reel%3A2025&v2=reel%3A2026&de=01&a=02", embauches: "/e/demo/studio-rh/hypotheses", globales: "/e/demo/studio-rh/hypotheses", fixeVariable: "/x?chapitre=fixe-variable", parametres: "/e/demo/parametres#croisee" },
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
    // Écart de coût : masse N et N-1 sur leur ligne, avec le libellé de chaque période.
    expect(tile(m, "ecart").variations!.map((v) => [v.label, sp(v.text!)])).toEqual([["N (janvier → février 2026)", "8 680,00 €"], ["N-1 (janvier → février 2025)", "5 600,00 €"]]);
    const etp = tile(m, "etp");
    expect(etp.value.text).toBe("1,50 ETP");
    expect(etp.cost).toBeFalsy();
    expect(etp.variations!.map((v) => [v.label, v.text, v.tone])).toEqual([["N-1 (janvier → février 2025)", "1,00 ETP", "flat"], ["Écart", "+0,50 ETP", "flat"]]);
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

  it("pont et cascade n.d. : effets n.d. avec la raison (mois en toutes lettres), aucun graphique, bloc n.d. ; l'écart de masse reste affiché (il ne dépend pas de l'ETP)", () => {
    const n = buildEffets(effetsInput({ pont: { kind: "nd", reason: "Réel PayFit 2026 : ETP n.d. (2026-02)" }, cascade: { kind: "nd", reason: "service des collaborateurs non historisé" } }));
    expect(n.tiles.slice(1, 3).map((t) => t.value)).toEqual(Array(2).fill({ text: "n.d.", kind: "nd", reason: "Réel PayFit 2026 : ETP n.d. (février 2026)" }));
    // 8 680,00 − 5 600,00 = +3 080,00 €.
    expect(sp(tile(n, "ecart").value.text)).toBe("+3 080,00 €");
    expect(n.charts).toHaveLength(0);
    expect(n.tables).toHaveLength(0);
    expect(n.blocks.map((b) => b.nd[0]?.reason)).toEqual(["Réel PayFit 2026 : ETP n.d. (février 2026)", "service des collaborateurs non historisé"]);
  });

  it("masse n.d. : l'écart de masse est n.d. avec la raison de la masse", () => {
    const n = buildEffets(effetsInput({ masse: { cur: { kind: "nd", reason: "2026-02 : paie non clôturée à la lecture" }, prev: { kind: "value", num: 560_000, den: 1 } } }));
    expect(tile(n, "ecart").value).toEqual({ text: "n.d.", kind: "nd", reason: "février 2026 : paie non clôturée à la lecture" });
  });
});

describe("buildEffets — seuil de confidentialité sur la cascade d'ETP", () => {
  // Paliers : entrées nouvelles +0,50 ETP (1 contrat fictif), sorties −0,25 ETP (3 contrats), changement d'ETP +0,25 ETP (4 contrats),
  // les autres paliers vides. Départ 1,00 ; arrivée 1,50.
  const C3: Cascade = {
    kind: "value",
    months: 2,
    start: 10_000,
    end: 15_000,
    steps: [
      { id: "entrees-new", label: STEP_LABELS["entrees-new"], etp4: 5_000, people: [{ key: "k1", etp4: 5_000 }] },
      { id: "entrees-report", label: STEP_LABELS["entrees-report"], etp4: 0, people: [] },
      { id: "sorties", label: STEP_LABELS.sorties, etp4: -2_500, people: [{ key: "k2", etp4: -1_000 }, { key: "k3", etp4: -1_000 }, { key: "k4", etp4: -500 }] },
      { id: "sorties-deport", label: STEP_LABELS["sorties-deport"], etp4: 0, people: [] },
      { id: "etp-change", label: STEP_LABELS["etp-change"], etp4: 2_500, people: [{ key: "k5", etp4: 1_000 }, { key: "k6", etp4: 1_000 }, { key: "k7", etp4: 250 }, { key: "k8", etp4: 250 }] },
    ],
    residual: 0,
  };
  const N2 = { nd: "non affiché (seuil de confidentialité : 2 personnes)" };

  it("seuil 2 : « entrées nouvelles » (1 contrat) masqué ; secondaire : le plus petit palier affiché (« entrées : effet report », 0) ; graphique non tracé", () => {
    const m = buildEffets(effetsInput({ cascade: C3, confidentialite: { kind: "set", value: 2 } }));
    const t = table(m, EFFETS_TABLE_IDS.etp);
    expect(t.rows.map((r) => r.cells[2])).toEqual(["", N2, N2, -2_500, 0, 2_500, 0, 5_000]);
    expect(t.foot?.cells).toEqual(["ETP moyen N (janvier → février 2026)", 15_000, ""]);
    expect(m.charts.some((c) => c.id === EFFETS_CHART_IDS.etp)).toBe(false);
    expect(m.blocks.find((b) => b.id === "etp")!.nd).toEqual([{ label: "Graphique de la cascade d'ETP", reason: "non affiché (seuil de confidentialité : 2 personnes)" }]);
    // Aucune clé de contrat dans le modèle.
    expect(JSON.stringify(m)).not.toMatch(/"k\d"/);
  });

  it("seuil 1 : rien n'est masqué, la cascade est tracée ; seuil non défini : bloc n.d. avec le lien vers les Paramètres", () => {
    const m1 = buildEffets(effetsInput({ cascade: C3 }));
    expect(table(m1, EFFETS_TABLE_IDS.etp).rows.map((r) => r.cells[2])).toEqual(["", 5_000, 0, -2_500, 0, 2_500, 0, 5_000]);
    expect(m1.charts.some((c) => c.id === EFFETS_CHART_IDS.etp)).toBe(true);
    const mx = buildEffets(effetsInput({ cascade: C3, confidentialite: { kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" } }));
    expect(mx.blocks.find((b) => b.id === "etp")!.nd).toEqual([{ label: "Cascade d'ETP", reason: "seuil de confidentialité non défini (Paramètres)", action: { href: "/e/demo/parametres#croisee", label: "Paramètres" } }]);
    expect(mx.tables.some((t) => t.id === EFFETS_TABLE_IDS.etp)).toBe(false);
    // Le pont de toute l'entreprise reste affiché.
    expect(sp(tile(mx, "volume").value.text)).toBe("+2 800,00 €");
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
// seuil : seuil de confidentialité de l'espace (null : non défini) ; etp : ETP du service par mois ; scénario : base, projection, début.
type FakeOpts = { seuil?: number | null; etp?: (months: string[]) => { month: string; etp4: number | null; reason: string | null }[]; base?: BaseSnapshot; firstMonth?: string; hyps?: Hypothesis[] };
function fakeCtx(service: string | undefined, kpiInput: unknown = null, o: FakeOpts = {}): CroiseeContext {
  const b = o.base ?? baseSnap;
  const pr = o.base || o.hyps ? project(b, "2026-03", "2026-12", o.hyps ?? [], { prorata: "calendaire" }) : proj;
  const scenario: ScenarioLoad = { kind: "value", full: { scenario: { id: "s1", name: "Scénario test", firstMonth: o.firstMonth ?? "2026-03", lastMonth: "2026-12" }, base: b, baseHash: "h", hypotheses: o.hyps ?? [] } as never, proj: pr };
  const seuil = o.seuil === undefined ? 2 : o.seuil;
  return {
    slug: "demo",
    settings: { confidentialite: seuil === null ? { kind: "absent" } : { kind: "set", value: seuil, updatedAt: null, updatedBy: null } },
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
      payroll: async () => ({ input: journal, kpi: { input: kpiInput }, etp: (months: string[]) => (o.etp ?? etpOf)(months), unavailable: null, source: "payfit" }) as never,
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

  it("filtre de service TECH : réalisé et contrats du service ; budget et scénario n.d. ; seuil 2 : contrats observés n.d. (1 contrat en N-1)", async () => {
    const input = await loadBudgetInput(fakeCtx("TECH"));
    if (input.kind !== "value") throw new Error(input.reason);
    expect(input.budget).toEqual({ kind: "na", reason: "budget saisi global : non filtrable par service" });
    expect(input.scenario).toEqual({ kind: "na", reason: "scénario global : non filtrable par service" });
    // Effectif du service : alpha et gamma payés en janvier et en février 2026 → 2, 2 ; 2 contrats distincts sur la période.
    expect(input.serviceSizes).toEqual({ months: [2, 2], period: 2 });
    const m = buildBudget(input);
    // TECH, N : alpha 2 × 2 940 + gamma 2 × 1 400 = 8 680,00 € (2 contrats ≥ seuil 2 : affiché).
    expect(sp(tile(m, "realise").value.text)).toBe("8 680,00 €");
    expect(input.cohorts.kind === "value" && input.cohorts.total).toEqual({ count: 2, prev: 560_000, cur: 868_000, delta: 308_000 });
    // N-1 : alpha seul (1 contrat < 2) : le tableau du service n'est pas affiché.
    expect(m.blocks.find((b) => b.id === "personnes")!.nd).toEqual([{ label: "Contrats observés", reason: "non affiché : service de moins de 2 contrats observés sur N ou sur N-1 (seuil de confidentialité)" }]);
    expect(m.tables.some((t) => t.id === BUDGET_TABLE_IDS.personnes)).toBe(false);
    // Seuil 3 : le service (2 contrats) est sous le seuil : réalisé n.d., aucune valeur du service dans le tableau mensuel.
    const m3 = buildBudget(await loadBudgetInput(fakeCtx("TECH", null, { seuil: 3 })));
    expect(tile(m3, "realise").value).toEqual({ text: "n.d.", kind: "nd", reason: "non affiché : service de moins de 3 contrats rémunérés (seuil de confidentialité)" });
    expect(table(m3, BUDGET_TABLE_IDS.mensuel).rows.every((r) => typeof r.cells[1] === "object")).toBe(true);
    // Seuil non défini : chiffres du service n.d. avec la raison et le lien vers les Paramètres.
    const mx = buildBudget(await loadBudgetInput(fakeCtx("TECH", null, { seuil: null })));
    expect(tile(mx, "realise").value.reason).toBe("seuil de confidentialité non défini (Paramètres)");
    expect(mx.blocks.find((b) => b.id === "ecart")!.nd).toEqual([{ label: "Réalisé du service", reason: "seuil de confidentialité non défini (Paramètres)", action: { href: "/e/demo/parametres#croisee", label: "Paramètres" } }]);
  });

  it("paidSizes : contrats rémunérés (ligne de brut) par mois et contrats distincts sur la période ; mois hors lecture → null", () => {
    // Toute l'entreprise, 2025 : alpha, beta → 2 par mois, 2 distincts. TECH 2026 : alpha, gamma. TECH 2025 : alpha seul.
    expect(paidSizes(journal, ["2025-01", "2025-02"])).toEqual({ months: [2, 2], period: 2 });
    const tech = { ...journal, serviceFilter: { value: "TECH" } };
    expect(paidSizes(tech, ["2026-01", "2026-02"])).toEqual({ months: [2, 2], period: 2 });
    expect(paidSizes(tech, ["2025-01", "2025-02"])).toEqual({ months: [1, 1], period: 1 });
    expect(paidSizes(journal, ["2024-12", "2025-01"])).toEqual({ months: [null, 2], period: null });
  });

  it("atterrissage : lien vers Hypothèses seulement quand le scénario commence l'année de la période", async () => {
    const same = await loadBudgetInput(fakeCtx(undefined));
    expect(same.kind === "value" && same.hrefs.atterrissage).toBe("/e/demo/studio-rh/hypotheses?scenario=s1&vue=resultat&sous=atterrissage");
    const other = await loadBudgetInput(fakeCtx(undefined, null, { firstMonth: "2025-10" }));
    expect(other.kind === "value" && other.hrefs.atterrissage).toBeNull();
    expect(other.kind === "value" && other.hrefs.parametres).toBe("/e/demo/parametres#croisee");
  });

  it("aucune identité : la raison n.d. du moteur qui nomme un contrat sans base est remplacée par un décompte", async () => {
    // Contrat fictif sans base : le moteur rend chaque mois projeté n.d. avec son libellé.
    const B: BaseContract = { ...A, contractKey: "payfit:y", externalId: "y", label: "Camille Exemple", base: null, baseNd: "salaire de base absent" };
    const withNd: BaseSnapshot = { ...baseSnap, contracts: [A, B] };
    const raw = project(withNd, "2026-03", "2026-12", [], { prorata: "calendaire" });
    expect(raw.kind === "value" && raw.months[0].kind === "nd" && raw.months[0].reasons).toEqual(["Camille Exemple : base n.d. (salaire de base absent) — saisir une correction de base"]);
    const input = await loadBudgetInput(fakeCtx(undefined, null, { base: withNd }));
    if (input.kind !== "value" || input.scenario.kind !== "value") throw new Error("scénario attendu");
    // Raison de l'année regroupée : dix mois projetés, une même raison.
    expect(input.scenario.landing).toEqual({ kind: "nd", year: "2026", reason: "mars 2026, avr. 2026, mai 2026, juin 2026, juil. 2026, août 2026, sept. 2026, oct. 2026, nov. 2026, déc. 2026 : 1 contrat sans base de projection (détail dans Hypothèses budgétaires)" });
    const m = buildBudget(input);
    expect(table(m, BUDGET_TABLE_IDS.douzeMois).rows[2].cells[2]).toEqual({ nd: "1 contrat sans base de projection (détail dans Hypothèses budgétaires)" });
    expect(JSON.stringify(m)).not.toMatch(/Camille|Exemple|payfit:y/);
  });

  it("éléments non récurrents du scénario : contributeurs comptés (contrat, à défaut hypothèse) ; seuil 2 : les deux totaux n.d. ; seuil 1 : affichés", async () => {
    // Hypothèses fictives : prime déjà comptabilisée en janvier 2026, 1 200,00 € ; départ du contrat payfit:x fin juin 2026 avec
    // 5 000,00 € de coûts de sortie et ponctuel non récurrent de 300,00 € en mai sur le même contrat (un seul contributeur) ;
    // enveloppe non récurrente de 200,00 € en avril, sans contrat (contributeur : l'hypothèse).
    const hyps: Hypothesis[] = [
      { id: "h-real", kind: "realise", label: "Saisie fictive", category: "Prime fictive", month: "2026-01", costCents: 120_000 },
      { id: "h-dep", kind: "depart", label: "Départ fictif", contractKey: "payfit:x", lastPaidDate: "2026-06-30", exitCost: { mode: "charge", costCents: 500_000 }, motif: "Motif fictif" },
      { id: "h-pon", kind: "ponctuel", label: "Ponctuel fictif", month: "2026-05", amount: { mode: "charge", costCents: 30_000 }, service: null, nonRecurring: true, contractKey: "payfit:x" },
      { id: "h-env", kind: "enveloppe", label: "Enveloppe fictive", axis: "rubrique", target: "Divers", monthly: { "2026-04": 20_000 }, chargesBps: null, nonRecurring: true },
    ];
    const input = await loadBudgetInput(fakeCtx(undefined, null, { hyps }));
    if (input.kind !== "value" || input.scenario.kind !== "value") throw new Error("scénario attendu");
    // Déjà comptabilisés : 1 hypothèse, 1 200,00 €. Prévus : payfit:x (5 000 + 300) et l'enveloppe (200) → 2 contributeurs, 5 500,00 €.
    expect(input.scenario.contributors).toEqual({ realised: 1, projected: 2 });
    expect(input.scenario.retraite).toMatchObject({ kind: "value", realised: 120_000, projected: 550_000, total: 670_000 });
    // Seuil 2 : « Déjà comptabilisés » (1) masqué ; « Prévus » (2) masqué en second, sinon 6 700 − 5 500 = 1 200.
    const m = buildBudget(input);
    const nd2 = "non affiché (seuil de confidentialité : 2 personnes)";
    expect(tile(m, "retraite").variations!.map((v) => [v.label, v.text === null ? null : sp(v.text), v.reason ?? null])).toEqual([
      ["Non récurrents retirés", "6 700,00 €", null],
      ["Déjà comptabilisés", null, nd2],
      ["Prévus", null, nd2],
    ]);
    expect(JSON.stringify(m)).not.toMatch(/Prime fictive|Motif fictif|payfit:x|h-env/);
    const m1 = buildBudget(await loadBudgetInput(fakeCtx(undefined, null, { hyps, seuil: 1 })));
    expect(tile(m1, "retraite").variations!.map((v) => [v.label, sp(v.text!)])).toEqual([
      ["Non récurrents retirés", "6 700,00 €"],
      ["Déjà comptabilisés", "1 200,00 €"],
      ["Prévus", "5 500,00 €"],
    ]);
  });

  it("publicProjectionReasons : décompte des raisons nominatives et des autres raisons, sans aucun texte du moteur", () => {
    expect(publicProjectionReasons(["Nom Un : base n.d. (x) — saisir une correction de base", "Nom Deux : base n.d. (y) — saisir une correction de base", "texte inconnu Nom Trois"])).toEqual([
      "2 contrats sans base de projection (détail dans Hypothèses budgétaires)",
      "1 autre raison de n.d. de la projection (détail dans Hypothèses budgétaires)",
    ]);
    expect(publicProjectionReasons([])).toEqual([]);
  });

  it("budgetModel : un seul calcul par contexte de requête (écran et export)", async () => {
    const ctx = fakeCtx(undefined);
    let calls = 0;
    const load = ctx.load.payroll;
    ctx.load.payroll = () => {
      calls += 1;
      return load();
    };
    const a = await budgetModel(ctx);
    expect(await budgetModel(ctx)).toBe(a);
    expect(calls).toBe(1);
    expect(a).toEqual(buildBudget(await loadBudgetInput(fakeCtx(undefined))));
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
    // Masse N et N-1 (aggregate, sans ETP) : 8 680,00 € et 5 600,00 €.
    expect(input.masse).toEqual({ cur: aggregate(b, monthsB, "masse"), prev: aggregate(a, monthsA, "masse") });
    expect(input.masse).toEqual({ cur: { kind: "value", num: 868_000, den: 1 }, prev: { kind: "value", num: 560_000, den: 1 } });
    // Effectif du service : 2 contrats en N (alpha, gamma), 1 en N-1 (alpha).
    expect(input.serviceSizes).toEqual({ cur: 2, prev: 1 });
  });

  it("service TECH sous le seuil (1 contrat en N-1, seuil 2) : cartes et pont du service n.d. ; seuil 1 : affichés", async () => {
    const m = buildEffets(await loadEffetsInput(fakeCtx("TECH", {})));
    const r = "non affiché : service de moins de 2 contrats rémunérés (seuil de confidentialité)";
    expect(m.tiles.map((t) => t.value)).toEqual(Array(4).fill({ text: "n.d.", kind: "nd", reason: r }));
    expect(m.tiles.every((t) => (t.variations ?? []).length === 0)).toBe(true);
    expect(m.tables).toHaveLength(0);
    expect(m.blocks.find((b) => b.id === "decomposition")!.nd).toEqual([{ label: "Pont volume / coût moyen du service", reason: r }]);
    const m1 = buildEffets(await loadEffetsInput(fakeCtx("TECH", {}, { seuil: 1 })));
    expect(m1.tiles.slice(0, 3).map((t) => sp(t.value.text))).toEqual(["+3 080,00 €", "+2 800,00 €", "+280,00 €"]);
    // Seuil non défini : n.d. avec la raison et le lien vers les Paramètres.
    const mx = buildEffets(await loadEffetsInput(fakeCtx("TECH", {}, { seuil: null })));
    expect(tile(mx, "ecart").value.reason).toBe("seuil de confidentialité non défini (Paramètres)");
    expect(mx.blocks.find((b) => b.id === "decomposition")!.nd[0].action).toEqual({ href: "/e/demo/parametres#croisee", label: "Paramètres" });
  });

  it("pont n.d. : la raison est datée du mois réel de N (le pont aligne N sur les mois de N-1)", async () => {
    // ETP du service n.d. en février 2026 seulement.
    const etp = (months: string[]) => months.map((month) => ({ month, etp4: month === "2026-02" ? null : month < "2026" ? 10_000 : 15_000, reason: month === "2026-02" ? "quotité absente" : null }));
    const input = await loadEffetsInput(fakeCtx("TECH", {}, { etp, seuil: 1 }));
    if (input.kind !== "value") throw new Error(input.reason);
    expect(input.pont.kind).toBe("nd");
    const reason = input.pont.kind === "nd" ? input.pont.reason : "";
    expect(reason).toContain("2026-02");
    expect(reason).not.toContain("2025-02");
    // L'écart de masse reste calculé : il ne dépend pas de l'ETP.
    expect(sp(tile(buildEffets(input), "ecart").value.text)).toBe("+3 080,00 €");
  });

  it("effetsModel : un seul calcul par contexte de requête", async () => {
    const ctx = fakeCtx("TECH", {}, { seuil: 1 });
    expect(await effetsModel(ctx)).toBe(await effetsModel(ctx));
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

  it("seuil non défini : mention n.d. du bloc des contrats observés avec le lien vers les Paramètres ; seuil 2 : cellules n.d. avec la raison", () => {
    const out = render(buildBudget(budgetInput({ confidentialite: { kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" } })));
    expect(out).toContain('data-testid="cx-budget-personnes-nd"');
    expect(out).toContain("seuil de confidentialité non défini (Paramètres)");
    expect(out).toContain('href="/e/demo/parametres#croisee"');
    expect(out).not.toContain('data-testid="cx-table-budget-personnes"');
    const masked = render(buildBudget(budgetInput({ confidentialite: { kind: "set", value: 2 } })));
    expect(masked).toContain('data-testid="cx-table-budget-personnes"');
    expect(masked).toContain("non affiché (seuil de confidentialité : 2 personnes)");
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
