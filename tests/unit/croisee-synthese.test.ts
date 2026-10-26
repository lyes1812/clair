import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SyntheseView } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChSynthese";
import type { Layer, Point, Series } from "@/lib/budget/series";
import { glossaryEntry } from "@/lib/glossary";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { cellView, croiseeHref, yearMonths, type CroiseeTable } from "@/lib/viz/croisee";
import { buildSynthese, chartHasData, etpProratedAverage, loadSyntheseInput, SYNTHESE_CX_TERMS, type SyntheseInput } from "@/lib/viz/croisee-synthese";
import type { MonthIn } from "@/lib/viz/masse";

// Chapitre 01 · Synthèse : entrées fictives écrites à la main, valeurs de référence calculées à la main (centimes, fractions exactes).
const sp = (s: string) => s.replace(/[  ]/g, " ");

// --- Fabriques de données fictives --------------------------------------------------------------------------------------------
const mv = (month: string, masse: number): MonthIn => ({ month, kind: "value", open: false, brut: masse - 300_000, cotisations: 300_000, masse, byRubric: { salaires: masse - 300_000, primes: 0, stages: 0, indemnites: 0 } });
const mnd = (month: string, reason: string): MonthIn => ({ month, kind: "nd", open: false, nd: { reason } });
const series = (key: string, label: string, pts: Record<string, number | string>, layer: (m: string) => Layer = () => "reel"): Series => ({
  key,
  label,
  points: new Map(Object.entries(pts).map(([m, v]): [string, Point] => [m, typeof v === "number" ? { month: m, kind: "value", cost: v, etp4: null, etpNd: null, layer: layer(m) } : { month: m, kind: "nd", reason: v }])),
});
const Y26 = yearMonths(2026);
const Y25 = yearMonths(2025);
const QUAL = "ETP contractuel proratisé : quotité à la date de lecture (01/04/2026), proratisée sur les jours sous contrat du mois ; ni ETP payé ni historique exact";

// Budget saisi 2026 : janvier et février à 11 000,00 €, mars non saisi, avril → novembre à 12 000,00 €, décembre à 12 500,00 €.
const budgetPts: Record<string, number | string> = Object.fromEntries(Y26.map((m) => [m, m === "2026-03" ? "montant du budget non saisi" : m <= "2026-02" ? 1_100_000 : m === "2026-12" ? 1_250_000 : 1_200_000]));
// Scénario : réel figé janvier → mars (11 000, 11 500, 11 500), projection avril → novembre à 12 000,00 €, décembre à 13 000,00 €.
const scenPts: Record<string, number> = Object.fromEntries(Y26.map((m) => [m, m === "2026-01" ? 1_100_000 : m <= "2026-03" ? 1_150_000 : m === "2026-12" ? 1_300_000 : 1_200_000]));

