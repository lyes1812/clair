import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SyntheseView } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChSynthese";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { Layer, Point, Series } from "@/lib/budget/series";
import type { CroiseeSetting, SeuilEffectif } from "@/lib/croisee-settings";
import { glossaryEntry } from "@/lib/glossary";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { cellView, croiseeHref, yearMonths, type CroiseeTable } from "@/lib/viz/croisee";
import { N1_NUL, type ServicesInput, type WindowValue } from "@/lib/viz/croisee-masse";
import {
  buildSynthese,
  chartHasData,
  etpProratedAverage,
  loadSyntheseInput,
  PRINT_REPERES_MAX,
  publicReason,
  SYNTHESE_CX_TERMS,
  SYNTHESE_TABLE_IDS as ID,
  syntheseModel,
  type SyntheseInput,
  type SyntheseModel,
} from "@/lib/viz/croisee-synthese";
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
const evo = (delta: number, prev: number) => ({ kind: "value" as const, deltaCents: delta, ratio: prev === 0 ? null : { num: delta, den: prev } });
const set = <T,>(value: T): CroiseeSetting<T> => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const Y26 = yearMonths(2026);
const Y25 = yearMonths(2025);
const QUAL = "ETP contractuel proratisé : quotité à la date de lecture (01/04/2026), proratisée sur les jours sous contrat du mois ; ni ETP payé ni historique exact";
const BASE = "/e/demo/studio-rh/masse-salariale/croisee";

// Budget saisi 2026 : janvier et février à 11 000,00 €, mars non saisi, avril → novembre à 12 000,00 €, décembre à 12 500,00 €.
const budgetPts: Record<string, number | string> = Object.fromEntries(Y26.map((m) => [m, m === "2026-03" ? "montant du budget non saisi" : m <= "2026-02" ? 1_100_000 : m === "2026-12" ? 1_250_000 : 1_200_000]));
// Scénario : réel figé janvier → mars (11 000, 11 500, 11 500), projection avril → novembre à 12 000,00 €, décembre à 13 000,00 €.
const scenPts: Record<string, number> = Object.fromEntries(Y26.map((m) => [m, m === "2026-01" ? 1_100_000 : m <= "2026-03" ? 1_150_000 : m === "2026-12" ? 1_300_000 : 1_200_000]));

// Services (chapitre 05) : A 20 000 € (N-1 18 000 €), B 14 000 € (N-1 13 000 €), total 34 000 € (N-1 31 000 €).
const win = (masse: number): WindowValue => ({ kind: "value", brut: masse, cotisations: 0, masse, byRubric: { salaires: masse, primes: 0, stages: 0, indemnites: 0 }, months: [], paidContractMonths: 1 });
const SERVICES: ServicesInput = {
  nd: null,
  data: {
    year: 2026,
    prevYear: 2025,
    labels: { period: "janvier → mars 2026", prev: "janvier → mars 2025" },
    axis: "Service",
    axisMissing: false,
    rows: [
      { value: "A", cur: win(2_000_000), prev: win(1_800_000), evo: evo(200_000, 1_800_000), href: "/x?service=A" },
      { value: "B", cur: win(1_400_000), prev: win(1_300_000), evo: evo(100_000, 1_300_000), href: "/x?service=B" },
    ],
    total: { cur: win(3_400_000), prev: win(3_100_000), evo: evo(300_000, 3_100_000) },
    selected: null,
  },
};

