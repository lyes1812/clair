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
import { confidentialiteReason, SEUIL_NON_VERIFIABLE, type PersonLink, type PersonsOfContracts } from "@/lib/confidentialite";
import type { JournalGroup } from "@/lib/croisee/confidentialite";
import { glossaryEntry } from "@/lib/glossary";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { fmtFixed } from "@/lib/rh/kpi/format";
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
  CASCADE_NON_RAPPROCHEE,
  ETP_ND_PUBLIC,
  loadEffetsInput,
  masseContracts,
  observedSizes,
  plotEtp4,
  publicProjectionReasons,
  publicScenario,
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
// Personnes distinctes d'un groupe (jetons) ; unlinked : contrats non reliés à une personne.
const G = (persons: string[], unlinked = 0): PersonsOfContracts => ({ persons, unlinked });
const P = (n: number, prefix = "p") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
// Groupe d'un service (contrats observés) : personnes, et présence d'une masse non nulle.
const S = (persons: string[], nonZero = true, unlinked = 0): JournalGroup => ({ persons, unlinked, nonZero });
const CONF_HREF = "/e/demo/parametres#confidentialite";
// Contributeurs fictifs des éléments non récurrents (cas de base, seuil 1) : 1 personne déjà comptabilisée, 1 contrat relié aux coûts
// prévus. Une hypothèse « réalisé » réelle n'est reliée à personne : les cas « non relié » sont plus bas.
const NR1 = { realised: G(["q1"]), projected: G(["p1"]) };
type ScenarioIn = Extract<Extract<BudgetChapterInput, { kind: "value" }>["scenario"], { kind: "value" }>;
const scenarioOf = (over: Partial<ScenarioIn> = {}): ScenarioIn => ({ kind: "value", name: "Scénario test", refMonth: "2026-03", series: scen, landing: land, retraite: ret, contributors: NR1, ...over });
const HREFS = { hypotheses: "/e/demo/studio-rh/hypotheses", comparaison: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=resultat&sous=comparaison&annee=2026", atterrissage: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=resultat&sous=atterrissage", postes: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=postes", embauches: "/e/demo/studio-rh/hypotheses?scenario=s1&vue=embauches", parametres: CONF_HREF };
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
      onlyPrev: { count: 1, prev: 100_000, cur: 0, delta: -100_000, ...G(["a"]) },
      onlyCur: { count: 2, prev: 0, cur: 150_000, delta: 150_000, ...G(["d", "e"]) },
      both: { count: 2, prev: 250_000, cur: 255_000, delta: 5_000, ...G(["b", "c"]) },
      outside: { prev: 1_000, cur: 2_500, delta: 1_500 },
      total: { count: 5, prev: 351_000, cur: 407_500, delta: 56_500, ...G(["a", "b", "c", "d", "e"]) },
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
    const z = buildBudget(budgetInput({ scenario: scenarioOf({ retraite: { kind: "value", year: "2026", atterrissage: 13_230_000, rows: [], realised: 0, projected: 0, total: 0, retraite: 13_230_000 }, contributors: { realised: G([]), projected: G([]) } }) }));
    const t = table(z, BUDGET_TABLE_IDS.atterrissage);
    expect(Object.is(t.rows[3].cells[1], 0)).toBe(true);
    expect(Object.is(t.rows[4].cells[1], 0)).toBe(true);
    expect(z.charts.some((c) => c.id === BUDGET_CHART_IDS.retraite)).toBe(false);
    // La raison écrite est celle de la cascade (retraiteWaterfall) : le graphique ne disparaît jamais sans phrase.
    expect(z.blocks.find((b) => b.id === "atterrissage")!.notes).toEqual(["Aucun élément non récurrent : l'atterrissage retraité 2026 égale l'atterrissage."]);
  });

  it("des lignes non récurrentes à 0 : même phrase (cascade « vide »), pas de cascade du retraité", () => {
    const z = buildBudget(budgetInput({ scenario: scenarioOf({ retraite: { kind: "value", year: "2026", atterrissage: 13_230_000, rows: [{ label: "Saisie annulée", realised: 0, projected: 0 }], realised: 0, projected: 0, total: 0, retraite: 13_230_000 }, contributors: { realised: G([]), projected: G([]) } }) }));
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
    // Sans lignes sans contrat : au seuil 1, rien n'est masqué.
    const t = table(buildBudget(budgetInput({ cohorts: { kind: "value", onlyPrev: { count: 1, prev: 100_000, cur: 0, delta: -100_000, ...G(["a"]) }, onlyCur: { count: 2, prev: 0, cur: 150_000, delta: 150_000, ...G(["d", "e"]) }, both: { count: 2, prev: 250_000, cur: 255_000, delta: 5_000, ...G(["b", "c"]) }, outside: null, total: { count: 5, prev: 350_000, cur: 405_000, delta: 55_000, ...G(["a", "b", "c", "d", "e"]) } } })), BUDGET_TABLE_IDS.personnes);
    expect(t.title).toBe("Écart de masse lié aux contrats observés, janvier → mars 2026 face à janvier → mars 2025");
    expect(t.columns.map((c) => c.header)).toEqual(["Groupe", "Contrats", "Coût N-1 (janvier → mars 2025)", "Coût N (janvier → mars 2026)", "Contribution à l'écart"]);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Contrats observés seulement en N-1", 1, 100_000, "", -100_000],
      ["Contrats observés seulement en N", 2, "", 150_000, 150_000],
      ["Contrats observés dans les deux périodes", 2, 250_000, 255_000, 5_000],
    ]);
    expect(t.foot?.cells).toEqual(["Total", 5, 350_000, 405_000, 55_000]);
    expect(cellView(t.rows[0].cells[3], t.columns[3]).text).toBe("—");
  });

  it("lignes du journal sans contrat d'un montant non nul : « non vérifiable », même au seuil 1, avec masquage secondaire dans chaque colonne", () => {
    // Lignes sans contrat : 10,00 € en N-1, 25,00 € en N (aucun contrat dénombré). Seuil 1. Coût N-1 : seules, elles se liraient par
    // 3 510,00 − 1 000,00 − 2 500,00 → la plus petite ligne qui compte un contrat, « seulement N-1 » (1 000,00 €), est masquée en second
    // (en bloc : nombre et contribution aussi). Coût N : « seulement N » (1 500,00 € < 2 550,00 €) masqué en second. Contrats et
    // contribution : déjà deux lignes masquées, 3 contrats. « Les deux » reste affiché ; le total n'est jamais masqué.
    const t = table(m, BUDGET_TABLE_IDS.personnes);
    const N1 = { nd: confidentialiteReason(1) };
    const NV = { nd: "effectif du groupe non dénombré : seuil de confidentialité non vérifiable" };
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Contrats observés seulement en N-1", N1, N1, "", N1],
      ["Contrats observés seulement en N", N1, "", N1, N1],
      ["Contrats observés dans les deux périodes", 2, 250_000, 255_000, 5_000],
      ["Lignes du journal sans contrat", "", NV, NV, NV],
    ]);
    expect(t.foot?.cells).toEqual(["Total", 5, 351_000, 407_500, 56_500]);
    for (const j of [1, 2, 3, 4]) expect(t.rows.filter((r) => typeof r.cells[j] === "object").length, `colonne ${j}`).not.toBe(1);
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
  const ND2 = { nd: confidentialiteReason(2) };
  const NV2 = { nd: "effectif du groupe non dénombré : seuil de confidentialité non vérifiable" };

  it("seuil non défini : bloc des contrats observés n.d. avec la raison et le lien vers les Paramètres ; le reste du chapitre est affiché", () => {
    const m = buildBudget(budgetInput({ confidentialite: { kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" } }));
    expect(m.blocks.find((b) => b.id === "personnes")!.nd).toEqual([{ label: "Contrats observés", reason: "seuil de confidentialité non défini (Paramètres)", action: { href: CONF_HREF, label: "Paramètres" } }]);
    expect(m.tables.some((t) => t.id === BUDGET_TABLE_IDS.personnes)).toBe(false);
    expect(sp(tile(m, "realise").value.text)).toBe("31 500,00 €");
  });

  it("seuil 2 : « seulement N-1 » (1 contrat) masqué ; masquage secondaire jusqu'à deux contrats masqués par colonne, les lignes sans contrat ne protégeant personne ; total inchangé", () => {
    const t = table(buildBudget(budgetInput({ confidentialite: { kind: "set", value: 2 } })), BUDGET_TABLE_IDS.personnes);
    // Lignes sans contrat (montants non nuls) : non vérifiables. Contrats : « seulement N » (2, premier des plus petits) masqué en second
    // (1 + 2 = 3 contrats). Coût N-1 : « seulement N-1 » (1 contrat) et les lignes sans contrat (aucun) ne comptent qu'un contrat →
    // « les deux » masqué (3 contrats). Coût N et contribution : déjà trois lignes masquées, 4 et 5 contrats.
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["Contrats observés seulement en N-1", ND2, ND2, "", ND2],
      ["Contrats observés seulement en N", ND2, "", ND2, ND2],
      ["Contrats observés dans les deux périodes", ND2, ND2, ND2, ND2],
      ["Lignes du journal sans contrat", "", NV2, NV2, NV2],
    ]);
    // Le total n'est jamais masqué ; aucune valeur masquée ne se retrouve par différence d'une colonne (au moins deux n.d. par colonne).
    expect(t.foot?.cells).toEqual(["Total", 5, 351_000, 407_500, 56_500]);
    for (const j of [1, 2, 3, 4]) expect(t.rows.filter((r) => typeof r.cells[j] === "object").length, `colonne ${j}`).not.toBe(1);
  });

  it("filtre de service : un mois de 1 contrat masqué, le plus petit autre mois aussi ; total de la période affiché", () => {
    // Service : 3 personnes en janvier, 1 en février, 3 en mars, 4 distinctes sur la période ; seuil 2. Février masqué ; secondaire :
    // janvier (10 000,00 €, plus petit que mars 11 000,00 €). Réalisé de la période : 31 500,00 €.
    const m = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, confidentialite: { kind: "set", value: 2 }, serviceSizes: { months: [S(P(3)), S(["p1"]), S(["p1", "p2", "p4"])], period: S(P(4)) } }));
    const t = table(m, BUDGET_TABLE_IDS.mensuel);
    expect(t.rows.map((r) => r.cells[1])).toEqual([ND2, ND2, 1_100_000]);
    expect(t.foot?.cells[1]).toBe(3_150_000);
    expect(sp(tile(m, "realise").value.text)).toBe("31 500,00 €");
    // Service d'une personne sur la période : carte et tableau n.d., avec la seule raison du seuil.
    const one = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, confidentialite: { kind: "set", value: 2 }, serviceSizes: { months: [S(["p1"]), S(["p1"]), S(["p1"])], period: S(["p1"]) } }));
    expect(tile(one, "realise").value.reason).toBe(confidentialiteReason(2));
    expect(table(one, BUDGET_TABLE_IDS.mensuel).foot?.cells[1]).toEqual(ND2);
  });

  it("filtre de service : une personne présente dans deux mois masqués n'y compte qu'une fois (personnes distinctes) ; un contrat non relié ne protège pas", () => {
    // Seuil 3. Service : janvier et février portés par les deux mêmes personnes (p1, p2 : deux contrats chacune, ou un contrat qui dure),
    // mars par 5 personnes (p1 à p5) ; 5 personnes distinctes sur la période. Janvier et février (2 personnes chacun) masqués ;
    // ensemble ils ne décrivent que 2 personnes (< 3) : mars affiché donnerait janvier + février = 31 500,00 − 11 000,00 = 20 500,00 €
    // par différence → mars masqué en second (5 personnes au total). Additionner les tailles (2 + 2 = 4 ≥ 3) aurait laissé mars affiché.
    const ND3 = { nd: confidentialiteReason(3) };
    const m = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, confidentialite: { kind: "set", value: 3 }, serviceSizes: { months: [S(P(2)), S(P(2)), S(P(5))], period: S(P(5)) } }));
    const t = table(m, BUDGET_TABLE_IDS.mensuel);
    expect(t.rows.map((r) => r.cells[1])).toEqual([ND3, ND3, ND3]);
    expect(t.foot?.cells[1]).toBe(3_150_000);
    expect(sp(tile(m, "realise").value.text)).toBe("31 500,00 €");
    // Mars porté par 3 nouvelles personnes seulement (p3 à p5) : janvier et février masqués décrivent 2 personnes, mars 3 ; mars est
    // tout de même masqué en second (le seul autre mois).
    const other = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, confidentialite: { kind: "set", value: 3 }, serviceSizes: { months: [S(P(2)), S(P(2)), S(["p3", "p4", "p5"])], period: S(P(5)) } }));
    expect(table(other, BUDGET_TABLE_IDS.mensuel).rows.map((r) => r.cells[1])).toEqual([ND3, ND3, ND3]);
    // Février : 2 personnes reliées et 1 contrat non relié : non dénombré (le contrat ne protège pas) ; janvier (2) masqué ; mars (5)
    // masqué en second. La période compte 5 personnes reliées : le total reste affiché malgré le contrat non relié.
    const unlinked = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, confidentialite: { kind: "set", value: 3 }, serviceSizes: { months: [S(P(2)), S(P(2), true, 1), S(P(5))], period: S(P(5), true, 1) } }));
    expect(table(unlinked, BUDGET_TABLE_IDS.mensuel).rows.map((r) => r.cells[1])).toEqual([ND3, { nd: SEUIL_NON_VERIFIABLE }, ND3]);
    expect(sp(tile(unlinked, "realise").value.text)).toBe("31 500,00 €");
    // Période de 2 personnes reliées et 1 contrat non relié : tout le réalisé est non vérifiable.
    const periodNd = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, confidentialite: { kind: "set", value: 3 }, serviceSizes: { months: [S(P(2)), S(P(2)), S(P(2))], period: S(P(2), true, 1) } }));
    expect(tile(periodNd, "realise").value).toEqual({ text: "n.d.", kind: "nd", reason: SEUIL_NON_VERIFIABLE });
  });

  it("filtre de service : un mois sans aucun contrat pour une masse non nulle est « non vérifiable », avec masquage secondaire ; une période sans contrat est n.d., même au seuil 1", () => {
    const NV = SEUIL_NON_VERIFIABLE;
    const svc = { filtered: true, budget: { kind: "na" as const, reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na" as const, reason: "scénario global : non filtrable par service" } };
    // Service : 3 personnes en janvier, aucune en février pour 10 500,00 € (lignes sans contrat), 3 en mars ; seuil 2. Février : non
    // vérifiable ; secondaire : janvier (10 000,00 € < 11 000,00 €), sinon 31 500 − 11 000 − 10 000 redonnerait février. Total affiché.
    const m = buildBudget(budgetInput({ ...svc, confidentialite: { kind: "set", value: 2 }, serviceSizes: { months: [S(P(3)), S([]), S(P(3))], period: S(P(3)) } }));
    expect(table(m, BUDGET_TABLE_IDS.mensuel).rows.map((r) => r.cells[1])).toEqual([ND2, { nd: NV }, 1_100_000]);
    expect(sp(tile(m, "realise").value.text)).toBe("31 500,00 €");
    // Aucun contrat sur toute la période pour 31 500,00 € : réalisé n.d. « non vérifiable », chaque mois aussi, même au seuil 1.
    const z = buildBudget(budgetInput({ ...svc, confidentialite: { kind: "set", value: 1 }, serviceSizes: { months: [S([]), S([]), S([])], period: S([]) } }));
    expect(tile(z, "realise").value).toEqual({ text: "n.d.", kind: "nd", reason: NV });
    expect(table(z, BUDGET_TABLE_IDS.mensuel).rows.map((r) => r.cells[1])).toEqual([{ nd: NV }, { nd: NV }, { nd: NV }]);
    expect(table(z, BUDGET_TABLE_IDS.mensuel).foot?.cells[1]).toEqual({ nd: NV });
    // Service vide (aucun contrat, masse nulle chaque mois) : il ne désigne personne, les zéros restent affichés.
    const empty = buildBudget(budgetInput({ ...svc, live: { kind: "value", series: series("reel", "Réalisé", { "2026-01": 0, "2026-02": 0, "2026-03": 0 }) }, confidentialite: { kind: "set", value: 2 }, serviceSizes: { months: [S([], false), S([], false), S([], false)], period: S([], false) } }));
    expect(table(empty, BUDGET_TABLE_IDS.mensuel).rows.map((r) => r.cells[1])).toEqual([0, 0, 0]);
    expect(sp(tile(empty, "realise").value.text)).toBe("0,00 €");
  });

  it("filtre de service : contrats observés n.d. « non vérifiable » quand N ou N-1 n'a aucun contrat pour un coût non nul", () => {
    // Service : aucun contrat observé en N-1 mais 10,00 € de lignes sans contrat ; 2 contrats en N (seuil 2, donc pas sous le seuil).
    const cohorts = {
      kind: "value" as const,
      onlyPrev: { count: 0, prev: 0, cur: 0, delta: 0, ...G([]) },
      onlyCur: { count: 2, prev: 0, cur: 150_000, delta: 150_000, ...G(["d", "e"]) },
      both: { count: 0, prev: 0, cur: 0, delta: 0, ...G([]) },
      outside: { prev: 1_000, cur: 0, delta: -1_000 },
      total: { count: 2, prev: 1_000, cur: 150_000, delta: 149_000, ...G(["d", "e"]) },
    };
    const sizes = { months: [S(P(2)), S(P(2)), S(P(2))], period: S(P(2)) };
    const m = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, cohorts, confidentialite: { kind: "set", value: 2 }, serviceSizes: sizes }));
    expect(m.blocks.find((b) => b.id === "personnes")!.nd).toEqual([{ label: "Contrats observés", reason: SEUIL_NON_VERIFIABLE }]);
    expect(m.tables.some((t) => t.id === BUDGET_TABLE_IDS.personnes)).toBe(false);
    // Sans lignes sans contrat en N-1 (coût N-1 nul) : groupe vide, le tableau est affiché.
    const ok = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, cohorts: { ...cohorts, outside: null, total: { count: 2, prev: 0, cur: 150_000, delta: 150_000, ...G(["d", "e"]) } }, confidentialite: { kind: "set", value: 2 }, serviceSizes: sizes }));
    expect(ok.tables.some((t) => t.id === BUDGET_TABLE_IDS.personnes)).toBe(true);
    // Service d'une seule personne en N (d et e : deux contrats de la même personne) : tableau n.d. avec la seule raison du seuil.
    const one = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, cohorts: { ...cohorts, onlyCur: { ...cohorts.onlyCur, ...G(["d"]) }, outside: null, total: { count: 2, prev: 0, cur: 150_000, delta: 150_000, ...G(["d"]) } }, confidentialite: { kind: "set", value: 2 }, serviceSizes: sizes }));
    expect(one.blocks.find((b) => b.id === "personnes")!.nd).toEqual([{ label: "Contrats observés", reason: confidentialiteReason(2) }]);
  });

  it("sans filtre : le réalisé de toute l'entreprise n'est jamais masqué", () => {
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 50 } }));
    expect(table(m, BUDGET_TABLE_IDS.mensuel).rows.map((r) => r.cells[1])).toEqual([1_000_000, 1_050_000, 1_100_000]);
  });
});