function input(over: Partial<Extract<SyntheseInput, { kind: "value" }>> = {}): SyntheseInput {
  return {
    kind: "value",
    year: 2026,
    months: ["2026-01", "2026-02", "2026-03"],
    prevMonths: ["2025-01", "2025-02", "2025-03"],
    labels: { period: "janvier → mars 2026", prev: "janvier → mars 2025" },
    openMonths: [],
    hrefs: { donnees: "/e/demo/donnees", parametres: "/e/demo/parametres#croisee", grille: "/e/demo/parametres#masse-salariale", budget: "/e/demo/studio-rh/hypotheses", services: "/x?chapitre=services", budgetChapter: "/x?chapitre=budget", paieCompta: "/x?chapitre=paie-compta", tableau: "/x?affichage=tableau#cx-synthese-graphique" },
    rh: {
      kind: "value",
      etpAverage: { current: { kind: "exact", ratio: { num: 1225, den: 100 } }, previous: { kind: "exact", ratio: { num: 23, den: 2 } }, delta: { kind: "exact", unit: "etp", value: { num: 3, den: 4 } } },
      // 12, 12 et 13 ETP : moyenne 37/3 = 12,33.
      prorated: [
        { month: "2026-01", kind: "exact", ratio: { num: 372, den: 31 }, qualifiers: [QUAL] },
        { month: "2026-02", kind: "exact", ratio: { num: 336, den: 28 }, qualifiers: [QUAL] },
        { month: "2026-03", kind: "exact", ratio: { num: 1209, den: 93 }, qualifiers: [QUAL] },
      ],
      proratedQualifier: QUAL,
      // 9 demi-journées d'absence sur 400 théoriques : 2,25 % ; N-1 6/400 = 1,50 % ; écart + 0,75 point.
      absenteeism: { current: { kind: "exact", ratio: { num: 9, den: 400 } }, previous: { kind: "exact", ratio: { num: 6, den: 400 } }, delta: { kind: "exact", unit: "points", value: { num: 3, den: 4 } } },
      absenceTypes: ["motif_test"],
      turnover: { current: { kind: "exact", ratio: { num: 3, den: 25 }, entries: 2, exits: 4 }, previous: { kind: "nd", nd: { reason: "historique insuffisant" } }, delta: { kind: "nd", nd: { code: "previous-nd", reason: "N-1 : historique insuffisant" } } },
      headcountAverage: { kind: "exact", ratio: { num: 97, den: 2 } },
      rolling: yearMonths(2025).slice(3).concat(["2026-01", "2026-02", "2026-03"]),
      sparks: { etp: Array.from({ length: 12 }, (_, i) => ({ kind: "exact" as const, etp4: 120_000 + i * 1_000 })), absenteeism: Array.from({ length: 12 }, () => ({ kind: "exact" as const, ratio: { num: 3, den: 100 } })), headcount: Array.from({ length: 12 }, (_, i) => ({ kind: "exact" as const, persons: 40 + i })) },
    },
    pay: {
      kind: "value",
      // Période : brut 24 000,00 € (fixe 20 000, variable 3 000 + 500, stages 500), cotisations 10 000,00 €, masse 34 000,00 €.
      cur: { kind: "value", brut: 2_400_000, cotisations: 1_000_000, masse: 3_400_000, byRubric: { salaires: 2_000_000, primes: 300_000, stages: 50_000, indemnites: 50_000 }, openMonths: [] },
      prev: { kind: "value", brut: 2_200_000, cotisations: 900_000, masse: 3_100_000, byRubric: { salaires: 1_900_000, primes: 200_000, stages: 0, indemnites: 100_000 }, openMonths: [] },
      // + 300 000 c sur 3 100 000 c : + 9,677… % → « +9,68 % ».
      evolution: { kind: "value", deltaCents: 300_000, ratio: { num: 300_000, den: 3_100_000 } },
      // 3 400 000 c ÷ 12 ETP-mois = 283 333,33 c → « 2 833,33 € ».
      cost: { kind: "value", costCents: { num: 3_400_000 * 10_000, den: 120_000 }, etpMonths4: 120_000 },
      costPrev: { kind: "nd", nd: { reason: "ETP fin 2025-02 : n.d." } },
      rolling: Y25.slice(3).map((m) => mv(m, 1_000_000)).concat([mv("2026-01", 1_100_000), mv("2026-02", 1_150_000), mv("2026-03", 1_150_000)]),
      year: Y26.map((m) => (m === "2026-01" ? mv(m, 1_100_000) : m <= "2026-03" ? mv(m, 1_150_000) : mnd(m, `mois ${m} hors de la lecture PayFit appliquée`))),
      yearPrev: Y25.map((m) => (m === "2025-06" ? mnd(m, "journal de paie 2025-06 non renvoyé") : mv(m, 1_000_000))),
      unclassified: ["6459"],
      checks: { compta: null, dsn: null },
    },
    budget: { kind: "value", name: "Budget test", series: series("b", "Budget saisi « Budget test »", budgetPts, () => "budget") },
    live: { kind: "value", series: series("reel", "Réalisé", { "2026-01": 1_100_000, "2026-02": 1_150_000, "2026-03": 1_150_000 }) },
    landing: {
      kind: "value",
      scenarioName: "Scénario test",
      refMonth: "2026-03",
      // 34 000 + 8 × 12 000 + 13 000 = 143 000,00 €.
      landing: { kind: "value", total: 14_300_000, actualMonths: ["2026-01", "2026-02", "2026-03"], priorMonths: [], projectedMonths: Y26.slice(3) },
      series: series("s", "Scénario « Scénario test »", scenPts, (m) => (m <= "2026-03" ? "reel" : "projete")),
    },
    seuils: { kind: "absent" },
    marge: { kind: "absent" },
    ...over,
  };
}
const tile = (m: ReturnType<typeof buildSynthese>, id: string) => m.tiles.find((t) => t.id === id)!;
const tableOf = (m: ReturnType<typeof buildSynthese>, id: string) => m.tables.find((t) => t.id === id)!;
const texts = (t: CroiseeTable) => t.rows.map((r) => r.cells.map((c, i) => sp(cellView(c, t.columns[i], r).text)));