function input(over: Partial<Extract<SyntheseInput, { kind: "value" }>> = {}): SyntheseInput {
  return {
    kind: "value",
    year: 2026,
    months: ["2026-01", "2026-02", "2026-03"],
    prevMonths: ["2025-01", "2025-02", "2025-03"],
    labels: { period: "janvier → mars 2026", prev: "janvier → mars 2025" },
    openMonths: [],
    filtered: false,
    hrefs: {
      donnees: "/e/demo/donnees",
      parametres: "/e/demo/parametres#croisee",
      grille: "/e/demo/parametres#masse-salariale",
      budget: "/e/demo/studio-rh/hypotheses",
      services: "/x?chapitre=services",
      budgetChapter: "/x?chapitre=budget",
      paieCompta: "/x?chapitre=paie-compta",
      fixeVariable: "/x?chapitre=fixe-variable",
      effectifs: "/x?chapitre=effectifs#cx-effectifs-seuils",
      tableau: "/x?affichage=tableau#cx-synthese-graphique",
      tableauComposition: "/x?affichage=tableau#cx-synthese-composition",
      tableauCascade: "/x?affichage=tableau#cx-synthese-cascade",
      months: Y26.map((m) => `/x?de=${m.slice(5)}&a=${m.slice(5)}`),
    },
    rh: {
      kind: "value",
      etpAverage: { current: { kind: "exact", ratio: { num: 1225, den: 100 } }, previous: { kind: "exact", ratio: { num: 23, den: 2 } }, delta: { kind: "exact", unit: "etp", value: { num: 3, den: 4 } } },
      // 12, 12 et 13 ETP : moyenne 37/3 = 12,33.
      prorated: [
        { month: "2026-01", kind: "exact", ratio: { num: 372, den: 31 }, qualifiers: [QUAL] },
        { month: "2026-02", kind: "exact", ratio: { num: 336, den: 28 }, qualifiers: [QUAL] },
        { month: "2026-03", kind: "exact", ratio: { num: 1209, den: 93 }, qualifiers: [QUAL] },
      ],
      // N-1 : 11, 12 et 12 ETP : moyenne 35/3 = 11,67 ; écart 37/3 − 35/3 = 2/3 = +0,67 ETP.
      proratedPrev: [
        { month: "2025-01", kind: "exact", ratio: { num: 11, den: 1 }, qualifiers: [QUAL] },
        { month: "2025-02", kind: "exact", ratio: { num: 12, den: 1 }, qualifiers: [QUAL] },
        { month: "2025-03", kind: "exact", ratio: { num: 12, den: 1 }, qualifiers: [QUAL] },
      ],
      proratedQualifier: QUAL,
      // 9 demi-journées d'absence sur 400 théoriques : 2,25 % ; N-1 6/400 = 1,50 % ; écart + 0,75 point.
      absenteeism: { current: { kind: "exact", ratio: { num: 9, den: 400 } }, previous: { kind: "exact", ratio: { num: 6, den: 400 } }, delta: { kind: "exact", unit: "points", value: { num: 3, den: 4 } } },
      absenceTypes: ["motif_test"],
      turnover: { current: { kind: "exact", ratio: { num: 3, den: 25 }, entries: 2, exits: 4 }, previous: { kind: "nd", nd: { reason: "historique insuffisant" } }, delta: { kind: "nd", nd: { code: "previous-nd", reason: "N-1 : historique insuffisant" } } },
      // Effectif moyen 2025 : 97/2 = 48,5 ; 2026 à date (janvier → mars) : 49.
      annual: { prevYear: 2025, prev: { kind: "exact", ratio: { num: 97, den: 2 } }, curMonths: ["2026-01", "2026-02", "2026-03"], cur: { kind: "exact", ratio: { num: 49, den: 1 } } },
      rolling: Y25.slice(3).concat(["2026-01", "2026-02", "2026-03"]),
      // Effectif de fin de mois : 40 à 51 ; le dernier (fin mars 2026) vaut 51.
      sparks: { etp: Array.from({ length: 12 }, (_, i) => ({ kind: "exact" as const, etp4: 120_000 + i * 1_000 })), absenteeism: Array.from({ length: 12 }, () => ({ kind: "exact" as const, ratio: { num: 3, den: 100 } })), headcount: Array.from({ length: 12 }, (_, i) => ({ kind: "exact" as const, persons: 40 + i })) },
    },
    pay: {
      kind: "value",
      // Période : brut 24 000,00 € (fixe 20 000, variable 3 000 + 500, stages 500), cotisations 10 000,00 €, masse 34 000,00 €.
      cur: { kind: "value", brut: 2_400_000, cotisations: 1_000_000, masse: 3_400_000, byRubric: { salaires: 2_000_000, primes: 300_000, stages: 50_000, indemnites: 50_000 }, openMonths: [] },
      prev: { kind: "value", brut: 2_200_000, cotisations: 900_000, masse: 3_100_000, byRubric: { salaires: 1_900_000, primes: 200_000, stages: 0, indemnites: 100_000 }, openMonths: [] },
      // + 300 000 c sur 3 100 000 c : + 9,677… % → « +9,68 % ».
      evolution: evo(300_000, 3_100_000),
      // Fixe +1 000 € sur 19 000 € = 5,26 % ; variable +500 € sur 3 000 € = 16,67 % ; stages +500 € sur 0 € (% n.d.) ;
      // brut +2 000 € sur 22 000 € = 9,09 % ; cotisations +1 000 € sur 9 000 € = 11,11 % ; masse +3 000 € sur 31 000 € = 9,68 %.
      composition: { fixe: evo(100_000, 1_900_000), variable: evo(50_000, 300_000), stages: evo(50_000, 0), brut: evo(200_000, 2_200_000), cotisations: evo(100_000, 900_000), masse: evo(300_000, 3_100_000) },
      // 3 400 000 c ÷ 12 ETP-mois = 283 333,33 c → « 2 833,33 € ».
      cost: { kind: "value", costCents: { num: 3_400_000 * 10_000, den: 120_000 }, etpMonths4: 120_000 },
      costPrev: { kind: "nd", nd: { reason: "ETP fin 2025-02 : n.d." } },
      rolling: Y25.slice(3).map((m) => mv(m, 1_000_000)).concat([mv("2026-01", 1_100_000), mv("2026-02", 1_150_000), mv("2026-03", 1_150_000)]),
      year: Y26.map((m) => (m === "2026-01" ? mv(m, 1_100_000) : m <= "2026-03" ? mv(m, 1_150_000) : mnd(m, `mois ${m} hors de la lecture PayFit appliquée`))),
      // N-1 : 10 000 € par mois, 11 000 € en mars 2025 (total janvier → mars 2025 = 31 000 €), juin 2025 n.d.
      yearPrev: Y25.map((m) => (m === "2025-06" ? mnd(m, "journal de paie 2025-06 non renvoyé") : mv(m, m === "2025-03" ? 1_100_000 : 1_000_000))),
      // Mois par mois : janvier +1 000 € (10,00 %), février +1 500 € (15,00 %), mars +500 € sur 11 000 € (4,55 %) ; ensuite n.d.
      yearEvo: Y26.map((m, i) => (i === 0 ? evo(100_000, 1_000_000) : i === 1 ? evo(150_000, 1_000_000) : i === 2 ? evo(50_000, 1_100_000) : { kind: "nd" as const, nd: { reason: `période n.d. (${m} : mois hors de la lecture PayFit appliquée)` } })),
      // Rubriques (remun = salaires + stages) : +1 500 €, primes +1 000 €, indemnités −500 €, charges +1 000 € ; somme +3 000 €.
      cascade: {
        kind: "value",
        start: 3_100_000,
        end: 3_400_000,
        steps: [
          { key: "remun", label: "Rémunération de base", delta: 150_000, reason: null },
          { key: "primes", label: "Primes et éléments variables", delta: 100_000, reason: null },
          { key: "indemnites", label: "Indemnités et avantages", delta: -50_000, reason: null },
          { key: "charges", label: "Charges patronales", delta: 100_000, reason: null },
        ],
        residual: 0,
      },
      unclassified: ["6459"],
      checks: { compta: { kind: "skip" }, dsn: { kind: "skip" } },
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
    services: SERVICES,
    seuils: { kind: "absent" },
    marge: { kind: "absent" },
    ...over,
  };
}
const value = (over: Partial<Extract<SyntheseInput, { kind: "value" }>> = {}) => input(over) as Extract<SyntheseInput, { kind: "value" }>;
const tile = (m: SyntheseModel, id: string) => m.tiles.find((t) => t.id === id)!;
const tableOf = (m: SyntheseModel, id: string) => m.tables.find((t) => t.id === id)!;
const texts = (t: CroiseeTable) => t.rows.map((r) => r.cells.map((c, i) => sp(cellView(c, t.columns[i], r).text)));
const footText = (t: CroiseeTable) => t.foot!.cells.map((c, i) => sp(cellView(c, t.columns[i], t.foot).text));
const lines = (m: SyntheseModel, id: string) => tile(m, id).variations!.map((v) => [v.label, v.text && sp(v.text)]);

// --- Calcul nouveau ------------------------------------------------------------------------------------------------------------
describe("etpProratedAverage : moyenne exacte des mois de la période", () => {
  it("cas de référence : (2 + 1,5) ÷ 2 = 7/4 ; (1/3 + 1/6 + 1/2) ÷ 3 = 1/3 ; 12, 12 et 13 → 37/3", () => {
    expect(etpProratedAverage([{ month: "2026-01", kind: "exact", ratio: { num: 62, den: 31 }, qualifiers: [] }, { month: "2026-02", kind: "exact", ratio: { num: 45, den: 30 }, qualifiers: [] }])).toEqual({ kind: "exact", ratio: { num: 7, den: 4 }, months: 2 });
    expect(etpProratedAverage([1, 2, 3].map((i) => ({ month: `2026-0${i}`, kind: "exact" as const, ratio: { num: 1, den: [3, 6, 2][i - 1] }, qualifiers: [] })))).toEqual({ kind: "exact", ratio: { num: 1, den: 3 }, months: 3 });
    const pr = value().rh;
    expect(pr.kind === "value" && etpProratedAverage(pr.prorated)).toEqual({ kind: "exact", ratio: { num: 37, den: 3 }, months: 3 });
  });
  it("un mois en borne basse rend la moyenne en borne basse ; un mois n.d. la rend n.d. (mois nommés), jamais zéro", () => {
    expect(etpProratedAverage([{ month: "2026-01", kind: "lower_bound", ratio: { num: 2, den: 1 }, qualifiers: [] }, { month: "2026-02", kind: "exact", ratio: { num: 1, den: 1 }, qualifiers: [] }])).toEqual({ kind: "lower_bound", ratio: { num: 3, den: 2 }, months: 2 });
    expect(etpProratedAverage([{ month: "2026-01", kind: "exact", ratio: { num: 2, den: 1 }, qualifiers: [] }, { month: "2026-02", kind: "nd", nd: { reason: "aucune quotité lisible" } }])).toEqual({ kind: "nd", reason: "févr. 2026 : aucune quotité lisible" });
    expect(etpProratedAverage([])).toEqual({ kind: "nd", reason: "aucun mois dans la période" });
  });
});

// --- Raisons publiques (aucun identifiant dans la page croisée) -------------------------------------------------------------------
describe("publicReason : raisons du moteur sans identifiant de contrat ni d'absence", () => {
  const CONT = "sorties de 2026-03 : contrats continus non vérifiables (CTR-TEST-1 le 03/03/2026, CTR-TEST-2 le 05/03/2026) — jour voisin hors de la couverture ; sans la neutralisation (Paramètres), ces mouvements seraient comptés";
  it("contrats continus non vérifiables : le nombre et le mois restent, les identifiants partent", () => {
    expect(publicReason(CONT)).toBe("2 contrats continus non vérifiables en 2026-03 (sorties, détail dans KPI RH)");
    expect(publicReason(`2026-03 : ${CONT}`)).toBe("2026-03 : 2 contrats continus non vérifiables en 2026-03 (sorties, détail dans KPI RH)");
    expect(publicReason("Entrées de 2026-02 : contrats continus non vérifiables (CTR-TEST-3 le 02/02/2026)")).toBe("1 contrat continu non vérifiable en 2026-02 (entrées, détail dans KPI RH)");
  });
  it("absence rattachée à un contrat inconnu, absence sans date : raison générique ; autre raison inchangée", () => {
    expect(publicReason("2026-03 : absence ABS-TEST-9 rattachée au contrat CTR-TEST-4 inconnu du référentiel")).toBe("2026-03 : 1 absence rattachée à un contrat inconnu du référentiel (détail dans KPI RH)");
    expect(publicReason("absence ABS-TEST-8 : date de fin non renseignée dans PayFit")).toBe("1 absence sans date de fin renseignée dans PayFit (détail dans KPI RH)");
    expect(publicReason("historique insuffisant")).toBe("historique insuffisant");
  });
  it("buildSynthese : une raison de turnover qui cite des contrats est réécrite partout (carte, tableau)", () => {
    const rh = value().rh;
    if (rh.kind !== "value") throw new Error("entrée attendue");
    const m = buildSynthese(input({ rh: { ...rh, turnover: { current: { kind: "nd", nd: { reason: `2026-03 : ${CONT}` } }, previous: { kind: "nd", nd: { reason: "historique insuffisant" } }, delta: { kind: "nd", nd: { code: "current-not-exact", reason: `valeur n.d. — 2026-03 : ${CONT}` } } } } }));
    const json = JSON.stringify(m);
    expect(json).not.toContain("CTR-TEST");
    expect(tile(m, "turnover").value.reason).toBe("2026-03 : 2 contrats continus non vérifiables en 2026-03 (sorties, détail dans KPI RH)");
    expect(tableOf(m, ID.rh).rows[3].cells[2]).toEqual({ nd: "2026-03 : 2 contrats continus non vérifiables en 2026-03 (sorties, détail dans KPI RH)" });
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
  it("1 · ETP moyen 12,25, N-1 11,50, écart +0,75 ETP (sans couleur), ETP proratisé « moyenne des mois » 12,33", () => {
    const t = tile(m, "etp");
    expect(t.value).toEqual({ text: "12,25", kind: "value", reason: null });
    expect(t.cost).toBeUndefined();
    expect(t.variations!.map((v) => [v.label, v.text && sp(v.text), v.tone])).toEqual([
      ["N-1", "11,50", "flat"],
      ["Écart", "+0,75 ETP", "flat"],
      ["ETP contractuel proratisé — quotité actuelle, moyenne des mois", "12,33", "flat"],
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
  it("4 · atterrissage 143 000,00 € sur douze mois ; mêmes 11 mois : 131 500,00 − 130 500,00 = +1 000,00 € (+0,77 %)", () => {
    // Budget sans mars : 2 × 11 000 + 8 × 12 000 + 12 500 = 130 500 ; scénario sur les mêmes mois : 11 000 + 11 500 + 8 × 12 000 + 13 000 = 131 500.
    const t = tile(m, "atterrissage");
    expect(sp(t.value.text)).toBe("143 000,00 €");
    expect(t.sub).toBe("Scénario « Scénario test » · douze mois");
    expect(lines(m, "atterrissage")).toEqual([
      ["Budget saisi « Budget test », 11 mois", "130 500,00 €"],
      ["Atterrissage, 11 mois comparés", "131 500,00 €"],
      ["Écart, 11 mois comparés", "+1 000,00 € (+0,77 %)"],
    ]);
    expect(t.note).toBe("réel : 3 mois · projection : 9 mois ; sans montant de budget, exclus : mars 2026");
  });
  it("4 bis · budget saisi sur les douze mois (mars à 11 500 €) : 143 000 − 142 000 = +1 000,00 € (+0,70 %), sans ligne « mois comparés »", () => {
    const full = { ...budgetPts, "2026-03": 1_150_000 };
    const m2 = buildSynthese(input({ budget: { kind: "value", name: "Budget test", series: series("b", "Budget saisi « Budget test »", full, () => "budget") } }));
    expect(lines(m2, "atterrissage")).toEqual([
      ["Budget saisi « Budget test »", "142 000,00 €"],
      ["Écart", "+1 000,00 € (+0,70 %)"],
    ]);
  });
  it("5 · absentéisme 2,25 %, N-1 1,50 %, écart +0,75 pts, 4,5 j sur 200 j ; 6 · turnover 12,00 %, effectif de fin 51", () => {
    const a = tile(m, "absenteisme");
    expect(sp(a.value.text)).toBe("2,25 %");
    expect(lines(m, "absenteisme")).toEqual([
      ["N-1", "1,50 %"],
      ["Écart", "+0,75 pts"],
      ["Absence", "4,5 j sur 200 j théoriques"],
    ]);
    expect(a.note).toBe("Motifs retenus : motif_test");
    const to = tile(m, "turnover");
    expect(sp(to.value.text)).toBe("12,00 %");
    expect(to.sub).toBe("Douze mois glissants à fin mars 2026");
    expect(to.note).toBe("Effectif de fin : 51 (fin mars 2026)");
    expect(to.variations!.map((v) => [v.label, v.text, v.reason])).toEqual([
      ["N-1", null, "historique insuffisant"],
      ["Écart", null, "N-1 : historique insuffisant"],
      ["Sorties", "4", null],
      ["Entrées", "2", null],
    ]);
    expect(m.trend).toBe(true);
  });
  it("absentéisme en borne basse : les jours d'absence sont écrits « ≥ »", () => {
    const rh = value().rh;
    if (rh.kind !== "value") throw new Error("entrée attendue");
    const lb = buildSynthese(input({ rh: { ...rh, absenteeism: { ...rh.absenteeism, current: { kind: "lower_bound", ratio: { num: 9, den: 400 } } } } }));
    expect(lines(lb, "absenteisme")[2]).toEqual(["Absence", "≥ 4,5 j sur 200 j théoriques"]);
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
    expect(m.print).toEqual({ max: PRINT_REPERES_MAX, folded: 0 });
  });
  it("seuils d'effectif (seuilAlerts du chapitre 02) : effectif moyen 2025 = 48,5 et 2026 à date = 49, seuil 50, marge 2 : deux repères vers le chapitre 02", () => {
    const m = buildSynthese(input({ seuils: set<SeuilEffectif[]>([{ libelle: "Seuil A", valeur: 50 }]), marge: set(2) }));
    const s = m.alerts.filter((a) => a.label === "Effectif proche d'un seuil");
    expect(s.map((a) => [a.id, a.level, a.href, a.linkLabel])).toEqual([
      ["effectifs-seuil-n1", "repere", "/x?chapitre=effectifs#cx-effectifs-seuils", "Effectifs & mouvements"],
      ["effectifs-seuil-n", "repere", "/x?chapitre=effectifs#cx-effectifs-seuils", "Effectifs & mouvements"],
    ]);
    expect(s[0].text).toContain("48,50");
    expect(m.mentions).toEqual([]);
    // Marge 1 : 50 − 48,5 = 1,5 > 1 (aucun repère pour 2025) ; 50 − 49 = 1 ≤ 1 (repère pour 2026).
    expect(buildSynthese(input({ seuils: set<SeuilEffectif[]>([{ libelle: "Seuil A", valeur: 50 }]), marge: set(1) })).alerts.filter((a) => a.label === "Effectif proche d'un seuil").map((a) => a.id)).toEqual(["effectifs-seuil-n"]);
  });
  it("seuils définis, effectif moyen 2026 n.d. : point « à compléter » ; marge absente : mention ; filtre de service : mention sans lien", () => {
    const rh = value().rh;
    if (rh.kind !== "value") throw new Error("entrée attendue");
    const nd = buildSynthese(input({ rh: { ...rh, annual: { ...rh.annual, cur: { kind: "nd", nd: { reason: "mois non clos" } } } }, seuils: set<SeuilEffectif[]>([{ libelle: "Seuil A", valeur: 80 }]), marge: set(2) }));
    expect(nd.alerts.find((a) => a.id === "effectif-nd")).toMatchObject({ level: "a-completer", text: "Effectif moyen 2026 (janvier → mars 2026) : mois non clos." });
    expect(buildSynthese(input({ seuils: set<SeuilEffectif[]>([{ libelle: "Seuil A", valeur: 50 }]) })).mentions.map((x) => x.text)).toEqual(["Marge d'alerte des seuils d'effectif non définie (Paramètres)"]);
    const na = buildSynthese(input({ rh: { kind: "na", reason: "référentiel RH : non filtrable par service" }, seuils: set<SeuilEffectif[]>([{ libelle: "Seuil A", valeur: 50 }]), marge: set(2) }));
    expect(na.mentions).toEqual([{ id: "seuils-effectif", text: "Seuils d'effectif : effectif moyen non filtrable par service." }]);
  });
  it("comptabilité non lue et DSN de contrôle absente : « à compléter » ; écart DSN avec mois incomplet : repère", () => {
    const pay = value().pay;
    if (pay.kind !== "value") throw new Error("entrée attendue");
    const m = buildSynthese(input({ pay: { ...pay, checks: { compta: { kind: "absent", reason: "aucune source comptable retenue" }, dsn: { kind: "nd", reason: "2026-02 : aucune DSN retenue", months: ["2026-02"], none: false } } } }));
    expect(m.alerts.filter((a) => a.level === "a-completer").map((a) => a.id)).toEqual(["source-compta", "source-dsn", "comptes-non-classes"]);
    expect(sp(m.alerts.find((a) => a.id === "source-dsn")!.text)).toBe("1 mois de la période sans DSN exploitable : févr. 2026 : aucune DSN retenue.");
    const g = buildSynthese(input({ pay: { ...pay, checks: { compta: { kind: "value", ecart: 0 }, dsn: { kind: "value", delta: 500, incomplete: ["2026-03"] } } } }));
    expect(sp(g.alerts.find((a) => a.id === "journal-dsn")!.text)).toBe("Brut du journal moins brut déclaré (DSN, type 001) sur la période : +5,00 €. DSN incomplète : mars 2026.");
  });
});

// --- Graphique principal et tableaux -----------------------------------------------------------------------------------------------
describe("buildSynthese : graphique principal (réel et projection distincts) et son tableau exact", () => {
  const m = buildSynthese(input());
  const chart = m.charts.find((c) => c.id === ID.mensuel)!;
  const table = tableOf(m, ID.mensuel);
  it("quatre séries : réel de janvier à mars, projection (teinte 3) ensuite, budget avec mars n.d., N-1 avec juin 2025 n.d. ; mois de la période marqués", () => {
    expect(chart.kind).toBe("barres");
    expect(chart.mode).toBe("grouped");
    expect(chart.tableId).toBe(table.id);
    expect(chart.series.map((s) => s.key)).toEqual(["reel", "projection", "budget", "n1"]);
    expect(chart.series[1].color).toBe("var(--chart-3)");
    expect(chart.series[0].values).toEqual([1_100_000, 1_150_000, 1_150_000, ...Array(9).fill(null)]);
    expect(chart.series[1].values).toEqual([null, null, null, ...Array(8).fill(1_200_000), 1_300_000]);
    expect(chart.series[2].values[2]).toBeNull();
    expect(chart.series[2].reasons![2]).toBe("montant du budget non saisi");
    expect(chart.series[3].values[5]).toBeNull();
    expect(chart.series[3].reasons![5]).toBe("journal de paie 2025-06 non renvoyé");
    expect(chart.categories.slice(0, 4)).toEqual(["janv. •", "févr. •", "mars •", "avr."]);
    expect(chart.categoryTitles![0]).toBe("janvier 2026 · réel · dans la période");
    expect(chart.categoryTitles![3]).toBe("avril 2026 · projection (scénario « Scénario test »)");
    expect(chart.note).toBe("• : mois de la période (janvier → mars 2026).");
  });
  it("le tableau porte exactement les valeurs du graphique ; écart réel − N-1 par mois réalisé ; lien par mois clos ; total de la période", () => {
    expect(table.rows).toHaveLength(12);
    table.rows.forEach((r, i) => {
      chart.series.forEach((s, k) => {
        const v = s.values[i];
        if (v !== null) expect(r.cells[k + 3]).toBe(v);
      });
    });
    expect(table.columns.map((c) => c.header)).toEqual(["Mois", "Dans la période", "Nature", "Réel", "Projection", "Budget saisi « Budget test »", "N-1 (même mois)", "Écart réel − N-1", "Écart réel − N-1 (%)"]);
    expect(texts(table)[0]).toEqual(["Janvier 2026", "Oui", "Réel", "11 000,00 €", "—", "11 000,00 €", "10 000,00 €", "+1 000,00 €", "+10,00 %"]);
    expect(texts(table)[2]).toEqual(["Mars 2026", "Oui", "Réel", "11 500,00 €", "—", "n.d.", "11 000,00 €", "+500,00 €", "+4,55 %"]);
    expect(texts(table)[3]).toEqual(["Avril 2026", "Non", "Projection", "—", "12 000,00 €", "12 000,00 €", "10 000,00 €", "—", "—"]);
    expect(texts(table)[5]).toEqual(["Juin 2026", "Non", "Projection", "—", "12 000,00 €", "12 000,00 €", "n.d.", "—", "—"]);
    expect(table.rows.map((r) => r.href ?? null)).toEqual(["/x?de=01&a=01", "/x?de=02&a=02", "/x?de=03&a=03", ...Array(9).fill(null)]);
    // Total : 34 000 € ; budget n.d. (mars sans montant) ; N-1 31 000 € ; +3 000 € ; 3 000 ÷ 31 000 = 9,68 %.
    expect(footText(table)).toEqual(["Total janvier → mars 2026", "—", "Réel", "34 000,00 €", "—", "n.d.", "31 000,00 €", "+3 000,00 €", "+9,68 %"]);
    expect(table.notes).toEqual(["Projection : avr. 2026 → déc. 2026, scénario « Scénario test ».", "Période retenue : janvier → mars 2026 ; N-1 : janvier → mars 2025."]);
  });
  it("composition (brutParts + cotisations) et son tableau : écarts de coût N / N-1 en montant et en %", () => {
    const comp = m.charts.find((c) => c.id === ID.composition)!;
    expect(comp.kind).toBe("anneau");
    expect(comp.series.map((s) => [s.key, s.values[0]])).toEqual([["fixe", 2_000_000], ["variable", 350_000], ["stages", 50_000], ["cotisations", 1_000_000]]);
    const t = tableOf(m, ID.composition);
    expect(t.columns.map((c) => c.header)).toEqual(["Composante", "janvier → mars 2026", "N-1 (janvier → mars 2025)", "Écart", "Écart (%)"]);
    expect(texts(t)).toEqual([
      ["Fixe (salaires et congés payés)", "20 000,00 €", "19 000,00 €", "+1 000,00 €", "+5,26 %"],
      ["Variable (primes et indemnités)", "3 500,00 €", "3 000,00 €", "+500,00 €", "+16,67 %"],
      ["Gratifications de stage", "500,00 €", "0,00 €", "+500,00 €", "n.d."],
      ["Brut", "24 000,00 €", "22 000,00 €", "+2 000,00 €", "+9,09 %"],
      ["Cotisations patronales", "10 000,00 €", "9 000,00 €", "+1 000,00 €", "+11,11 %"],
    ]);
    expect(t.rows[2].cells[4]).toEqual({ nd: N1_NUL });
    expect(footText(t)).toEqual(["Masse salariale chargée", "34 000,00 €", "31 000,00 €", "+3 000,00 €", "+9,68 %"]);
    expect(cellView(t.foot!.cells[3], t.columns[3]).tone).toBe("bad");
  });
  it("cascade de l'écart (masseByRubric) : 31 000 + 1 500 + 1 000 − 500 + 1 000 = 34 000 €, tendance de coût, tableau exact", () => {
    const c = m.charts.find((x) => x.id === ID.cascade)!;
    expect(c.kind).toBe("cascade");
    expect(c.trend).toBe("cost");
    expect(c.categories).toEqual(["N-1", "Rémunération de base", "Primes et éléments variables", "Indemnités et avantages", "Charges patronales", "N"]);
    expect(c.series[0].values).toEqual([3_100_000, 150_000, 100_000, -50_000, 100_000, 3_400_000]);
    const t = tableOf(m, ID.cascade);
    expect(texts(t)).toEqual([
      ["Masse salariale chargée N-1 (janvier → mars 2025)", "31 000,00 €", "—"],
      ["Rémunération de base", "—", "+1 500,00 €"],
      ["Primes et éléments variables", "—", "+1 000,00 €"],
      ["Indemnités et avantages", "—", "−500,00 €"],
      ["Charges patronales", "—", "+1 000,00 €"],
      ["Écart total", "—", "+3 000,00 €"],
    ]);
    expect(footText(t)).toEqual(["Masse salariale chargée N (janvier → mars 2026)", "34 000,00 €", "—"]);
  });
  it("cascade avec une rubrique n.d. : l'écart non réparti va sur « Rubriques n.d. » (+1 000 €), jamais réparti ; cascade n.d. : bloc n.d.", () => {
    const pay = value().pay;
    if (pay.kind !== "value" || pay.cascade.kind !== "value") throw new Error("entrée attendue");
    const steps = pay.cascade.steps.map((s) => (s.key === "primes" ? { ...s, delta: null, reason: "N : févr. 2026 : rubrique n.d." } : s));
    const m2 = buildSynthese(input({ pay: { ...pay, cascade: { ...pay.cascade, steps, residual: 100_000 } } }));
    const t = tableOf(m2, ID.cascade);
    expect(texts(t).map((r) => [r[0], r[2]])).toEqual([
      ["Masse salariale chargée N-1 (janvier → mars 2025)", "—"],
      ["Rémunération de base", "+1 500,00 €"],
      ["Primes et éléments variables", "n.d."],
      ["Indemnités et avantages", "−500,00 €"],
      ["Charges patronales", "+1 000,00 €"],
      ["Rubriques n.d. (écart non réparti)", "+1 000,00 €"],
      ["Écart total", "+3 000,00 €"],
    ]);
    expect(m2.charts.find((x) => x.id === ID.cascade)!.categories).toEqual(["N-1", "Rémunération de base", "Indemnités et avantages", "Charges patronales", "Rubriques n.d.", "N"]);
    const m3 = buildSynthese(input({ pay: { ...pay, cascade: { kind: "nd", reason: "N : 2026-03 : paie non clôturée à la lecture" } } }));
    expect(m3.tables.some((x) => x.id === ID.cascade)).toBe(false);
    expect(m3.blocks.find((b) => b.id === "cascade")!.nd).toEqual([{ label: "Cascade de l'écart de coût", reason: "N : 2026-03 : paie non clôturée à la lecture" }]);
  });
  it("tableau par service (lignes du chapitre 05) : coût, part, écart et écart en %, lien de filtre ; sous un filtre, seule la ligne du service", () => {
    const t = tableOf(m, ID.services);
    expect(t.columns.map((c) => c.header)).toEqual(["Service", "Coût janvier → mars 2026", "Part du coût", "Écart N / N-1", "Écart N / N-1 (%)"]);
    expect(t.columns.some((c) => c.sortable)).toBe(false);
    // A : 20 000 ÷ 34 000 = 58,82 % ; 2 000 ÷ 18 000 = 11,11 %. B : 14 000 ÷ 34 000 = 41,18 % ; 1 000 ÷ 13 000 = 7,69 %.
    expect(texts(t)).toEqual([
      ["A", "20 000,00 €", "58,82 %", "+2 000,00 €", "+11,11 %"],
      ["B", "14 000,00 €", "41,18 %", "+1 000,00 €", "+7,69 %"],
    ]);
    expect(footText(t)).toEqual(["Total", "34 000,00 €", "—", "+3 000,00 €", "+9,68 %"]);
    expect(t.rows.map((r) => r.href)).toEqual(["/x?service=A", "/x?service=B"]);
    expect(m.servicesNote).toBeNull();
    const f = buildSynthese(input({ services: { ...SERVICES, data: { ...SERVICES.data!, selected: { label: "B", clearHref: "/x" } } } }));
    const tf = tableOf(f, ID.services);
    expect(tf.columns.map((c) => c.key)).toEqual(["service", "n", "ecart", "ecart-pct"]);
    expect(texts(tf)).toEqual([["B", "14 000,00 €", "+1 000,00 €", "+7,69 %"]]);
    expect(tf.foot).toBeUndefined();
    expect(f.servicesNote).toBe("Filtre Service : seul le service « B » est listé ; le chapitre 05 · Services montre tous les services.");
    const nd = buildSynthese(input({ services: { nd: { reason: "aucun axe de service retenu", action: { href: "/e/demo/parametres#masse-salariale", label: "Paramètres" } }, data: null } }));
    expect(nd.tables.some((x) => x.id === ID.services)).toBe(false);
    expect(nd.blocks.find((b) => b.id === "services")!.nd).toEqual([{ label: "Tableau de synthèse par service", reason: "aucun axe de service retenu", action: { href: "/e/demo/parametres#masse-salariale", label: "Paramètres" } }]);
  });
  it("chiffres clés : Valeur − Référence = Écart sur les mêmes mois ; atterrissage des douze mois sur sa propre ligne, sans écart", () => {
    const t = tableOf(m, ID.montants);
    expect(texts(t)).toEqual([
      ["Masse salariale chargée", "janvier → mars 2026", "34 000,00 €", "N-1 : janvier → mars 2025", "31 000,00 €", "+3 000,00 €"],
      ["Coût par ETP-mois", "janvier → mars 2026", "2 833,33 €", "N-1 : janvier → mars 2025", "n.d.", "—"],
      ["Écart au budget saisi", "janvier → mars 2026 (2 mois avec budget)", "22 500,00 €", "Budget saisi « Budget test »", "22 000,00 €", "+500,00 €"],
      ["Atterrissage 2026", "Scénario « Scénario test » · douze mois", "143 000,00 €", "—", "—", "—"],
      ["Atterrissage 2026 face au budget", "11 mois comparés (sans montant de budget : mars 2026)", "131 500,00 €", "Budget saisi « Budget test »", "130 500,00 €", "+1 000,00 €"],
    ]);
    for (const r of t.rows) if (typeof r.cells[2] === "number" && typeof r.cells[4] === "number") expect(r.cells[2] - r.cells[4]).toBe(r.cells[5]);
    const rh = tableOf(m, ID.rh);
    expect(rh.columns.map((c) => c.header)).toEqual(["Indicateur", "Mesure", "Valeur", "N-1 (janvier → mars 2025)", "Écart"]);
    expect(texts(rh)).toEqual([
      ["ETP moyen", "janvier → mars 2026", "12,25", "11,50", "+0,75"],
      ["ETP contractuel proratisé — quotité actuelle, moyenne des mois", "janvier → mars 2026", "12,33", "11,67", "+0,67"],
      ["Absentéisme", "janvier → mars 2026", "2,25 %", "1,50 %", "+0,75 pts"],
      ["Turnover", "Douze mois glissants à fin mars 2026", "12,00 %", "n.d.", "n.d."],
    ]);
    for (const r of rh.rows) for (let i = 0; i < r.cells.length; i++) expect(cellView(r.cells[i], rh.columns[i], r).tone).toBe("flat");
  });
  it("séries des cartes : valeurs des mini-courbes mois par mois, « — » hors de la mini-courbe, n.d. avec sa raison", () => {
    const t = tableOf(m, ID.series);
    // Avril 2025 → décembre 2026 : 21 mois.
    expect(t.rows).toHaveLength(21);
    expect(texts(t)[0]).toEqual(["Avril 2025", "12,00", "10 000,00 €", "3,00 %", "40", "—", "—"]);
    // Mars 2026 : douzième mois glissant, ETP 120 000 + 11 × 1 000 = 131 000 dix-millièmes = 13,10 ; effectif 40 + 11 = 51.
    expect(texts(t)[11]).toEqual(["Mars 2026", "13,10", "11 500,00 €", "3,00 %", "51", "n.d.", "11 500,00 €"]);
    expect(t.rows[11].cells[5]).toEqual({ nd: "montant du budget non saisi" });
    expect(texts(t)[10][5]).toBe("+500,00 €");
    expect(texts(t)[20]).toEqual(["Décembre 2026", "—", "—", "—", "—", "—", "13 000,00 €"]);
  });
  it("tous les identifiants du glossaire du modèle existent ; « Prévu » du commentaire dans le modèle ; blocs = tableaux du modèle", () => {
    const ids = [...Object.values(SYNTHESE_CX_TERMS), ...m.terms, ...m.prevu.map((p) => p.term), ...m.tables.flatMap((t) => [...(t.terms ?? []), ...t.columns.flatMap((c) => (c.term ? [c.term] : []))])];
    for (const id of ids) expect(glossaryEntry(id), id).toBeDefined();
    expect(m.prevu.map((p) => [p.id, p.label])).toEqual([["commentaire", "Commentaire du mois"]]);
    expect(new Set(m.blocks.flatMap((b) => b.tables))).toEqual(new Set(m.tables.map((t) => t.id)));
    expect(m.blocks.find((b) => b.id === "cartes")!.nd.map((n) => n.label)).toEqual(["Coût par ETP-mois N-1", "Turnover N-1"]);
  });
});

// --- n.d., filtre de service, période absente ----------------------------------------------------------------------------------
describe("buildSynthese : un n.d. reste n.d. jusqu'au tableau et au graphique", () => {
  it("journal non lu : masse n.d., graphique sans valeur réelle (null, jamais 0), tableau n.d., alerte « à compléter »", () => {
    const why = "source RH retenue : DSN — journal de paie PayFit non lu";
    const m = buildSynthese(input({ pay: { kind: "nd", reason: why, action: { href: "/e/demo/donnees", label: "Données" } }, live: { kind: "nd", reason: why }, landing: { kind: "nd", reason: "aucun scénario ne couvre 2026" } }));
    expect(tile(m, "masse").value).toEqual({ text: "n.d.", kind: "nd", reason: why });
    expect(tile(m, "ecart-budget").value).toEqual({ text: "n.d.", kind: "nd", reason: `réalisé : ${why}` });
    const chart = m.charts.find((c) => c.id === ID.mensuel)!;
    expect(chart.series[0].values.every((v) => v === null)).toBe(true);
    expect(chart.series[0].reasons!.every((r) => r === why)).toBe(true);
    expect(chart.series[3].values.every((v) => v === null)).toBe(true);
    const t = tableOf(m, ID.mensuel);
    expect(t.rows.every((r) => JSON.stringify(r.cells[3]) === JSON.stringify({ nd: why }))).toBe(true);
    const comp = tableOf(m, ID.composition);
    expect([...comp.rows, comp.foot!].every((r) => r.cells.slice(1).every((c) => typeof c === "object" && "nd" in c))).toBe(true);
    expect(chartHasData(m.charts.find((c) => c.id === ID.composition)!)).toBe(false);
    expect(m.blocks.find((b) => b.id === "cascade")!.nd[0].reason).toBe(why);
    expect(m.alerts.map((a) => a.id)).toEqual(["atterrissage-nd", "source-journal"]);
    expect(m.alerts.find((a) => a.id === "source-journal")).toMatchObject({ level: "a-completer", href: "/e/demo/donnees" });
  });

  it("filtre de service : ETP, absentéisme, turnover, budget et atterrissage n.d. « non filtrable par service » ; masse filtrée calculée", () => {
    const m = buildSynthese(
      input({
        filtered: true,
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
    expect(m.mentions.map((x) => x.text)).toEqual(["Seuils d'effectif non définis (Paramètres)", "Contrôles du journal de paie (comptabilité, DSN) : non filtrables par service."]);
    const chart = m.charts.find((c) => c.id === ID.mensuel)!;
    expect(chart.series[1].values.every((v) => v === null)).toBe(true); // aucune projection sous un filtre de service
    expect(chart.series[2].reasons!.every((r) => r === "budget saisi global : non filtrable par service")).toBe(true);
  });

  it("période absente : chapitre n.d. avec la raison et l'action, aucune carte ; la section porte .cx-syn (imprimée par le PDF d'une page)", () => {
    const m = buildSynthese({ kind: "nd", reason: "aucun mois clos à la date de référence", action: { href: "/e/demo/donnees", label: "Données" } });
    expect(m.nd).toEqual({ reason: "Aucun mois clos à la date de référence", action: { href: "/e/demo/donnees", label: "Données" } });
    expect(m.tiles).toEqual([]);
    const out = renderToStaticMarkup(h(SyntheseView, { model: m, slug: "demo", affichage: "tout" }));
    expect(out).toContain('class="panel cx-syn cx-syn-nd" data-testid="cx-synthese-nd"');
    expect(out).toContain("Aucun mois clos à la date de référence");
  });
});

// --- Rendu du modèle --------------------------------------------------------------------------------------------------------------
describe("SyntheseView : rendu du modèle selon l'affichage", () => {
  const m = buildSynthese(input());
  it("tout : six cartes, graphique et tableau exact, points à surveiller, composition, cascade, services, chiffres ; ancres cx-synthese-*", () => {
    const out = sp(renderToStaticMarkup(h(SyntheseView, { model: m, slug: "demo", affichage: "tout" })));
    for (const id of ["etp", "masse", "ecart-budget", "atterrissage", "absenteisme", "turnover"]) expect(out).toContain(`data-testid="cx-tile-synthese-${id}"`);
    expect(out).toContain('class="facts ms-tiles cx-tiles six"');
    for (const tid of [
      "cx-synthese",
      "cx-chart-synthese-mensuel",
      "cx-table-synthese-mensuel",
      "cx-alerts",
      "cx-alert-budget-depasse",
      "cx-mention-seuils-effectif",
      "cx-prevu-synthese-commentaire",
      "cx-chart-synthese-composition",
      "cx-table-synthese-composition",
      "cx-synthese-cascade",
      "cx-chart-synthese-cascade",
      "cx-table-synthese-cascade",
      "cx-synthese-services",
      "cx-table-synthese-services",
      "cx-synthese-chiffres",
      "cx-table-synthese-series",
      "cx-synthese-liens",
      "cx-synthese-limites",
      "cx-synthese-cartes-nd",
      "ms-trend-legend",
    ]) {
      expect(out, tid).toContain(`data-testid="${tid}"`);
    }
    for (const anchor of ["cx-synthese-cartes", "cx-synthese-graphique", "cx-synthese-alertes", "cx-synthese-composition", "cx-synthese-cascade", "cx-synthese-services", "cx-synthese-chiffres"]) expect(out, anchor).toContain(`id="${anchor}"`);
    expect(out).toContain('class="cx-syn"');
    expect(out).toContain('class="panel cx-syn-chart with-graph"');
    expect(out).toContain('href="/x?de=01&amp;a=01"');
    expect(out).toContain('href="/x?service=A"');
    expect(out).toContain('href="/e/demo/parametres#croisee"');
    expect(out).toContain("ETP payé non calculé : aucune règle de conversion paramétrée.");
    expect(out).not.toContain('data-testid="cx-synthese-print-more"');
    expect(out).not.toMatch(/<details class="cx-fold" id="cx-synthese-chiffres"[^>]* open/);
  });
  it("graphiques seuls : pas de tableau, liens vers les tableaux exacts ; tableaux seuls : pas de graphique, blocs ouverts, tableau imprimable", () => {
    const g = renderToStaticMarkup(h(SyntheseView, { model: m, slug: "demo", affichage: "graphique" }));
    expect(g).toContain('data-testid="cx-chart-synthese-mensuel"');
    expect(g).toContain('data-testid="cx-chart-synthese-cascade"');
    expect(g).not.toContain('data-testid="cx-table-synthese-mensuel"');
    expect(g).not.toContain('data-testid="cx-synthese-chiffres"');
    expect(g).not.toContain('data-testid="cx-synthese-services"');
    expect(g).toContain('href="/x?affichage=tableau#cx-synthese-graphique"');
    expect(g).toContain('href="/x?affichage=tableau#cx-synthese-composition"');
    expect(g).toContain('href="/x?affichage=tableau#cx-synthese-cascade"');
    const t = renderToStaticMarkup(h(SyntheseView, { model: m, slug: "demo", affichage: "tableau" }));
    expect(t).not.toContain('data-testid="cx-chart-synthese-mensuel"');
    expect(t).not.toContain('data-testid="cx-chart-synthese-composition"');
    expect(t).not.toContain('data-testid="cx-chart-synthese-cascade"');
    expect(t).toContain('class="panel cx-syn-chart"');
    expect(t).toContain('data-testid="cx-table-synthese-mensuel"');
    expect(t).toMatch(/<details class="cx-fold" id="cx-synthese-chiffres" data-testid="cx-synthese-chiffres" open=""/);
    expect(t).toContain('data-testid="cx-table-synthese-montants"');
    expect(t).toContain('data-testid="cx-table-synthese-rh"');
  });
  it("impression d'une page : « + 2 autres repères » quand des repères sont regroupés ; la feuille masque le repère suivant le plafond", () => {
    const out = sp(renderToStaticMarkup(h(SyntheseView, { model: { ...m, print: { max: PRINT_REPERES_MAX, folded: 2 } }, slug: "demo", affichage: "tout" })));
    expect(out).toContain('data-testid="cx-synthese-print-more"');
    expect(out).toContain("+ 2 autres repères (liste complète à l&#x27;écran)");
    const css = readFileSync("src/styles/croisee-synthese.css", "utf8");
    const rule = /body\[data-print="synthese"\] \.cx-syn ((?:\.cx-alert-repere ~ )+\.cx-alert-repere) \{ display: none !important; \}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1].split("~").length - 1).toBe(PRINT_REPERES_MAX);
    expect(css).toMatch(/body\[data-print="synthese"\] \.cx-syn-chart\.with-graph \.cx-syn-table \{ display: none !important; \}/);
  });
  it("aucun zéro à la place d'un n.d. dans le rendu d'un journal non lu", () => {
    const why = "journal de paie indisponible";
    const nd = buildSynthese(input({ pay: { kind: "nd", reason: why, action: { href: "/e/demo/donnees", label: "Données" } }, live: { kind: "nd", reason: why } }));
    const out = sp(renderToStaticMarkup(h(SyntheseView, { model: nd, slug: "demo", affichage: "tableau" })));
    expect(out).not.toContain('data-money-cents="0"');
    expect(out).toContain('data-testid="cx-tile-synthese-masse-nd"');
    expect(out).toContain('data-testid="cx-synthese-cascade-nd"');
  });
});

// --- Lecture : branchement sur les lecteurs du contexte (sources simulées, sans base) --------------------------------------------
// Journal fictif, axe « Service » : janvier 2026 et janvier 2025.
// 2026-01 : A salaires 1 000 € (c1) + cotisations 400 € ; B salaires 500 € (c2) + cotisations 200 € ; sans code : prime 100 € (c3) ;
//           une contrepartie (compte 421) ignorée. 2025-01 : A salaires 900 € (c1) + cotisations 360 €.
const an = (code: string) => [{ type: "Service", code, value: code }];
const ln = (key: string, month: string, accountId: string, debit: number | null, contractId: string | null, svc?: string, credit: number | null = null): LedgerLine => ({ key, month, accountId, accountName: null, debitCents: debit, creditCents: credit, contractId, analytic: svc ? an(svc) : [] });
const JOURNAL: JournalInput = {
  lines: [
    ln("l1", "2026-01", "641100", 100000, "c1", "A"),
    ln("l2", "2026-01", "645000", 40000, null, "A"),
    ln("l3", "2026-01", "641100", 50000, "c2", "B"),
    ln("l4", "2026-01", "645000", 20000, null, "B"),
    ln("l5", "2026-01", "641300", 10000, "c3"),
    ln("l6", "2026-01", "421000", null, null, undefined, 220000),
    ln("l7", "2025-01", "641100", 90000, "c1", "A"),
    ln("l8", "2025-01", "645000", 36000, null, "A"),
  ],
  months: ["2025-01", "2026-01"],
  openMonths: [],
  grid: DEFAULT_PREFIXES,
  serviceAxis: "Service",
};

describe("loadSyntheseInput : lecteurs du contexte, filtre de service, sources absentes", () => {
  const calls = { scenario: 0, compta: 0 };
  const fakeCtx = (over: Record<string, unknown> = {}, journal: JournalInput | null = null) => {
    calls.scenario = 0;
    calls.compta = 0;
    const jan = journal !== null;
    const state = { chapitre: "synthese", annee: "2026", de: "01", a: jan ? "01" : "03" };
    const pay = {
      kpi: { collab: { source: { chosen: jan ? "payfit" : "dsn", reason: "Source appliquée." }, state: { kind: "ready" } }, settings: { invalid: [] }, input: null },
      source: jan ? "payfit" : "dsn",
      unavailable: null,
      input: journal,
      etp: () => [],
      dsn: new Map(),
      service: { axis: jan ? "Service" : null },
      axisMissing: false,
    };
    return {
      slug: "demo",
      canEdit: false,
      period: jan
        ? { year: 2026, from: "01", to: "01", years: [2025, 2026], last: "01", months: ["2026-01"], notices: [] }
        : { year: 2026, from: "01", to: "03", years: [2026], last: "03", months: ["2026-01", "2026-02", "2026-03"], notices: [] },
      periodNd: null,
      prevMonths: jan ? ["2025-01"] : ["2025-01", "2025-02", "2025-03"],
      labels: jan ? { period: "janvier 2026", prev: "janvier 2025" } : { period: "janvier → mars 2026", prev: "janvier → mars 2025" },
      openMonths: [],
      service: { axis: jan ? "Service" : null, value: undefined, label: "Tous les services", options: [], reason: jan ? null : "journal de paie indisponible" },
      budget: jan ? { selected: null, explicit: false, options: [], reason: "aucun budget saisi pour 2026" } : { selected: { id: "b-0123456789", name: "Budget test", year: "2026", amounts: { "2026-01": 100_000, "2026-02": null } }, explicit: false, options: [], reason: null },
      settings: { seuilsEffectif: { kind: "absent" }, margeAlerte: { kind: "absent" }, confidentialite: { kind: "absent" }, horizonEcheances: { kind: "absent" } },
      affichage: "tout",
      href: (patch: Record<string, string | null> = {}, hash?: string) => croiseeHref(BASE, { ...state, ...patch }, hash),
      load: {
        payroll: async () => pay,
        compta: async () => (calls.compta++, { source: null, reason: "aucune source comptable retenue", lines: [], months: [], nd: {}, error: false }),
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
    expect(r.services.nd?.reason).toBe("source RH retenue : DSN — journal de paie PayFit non lu");
    expect(r.budget.kind).toBe("value");
    if (r.budget.kind === "value") {
      expect(r.budget.series.points.get("2026-01")).toMatchObject({ kind: "value", cost: 100_000 });
      expect(r.budget.series.points.get("2026-02")).toEqual({ month: "2026-02", kind: "nd", reason: "montant du budget non saisi" });
    }
    expect(r.landing).toEqual({ kind: "nd", reason: "aucun scénario ne couvre 2026" });
    expect(r.hrefs.tableau).toBe(`${BASE}?chapitre=synthese&annee=2026&de=01&a=03&affichage=tableau#cx-synthese-graphique`);
    expect(r.hrefs.services).toBe(`${BASE}?chapitre=services&annee=2026&de=01&a=03`);
    expect(r.hrefs.effectifs).toBe(`${BASE}?chapitre=effectifs&annee=2026&de=01&a=03#cx-effectifs-seuils`);
    expect(r.hrefs.months[1]).toBe(`${BASE}?chapitre=synthese&annee=2026&de=02&a=02`);
    expect(calls.scenario).toBe(1);
    expect(calls.compta).toBe(0); // journal non lu : aucun contrôle, la comptabilité n'est pas lue
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
    expect(r.filtered).toBe(true);
    expect(calls.scenario).toBe(0);
    expect(calls.compta).toBe(0);
  });

  it("journal fictif (janvier 2026 face à janvier 2025) : composition, cascade par rubrique, écart du mois, services et contrôles calculés à la main", async () => {
    const ctx = fakeCtx({}, JOURNAL);
    const r = await loadSyntheseInput(ctx);
    if (r.kind !== "value" || r.pay.kind !== "value") throw new Error("entrée attendue");
    // Masse : 2026-01 = 1 000 + 400 + 500 + 200 + 100 = 2 200 € ; 2025-01 = 900 + 360 = 1 260 € ; +940 € ; 940 ÷ 1 260.
    expect(r.pay.evolution).toEqual({ kind: "value", deltaCents: 94_000, ratio: { num: 94_000, den: 126_000 } });
    expect(r.pay.yearEvo[0]).toEqual(r.pay.evolution);
    expect(r.pay.yearEvo[1].kind).toBe("nd");
    // Fixe 1 500 € face à 900 € ; variable (prime) 100 € face à 0 € (% non défini) ; cotisations 600 € face à 360 €.
    expect(r.pay.composition.fixe).toEqual({ kind: "value", deltaCents: 60_000, ratio: { num: 60_000, den: 90_000 } });
    expect(r.pay.composition.variable).toEqual({ kind: "value", deltaCents: 10_000, ratio: null });
    expect(r.pay.composition.cotisations).toEqual({ kind: "value", deltaCents: 24_000, ratio: { num: 24_000, den: 36_000 } });
    // Cascade : rémunération de base +600 €, primes +100 €, indemnités 0 €, charges +240 € ; somme +940 € ; enveloppes et coûts non
    // ventilés (sans objet pour un réel) retirés.
    expect(r.pay.cascade).toEqual({
      kind: "value",
      start: 126_000,
      end: 220_000,
      steps: [
        { key: "remun", label: "Rémunération de base", delta: 60_000, reason: null },
        { key: "primes", label: "Primes et éléments variables", delta: 10_000, reason: null },
        { key: "indemnites", label: "Indemnités et avantages", delta: 0, reason: null },
        { key: "charges", label: "Charges patronales", delta: 24_000, reason: null },
      ],
      residual: 0,
    });
    // Contrôles : comptabilité non retenue, aucune DSN déposée.
    expect(r.pay.checks.compta).toEqual({ kind: "absent", reason: "aucune source comptable retenue" });
    expect(r.pay.checks.dsn).toMatchObject({ kind: "nd", months: ["2026-01"], none: true });
    expect(calls.compta).toBe(1);
    // Services : A 1 400 €, B 700 €, non ventilé 100 € ; lien de filtre sur ce chapitre.
    expect(r.services.data?.rows.map((x) => [x.value, x.href])).toEqual([
      ["A", `${BASE}?chapitre=synthese&annee=2026&de=01&a=01&service=A`],
      ["B", `${BASE}?chapitre=synthese&annee=2026&de=01&a=01&service=B`],
      [null, `${BASE}?chapitre=synthese&annee=2026&de=01&a=01&service=__nv__`],
    ]);
    const m = buildSynthese(r);
    expect(texts(tableOf(m, ID.services)).map((x) => x.slice(0, 3))).toEqual([
      ["A", "1 400,00 €", "63,64 %"],
      ["B", "700,00 €", "31,82 %"],
      ["Non ventilé", "100,00 €", "4,55 %"],
    ]);
    expect(texts(tableOf(m, ID.mensuel))[0]).toEqual(["Janvier 2026", "Oui", "Réel", "2 200,00 €", "—", "n.d.", "1 260,00 €", "+940,00 €", "+74,60 %"]);
    expect(m.alerts.map((a) => a.id)).toEqual(["budget-absent", "atterrissage-nd", "source-rh", "source-compta", "source-dsn"]);
    // Un seul calcul par contexte : syntheseModel renvoie la même promesse au second appel.
    const p1 = syntheseModel(ctx);
    expect(syntheseModel(ctx)).toBe(p1);
    expect((await p1).tables.map((t) => t.id)).toEqual(m.tables.map((t) => t.id));
  });
});