// Éléments non récurrents : déjà comptabilisés 800,00 € (ret.realised), prévus 1 500,00 € (ret.projected), somme 2 300,00 €,
// retraité 130 000,00 €. Seuls les contributeurs changent d'un cas à l'autre.
describe("buildBudget — seuil de confidentialité des éléments non récurrents", () => {
  const ND2 = confidentialiteReason(2);
  const ND3 = confidentialiteReason(3);
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
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 3 }, scenario: scenarioOf({ contributors: { realised: G(["q1", "q2"]), projected: G(P(4)) } }) }));
    expect(lines(m).slice(1)).toEqual([
      ["Déjà comptabilisés", null, ND3],
      ["Prévus", null, ND3],
    ]);
  });

  it("seuil 2, 2 personnes et 3 personnes : rien n'est masqué, la cascade du retraité est tracée", () => {
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 2 }, scenario: scenarioOf({ contributors: { realised: G(["q1", "q2"]), projected: G(P(3)) } }) }));
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
    expect(att(m).nd).toEqual([{ label: "Éléments non récurrents déjà comptabilisés et prévus, cascade du retraité", reason: why, action: { href: CONF_HREF, label: "Paramètres" } }]);
    expect(m.charts.some((c) => c.id === BUDGET_CHART_IDS.retraite)).toBe(false);
  });

  it("seuil 3, contributeurs qui se compensent (2 hypothèses, somme 0) et aucun prévu : n.d. sans la phrase « Aucun élément non récurrent », qui dirait 0", () => {
    const zero: Retraite = { kind: "value", year: "2026", atterrissage: 13_230_000, rows: [], realised: 0, projected: 0, total: 0, retraite: 13_230_000 };
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 3 }, scenario: scenarioOf({ retraite: zero, contributors: { realised: G(["q1", "q2"]), projected: G([]) } }) }));
    expect(lines(m).slice(1)).toEqual([
      ["Déjà comptabilisés", null, ND3],
      ["Prévus", null, ND3],
    ]);
    expect(att(m).notes).toEqual([]);
    expect(att(m).nd).toEqual([{ label: "Éléments non récurrents déjà comptabilisés et prévus", reason: ND3 }]);
  });

  it("contributeurs des prévus non dénombrés : « Prévus » non vérifiable, « Déjà comptabilisés » masqué en second", () => {
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 2 }, scenario: scenarioOf({ contributors: { realised: G(P(5, "q")), projected: null } }) }));
    expect(lines(m).slice(1)).toEqual([
      ["Déjà comptabilisés", null, ND2],
      ["Prévus", null, SEUIL_NON_VERIFIABLE],
    ]);
  });

  it("hypothèses « réalisé » saisies sans contrat (non reliées) : « Déjà comptabilisés » non dénombré, « Prévus » masqué en second ; un contrat non relié ne protège pas", () => {
    const m = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 2 }, scenario: scenarioOf({ contributors: { realised: G([], 2), projected: G(P(3)) } }) }));
    expect(lines(m).slice(1)).toEqual([
      ["Déjà comptabilisés", null, SEUIL_NON_VERIFIABLE],
      ["Prévus", null, ND2],
    ]);
    // Prévus : 1 personne reliée + 1 embauche non reliée : sous le seuil 2, non dénombré ; 2 reliées + 1 embauche : affiché.
    const u = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 2 }, scenario: scenarioOf({ contributors: { realised: G(["q1", "q2"]), projected: G(["p1"], 1) } }) }));
    expect(lines(u).slice(1)).toEqual([
      ["Déjà comptabilisés", null, ND2],
      ["Prévus", null, SEUIL_NON_VERIFIABLE],
    ]);
    const ok = buildBudget(budgetInput({ confidentialite: { kind: "set", value: 2 }, scenario: scenarioOf({ contributors: { realised: G(["q1", "q2"]), projected: G(["p1", "p2"], 1) } }) }));
    expect(lines(ok).slice(1)).toEqual([
      ["Déjà comptabilisés", "800,00 €", null],
      ["Prévus", "1 500,00 €", null],
    ]);
  });

  it("rendu : la mention n.d. du bloc Atterrissage et le lien vers les Paramètres sont écrits", () => {
    const out = sp(renderToStaticMarkup(h(BlocksChapter, { model: buildBudget(budgetInput({ confidentialite: { kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" } })), slug: "demo", affichage: "tout", tableauHref: "/x" })));
    expect(out).toContain('data-testid="cx-budget-atterrissage-nd"');
    expect(out).toContain("Éléments non récurrents déjà comptabilisés et prévus, cascade du retraité");
    expect(out).toContain(`href="${CONF_HREF}"`);
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
    const f = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" }, serviceSizes: { months: [S(P(3)), S(P(3)), S(P(3))], period: S(P(3)) } }));
    expect(tile(f, "budget").value.reason).toBe("budget saisi global : non filtrable par service");
    expect(tile(f, "atterrissage").value.reason).toBe("scénario global : non filtrable par service");
    expect(f.blocks.find((b) => b.id === "prevision")!.nd[0].reason).toBe("scénario global : non filtrable par service");
    expect(f.charts).toHaveLength(0);
    expect(f.limits[0]).toContain("non filtrables par service");
    expect(sp(tile(f, "realise").value.text)).toBe("31 500,00 €");
    // Effectif du service non dénombré : le seuil ne peut pas être vérifié, le réalisé n'est pas affiché.
    const u = buildBudget(budgetInput({ filtered: true, budget: { kind: "na", reason: "budget saisi global : non filtrable par service" }, scenario: { kind: "na", reason: "scénario global : non filtrable par service" } }));
    expect(tile(u, "realise").value.reason).toBe(SEUIL_NON_VERIFIABLE);
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
  // Lien contrat → personne des paliers : chaque clé k1 … k8 est sa propre personne.
  link: new Map(P(8, "k").map((k) => [k, `personne-${k}`])),
  hrefs: { analyse: "/e/demo/studio-rh/masse-salariale/analyse?v1=reel%3A2025&v2=reel%3A2026&de=01&a=02", embauches: "/e/demo/studio-rh/hypotheses", globales: "/e/demo/studio-rh/hypotheses", fixeVariable: "/x?chapitre=fixe-variable", parametres: CONF_HREF },
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
    // Départ, arrivée et écart total : valeurs exactes de la carte, 20 000 ÷ 20 000 = 1 ETP, 30 000 ÷ 20 000 = 1,5 ETP, écart 0,5 ETP.
    const t = table(m, EFFETS_TABLE_IDS.etp);
    expect(t.rows[0].cells).toEqual(["ETP moyen N-1 (janvier → février 2025)", { exact: 1 }, ""]);
    expect(t.rows.at(-2)!.cells).toEqual(["Résiduel d'arrondi", "", { exact: 0 }]);
    expect(t.rows.at(-1)!.cells).toEqual(["Écart total", "", { exact: 0.5 }]);
    expect(t.foot?.cells).toEqual(["ETP moyen N (janvier → février 2026)", { exact: 1.5 }, ""]);
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
  const N2 = { nd: confidentialiteReason(2) };

  it("seuil 2 : « entrées nouvelles » (1 personne) masqué ; secondaire : le plus petit palier qui compte quelqu'un (« sorties », 3 personnes ; un palier vide ne protège pas) ; graphique non tracé", () => {
    const m = buildEffets(effetsInput({ cascade: C3, confidentialite: { kind: "set", value: 2 } }));
    const t = table(m, EFFETS_TABLE_IDS.etp);
    expect(t.rows.map((r) => r.cells[2])).toEqual(["", N2, 0, N2, 0, 2_500, { exact: 0 }, { exact: 0.5 }]);
    expect(t.foot?.cells).toEqual(["ETP moyen N (janvier → février 2026)", { exact: 1.5 }, ""]);
    expect(m.charts.some((c) => c.id === EFFETS_CHART_IDS.etp)).toBe(false);
    expect(m.blocks.find((b) => b.id === "etp")!.nd).toEqual([{ label: "Graphique de la cascade d'ETP", reason: confidentialiteReason(2) }]);
    // Aucune clé de contrat dans le modèle.
    expect(JSON.stringify(m)).not.toMatch(/"k\d"/);
  });

  it("une personne présente dans deux paliers masqués n'y compte qu'une fois : seuil 3, report {k1}, sorties {k3…k6}, changement {k1, k2} ; un contrat non relié ne protège pas", () => {
    // Départ 2,00 ETP (40 000 ÷ 20 000), arrivée 1,80 ETP (36 000 ÷ 20 000), sur 2 mois. Paliers : effet report +0,10 ETP (k1),
    // sorties −0,50 ETP (k3 à k6, 4 contrats), changement d'ETP +0,20 ETP (k1 et k2) ; 2,00 + 0,10 − 0,50 + 0,20 = 1,80.
    // Seuil 3 : report (1 contrat) et changement (2 contrats) masqués ; ensemble ils ne décrivent que 2 contrats distincts (k1, k2) :
    // sorties affichées donneraient report + changement = −0,20 − (−0,50) − 0 = +0,30 ETP pour 2 contrats → sorties masquées en second
    // (6 contrats distincts). Additionner les tailles (1 + 2 = 3) aurait laissé les sorties affichées.
    const twice: Cascade = {
      kind: "value",
      months: 2,
      start: 20_000,
      end: 18_000,
      steps: [
        { id: "entrees-new", label: STEP_LABELS["entrees-new"], etp4: 0, people: [] },
        { id: "entrees-report", label: STEP_LABELS["entrees-report"], etp4: 1_000, people: [{ key: "k1", etp4: 1_000 }] },
        { id: "sorties", label: STEP_LABELS.sorties, etp4: -5_000, people: ["k3", "k4", "k5", "k6"].map((key) => ({ key, etp4: -1_250 })) },
        { id: "sorties-deport", label: STEP_LABELS["sorties-deport"], etp4: 0, people: [] },
        { id: "etp-change", label: STEP_LABELS["etp-change"], etp4: 2_000, people: [{ key: "k1", etp4: 1_000 }, { key: "k2", etp4: 1_000 }] },
      ],
      residual: 0,
    };
    const N3 = { nd: confidentialiteReason(3) };
    const m = buildEffets(effetsInput({ cascade: twice, etp: { cur: { kind: "value", num: 36_000, den: 20_000 }, prev: { kind: "value", num: 40_000, den: 20_000 } }, confidentialite: { kind: "set", value: 3 } }));
    const t = table(m, EFFETS_TABLE_IDS.etp);
    expect(t.rows.map((r) => r.cells[2])).toEqual(["", 0, N3, N3, 0, N3, { exact: 0 }, { exact: -0.2 }]);
    expect(m.charts.some((c) => c.id === EFFETS_CHART_IDS.etp)).toBe(false);
    // k2 non relié à une personne : le changement d'ETP compte 1 personne reliée (k1) et 1 contrat non relié → non dénombré ; le report
    // (k1) masqué ; ensemble une personne : sorties masquées en second.
    const partial = buildEffets(effetsInput({ cascade: twice, etp: { cur: { kind: "value", num: 36_000, den: 20_000 }, prev: { kind: "value", num: 40_000, den: 20_000 } }, confidentialite: { kind: "set", value: 3 }, link: new Map(["k1", "k3", "k4", "k5", "k6"].map((k) => [k, `personne-${k}`])) }));
    expect(table(partial, EFFETS_TABLE_IDS.etp).rows.map((r) => r.cells[2])).toEqual(["", 0, N3, N3, 0, { nd: SEUIL_NON_VERIFIABLE }, { exact: 0 }, { exact: -0.2 }]);
    // Sans lien : chaque palier non vide est non dénombré, même au seuil 1 ; l'écart total étant affiché sans qu'aucune personne ne
    // soit comptée, la protection est impossible : toute la cascade est n.d., les paliers vides compris (raison du seuil).
    const none = buildEffets(effetsInput({ cascade: twice, etp: { cur: { kind: "value", num: 36_000, den: 20_000 }, prev: { kind: "value", num: 40_000, den: 20_000 } }, link: new Map() }));
    const N1 = { nd: confidentialiteReason(1) };
    expect(table(none, EFFETS_TABLE_IDS.etp).rows.map((r) => r.cells[2])).toEqual(["", N1, { nd: SEUIL_NON_VERIFIABLE }, { nd: SEUIL_NON_VERIFIABLE }, N1, { nd: SEUIL_NON_VERIFIABLE }, { exact: 0 }, { exact: -0.2 }]);
  });

  it("seuil 1 : rien n'est masqué, la cascade est tracée ; seuil non défini : bloc n.d. avec le lien vers les Paramètres", () => {
    const m1 = buildEffets(effetsInput({ cascade: C3 }));
    expect(table(m1, EFFETS_TABLE_IDS.etp).rows.map((r) => r.cells[2])).toEqual(["", 5_000, 0, -2_500, 0, 2_500, { exact: 0 }, { exact: 0.5 }]);
    expect(m1.charts.some((c) => c.id === EFFETS_CHART_IDS.etp)).toBe(true);
    const mx = buildEffets(effetsInput({ cascade: C3, confidentialite: { kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" } }));
    expect(mx.blocks.find((b) => b.id === "etp")!.nd).toEqual([{ label: "Cascade d'ETP", reason: "seuil de confidentialité non défini (Paramètres)", action: { href: CONF_HREF, label: "Paramètres" } }]);
    expect(mx.tables.some((t) => t.id === EFFETS_TABLE_IDS.etp)).toBe(false);
    // Le pont de toute l'entreprise reste affiché.
    expect(sp(tile(mx, "volume").value.text)).toBe("+2 800,00 €");
  });
});

describe("buildEffets — même ETP moyen sur la carte et dans la cascade (valeurs exactes)", () => {
  // N : S = 370 349 dix-millièmes d'ETP sur 3 mois → 370 349 ÷ 30 000 = 12,344 966… ETP, écrit « 12,34 ». Arrondi d'abord au
  // dix-millième (370 349 ÷ 3 = 123 449,67 → 123 450, soit 12,345 0) puis au centième, il s'écrirait « 12,35 ». N-1 : 360 000 → 12,00.
  // Cascade fictive : départ round(360 000 ÷ 3) = 120 000, arrivée 123 450 ; entrées nouvelles +5 000 (2 contrats), sorties −1 550
  // (2 contrats), autres paliers vides : 5 000 − 1 550 = 3 450 = 123 450 − 120 000.
  const C12: Cascade = {
    kind: "value",
    months: 3,
    start: 120_000,
    end: 123_450,
    steps: [
      { id: "entrees-new", label: STEP_LABELS["entrees-new"], etp4: 5_000, people: [{ key: "k1", etp4: 2_500 }, { key: "k2", etp4: 2_500 }] },
      { id: "entrees-report", label: STEP_LABELS["entrees-report"], etp4: 0, people: [] },
      { id: "sorties", label: STEP_LABELS.sorties, etp4: -1_550, people: [{ key: "k3", etp4: -1_000 }, { key: "k4", etp4: -550 }] },
      { id: "sorties-deport", label: STEP_LABELS["sorties-deport"], etp4: 0, people: [] },
      { id: "etp-change", label: STEP_LABELS["etp-change"], etp4: 0, people: [] },
    ],
    residual: 0,
  };
  const ETP = { cur: { kind: "value" as const, num: 370_349, den: 30_000 }, prev: { kind: "value" as const, num: 360_000, den: 30_000 } };
  const m = buildEffets(effetsInput({ cascade: C12, etp: ETP, confidentialite: { kind: "set", value: 2 } }));
  const t = table(m, EFFETS_TABLE_IDS.etp);
  const text = (row: { cells: unknown[] } | undefined, j: number) => sp(cellView(row!.cells[j] as never, t.columns[j]).text);

  it("carte « 12,34 ETP » ; tableau : arrivée exacte 370 349 ÷ 30 000, écrite « 12,34 » (et non « 12,35 ») ; départ 12 exactement", () => {
    expect(tile(m, "etp").value.text).toBe("12,34 ETP");
    expect(t.foot?.cells[1]).toEqual({ exact: 370_349 / 30_000 });
    expect(text(t.foot, 1)).toBe("12,34");
    expect(t.rows[0].cells[1]).toEqual({ exact: 12 });
    expect(text(t.rows[0], 1)).toBe("12,00");
  });

  it("écart total exact 10 349 ÷ 30 000 = 0,344 96… → « +0,34 », comme l'écart de la carte ; résiduel d'arrondi (10 349 − 3 × 3 450) ÷ 30 000 = −1 ÷ 30 000", () => {
    expect(t.rows.at(-1)!.cells[2]).toEqual({ exact: 10_349 / 30_000 });
    expect(text(t.rows.at(-1), 2)).toBe("+0,34");
    expect(tile(m, "etp").variations!.map((v) => [v.label, v.text])).toEqual([["N-1 (janvier → février 2025)", "12,00 ETP"], ["Écart", "+0,34 ETP"]]);
    expect(t.rows.at(-2)!.cells).toEqual(["Résiduel d'arrondi", "", { exact: -1 / 30_000 }]);
    expect(text(t.rows.at(-2), 2)).toBe("0,00");
    // Paliers arrondis inchangés.
    expect(t.rows.slice(1, 6).map((r) => r.cells[2])).toEqual([5_000, 0, -1_550, 0, 0]);
  });

  it("graphique : arrivée tracée à 123 449 dix-millièmes (écrite « 12,34 »), le résiduel d'arrondi (−1) raccorde les paliers", () => {
    expect(plotEtp4(370_349, 3)).toBe(123_449);
    expect(plotEtp4(360_000, 3)).toBe(120_000);
    // 370 351 ÷ 3 = 123 450,33 → 123 450 (12,345 0 → « 12,35 », comme 12,345 03… exact) : arrondi gardé.
    expect(plotEtp4(370_351, 3)).toBe(123_450);
    const c = m.charts.find((x) => x.id === EFFETS_CHART_IDS.etp)!;
    expect(c.categories.at(-2)).toBe("Résiduel d'arrondi");
    expect(c.series[0].values).toEqual([120_000, 5_000, 0, -1_550, 0, 0, -1, 123_449]);
    expect(fmtFixed({ num: 123_449, den: 10_000 })).toBe("12,34");
  });

  it("ETP moyen de la carte n.d. (borne basse) : départ, résiduel, écart total et graphique n.d. avec la raison de la carte ; arrivée exacte", () => {
    const why = "ETP en borne basse (source incomplète)";
    const lb = buildEffets(effetsInput({ cascade: C12, etp: { cur: ETP.cur, prev: { kind: "nd", reason: why } } }));
    const u = table(lb, EFFETS_TABLE_IDS.etp);
    expect(u.rows[0].cells[1]).toEqual({ nd: why });
    expect(u.rows.at(-2)!.cells[2]).toEqual({ nd: why });
    expect(u.rows.at(-1)!.cells[2]).toEqual({ nd: why });
    expect(u.foot?.cells[1]).toEqual({ exact: 370_349 / 30_000 });
    expect(lb.charts.some((x) => x.id === EFFETS_CHART_IDS.etp)).toBe(false);
    expect(lb.blocks.find((b) => b.id === "etp")!.nd).toEqual([{ label: "Graphique de la cascade d'ETP", reason: why }]);
    // Carte et composition non rapprochées (somme différente de celle de la cascade) : n.d. avec la raison, jamais deux valeurs.
    const off = buildEffets(effetsInput({ cascade: C12, etp: { cur: ETP.cur, prev: { kind: "value", num: 363_000, den: 30_000 } } }));
    expect(table(off, EFFETS_TABLE_IDS.etp).rows[0].cells[1]).toEqual({ nd: CASCADE_NON_RAPPROCHEE });
  });
});

describe("buildEffets — service retenu sans aucun contrat pour une masse ou un ETP non nuls", () => {
  const NV = SEUIL_NON_VERIFIABLE;
  it("N sans contrat observé, masse N 8 680,00 € : cartes et pont n.d. « non vérifiable », même au seuil 1 ; 2 personnes de chaque côté : affichés ; 1 personne : seule raison du seuil", () => {
    const m = buildEffets(effetsInput({ serviceSizes: { cur: S([]), prev: S(P(3)) } }));
    expect(m.tiles.map((t) => t.value)).toEqual(Array(4).fill({ text: "n.d.", kind: "nd", reason: NV }));
    expect(m.blocks.find((b) => b.id === "decomposition")!.nd).toEqual([{ label: "Pont volume / coût moyen du service", reason: NV }]);
    expect(m.tables).toHaveLength(0);
    const ok = buildEffets(effetsInput({ serviceSizes: { cur: S(P(2)), prev: S(P(2)) }, confidentialite: { kind: "set", value: 2 } }));
    expect(sp(tile(ok, "ecart").value.text)).toBe("+3 080,00 €");
    const one = buildEffets(effetsInput({ serviceSizes: { cur: S(P(2)), prev: S(["p1"]) }, confidentialite: { kind: "set", value: 2 } }));
    expect(tile(one, "ecart").value.reason).toBe(confidentialiteReason(2));
    // 1 personne reliée + 1 contrat non relié sur N : non dénombré.
    const u = buildEffets(effetsInput({ serviceSizes: { cur: S(["p1"], true, 1), prev: S(P(2)) }, confidentialite: { kind: "set", value: 2 } }));
    expect(tile(u, "ecart").value.reason).toBe(NV);
  });
  it("N-1 sans contrat, masse et ETP N-1 nuls : service vide, rien à vérifier (pas de « non vérifiable »)", () => {
    const zero = { kind: "value" as const, num: 0, den: 1 };
    const m = buildEffets(effetsInput({ serviceSizes: { cur: S(P(3)), prev: S([], false) }, masse: { cur: { kind: "value", num: 868_000, den: 1 }, prev: zero }, etp: { cur: { kind: "value", num: 30_000, den: 20_000 }, prev: { kind: "value", num: 0, den: 20_000 } } }));
    expect(m.tiles.find((t) => t.id === "ecart")!.value.reason).toBeNull();
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
// Lien contrat → personne du contexte : alpha, beta, gamma (identifiants du journal) et payfit:x (clé de référentiel de la base figée)
// ont chacun leur personne.
const LINK: PersonLink = new Map([["contrat-alpha", "personne-alpha"], ["contrat-beta", "personne-beta"], ["contrat-gamma", "personne-gamma"], ["payfit:x", "personne-x"]]);
type FakeOpts = { seuil?: number | null; etp?: (months: string[]) => { month: string; etp4: number | null; reason: string | null }[]; base?: BaseSnapshot; firstMonth?: string; hyps?: Hypothesis[]; link?: PersonLink };
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
      persons: async () => o.link ?? LINK,
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
      onlyPrev: { count: 0, prev: 0, cur: 0, delta: 0, ...G([]) },
      onlyCur: { count: 1, prev: 0, cur: 280_000, delta: 280_000, ...G(["personne-gamma"]) },
      both: { count: 2, prev: 980_000, cur: 1_008_000, delta: 28_000, ...G(["personne-alpha", "personne-beta"]) },
      outside: null,
      total: { count: 3, prev: 980_000, cur: 1_288_000, delta: 308_000, ...G(["personne-alpha", "personne-beta", "personne-gamma"]) },
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
    // Effectif du service : alpha et gamma payés en janvier et en février 2026 → 2 personnes chaque mois ; 2 sur la période.
    const AG = S(["personne-alpha", "personne-gamma"]);
    expect(input.serviceSizes).toEqual({ months: [AG, AG], period: AG });
    const m = buildBudget(input);
    // TECH, N : alpha 2 × 2 940 + gamma 2 × 1 400 = 8 680,00 € (2 contrats ≥ seuil 2 : affiché).
    expect(sp(tile(m, "realise").value.text)).toBe("8 680,00 €");
    expect(input.cohorts.kind === "value" && input.cohorts.total).toEqual({ count: 2, prev: 560_000, cur: 868_000, delta: 308_000, persons: ["personne-alpha", "personne-gamma"], unlinked: 0 });
    // N-1 : alpha seul (1 personne < 2) : le tableau du service n'est pas affiché, avec la seule raison du seuil.
    expect(m.blocks.find((b) => b.id === "personnes")!.nd).toEqual([{ label: "Contrats observés", reason: confidentialiteReason(2) }]);
    expect(m.tables.some((t) => t.id === BUDGET_TABLE_IDS.personnes)).toBe(false);
    // Seuil 3 : le service (2 personnes) est sous le seuil : réalisé n.d., aucune valeur du service dans le tableau mensuel.
    const m3 = buildBudget(await loadBudgetInput(fakeCtx("TECH", null, { seuil: 3 })));
    expect(tile(m3, "realise").value).toEqual({ text: "n.d.", kind: "nd", reason: confidentialiteReason(3) });
    // alpha et gamma portés par la même personne : une personne sur la période, masquée au seuil 2.
    const same = buildBudget(await loadBudgetInput(fakeCtx("TECH", null, { link: new Map([["contrat-alpha", "personne-ag"], ["contrat-gamma", "personne-ag"], ["contrat-beta", "personne-beta"]]) })));
    expect(tile(same, "realise").value.reason).toBe(confidentialiteReason(2));
    // gamma non relié : 1 personne reliée (alpha) et 1 contrat non relié sur la période : non dénombré.
    const unlinked = buildBudget(await loadBudgetInput(fakeCtx("TECH", null, { link: new Map([["contrat-alpha", "personne-alpha"], ["contrat-beta", "personne-beta"]]) })));
    expect(tile(unlinked, "realise").value.reason).toBe(SEUIL_NON_VERIFIABLE);
    expect(table(m3, BUDGET_TABLE_IDS.mensuel).rows.every((r) => typeof r.cells[1] === "object")).toBe(true);
    // Seuil non défini : chiffres du service n.d. avec la raison et le lien vers les Paramètres.
    const mx = buildBudget(await loadBudgetInput(fakeCtx("TECH", null, { seuil: null })));
    expect(tile(mx, "realise").value.reason).toBe("seuil de confidentialité non défini (Paramètres)");
    expect(mx.blocks.find((b) => b.id === "ecart")!.nd).toEqual([{ label: "Réalisé du service", reason: "seuil de confidentialité non défini (Paramètres)", action: { href: CONF_HREF, label: "Paramètres" } }]);
  });

  it("observedSizes : personnes des contrats qui portent une ligne de masse (lien du référentiel), par mois et sur la période ; mois hors lecture → null", () => {
    // Toute l'entreprise, 2025 : alpha, beta → 2 personnes par mois, 2 sur la période. TECH 2026 : alpha, gamma. TECH 2025 : alpha seul.
    const AB = S(["personne-alpha", "personne-beta"]);
    expect(observedSizes(journal, ["2025-01", "2025-02"], LINK)).toEqual({ months: [AB, AB], period: AB });
    const tech = { ...journal, serviceFilter: { value: "TECH" } };
    const AG = S(["personne-alpha", "personne-gamma"]);
    expect(observedSizes(tech, ["2026-01", "2026-02"], LINK)).toEqual({ months: [AG, AG], period: AG });
    expect(observedSizes(tech, ["2025-01", "2025-02"], LINK)).toEqual({ months: [S(["personne-alpha"]), S(["personne-alpha"])], period: S(["personne-alpha"]) });
    expect(observedSizes(journal, ["2024-12", "2025-01"], LINK)).toEqual({ months: [null, AB], period: null });
    // Sans lien : contrats non reliés, aucune personne.
    expect(observedSizes(tech, ["2025-01"], new Map())).toEqual({ months: [S([], true, 1)], period: S([], true, 1) });
  });

  it("masseContracts : toute ligne de masse compte (brut, cotisations, taxes), pas les provisions ni les lignes sans contrat", () => {
    // Journal fictif, service OPS. Janvier 2026 : c1 salaires 1 000 € ; c2 cotisations seules 400 € ; c3 taxe sur les salaires seule
    // 30 € (compte 631) ; c4 dotation de provision de congés payés 50 € (compte 6412, hors masse) ; cotisations sans contrat 20 €.
    // Février 2026 : cotisations sans contrat 30 € seulement. Contrats observés : janvier c1, c2, c3 (3) ; février aucun, masse non nulle.
    const O = (key: string, month: string, accountId: string, debit: number, contractId: string | null): LedgerLine => ({ key, month, accountId, accountName: null, debitCents: debit, creditCents: null, contractId, analytic: [{ type: "SERVICE", code: "OPS", value: "OPS" }] });
    const ops: JournalInput = {
      lines: [O("o1", "2026-01", "641100", 100_000, "c1"), O("o2", "2026-01", "645000", 40_000, "c2"), O("o3", "2026-01", "631000", 3_000, "c3"), O("o4", "2026-01", "641200", 5_000, "c4"), O("o5", "2026-01", "645000", 2_000, null), O("o6", "2026-02", "645000", 3_000, null)],
      months: ["2026-01", "2026-02"],
      openMonths: [],
      grid: DEFAULT_PREFIXES,
      serviceAxis: "SERVICE",
      serviceFilter: { value: "OPS" },
    };
    expect(masseContracts(ops, "2026-01")).toEqual({ contracts: ["c1", "c2", "c3"], nonZero: true });
    expect(masseContracts(ops, "2026-02")).toEqual({ contracts: [], nonZero: true });
    expect(masseContracts(ops, "2026-03")).toBeNull();
    expect(observedSizes(ops, ["2026-01", "2026-02"], new Map([["c1", "x1"], ["c2", "x2"], ["c3", "x3"]]))).toEqual({ months: [S(["x1", "x2", "x3"]), S([])], period: S(["x1", "x2", "x3"]) });
    // Un autre service : aucune ligne, aucun montant (mois vide, pas « non vérifiable »).
    expect(masseContracts({ ...ops, serviceFilter: { value: "AUTRE" } }, "2026-01")).toEqual({ contracts: [], nonZero: false });
  });

  it("atterrissage : lien vers Hypothèses seulement quand le scénario commence l'année de la période", async () => {
    const same = await loadBudgetInput(fakeCtx(undefined));
    expect(same.kind === "value" && same.hrefs.atterrissage).toBe("/e/demo/studio-rh/hypotheses?scenario=s1&vue=resultat&sous=atterrissage");
    const other = await loadBudgetInput(fakeCtx(undefined, null, { firstMonth: "2025-10" }));
    expect(other.kind === "value" && other.hrefs.atterrissage).toBeNull();
    expect(other.kind === "value" && other.hrefs.parametres).toBe(CONF_HREF);
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
    // Déjà comptabilisés : 1 hypothèse (saisie sans contrat : non reliée), 1 200,00 €. Prévus : payfit:x (5 000 + 300, relié à sa
    // personne) et l'enveloppe (200, hypothèse non reliée) → 2 contributeurs, 5 500,00 €.
    expect(input.scenario.contributors).toEqual({ realised: G([], 1), projected: G(["personne-x"], 1) });
    expect(input.scenario.retraite).toMatchObject({ kind: "value", realised: 120_000, projected: 550_000, total: 670_000 });
    // Seuil 2 : « Déjà comptabilisés » (aucune personne reliée) non dénombré ; « Prévus » (1 personne reliée + 1 hypothèse) non
    // dénombré aussi : les deux totaux sont n.d., la somme (6 700,00 €) reste affichée.
    const m = buildBudget(input);
    expect(tile(m, "retraite").variations!.map((v) => [v.label, v.text === null ? null : sp(v.text), v.reason ?? null])).toEqual([
      ["Non récurrents retirés", "6 700,00 €", null],
      ["Déjà comptabilisés", null, SEUIL_NON_VERIFIABLE],
      ["Prévus", null, SEUIL_NON_VERIFIABLE],
    ]);
    expect(JSON.stringify(m)).not.toMatch(/Prime fictive|Motif fictif|payfit:x|h-env/);
    // Seuil 1 : « Prévus » (1 personne reliée ≥ 1) affiché ; « Déjà comptabilisés » (hypothèse sans contrat) reste non dénombré, et
    // « Prévus » est alors masqué en second (leur somme est affichée).
    const m1 = buildBudget(await loadBudgetInput(fakeCtx(undefined, null, { hyps, seuil: 1 })));
    expect(tile(m1, "retraite").variations!.map((v) => [v.label, v.text === null ? null : sp(v.text), v.reason ?? null])).toEqual([
      ["Non récurrents retirés", "6 700,00 €", null],
      ["Déjà comptabilisés", null, SEUIL_NON_VERIFIABLE],
      ["Prévus", null, confidentialiteReason(1)],
    ]);
  });

  it("publicScenario : la raison de l'ETP n.d. des mois projetés chiffrés et des mois du scénario parent ne nomme personne ; montants inchangés", () => {
    // Contrat fictif compté sans quotité : le moteur rend chaque mois projeté chiffré avec etp4 null et etpNd « <libellé> : <raison> ».
    const C: BaseContract = { ...A, contractKey: "payfit:w", externalId: "w", label: "Dominique Exemple", etp4: null, etpNd: "quotité absente" };
    const prior = [{ month: "2026-02", kind: "value" as const, cost: 644_000, brut: 460_000, charges: 184_000, headcount: 2, etp4: null, etpNd: "Dominique Exemple : quotité absente", source: "Scénario parent fictif" }];
    const base: BaseSnapshot = { ...baseSnap, contracts: [A, C], prior };
    const raw = project(base, "2026-03", "2026-12", [], { prorata: "calendaire" });
    if (raw.kind !== "value" || raw.months[0].kind !== "value") throw new Error("mois projeté chiffré attendu");
    expect(raw.months[0].etpNd).toBe("Dominique Exemple : quotité absente");
    const pub = publicScenario(base, raw);
    if (pub.proj.kind !== "value") throw new Error("projection attendue");
    expect(pub.proj.months.map((m) => (m.kind === "value" ? m.etpNd : null))).toEqual(Array(10).fill(ETP_ND_PUBLIC));
    expect(pub.base.prior).toEqual([{ ...prior[0], etpNd: ETP_ND_PUBLIC }]);
    // Montants identiques ; objets d'origine intacts.
    expect(pub.proj.months.map((m) => (m.kind === "value" ? m.cost : null))).toEqual(raw.months.map((m) => (m.kind === "value" ? m.cost : null)));
    expect(raw.months[0].etpNd).toBe("Dominique Exemple : quotité absente");
    expect(prior[0].etpNd).toBe("Dominique Exemple : quotité absente");
  });

  it("entrées publiques du chapitre 06 : aucun libellé de contrat de la base figée (séries, Map comprises), aucun texte libre d'élément non récurrent", async () => {
    const C: BaseContract = { ...A, contractKey: "payfit:w", externalId: "w", label: "Dominique Exemple", etp4: null, etpNd: "quotité absente" };
    const hyps: Hypothesis[] = [{ id: "h-real", kind: "realise", label: "Saisie fictive", category: "Catégorie libre fictive", month: "2026-01", costCents: 120_000 }];
    const input = await loadBudgetInput(fakeCtx(undefined, null, { base: { ...baseSnap, contracts: [A, C] }, hyps }));
    if (input.kind !== "value" || input.scenario.kind !== "value") throw new Error("scénario attendu");
    const json = JSON.stringify(input, (_k, v: unknown) => (v instanceof Map ? Object.fromEntries(v) : v));
    expect(json).toContain(ETP_ND_PUBLIC);
    expect(json).not.toMatch(/Dominique|Exemple|payfit:w|Catégorie libre fictive/);
    // Totaux du retraité inchangés (1 200,00 € déjà comptabilisés).
    expect(input.scenario.retraite).toMatchObject({ kind: "value", realised: 120_000, rows: [] });
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
    // Effectif du service : 2 personnes en N (alpha, gamma), 1 en N-1 (alpha) ; le lien du contexte est transmis au modèle.
    expect(input.serviceSizes).toEqual({ cur: S(["personne-alpha", "personne-gamma"]), prev: S(["personne-alpha"]) });
    expect(input.link).toBe(LINK);
  });

  it("service TECH sous le seuil (1 personne en N-1, seuil 2) : cartes et pont du service n.d. ; seuil 1 : affichés", async () => {
    const m = buildEffets(await loadEffetsInput(fakeCtx("TECH", {})));
    const r = confidentialiteReason(2);
    expect(m.tiles.map((t) => t.value)).toEqual(Array(4).fill({ text: "n.d.", kind: "nd", reason: r }));
    expect(m.tiles.every((t) => (t.variations ?? []).length === 0)).toBe(true);
    expect(m.tables).toHaveLength(0);
    expect(m.blocks.find((b) => b.id === "decomposition")!.nd).toEqual([{ label: "Pont volume / coût moyen du service", reason: r }]);
    const m1 = buildEffets(await loadEffetsInput(fakeCtx("TECH", {}, { seuil: 1 })));
    expect(m1.tiles.slice(0, 3).map((t) => sp(t.value.text))).toEqual(["+3 080,00 €", "+2 800,00 €", "+280,00 €"]);
    // Seuil non défini : n.d. avec la raison et le lien vers les Paramètres.
    const mx = buildEffets(await loadEffetsInput(fakeCtx("TECH", {}, { seuil: null })));
    expect(tile(mx, "ecart").value.reason).toBe("seuil de confidentialité non défini (Paramètres)");
    expect(mx.blocks.find((b) => b.id === "decomposition")!.nd[0].action).toEqual({ href: CONF_HREF, label: "Paramètres" });
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
    expect(out).toContain(`href="${CONF_HREF}"`);
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