// --- Calcul nouveau ------------------------------------------------------------------------------------------------------------
describe("etpProratedAverage : moyenne exacte des mois de la période", () => {
  it("cas de référence : (2 + 1,5) ÷ 2 = 7/4 ; (1/3 + 1/6 + 1/2) ÷ 3 = 1/3 ; 12, 12 et 13 → 37/3", () => {
    expect(etpProratedAverage([{ month: "2026-01", kind: "exact", ratio: { num: 62, den: 31 }, qualifiers: [] }, { month: "2026-02", kind: "exact", ratio: { num: 45, den: 30 }, qualifiers: [] }])).toEqual({ kind: "exact", ratio: { num: 7, den: 4 }, months: 2 });
    expect(etpProratedAverage([1, 2, 3].map((i) => ({ month: `2026-0${i}`, kind: "exact" as const, ratio: { num: 1, den: [3, 6, 2][i - 1] }, qualifiers: [] })))).toEqual({ kind: "exact", ratio: { num: 1, den: 3 }, months: 3 });
    const pr = (input() as Extract<SyntheseInput, { kind: "value" }>).rh;
    expect(pr.kind === "value" && etpProratedAverage(pr.prorated)).toEqual({ kind: "exact", ratio: { num: 37, den: 3 }, months: 3 });
  });
  it("un mois en borne basse rend la moyenne en borne basse ; un mois n.d. la rend n.d. (mois nommés), jamais zéro", () => {
    expect(etpProratedAverage([{ month: "2026-01", kind: "lower_bound", ratio: { num: 2, den: 1 }, qualifiers: [] }, { month: "2026-02", kind: "exact", ratio: { num: 1, den: 1 }, qualifiers: [] }])).toEqual({ kind: "lower_bound", ratio: { num: 3, den: 2 }, months: 2 });
    expect(etpProratedAverage([{ month: "2026-01", kind: "exact", ratio: { num: 2, den: 1 }, qualifiers: [] }, { month: "2026-02", kind: "nd", nd: { reason: "aucune quotité lisible" } }])).toEqual({ kind: "nd", reason: "févr. 2026 : aucune quotité lisible" });
    expect(etpProratedAverage([])).toEqual({ kind: "nd", reason: "aucun mois dans la période" });
  });
});

// --- Cartes ------------------------------------------------------------------------------------------------------------------
describe("buildSynthese : six cartes dans l'ordre, valeurs de référence", () => {
  const m = buildSynthese(input());
  it("ordre et libellés ; pas d'« ETP payé » en carte", () => {
    expect(m.tiles.map((t) => t.id)).toEqual(["etp", "masse", "ecart-budget", "atterrissage", "absenteisme", "turnover"]);
    expect(m.tiles.map((t) => t.label)).toEqual(["ETP moyen", "Masse salariale chargée", "Écart au budget", "Atterrissage 2026", "Absentéisme", "Turnover"]);
    expect(m.tiles.some((t) => /payé/i.test(t.label))).toBe(false);
    expect(m.limits).toEqual(["ETP payé non calculé : aucune règle de conversion paramétrée."]);
    for (const t of m.tiles) expect(glossaryEntry(t.term!), t.id).toBeDefined();
  });
  it("1 · ETP moyen 12,25, N-1 11,50, écart +0,75 ETP (sans couleur), ETP proratisé moyen 12,33 avec son qualifieur", () => {
    const t = tile(m, "etp");
    expect(t.value).toEqual({ text: "12,25", kind: "value", reason: null });
    expect(t.cost).toBeUndefined();
    expect(t.variations!.map((v) => [v.label, v.text && sp(v.text), v.tone])).toEqual([
      ["N-1", "11,50", "flat"],
      ["Écart", "+0,75 ETP", "flat"],
      ["ETP contractuel proratisé — quotité actuelle", "12,33", "flat"],
    ]);
    expect(t.note).toBe("quotité à la date de lecture ; ni ETP payé ni historique exact");
    expect(t.spark?.values).toHaveLength(12);
  });
  it("2 · masse 34 000,00 €, N-1 31 000,00 €, évolution +3 000,00 € (+9,68 %) en hausse de coût, coût par ETP-mois 2 833,33 €", () => {
    const t = tile(m, "masse");
    expect(sp(t.value.text)).toBe("34 000,00 €");
    expect(t.cost && t.main).toBe(true);
    expect(t.variations!.map((v) => [v.label, v.text && sp(v.text), v.tone])).toEqual([
      ["N-1", "31 000,00 €", "flat"],
      ["Évolution", "+3 000,00 € (+9,68 %)", "bad"],
    ]);
    expect(sp(t.note!)).toBe("Coût par ETP-mois : 2 833,33 € (N-1 : n.d.)");
    expect(m.tileNd.map(sp)).toEqual(["Coût par ETP-mois N-1 : ETP fin 2025-02 : n.d.", "Turnover N-1 : historique insuffisant"]);
  });
  it("3 · écart au budget sur janvier et février (mars sans montant, exclu et nommé) : 22 500,00 − 22 000,00 = +500,00 € (+2,27 %)", () => {
    const t = tile(m, "ecart-budget");
    expect(sp(t.value.text)).toBe("+500,00 €");
    expect(t.valueTone).toBe("bad");
    expect(t.variations!.map((v) => [v.label, v.text && sp(v.text), v.tone])).toEqual([
      ["Budget de la période", "22 000,00 €", "flat"],
      ["Réalisé", "22 500,00 €", "flat"],
      ["Écart (%)", "+2,27 % · défavorable", "bad"],
    ]);
    expect(t.note).toBe("Comparé sur 2 mois ; sans montant de budget, exclus : mars 2026");
    // Écart mensuel : janvier 0, février + 50 000 c, mars n.d. (jamais 0).
    expect(t.spark?.values).toEqual([0, 50_000, null]);
  });
  it("4 · atterrissage 143 000,00 € ; budget 130 500,00 € sur 11 mois ; écart +1 000,00 € (+0,77 %) sur les mêmes mois", () => {
    // Budget sans mars : 2 × 11 000 + 8 × 12 000 + 12 500 = 130 500 ; scénario sur les mêmes mois : 11 000 + 11 500 + 8 × 12 000 + 13 000 = 131 500.
    const t = tile(m, "atterrissage");
    expect(sp(t.value.text)).toBe("143 000,00 €");
    expect(t.variations!.map((v) => [v.label, v.text && sp(v.text), v.tone])).toEqual([
      ["Budget saisi « Budget test »", "130 500,00 €", "flat"],
      ["Écart (11 mois avec budget)", "+1 000,00 € (+0,77 %)", "bad"],
    ]);
    expect(t.note).toBe("réel : 3 mois · projection : 9 mois ; sans montant de budget, exclus : mars 2026");
  });
  it("5 · absentéisme 2,25 %, N-1 1,50 %, écart +0,75 pts, 4,5 j sur 200 j, motifs retenus ; 6 · turnover 12,00 % sur douze mois glissants", () => {
    const a = tile(m, "absenteisme");
    expect(sp(a.value.text)).toBe("2,25 %");
    expect(a.variations!.map((v) => [v.label, v.text && sp(v.text)])).toEqual([
      ["N-1", "1,50 %"],
      ["Écart", "+0,75 pts"],
      ["Absence", "4,5 j sur 200 j théoriques"],
    ]);
    expect(a.note).toBe("Motifs retenus : motif_test");
    const to = tile(m, "turnover");
    expect(sp(to.value.text)).toBe("12,00 %");
    expect(to.sub).toBe("Douze mois glissants à fin mars 2026");
    expect(to.variations!.map((v) => [v.label, v.text, v.reason])).toEqual([
      ["N-1", null, "historique insuffisant"],
      ["Écart", null, "N-1 : historique insuffisant"],
      ["Sorties", "4", null],
      ["Entrées", "2", null],
    ]);
    expect(m.trend).toBe(true);
  });
});

// --- Points à surveiller --------------------------------------------------------------------------------------------------------
describe("buildSynthese : points à surveiller et mentions", () => {
  it("budget dépassé et atterrissage au-dessus (défavorable), compte non classé (à compléter), février au-dessus du budget (repère) ; seuils non définis : mention", () => {
    const m = buildSynthese(input());
    expect(m.alerts.map((a) => [a.id, a.level])).toEqual([
      ["budget-depasse", "defavorable"],
      ["atterrissage-depasse", "defavorable"],
      ["comptes-non-classes", "a-completer"],
      ["budget-mois", "repere"],
    ]);
    expect(sp(m.alerts[0].text)).toBe("Réalisé 22 500,00 € pour un budget saisi « Budget test » de 22 000,00 € sur 2 mois : écart +500,00 €. 1 mois sans montant de budget exclu (mars 2026).");
    expect(sp(m.alerts[1].text)).toBe("Atterrissage et budget saisi comparés sur 11 mois (1 mois sans montant de budget exclu : mars 2026) : écart +1 000,00 €.");
    expect(sp(m.alerts[3].text)).toBe("1 mois sur 2 : févr. 2026. 1 mois sans montant de budget exclu (mars 2026).");
    expect(m.mentions).toEqual([{ id: "seuils-effectif", text: "Seuils d'effectif non définis (Paramètres)", href: "/e/demo/parametres#croisee", linkLabel: "Paramètres" }]);
  });
});

// --- Graphique principal et tableaux -----------------------------------------------------------------------------------------------
describe("buildSynthese : graphique principal (trois séries groupées) et son tableau exact", () => {
  const m = buildSynthese(input());
  const chart = m.charts.find((c) => c.id === "synthese-mensuel")!;
  const table = tableOf(m, "synthese-mensuel");
  it("douze mois : réel de janvier à mars, projection ensuite ; budget avec mars n.d. ; N-1 avec juin 2025 n.d.", () => {
    expect(chart.kind).toBe("barres");
    expect(chart.mode).toBe("grouped");
    expect(chart.tableId).toBe(table.id);
    expect(chart.series.map((s) => s.key)).toEqual(["reel", "budget", "n1"]);
    expect(chart.series[0].values).toEqual([1_100_000, 1_150_000, 1_150_000, ...Array(8).fill(1_200_000), 1_300_000]);
    expect(chart.series[1].values[2]).toBeNull();
    expect(chart.series[1].reasons![2]).toBe("montant du budget non saisi");
    expect(chart.series[2].values[5]).toBeNull();
    expect(chart.series[2].reasons![5]).toBe("journal de paie 2025-06 non renvoyé");
    expect(chart.categoryTitles![0]).toBe("janvier 2026 · réel");
    expect(chart.categoryTitles![3]).toBe("avril 2026 · projection (scénario « Scénario test »)");
  });
  it("le tableau porte exactement les valeurs du graphique ; un n.d. y reste n.d. avec sa raison", () => {
    expect(table.rows).toHaveLength(12);
    table.rows.forEach((r, i) => {
      chart.series.forEach((s, k) => {
        const cell = r.cells[k + 2];
        if (s.values[i] === null) expect(cell).toEqual({ nd: s.reasons![i] });
        else expect(cell).toBe(s.values[i]);
      });
    });
    expect(texts(table)[0]).toEqual(["Janvier 2026", "Réel", "11 000,00 €", "11 000,00 €", "10 000,00 €"]);
    expect(texts(table)[2]).toEqual(["Mars 2026", "Réel", "11 500,00 €", "n.d.", "10 000,00 €"]);
    expect(texts(table)[3][1]).toBe("Projection");
    expect(table.notes).toEqual(["Projection : avr. 2026 → déc. 2026, scénario « Scénario test »."]);
  });
  it("composition de la masse chargée (brutParts + cotisations) et son tableau : écarts de coût N / N-1", () => {
    const comp = m.charts.find((c) => c.id === "synthese-composition")!;
    expect(comp.kind).toBe("anneau");
    expect(comp.series.map((s) => [s.key, s.values[0]])).toEqual([["fixe", 2_000_000], ["variable", 350_000], ["stages", 50_000], ["cotisations", 1_000_000]]);
    const t = tableOf(m, "synthese-composition");
    expect(texts(t)).toEqual([
      ["Fixe (salaires et congés payés)", "20 000,00 €", "19 000,00 €", "+1 000,00 €"],
      ["Variable (primes et indemnités)", "3 500,00 €", "3 000,00 €", "+500,00 €"],
      ["Gratifications de stage", "500,00 €", "0,00 €", "+500,00 €"],
      ["Brut", "24 000,00 €", "22 000,00 €", "+2 000,00 €"],
      ["Cotisations patronales", "10 000,00 €", "9 000,00 €", "+1 000,00 €"],
    ]);
    expect(t.foot!.cells).toEqual(["Masse salariale chargée", 3_400_000, 3_100_000, 300_000]);
    expect(cellView(t.foot!.cells[3], t.columns[3]).tone).toBe("bad");
  });
  it("chiffres clés en tableau : montants (écarts de coût colorés) et ETP / taux (écarts en points, jamais colorés)", () => {
    expect(texts(tableOf(m, "synthese-montants"))).toEqual([
      ["Masse salariale chargée", "janvier → mars 2026", "34 000,00 €", "N-1 : janvier → mars 2025", "31 000,00 €", "+3 000,00 €"],
      ["Coût par ETP-mois", "janvier → mars 2026", "2 833,33 €", "N-1 : janvier → mars 2025", "n.d.", "—"],
      ["Écart au budget saisi", "janvier → mars 2026 (2 mois avec budget)", "22 500,00 €", "Budget saisi « Budget test »", "22 000,00 €", "+500,00 €"],
      ["Atterrissage 2026", "Scénario « Scénario test »", "143 000,00 €", "Budget saisi « Budget test » (11 mois)", "130 500,00 €", "+1 000,00 €"],
    ]);
    const rh = tableOf(m, "synthese-rh");
    expect(texts(rh)).toEqual([
      ["ETP moyen", "janvier → mars 2026", "12,25", "11,50", "+0,75"],
      ["ETP contractuel proratisé — quotité actuelle", "moyenne des mois, janvier → mars 2026", "12,33", "—", "—"],
      ["Absentéisme", "janvier → mars 2026", "2,25 %", "1,50 %", "+0,75 pts"],
      ["Turnover", "Douze mois glissants à fin mars 2026", "12,00 %", "n.d.", "n.d."],
    ]);
    for (const r of rh.rows) for (let i = 0; i < r.cells.length; i++) expect(cellView(r.cells[i], rh.columns[i], r).tone).toBe("flat");
  });
  it("tous les identifiants du glossaire du modèle existent", () => {
    const ids = [...Object.values(SYNTHESE_CX_TERMS), ...m.terms, ...m.tables.flatMap((t) => [...(t.terms ?? []), ...t.columns.flatMap((c) => (c.term ? [c.term] : []))])];
    for (const id of ids) expect(glossaryEntry(id), id).toBeDefined();
  });
});

// --- n.d., filtre de service, période absente ----------------------------------------------------------------------------------
describe("buildSynthese : un n.d. reste n.d. jusqu'au tableau et au graphique", () => {
  it("journal non lu : masse n.d., graphique sans valeur réelle (null, jamais 0), tableau n.d., alerte « à compléter »", () => {
    const why = "source RH retenue : DSN — journal de paie PayFit non lu";
    const m = buildSynthese(input({ pay: { kind: "nd", reason: why, action: { href: "/e/demo/donnees", label: "Données" } }, live: { kind: "nd", reason: why }, landing: { kind: "nd", reason: "aucun scénario ne couvre 2026" } }));
    expect(tile(m, "masse").value).toEqual({ text: "n.d.", kind: "nd", reason: why });
    expect(tile(m, "ecart-budget").value).toEqual({ text: "n.d.", kind: "nd", reason: `réalisé : ${why}` });
    const chart = m.charts.find((c) => c.id === "synthese-mensuel")!;
    expect(chart.series[0].values.every((v) => v === null)).toBe(true);
    expect(chart.series[0].reasons!.every((r) => r === why)).toBe(true);
    expect(chart.series[2].values.every((v) => v === null)).toBe(true);
    const t = tableOf(m, "synthese-mensuel");
    expect(t.rows.every((r) => JSON.stringify(r.cells[2]) === JSON.stringify({ nd: why }))).toBe(true);
    const comp = tableOf(m, "synthese-composition");
    expect([...comp.rows, comp.foot!].every((r) => r.cells.slice(1).every((c) => typeof c === "object" && "nd" in c))).toBe(true);
    expect(chartHasData(m.charts.find((c) => c.id === "synthese-composition")!)).toBe(false);
    expect(m.alerts.map((a) => a.id)).toEqual(["atterrissage-nd", "source-journal"]);
    expect(m.alerts.find((a) => a.id === "source-journal")).toMatchObject({ level: "a-completer", href: "/e/demo/donnees" });
  });

  it("filtre de service : ETP, absentéisme, turnover, budget et atterrissage n.d. « non filtrable par service » ; masse filtrée calculée", () => {
    const m = buildSynthese(
      input({
        rh: { kind: "na", reason: "référentiel RH : non filtrable par service" },
        budget: { kind: "na", reason: "budget saisi global : non filtrable par service" },
        landing: { kind: "na", reason: "atterrissage du scénario global : non filtrable par service" },
      }),
    );
    for (const id of ["etp", "absenteisme", "turnover", "ecart-budget", "atterrissage"]) {
      expect(tile(m, id).value.kind, id).toBe("nd");
      expect(tile(m, id).value.reason, id).toMatch(/non filtrable par service$/);
    }
    expect(tile(m, "masse").value.kind).toBe("value");
    expect(m.alerts.map((a) => a.id)).toEqual(["comptes-non-classes"]);
    const chart = m.charts.find((c) => c.id === "synthese-mensuel")!;
    expect(chart.series[0].values.slice(3).every((v) => v === null)).toBe(true); // aucune projection sous un filtre de service
    expect(chart.series[1].reasons!.every((r) => r === "budget saisi global : non filtrable par service")).toBe(true);
  });

  it("période absente : chapitre n.d. avec la raison et l'action, aucune carte", () => {
    const m = buildSynthese({ kind: "nd", reason: "aucun mois clos à la date de référence", action: { href: "/e/demo/donnees", label: "Données" } });
    expect(m.nd).toEqual({ reason: "Aucun mois clos à la date de référence", action: { href: "/e/demo/donnees", label: "Données" } });
    expect(m.tiles).toEqual([]);
    const out = renderToStaticMarkup(h(SyntheseView, { model: m, slug: "demo", affichage: "tout" }));
    expect(out).toContain('data-testid="cx-synthese-nd"');
    expect(out).toContain("Aucun mois clos à la date de référence");
  });
});

// --- Rendu du modèle --------------------------------------------------------------------------------------------------------------
describe("SyntheseView : rendu du modèle selon l'affichage", () => {
  const m = buildSynthese(input());
  it("tout : six cartes, graphique et tableau exact, points à surveiller, mention, composition, liens ; ancres cx-synthese-*", () => {
    const out = sp(renderToStaticMarkup(h(SyntheseView, { model: m, slug: "demo", affichage: "tout" })));
    for (const id of ["etp", "masse", "ecart-budget", "atterrissage", "absenteisme", "turnover"]) expect(out).toContain(`data-testid="cx-tile-synthese-${id}"`);
    expect(out).toContain('class="facts ms-tiles cx-tiles six"');
    for (const tid of ["cx-synthese", "cx-chart-synthese-mensuel", "cx-table-synthese-mensuel", "cx-alerts", "cx-alert-budget-depasse", "cx-mention-seuils-effectif", "cx-prevu-synthese-commentaire", "cx-chart-synthese-composition", "cx-table-synthese-composition", "cx-synthese-chiffres", "cx-synthese-liens", "cx-synthese-limites", "cx-synthese-cartes-nd", "ms-trend-legend"]) {
      expect(out, tid).toContain(`data-testid="${tid}"`);
    }
    for (const anchor of ["cx-synthese-cartes", "cx-synthese-graphique", "cx-synthese-alertes", "cx-synthese-composition", "cx-synthese-chiffres"]) expect(out, anchor).toContain(`id="${anchor}"`);
    expect(out).toContain('class="cx-syn"');
    expect(out).toContain('href="/e/demo/parametres#croisee"');
    expect(out).toContain("ETP payé non calculé : aucune règle de conversion paramétrée.");
    expect(out).not.toMatch(/<details class="cx-fold" id="cx-synthese-chiffres"[^>]* open/);
  });
  it("graphiques seuls : pas de tableau, lien vers le tableau exact ; tableaux seuls : pas de graphique, chiffres clés ouverts", () => {
    const g = renderToStaticMarkup(h(SyntheseView, { model: m, slug: "demo", affichage: "graphique" }));
    expect(g).toContain('data-testid="cx-chart-synthese-mensuel"');
    expect(g).not.toContain('data-testid="cx-table-synthese-mensuel"');
    expect(g).not.toContain('data-testid="cx-synthese-chiffres"');
    expect(g).toContain('href="/x?affichage=tableau#cx-synthese-graphique"');
    const t = renderToStaticMarkup(h(SyntheseView, { model: m, slug: "demo", affichage: "tableau" }));
    expect(t).not.toContain('data-testid="cx-chart-synthese-mensuel"');
    expect(t).not.toContain('data-testid="cx-chart-synthese-composition"');
    expect(t).toContain('data-testid="cx-table-synthese-mensuel"');
    expect(t).toMatch(/<details class="cx-fold" id="cx-synthese-chiffres" data-testid="cx-synthese-chiffres" open=""/);
    expect(t).toContain('data-testid="cx-table-synthese-montants"');
    expect(t).toContain('data-testid="cx-table-synthese-rh"');
  });
  it("aucun zéro à la place d'un n.d. dans le rendu d'un journal non lu", () => {
    const why = "journal de paie indisponible";
    const nd = buildSynthese(input({ pay: { kind: "nd", reason: why, action: { href: "/e/demo/donnees", label: "Données" } }, live: { kind: "nd", reason: why } }));
    const out = sp(renderToStaticMarkup(h(SyntheseView, { model: nd, slug: "demo", affichage: "tableau" })));
    expect(out).not.toContain('data-money-cents="0"');
    expect(out).toContain('data-testid="cx-tile-synthese-masse-nd"');
  });
});

// --- Lecture : branchement sur les lecteurs du contexte (sources simulées, sans base) --------------------------------------------
describe("loadSyntheseInput : lecteurs du contexte, filtre de service, sources absentes", () => {
  const calls = { scenario: 0, compta: 0 };
  const fakeCtx = (over: Record<string, unknown> = {}) => {
    calls.scenario = 0;
    calls.compta = 0;
    const base = "/e/demo/studio-rh/masse-salariale/croisee";
    const state = { chapitre: "synthese", annee: "2026", de: "01", a: "03" };
    const pay = {
      kpi: { collab: { source: { chosen: "dsn", reason: "Fichiers DSN appliqués." }, state: { kind: "ready" } }, settings: { invalid: [] }, input: null },
      source: "dsn",
      unavailable: null,
      input: null,
      etp: () => [],
      dsn: new Map(),
    };
    return {
      slug: "demo",
      canEdit: false,
      period: { year: 2026, from: "01", to: "03", years: [2026], last: "03", months: ["2026-01", "2026-02", "2026-03"], notices: [] },
      periodNd: null,
      prevMonths: ["2025-01", "2025-02", "2025-03"],
      labels: { period: "janvier → mars 2026", prev: "janvier → mars 2025" },
      openMonths: [],
      service: { axis: null, value: undefined, label: "Tous les services", options: [], reason: null },
      budget: { selected: { id: "b-0123456789", name: "Budget test", year: "2026", amounts: { "2026-01": 100_000, "2026-02": null } }, explicit: false, options: [], reason: null },
      settings: { seuilsEffectif: { kind: "absent" }, margeAlerte: { kind: "absent" }, confidentialite: { kind: "absent" }, horizonEcheances: { kind: "absent" } },
      affichage: "tout",
      href: (patch: Record<string, string | null> = {}, hash?: string) => croiseeHref(base, { ...state, ...patch }, hash),
      load: {
        payroll: async () => pay,
        compta: async () => (calls.compta++, { source: null, reason: "", lines: [], months: [], nd: {}, error: false }),
        scenario: async () => (calls.scenario++, { kind: "nd", reason: "aucun scénario ne couvre 2026" }),
      },
      ...over,
    } as unknown as CroiseeContext;
  };

  it("période absente : chapitre n.d. avec la raison et le lien vers Données (lecteur)", async () => {
    const r = await loadSyntheseInput(fakeCtx({ period: null, periodNd: "Aucun mois clos à la date de référence" }));
    expect(r).toEqual({ kind: "nd", reason: "Aucun mois clos à la date de référence", action: { href: "/e/demo/donnees", label: "Données" } });
  });

  it("source DSN : journal et référentiel n.d. avec leur raison ; budget saisi lu ; scénario absent : atterrissage n.d.", async () => {
    const r = await loadSyntheseInput(fakeCtx());
    if (r.kind !== "value") throw new Error("entrée attendue");
    expect(r.pay).toMatchObject({ kind: "nd", reason: "source RH retenue : DSN — journal de paie PayFit non lu" });
    expect(r.live).toEqual({ kind: "nd", reason: "source RH retenue : DSN — journal de paie PayFit non lu" });
    expect(r.rh).toMatchObject({ kind: "nd", reason: "référentiel RH non construit" });
    expect(r.budget.kind).toBe("value");
    if (r.budget.kind === "value") {
      expect(r.budget.series.points.get("2026-01")).toMatchObject({ kind: "value", cost: 100_000 });
      expect(r.budget.series.points.get("2026-02")).toEqual({ month: "2026-02", kind: "nd", reason: "montant du budget non saisi" });
    }
    expect(r.landing).toEqual({ kind: "nd", reason: "aucun scénario ne couvre 2026" });
    expect(r.hrefs.tableau).toBe("/e/demo/studio-rh/masse-salariale/croisee?chapitre=synthese&annee=2026&de=01&a=03&affichage=tableau#cx-synthese-graphique");
    expect(r.hrefs.services).toBe("/e/demo/studio-rh/masse-salariale/croisee?chapitre=services&annee=2026&de=01&a=03");
    expect(calls.scenario).toBe(1);
    const m = buildSynthese(r);
    expect(m.alerts.map((a) => a.id)).toEqual(["atterrissage-nd", "source-journal", "source-rh"]);
    expect(m.tiles.every((t) => t.value.kind === "nd")).toBe(true);
  });

  it("filtre de service : indicateurs RH, budget et atterrissage « non filtrable par service », sans lire le scénario ni la comptabilité", async () => {
    const r = await loadSyntheseInput(fakeCtx({ service: { axis: "SVC", value: "Atelier", label: "Atelier", options: [], reason: null } }));
    if (r.kind !== "value") throw new Error("entrée attendue");
    expect(r.rh).toEqual({ kind: "na", reason: "référentiel RH : non filtrable par service" });
    expect(r.budget).toEqual({ kind: "na", reason: "budget saisi global : non filtrable par service" });
    expect(r.landing).toEqual({ kind: "na", reason: "atterrissage du scénario global : non filtrable par service" });
    expect(calls.scenario).toBe(0);
    expect(calls.compta).toBe(0);
  });
});
