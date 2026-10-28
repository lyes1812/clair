import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AbsencesView } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChAbsences";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { Affichage } from "@/app/e/[slug]/studio-rh/masse-salariale/components";
import { monthRange } from "@/lib/connectors/months";
import type { CongeCell, CongesPris } from "@/lib/croisee/conges";
import { readCroiseeSettings, type CroiseeSettings } from "@/lib/croisee-settings";
import { glossaryEntry, glossaryHref } from "@/lib/glossary";
import { ABSENCE_ALL_MOTIFS_LABEL } from "@/lib/rh/kpi/absence-motifs";
import { kpiNd, type Window } from "@/lib/rh/kpi/types";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { cellView, tableNdReasons, type CroiseeTable } from "@/lib/viz/croisee";
import {
  ABSENCES_TERMS,
  aVenirMask,
  buildAbsences,
  congesMask,
  dayGapCell,
  ECART_ND,
  loadAbsencesInput,
  maskCells,
  masked,
  NON_FILTRABLE,
  PREVU_ARRETS,
  PREVU_SOLDES,
  publicText,
  rateGap,
  SEUIL_NON_VERIFIABLE,
  SOUS_SEUIL,
  TABLE_IDS,
  type AbsencesData,
  type AbsencesInput,
  type AbsencesModel,
  type AbsRow,
  type MotifLineK,
  type RateK,
} from "@/lib/viz/croisee-absences";
import { absenceTypeText } from "@/lib/viz/kpi";
import { periodLabel } from "@/lib/viz/synthese";
import { absence, DSN_ABSENCES, kpiInput, readAbsences } from "./helpers/kpi";
import { dsnFixtureBuild, payfitEdgeBuild } from "./helpers/rh";

// Chapitre 03 · Absences & congés : buildAbsences avec des entrées fictives écrites à la main (aucune donnée réelle), puis rendu du
// modèle et lecture des sources sur un référentiel fictif. Période juillet → septembre 2026, N-1 juillet → septembre 2025.

const MONTHS = ["2026-07", "2026-08", "2026-09"];
const PREV = ["2025-07", "2025-08", "2025-09"];
const LABEL = periodLabel(MONTHS); // « juillet → septembre 2026 » (libellé du contexte, ctx.labels.period)
const PREV_LABEL = periodLabel(PREV);
const LINKS: AbsencesInput["links"] = {
  parametres: "/e/demo/parametres#croisee",
  parametresKpi: "/e/demo/parametres#kpi",
  donnees: "/e/demo/donnees",
  tableau: "/e/demo/studio-rh/masse-salariale/croisee?chapitre=absences&affichage=tableau",
  paieCompta: "/e/demo/studio-rh/masse-salariale/croisee?chapitre=paie-compta",
};
const settingsOf = (v?: unknown): CroiseeSettings => readCroiseeSettings(new Map(v === undefined ? [] : [["rh.croisee.confidentialite", { value: v }]]));
const SEUIL_3 = settingsOf(3);
const CONF = "non affiché (seuil de confidentialité : 3 personnes)";

const ex = (num: number, den: number): RateK => ({ kind: "exact", ratio: { num, den } });
const lo = (num: number, den: number): RateK => ({ kind: "lower_bound", ratio: { num, den } });
const ndr = (reason: string): RateK => ({ kind: "nd", nd: kpiNd("month-nd", reason) });
const unused = { kind: "nd" as const, nd: { reason: "non utilisé" } };
const row = (month: string, prevMonth: string, cur: RateK, prev: RateK, half: number): AbsRow => ({
  month,
  headcount: unused,
  etp: unused,
  movements: { entries: unused, exits: unused },
  absenteeism: cur,
  previous: { month: prevMonth, etp: unused, absenteeism: prev },
  theoretical: { kind: "exact", half },
});
// Juillet : 6 / 600 demi-journées (1,00 %) face à 3 / 600 (0,50 %) ; août : 0 / 620 face à 4 / 620 (0,65 %) ; septembre : 9 / 600
// (1,50 %) face à 12 / 600 (2,00 %). Période : 15 / 1 820 (0,82 %) face à 19 / 1 820 (1,04 %), écart −0,22 point.
const ROWS: AbsRow[] = [row("2026-07", "2025-07", ex(6, 600), ex(3, 600), 600), row("2026-08", "2025-08", ex(0, 620), ex(4, 620), 620), row("2026-09", "2025-09", ex(9, 600), ex(12, 600), 600)];

const line = (type: string, chosen: boolean, half: number | null, reason?: string): MotifLineK =>
  half === null ? { type, chosen, kind: "nd", half: null, ratio: null, nd: kpiNd("month-nd", reason ?? "n.d.") } : { type, chosen, kind: "exact", half, ratio: { num: half, den: 1820 } };
const UNREAD = "absences non lues pour 2026-08 (mois lus : 2024-10 → 2026-07)";
const W: Window = { mode: "civil", from: MONTHS[0], to: MONTHS[2], months: MONTHS, label: LABEL };
const PW: Window = { mode: "civil", from: PREV[0], to: PREV[2], months: PREV, label: PREV_LABEL };
// Cellules fictives : chaque cellule reçoit des jetons de personne qui lui sont propres (seq), pour que le masquage secondaire compte
// autant de personnes distinctes que de personnes de la cellule ; aucun contrat non relié sauf mention.
let seq = 1000;
const who = (persons: number): number[] => Array.from({ length: persons }, () => seq++);
const v = (half: number, persons: number): CongeCell => ({ kind: "exact", half, persons, unlinked: 0, who: who(persons) });
const lb = (half: number, persons: number): CongeCell => ({ kind: "lower_bound", half, persons, unlinked: 0, who: who(persons) });
const ndc = (reason: string): CongeCell => ({ kind: "nd", reason });
const zero3 = [v(0, 0), v(0, 0), v(0, 0)];
// Cas A : un seul motif retenu (test_sickness), exempté du seuil (sa ligne égale la tuile Absentéisme).
const CONGES: CongesPris = {
  window: W,
  emptyReason: null,
  lines: [
    { type: "test_paid_leave", chosen: false, months: [v(20, 3), v(30, 4), v(10, 1)], total: v(60, 5) },
    { type: "test_rare", chosen: false, months: [v(0, 0), v(4, 1), v(0, 0)], total: v(4, 1) },
    { type: "test_sickness", chosen: true, months: [v(6, 2), v(0, 0), v(9, 2)], total: v(15, 3) },
    { type: "test_unread", chosen: false, months: [v(0, 0), ndc(UNREAD), v(0, 0)], total: ndc(UNREAD) },
  ],
};
const CONGES_N1: CongesPris = {
  window: PW,
  emptyReason: null,
  lines: [
    { type: "test_paid_leave", chosen: false, months: [v(10, 2), v(30, 3), v(10, 1)], total: v(50, 4) },
    { type: "test_rare", chosen: false, months: zero3, total: v(0, 0) },
    { type: "test_sickness", chosen: true, months: [v(3, 1), v(4, 1), v(12, 2)], total: v(19, 2) },
    { type: "test_unread", chosen: false, months: zero3, total: v(0, 0) },
  ],
};

const PUBLISHED_3 = { months: [true, true, true], allMonths: [true, true, true], all: true };
const data = (over: Partial<AbsencesData> = {}): AbsencesData => ({
  source: "payfit",
  absenceTypes: ["test_sickness"],
  rows: ROWS,
  period: { current: ex(15, 1820), previous: ex(19, 1820) },
  theoretical: { current: { kind: "exact", half: 1820 }, previous: { kind: "exact", half: 1820 } },
  // Douze mois glissants : 40 / 7 300 (0,55 %) face à 30 / 7 300 (0,41 %), écart +0,14 point. Mini-courbe : neuf mois n.d., trois connus.
  rolling: {
    from: "2025-10",
    to: "2026-09",
    prevFrom: "2024-10",
    prevTo: "2025-09",
    current: ex(40, 7300),
    previous: ex(30, 7300),
    months: [...Array.from({ length: 9 }, () => ndr("mois en borne basse (PayFit)")), ex(6, 600), ex(0, 620), ex(9, 600)],
  },
  motifs: {
    current: { label: ABSENCE_ALL_MOTIFS_LABEL, lines: [line("test_paid_leave", false, 60), line("test_rare", false, 4), line("test_sickness", true, 15), line("test_unread", false, null, UNREAD)], all: ex(70, 1820), emptyReason: null },
    previous: { label: ABSENCE_ALL_MOTIFS_LABEL, lines: [line("test_paid_leave", false, 50), line("test_rare", false, 0), line("test_sickness", true, 19), line("test_unread", false, 0)], all: ex(62, 1820), emptyReason: null },
  },
  conges: { current: CONGES, previous: CONGES_N1 },
  // Absentéisme et taux tous motifs publiés pour chaque mois de la période et de N-1, et pour les deux fenêtres (motifPublished).
  published: { current: PUBLISHED_3, previous: PUBLISHED_3 },
  aVenir: {
    kind: "value",
    after: "2026-09",
    months: ["2026-10"],
    lines: [
      { type: "test_paid_leave", statut: "pose", months: [v(12, 3)], total: v(12, 3) },
      { type: "test_paid_leave", statut: "en-attente", months: [v(3, 1)], total: v(3, 1) },
    ],
    nonRattachees: 2,
  },
  ...over,
});
const input = (over: Partial<AbsencesInput> = {}, dataOver: Partial<AbsencesData> = {}): AbsencesInput => ({
  links: LINKS,
  period: { months: MONTHS, prevMonths: PREV, labels: { period: LABEL, prev: PREV_LABEL } },
  service: { value: undefined, label: "Tous les services" },
  settings: SEUIL_3,
  nd: null,
  data: data(dataOver),
  ...over,
});

// Cas B : deux motifs retenus (test_accident, test_sickness), tous deux soumis au seuil. Accident : une personne en août (4
// demi-journées). Tuile : 19 / 1 820 ; mois retenus : juillet 6, août 4, septembre 9 ; tous motifs : 85 / 1 820 (N), 69 / 1 820 (N-1).
const CONGES_B: CongesPris = {
  window: W,
  emptyReason: null,
  lines: [
    { type: "test_accident", chosen: true, months: [v(0, 0), v(4, 1), v(0, 0)], total: v(4, 1) },
    { type: "test_paid_leave", chosen: false, months: [v(20, 3), v(30, 4), v(16, 3)], total: v(66, 5) },
    { type: "test_sickness", chosen: true, months: [v(6, 3), v(0, 0), v(9, 3)], total: v(15, 4) },
  ],
};
const CONGES_B_N1: CongesPris = {
  window: PW,
  emptyReason: null,
  lines: [
    { type: "test_accident", chosen: true, months: zero3, total: v(0, 0) },
    { type: "test_paid_leave", chosen: false, months: [v(10, 3), v(30, 3), v(10, 3)], total: v(50, 4) },
    { type: "test_sickness", chosen: true, months: [v(3, 3), v(4, 3), v(12, 3)], total: v(19, 3) },
  ],
};
const dataB: Partial<AbsencesData> = {
  absenceTypes: ["test_accident", "test_sickness"],
  rows: [row("2026-07", "2025-07", ex(6, 600), ex(3, 600), 600), row("2026-08", "2025-08", ex(4, 620), ex(4, 620), 620), row("2026-09", "2025-09", ex(9, 600), ex(12, 600), 600)],
  period: { current: ex(19, 1820), previous: ex(19, 1820) },
  motifs: {
    current: { label: ABSENCE_ALL_MOTIFS_LABEL, lines: [line("test_accident", true, 4), line("test_paid_leave", false, 66), line("test_sickness", true, 15)], all: ex(85, 1820), emptyReason: null },
    previous: { label: ABSENCE_ALL_MOTIFS_LABEL, lines: [line("test_accident", true, 0), line("test_paid_leave", false, 50), line("test_sickness", true, 19)], all: ex(69, 1820), emptyReason: null },
  },
  conges: { current: CONGES_B, previous: CONGES_B_N1 },
};

const tableOf = (m: AbsencesModel, id: string): CroiseeTable => {
  const t = m.tables.find((x) => x.id === id);
  if (!t) throw new Error(`tableau ${id} absent`);
  return t;
};
// Espaces insécables des formats français (« 0,82 % », « 1 820 ») ramenées à des espaces simples pour les comparaisons.
const sp = <T,>(x: T): T => JSON.parse(JSON.stringify(x).replace(/[  ]/g, " "));
// Textes affichés d'un tableau, ligne par ligne (n.d. : « n.d. »), pied compris.
const texts = (t: CroiseeTable) => sp([...t.rows, ...(t.foot ? [t.foot] : [])].map((r) => t.columns.map((c, i) => cellView(r.cells[i], c, r).text)));
const tile = (m: AbsencesModel, id: string) => sp(m.tiles.find((t) => t.id === id)!);
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const render = (m: AbsencesModel, affichage: Affichage = "tout") => unescape(renderToStaticMarkup(h(AbsencesView, { model: m, slug: "demo", affichage, tableauHref: LINKS.tableau })));
const isNd = (c: unknown) => typeof c === "object" && c !== null && "nd" in c;

describe("buildAbsences : cartes", () => {
  const m = buildAbsences(input());
  it("quatre cartes : absentéisme (tuile principale du moteur, motifs retenus en une ligne), N-1, douze mois glissants, jours théoriques", () => {
    expect(m.nd).toBeNull();
    expect(m.tiles.map((t) => t.id)).toEqual(["absenteisme", "absenteisme-n1", "douze-mois", "jours-theoriques"]);
    const a = tile(m, "absenteisme");
    // 15 / 1 820 = 0,824… % → « 0,82 % » ; écart (15 − 19) / 1 820 × 100 = −0,219… point → « −0,22 pts ».
    expect(a).toMatchObject({ label: "Absentéisme", term: "absenteeism", sub: LABEL, value: { text: "0,82 %", kind: "value" }, note: "Motifs retenus : test_sickness" });
    expect(a.variations).toEqual([{ label: "Écart", text: "−0,22 pts", reason: null, tone: "flat" }]);
    // Aucun ton de coût, et la valeur n'est pas mise en bleu (réservé à la carte de masse).
    expect(a.cost).toBeUndefined();
    expect(a.main).toBeUndefined();
    // Mini-courbe : points de base des mois exacts, null pour un mois n.d. (jamais 0).
    expect(a.spark!.values).toEqual([...Array(9).fill(null), 100, 0, 150]);
    expect(tile(m, "absenteisme-n1")).toMatchObject({ sub: PREV_LABEL, value: { text: "1,04 %", kind: "value" } });
    // 40 / 7 300 = 0,547… % ; 30 / 7 300 = 0,410… % ; écart 10 / 7 300 × 100 = 0,136… point.
    const r = tile(m, "douze-mois");
    expect(r).toMatchObject({ sub: "octobre 2025 → septembre 2026", value: { text: "0,55 %" } });
    expect(r.variations!.map((x) => x.text)).toEqual(["0,41 %", "+0,14 pts"]);
    // 1 820 demi-journées = 910 j ; 15 demi-journées d'absence = 7,5 j.
    const j = tile(m, "jours-theoriques");
    expect(j.value).toEqual({ text: "910 j", kind: "value", reason: null });
    expect(j.variations!.map((x) => [x.label, x.text])).toEqual([
      ["Jours d'absence (motifs retenus)", "7,5 j"],
      ["N-1", "910 j"],
    ]);
  });

  it("libellés de période : ceux du contexte, tels quels (cartes, en-têtes de colonnes)", () => {
    const n = buildAbsences(input({ period: { months: MONTHS, prevMonths: PREV, labels: { period: "LIBELLÉ-N", prev: "LIBELLÉ-N1" } } }));
    expect(tile(n, "absenteisme").sub).toBe("LIBELLÉ-N");
    expect(tile(n, "absenteisme-n1").sub).toBe("LIBELLÉ-N1");
    expect(tableOf(n, TABLE_IDS.motifs).columns.map((c) => c.header)).toContain("Demi-journées LIBELLÉ-N1");
    expect(tableOf(n, TABLE_IDS.conges).columns.map((c) => c.header)).toEqual(["Motif", "Juil. 2026", "Août 2026", "Sept. 2026", "Demi-journées LIBELLÉ-N", "Demi-journées LIBELLÉ-N1", "Écart (demi-journées)"]);
    expect(tableOf(n, TABLE_IDS.mensuel).foot!.cells[0]).toBe("Période (LIBELLÉ-N)");
  });

  it("valeurs n.d. ou en borne basse : la carte garde la raison, jamais un zéro ; l'écart n'est pas calculé", () => {
    const n = buildAbsences(input({}, { period: { current: lo(15, 1820), previous: ndr("2025-08 : absences non lues pour 2025-08") }, theoretical: { current: { kind: "exact", half: 1820 }, previous: { kind: "nd", nd: kpiNd("month-nd", "mois non couvert") } } }));
    const a = tile(n, "absenteisme");
    expect(a.value).toEqual({ text: "≥ 0,82 %", kind: "lower", reason: null });
    expect(a.variations![0]).toMatchObject({ text: null, reason: "valeur en borne basse : écart non calculable" });
    expect(tile(n, "absenteisme-n1").value).toEqual({ text: "n.d.", kind: "nd", reason: "2025-08 : absences non lues pour 2025-08" });
    expect(tile(n, "jours-theoriques").variations!.map((x) => x.text)).toEqual(["≥ 7,5 j", null]);
  });

  it("aucun motif retenu : la tuile reste celle du moteur (n.d. avec sa raison) et le bloc renvoie aux Définitions des KPI", () => {
    const n = buildAbsences(input({}, { absenceTypes: [], period: { current: ndr("motifs d'absence non choisis (Paramètres › Définitions des KPI)"), previous: ndr("motifs d'absence non choisis (Paramètres › Définitions des KPI)") } }));
    expect(tile(n, "absenteisme").note).toBe("Motifs retenus : aucun");
    expect(n.blocks.find((b) => b.id === "cartes")!.nd).toEqual([{ label: "Absentéisme", reason: "motifs d'absence non choisis (Paramètres › Définitions des KPI)", action: { href: LINKS.parametresKpi, label: "Paramètres" } }]);
  });
});

describe("buildAbsences : absentéisme par mois (graphique et tableau exact)", () => {
  it("barres groupées N et N-1 en points de base, même valeurs que le tableau exact, pied « Période » égal à la carte", () => {
    const m = buildAbsences(input());
    const c = m.charts.find((x) => x.id === TABLE_IDS.mensuel)!;
    expect(c).toMatchObject({ kind: "barres", unit: "bps", mode: "grouped", tableId: TABLE_IDS.mensuel, categories: ["juil.", "août", "sept."] });
    // 6/600 = 1,00 % = 100 pb ; 4/620 = 0,645… % → 65 pb ; 12/600 = 2,00 % = 200 pb.
    expect(c.series.map((s) => [s.key, s.values, s.color])).toEqual([
      ["absenteisme", [100, 0, 150], "var(--chart-1)"],
      ["absenteisme-n1", [50, 65, 200], "var(--chart-7)"],
    ]);
    const t = tableOf(m, TABLE_IDS.mensuel);
    expect(t.columns.map((x) => x.header)).toEqual(["Mois", "Absentéisme", "Demi-journées d'absence", "Demi-journées théoriques", "Absentéisme N-1", "Écart (points)"]);
    expect(texts(t)).toEqual([
      ["Juillet 2026", "1,00 %", "6", "600", "0,50 %", "+0,50 pts"],
      ["Août 2026", "0,00 %", "0", "620", "0,65 %", "−0,65 pts"],
      ["Septembre 2026", "1,50 %", "9", "600", "2,00 %", "−0,50 pts"],
      [`Période (${LABEL})`, "0,82 %", "15", "1 820", "1,04 %", "−0,22 pts"],
    ]);
    expect(m.blocks.find((b) => b.id === "mensuel")).toMatchObject({ graph: true, charts: [TABLE_IDS.mensuel] });
  });

  it("un mois n.d. reste n.d. jusqu'au graphique (null + raison) et au tableau ; une borne basse n'est jamais tracée comme exacte", () => {
    const rows = [row("2026-07", "2025-07", ex(6, 600), ex(3, 600), 600), row("2026-08", "2025-08", ndr(UNREAD), ex(4, 620), 620), row("2026-09", "2025-09", lo(9, 600), ex(12, 600), 600)];
    const m = buildAbsences(input({}, { rows }));
    const s = m.charts.find((x) => x.id === TABLE_IDS.mensuel)!.series[0];
    expect(s.values).toEqual([100, null, null]);
    expect(s.reasons![1]).toBe(UNREAD);
    expect(sp(s.reasons![2])).toContain("borne basse (≥ 1,50 %)");
    const t = tableOf(m, TABLE_IDS.mensuel);
    expect(texts(t)[1]).toEqual(["Août 2026", "n.d.", "n.d.", "620", "0,65 %", "n.d."]);
    expect(texts(t)[2]).toEqual(["Septembre 2026", "≥ 1,50 %", "≥ 9", "600", "2,00 %", "n.d."]);
    expect(t.rows[1].cells[1]).toEqual({ nd: UNREAD });
    expect(t.rows[1].cells[5]).toEqual({ nd: ECART_ND.valeur });
    expect(t.rows[2].cells[5]).toEqual({ nd: ECART_ND.borne });
    // Raisons listées sous le tableau : une fois chacune, celle du moteur pour le mois n.d., une ligne courte pour l'écart.
    expect(tableNdReasons(t)).toEqual([UNREAD, ECART_ND.valeur, ECART_ND.borne]);
  });
});

// Cas A sous la règle canonique (lot 12, troisième relecture) : le statut d'un mois se calcule sur la seule colonne de son mois ; une
// période, N-1 et le taux tous motifs se déduisent de leurs mois (n.d. dès qu'un mois est masqué). Colonnes, seuil 3, test_sickness
// exempt (seul motif retenu) ; autres motifs → taux tous motifs du mois − absentéisme du mois (tous deux publiés chaque mois) :
//   juillet 2026 : test_paid_leave 20 (3 personnes), test_rare 0, test_unread 0 → rien à masquer ;
//   août 2026 : test_rare 4 (1 personne) masqué, test_unread n.d. (n'apporte personne) → 1 < 3 : test_paid_leave 30 (4 personnes)
//     masqué en second (1 + 4 ≥ 3) ;
//   septembre 2026 : test_paid_leave 10 (1 personne) masqué ; test_rare et test_unread à 0 ne protègent personne : impossible, le taux
//     tous motifs de septembre est masqué ;
//   juillet 2025 : test_paid_leave 10 (2 personnes) masqué, seul autre motif non vide : taux tous motifs de juillet 2025 masqué ;
//   août 2025 : test_paid_leave 30 (3 personnes) affiché ; septembre 2025 : 10 (1 personne) masqué, taux tous motifs masqué.
// Périodes : test_paid_leave n.d. en N et en N-1 (un mois masqué chacune) ; test_rare n.d. en N (août), 0 en N-1 ; tous motifs n.d. en
// N (septembre) et en N-1 (juillet, septembre).
describe("buildAbsences : motifs, tous motifs, demi-journées prises (cas A : un seul motif retenu ; seuil 3)", () => {
  const m = buildAbsences(input());

  it("tableau par motif : tous les motifs de la lecture ; le seul motif retenu n'est pas masqué (il égale la tuile), les autres sous le seuil sont n.d.", () => {
    const t = tableOf(m, TABLE_IDS.motifs);
    expect(t.columns.map((c) => c.header)).toEqual(["Motif", "Retenu dans l'absentéisme", `Demi-journées ${LABEL}`, `Taux ${LABEL}`, `Demi-journées ${PREV_LABEL}`, `Taux ${PREV_LABEL}`, "Écart (points)"]);
    expect(texts(t)).toEqual([
      // Période : août (masqué en second) et septembre (1 personne) masqués ⇒ n.d. N-1 : juillet 2025 (2 personnes) et septembre 2025
      // (1 personne) masqués ⇒ n.d. Avant : N-1 affiché (50/1 820), ses deux mois masqués se protégeant dans la relation de la ligne,
      // propre à la fenêtre ; un total qui contient un mois masqué est désormais n.d. pour toute fenêtre. Écart n.d.
      ["test_paid_leave", "non", "n.d.", "n.d.", "n.d.", "n.d.", "n.d."],
      // 1 personne en N : n.d. ; aucune personne en N-1 (rien à protéger) : 0 affiché ; écart n.d.
      ["test_rare", "non", "n.d.", "n.d.", "0", "0,00 %", "n.d."],
      // Seul motif retenu : 15 et 19 demi-journées (2 personnes en N-1) affichées, comme la tuile (0,82 % et 1,04 %).
      ["test_sickness", "oui", "15", "0,82 %", "19", "1,04 %", "−0,22 pts"],
      // Motif n.d. dans le moteur : sa raison.
      ["test_unread", "non", "n.d.", "n.d.", "0", "0,00 %", "n.d."],
    ]);
    expect(t.rows[1].cells[2]).toEqual({ nd: CONF });
    expect(t.rows[1].cells[6]).toEqual({ nd: ECART_ND.valeur });
    expect(t.rows[3].cells[2]).toEqual({ nd: UNREAD });
    // Le motif retenu seul et la tuile disent la même chose.
    expect(texts(t)[2][3]).toBe(tile(m, "absenteisme").value.text);
    expect(texts(t)[2][5]).toBe(tile(m, "absenteisme-n1").value.text);
  });

  it("« Taux d'absence, tous motifs » : tableau à part, jamais l'absentéisme ; n.d. quand un de ses mois donnerait un motif masqué", () => {
    const t = tableOf(m, TABLE_IDS.tousMotifs);
    expect(t.title).toBe("Taux d'absence, tous motifs");
    // Avant : 70 (3,85 %) et 62 (3,41 %) affichés. Septembre 2026 (et juillet, septembre 2025) : le seul autre motif non vide est
    // masqué ; le taux tous motifs de ce mois, publié par une période d'un mois, le redonnerait (tous motifs − absentéisme − 0) : il est
    // masqué, et avec lui la période et N-1 qui le contiennent (sinon il se lirait par différence entre deux périodes).
    expect(texts(t)).toEqual([["Taux d'absence, tous motifs", "n.d.", "n.d.", "n.d.", "n.d.", "n.d."]]);
    expect(t.rows[0].cells.slice(1, 5)).toEqual([{ nd: CONF }, { nd: CONF }, { nd: CONF }, { nd: CONF }]);
    expect(m.blocks.find((b) => b.id === "tous-motifs")!.tables).toEqual([TABLE_IDS.tousMotifs]);
    expect(t.title.toLowerCase()).not.toContain("absentéisme");
  });

  it("demi-journées prises par motif et par mois : nombres entiers, masquage principal et secondaire dans la ligne, écart signé", () => {
    const t = tableOf(m, TABLE_IDS.conges);
    expect(t.title).toBe("Demi-journées prises par motif et par mois");
    expect(t.columns.map((c) => c.header)).toEqual(["Motif", "Juil. 2026", "Août 2026", "Sept. 2026", `Demi-journées ${LABEL}`, `Demi-journées ${PREV_LABEL}`, "Écart (demi-journées)"]);
    expect(texts(t)).toEqual([
      // Août : masqué en second dans sa colonne (protège test_rare) ; septembre : 1 personne ⇒ masqué ; juillet (3 personnes) affiché.
      // Avant : juillet masqué et août affiché (relation de la ligne, propre à la période) ; la ligne n'est plus une relation : la
      // période et N-1, qui contiennent un mois masqué, sont n.d. ; écart n.d.
      ["test_paid_leave", "20", "n.d.", "n.d.", "n.d.", "n.d.", "n.d."],
      // Août et la période : 1 personne ⇒ masqués (deux cellules masquées dans la ligne : rien de plus).
      ["test_rare", "0", "n.d.", "0", "n.d.", "0", "n.d."],
      // Seul motif retenu : rien n'est masqué (juillet 6 et septembre 9 = tableau mensuel). Écart 15 − 19 = −4.
      ["test_sickness", "6", "0", "9", "15", "19", "−4"],
      ["test_unread", "0", "n.d.", "0", "n.d.", "0", "n.d."],
    ]);
    // Cellules numériques (exportées comme nombres), jamais du texte « 3,5 j ».
    expect(t.rows[0].cells.slice(2)).toEqual([{ nd: CONF }, { nd: CONF }, { nd: CONF }, { nd: CONF }, { nd: ECART_ND.valeur }]);
    expect(t.rows[2].cells.slice(1)).toEqual([6, 0, 9, 15, 19, -4]);
    expect(t.rows[0].cells[1]).toBe(20);
    expect(t.rows[1].cells[6]).toEqual({ nd: ECART_ND.valeur });
    expect(t.rows[3].cells[2]).toEqual({ nd: UNREAD });
    // Aucun classement « congé payé / RTT / repos » : les motifs de la source, tels quels.
    expect(JSON.stringify(t)).not.toMatch(/RTT|congés payés|Repos/);
    // La même valeur, période et N-1, que le tableau par motif.
    expect(texts(t).map((r) => [r[4], r[5]])).toEqual(texts(tableOf(m, TABLE_IDS.motifs)).map((r) => [r[2], r[4]]));
  });

  it("graphique empilé des demi-journées prises : une série par motif (var(--chart-N)), mêmes valeurs que le tableau, n.d. non tracé avec sa raison", () => {
    const c = m.charts.find((x) => x.id === TABLE_IDS.conges)!;
    expect(c).toMatchObject({ kind: "barres", unit: "nombre", mode: "stacked", tableId: TABLE_IDS.conges, categories: ["juil.", "août", "sept."], title: "Demi-journées prises par motif et par mois" });
    expect(c.series.map((s) => [s.key, s.name, s.values, s.color])).toEqual([
      ["motif-1", "test_paid_leave", [20, null, null], "var(--chart-1)"],
      ["motif-2", "test_rare", [0, null, 0], "var(--chart-2)"],
      ["motif-3", "test_sickness", [6, 0, 9], "var(--chart-3)"],
      ["motif-4", "test_unread", [0, null, 0], "var(--chart-4)"],
    ]);
    expect(c.series[0].reasons).toEqual([null, CONF, CONF]);
    expect(c.series[3].reasons).toEqual([null, UNREAD, null]);
    // Le graphique est suivi de son tableau exact, dans le même bloc.
    expect(m.blocks.find((b) => b.id === "conges")).toMatchObject({ graph: true, charts: [TABLE_IDS.conges], tables: [] });
  });

  it("borne basse d'un motif : « ≥ x » dans le tableau, non tracée dans le graphique", () => {
    const cc: CongesPris = { ...CONGES, lines: CONGES.lines.map((l) => (l.type === "test_sickness" ? { ...l, months: [v(6, 2), v(0, 0), lb(9, 2)], total: lb(15, 3) } : l)) };
    const n = buildAbsences(input({}, { conges: { current: cc, previous: CONGES_N1 } }));
    expect(texts(tableOf(n, TABLE_IDS.conges))[2]).toEqual(["test_sickness", "6", "0", "≥ 9", "≥ 15", "19", "n.d."]);
    const s = n.charts.find((x) => x.id === TABLE_IDS.conges)!.series[2];
    expect(s.values).toEqual([6, 0, null]);
    expect(s.reasons![2]).toContain("borne basse (≥ 9 demi-journées)");
  });

  it("absences posées et demandes en attente : demi-journées par mois lu, sans nom ; jours hors des mois lus en note du tableau", () => {
    const t = tableOf(m, TABLE_IDS.aVenir);
    expect(t.title).toBe("Absences posées et demandes en attente après septembre 2026 (demi-journées)");
    expect(texts(t)).toEqual([
      ["test_paid_leave", "Posée (statut retenu)", "12", "12"],
      ["test_paid_leave", "En attente d'approbation", "n.d.", "n.d."],
    ]);
    expect(t.rows[1].cells[2]).toEqual({ nd: CONF });
    expect(t.notes).toEqual(["2 absences posées ou en attente hors des mois lus (date absente, mois non lu ou contrat inconnu) : jours non comptés."]);
    expect(m.blocks.find((x) => x.id === "a-venir")!.prevu).toEqual([]);
  });

  it("à venir sans aucune absence : un tableau sans ligne et la phrase qui le dit (jamais un zéro inventé) ; à venir n.d. : la raison", () => {
    const empty = buildAbsences(input({}, { aVenir: { kind: "value", after: "2026-09", months: ["2026-10"], lines: [], nonRattachees: 0 } }));
    const t = tableOf(empty, TABLE_IDS.aVenir);
    expect(t.rows).toEqual([]);
    expect(t.notes).toEqual(["Aucune absence posée ni demande en attente dans les mois lus après septembre 2026."]);
    const nd = buildAbsences(input({}, { aVenir: { kind: "nd", reason: "aucun mois lu après 2026-09 (mois lus : 2024-10 → 2026-09)" } }));
    expect(nd.blocks.find((x) => x.id === "a-venir")!.nd).toEqual([{ reason: "aucun mois lu après 2026-09 (mois lus : 2024-10 → 2026-09)" }]);
    expect(tableOf(nd, TABLE_IDS.aVenir).rows[0].cells[1]).toEqual({ nd: "aucun mois lu après 2026-09 (mois lus : 2024-10 → 2026-09)" });
  });

  it("statistiques d'arrêts et soldes : « Prévu » avec la raison, aucun chiffre ; les arrêts renvoient au glossaire, pas aux Paramètres", () => {
    const b = m.blocks.find((x) => x.id === "non-disponibles")!;
    expect(b.prevu.map((x) => [x.id, x.label, x.reason])).toEqual([
      [PREVU_ARRETS.id, "Statistiques d'arrêts sur douze mois glissants", "règle de regroupement de deux arrêts et durée d'un arrêt court non définies"],
      [PREVU_SOLDES.id, "Soldes de congés et de RTT en jours", "non restitués par l'API PayFit ni par la DSN ; leur valeur en euros figure dans la provision de congés payés"],
    ]);
    expect(b.prevu[0]).toMatchObject({ term: "croisee-arrets" });
    expect(b.prevu[0].link).toBeUndefined();
    expect(b.prevu[1].link).toEqual({ href: LINKS.paieCompta, label: "Paie & comptabilité" });
    for (const x of b.prevu) expect(x.reason).not.toMatch(/\d/);
  });
});

describe("buildAbsences : cas B, deux motifs retenus soumis au seuil (masquage secondaire par les totaux publiés)", () => {
  const m = buildAbsences(input({}, dataB));

  it("accident (1 personne) masqué ; maladie masquée en août (tableau mensuel : 4 = accident + maladie) et sur la période (tuile : 19)", () => {
    expect(texts(tableOf(m, TABLE_IDS.conges))).toEqual([
      ["test_accident", "0", "n.d.", "0", "n.d.", "0", "n.d."],
      // Autres motifs : un seul motif, aucune cellule masquée ; 66 − 50 = +16.
      ["test_paid_leave", "20", "30", "16", "66", "50", "+16"],
      // Août (0) et la période (15) masqués en second : 4 − 0 et 19 − 15 ne donnent plus l'accident.
      ["test_sickness", "6", "n.d.", "9", "n.d.", "19", "n.d."],
    ]);
    expect(texts(tableOf(m, TABLE_IDS.motifs))).toEqual([
      ["test_accident", "oui", "n.d.", "n.d.", "0", "0,00 %", "n.d."],
      // 66/1 820 = 3,626… % ; 50/1 820 = 2,747… % ; écart 16/1 820 × 100 = 0,879… point.
      ["test_paid_leave", "non", "66", "3,63 %", "50", "2,75 %", "+0,88 pts"],
      ["test_sickness", "oui", "n.d.", "n.d.", "19", "1,04 %", "n.d."],
    ]);
    // Même raison pour le masquage principal et le masquage secondaire (on ne sait pas laquelle est sous le seuil).
    expect(tableOf(m, TABLE_IDS.conges).rows[2].cells[2]).toEqual({ nd: CONF });
    expect(tableOf(m, TABLE_IDS.conges).rows[0].cells[2]).toEqual({ nd: CONF });
  });

  it("aucune relation publiée n'a une seule valeur masquée (ligne + total ; motifs retenus d'un mois ou de la période + tuile ; autres motifs)", () => {
    const t = tableOf(m, TABLE_IDS.conges);
    const hidden = (r: number, j: number) => isNd(t.rows[r].cells[j + 1]);
    const one = (cells: boolean[]) => cells.filter(Boolean).length === 1;
    for (let r = 0; r < 3; r++) expect(one([0, 1, 2, 3].map((j) => hidden(r, j))), `ligne ${r}`).toBe(false);
    const retained = [0, 2];
    for (const j of [0, 1, 2, 3, 4]) expect(one(retained.map((r) => hidden(r, j))), `colonne ${j}`).toBe(false);
    expect(one([hidden(1, 3)])).toBe(false);
  });

  it("tableau mensuel et tuiles : entreprise entière, jamais masqués", () => {
    expect(texts(tableOf(m, TABLE_IDS.mensuel))[1].slice(0, 3)).toEqual(["Août 2026", "0,65 %", "4"]);
    expect(tile(m, "absenteisme").value.text).toBe("1,04 %");
  });
});

// Cas C : un seul motif non retenu présent (test_paid_leave, 2 personnes en N, 14 demi-journées en juillet) et le seul motif retenu
// (test_sickness, exempté : sa ligne égale la tuile). Tous motifs N : 14 + 15 = 29 / 1 820 ; N-1 : 0 + 19 = 19 / 1 820. Sans masquage
// du taux tous motifs, 29 − 15 (tuile) = 14 donnerait la valeur masquée des congés.
const CONGES_C: CongesPris = {
  window: W,
  emptyReason: null,
  lines: [
    { type: "test_paid_leave", chosen: false, months: [v(14, 2), v(0, 0), v(0, 0)], total: v(14, 2) },
    { type: "test_sickness", chosen: true, months: [v(6, 2), v(0, 0), v(9, 2)], total: v(15, 3) },
  ],
};
const CONGES_C_N1: CongesPris = {
  window: PW,
  emptyReason: null,
  lines: [
    { type: "test_paid_leave", chosen: false, months: zero3, total: v(0, 0) },
    { type: "test_sickness", chosen: true, months: [v(3, 1), v(4, 1), v(12, 2)], total: v(19, 2) },
  ],
};
const dataC = (prev: CongesPris = CONGES_C_N1, prevLeave = 0): Partial<AbsencesData> => ({
  motifs: {
    current: { label: ABSENCE_ALL_MOTIFS_LABEL, lines: [line("test_paid_leave", false, 14), line("test_sickness", true, 15)], all: ex(29, 1820), emptyReason: null },
    previous: { label: ABSENCE_ALL_MOTIFS_LABEL, lines: [line("test_paid_leave", false, prevLeave), line("test_sickness", true, 19)], all: ex(19 + prevLeave, 1820), emptyReason: null },
  },
  conges: { current: CONGES_C, previous: prev },
});

describe("buildAbsences : cas C, un seul motif non retenu sous le seuil (le taux tous motifs le donnerait par différence)", () => {
  it("seuil 3 : congés (2 personnes) n.d. ; la ligne « tous motifs » de la période est n.d. avec la raison du seuil, N-1 reste affiché", () => {
    const m = buildAbsences(input({}, dataC()));
    const t = tableOf(m, TABLE_IDS.tousMotifs);
    // N-1 : 19/1 820 = 1,04 % ; l'écart n'est pas calculé (valeur de la période n.d.).
    expect(texts(t)).toEqual([["Taux d'absence, tous motifs", "n.d.", "n.d.", "19", "1,04 %", "n.d."]]);
    expect(t.rows[0].cells[1]).toEqual({ nd: CONF });
    expect(t.rows[0].cells[2]).toEqual({ nd: CONF });
    expect(t.rows[0].cells[5]).toEqual({ nd: ECART_ND.valeur });
    expect(texts(tableOf(m, TABLE_IDS.motifs))).toEqual([
      ["test_paid_leave", "non", "n.d.", "n.d.", "0", "0,00 %", "n.d."],
      ["test_sickness", "oui", "15", "0,82 %", "19", "1,04 %", "−0,22 pts"],
    ]);
    // La ligne des congés : juillet et la période masqués (leur total est lui-même masqué) ; août et septembre, vides, restent 0.
    expect(texts(tableOf(m, TABLE_IDS.conges))[0]).toEqual(["test_paid_leave", "n.d.", "0", "0", "n.d.", "0", "n.d."]);
    // La tuile et le tableau mensuel restent (entreprise entière, KPI RH).
    expect(tile(m, "absenteisme").value.text).toBe("0,82 %");
  });

  it("N-1 aussi sous le seuil (1 personne, 5 demi-journées en août 2025) : la ligne « tous motifs » est n.d. sur les deux périodes", () => {
    const prev: CongesPris = { ...CONGES_C_N1, lines: [{ type: "test_paid_leave", chosen: false, months: [v(0, 0), v(5, 1), v(0, 0)], total: v(5, 1) }, CONGES_C_N1.lines[1]] };
    const t = tableOf(buildAbsences(input({}, dataC(prev, 5))), TABLE_IDS.tousMotifs);
    expect(texts(t)).toEqual([["Taux d'absence, tous motifs", "n.d.", "n.d.", "n.d.", "n.d.", "n.d."]]);
    expect(t.rows[0].cells[3]).toEqual({ nd: CONF });
  });

  it("seuil 2 : les congés (2 personnes) sont affichés, le taux tous motifs aussi (29/1 820 = 1,59 % ; écart 10/1 820 × 100 = +0,55 point)", () => {
    const t = tableOf(buildAbsences(input({ settings: settingsOf(2) }, dataC())), TABLE_IDS.tousMotifs);
    expect(texts(t)).toEqual([["Taux d'absence, tous motifs", "29", "1,59 %", "19", "1,04 %", "+0,55 pts"]]);
  });
});

describe("masquage : fonctions pures (cas écrits à la main, seuil 3)", () => {
  it("maskCells : une cellule masquée dans une relation ⇒ la plus petite affichée qui compte des personnes l'est aussi (un motif vide ne protège pas)", () => {
    // 1 personne masquée ; le motif vide (0) ne protège personne ; plus petite valeur qui compte des personnes : 20 (5) → 6 ≥ 3.
    expect(maskCells([{ size: 5, value: 20 }, { size: 1, value: 4 }, { size: 4, value: 30 }, { size: 0, value: 0 }], [[0, 1, 2, 3]], 3)).toEqual(["secondary", "masked", "shown", "shown"]);
  });
  it("maskCells : l'ensemble masqué compte au moins « seuil » personnes ; un n.d. du moteur n'en apporte aucune ; personnes non dénombrées ⇒ masquée", () => {
    // 1 + 2 = 3 personnes ≥ 3 : rien de plus.
    expect(maskCells([{ size: 1, value: 4 }, { size: 2, value: 6 }, { size: 9, value: 30 }], [[0, 1, 2]], 3)).toEqual(["masked", "masked", "shown"]);
    // Le n.d. du moteur (personnes non dénombrées) ne compte pour personne : 1 < 3 → la cellule de 9 personnes est masquée.
    expect(maskCells([{ size: 1, value: 4 }, { size: null, value: null }, { size: 9, value: 30 }], [[0, 1, 2]], 3)).toEqual(["masked", "nd", "secondary"]);
    expect(maskCells([{ size: null, value: 4 }, { size: 9, value: 30 }, { size: 8, value: 12 }], [[0, 1, 2]], 3)).toEqual(["unverifiable", "shown", "secondary"]);
  });
  it("maskCells : jetons de personne — une même personne dans deux cellules masquées ne compte qu'une fois", () => {
    // Mois de 2 personnes {0, 1} et d'1 personne {1} masqués : 2 personnes distinctes < 3 → le mois de 4 personnes est masqué.
    expect(maskCells([{ size: 2, value: 6, members: [0, 1] }, { size: 1, value: 2, members: [1] }, { size: 4, value: 9, members: [2, 3, 4, 5] }], [[0, 1, 2]], 3)).toEqual(["masked", "masked", "secondary"]);
  });
  it("maskCells : une cellule exemptée (valeur publiée) n'est jamais masquée et ne sert pas de masque secondaire", () => {
    expect(maskCells([{ size: 1, value: 4, exempt: true }, { size: 1, value: 2 }, { size: 5, value: 9 }], [[0, 1, 2]], 3)).toEqual(["shown", "masked", "secondary"]);
  });
  it("maskCells : en cascade d'une relation à l'autre", () => {
    // Relation 1 : a (1 personne) et b ⇒ b masquée ; relation 2 : b, c, d ⇒ b seule masquée ⇒ c (10 < 12) masquée.
    expect(
      maskCells(
        [
          { size: 1, value: 3 },
          { size: 4, value: 8 },
          { size: 5, value: 10 },
          { size: 6, value: 12 },
        ],
        [
          [0, 1],
          [1, 2, 3],
        ],
        3,
      ),
    ).toEqual(["masked", "secondary", "secondary", "shown"]);
  });
  it("aVenirMask : un mois masqué dans une ligne dont le total est affiché ⇒ le plus petit autre mois l'est aussi", () => {
    expect(aVenirMask([{ months: [v(2, 1), v(6, 4)], total: v(8, 4) }], 3)).toEqual({ months: [["masked", "secondary"]], total: ["shown"] });
  });
  // Lot 12 (troisième relecture) : la grille porte deux fenêtres (période et N-1), masquées chacune par la fonction partagée
  // motifWindowMask (celle du détail de KPI RH) : chaque mois a le statut de la seule colonne de son mois, le total d'une fenêtre se
  // déduit de ses mois (windowStatus : « secondary » dès qu'un mois est masqué, même raison du seuil à l'écran). Le motif exempt est
  // déduit des lignes (seul motif retenu). Fenêtres d'un mois : la tuile de la fenêtre est l'absentéisme du mois.
  const NOTHING = { months: [false], allMonths: [false], all: false };
  it("congesMask : sans absentéisme publié pour un mois, la colonne de ce mois n'est pas une relation", () => {
    const g = {
      current: {
        lines: [
          { type: "test_a", chosen: true, months: [v(4, 1)], total: v(4, 1) },
          { type: "test_b", chosen: true, months: [v(9, 3)], total: v(9, 3) },
        ],
        published: NOTHING,
      },
      previous: {
        lines: [
          { type: "test_a", chosen: true, months: [v(0, 0)], total: v(0, 0) },
          { type: "test_b", chosen: true, months: [v(0, 0)], total: v(0, 0) },
        ],
        published: NOTHING,
      },
    };
    // Mois : masquage principal seul (1 personne masquée, 3 affichées). Période : déduite du mois masqué (avant : « masked », la
    // période étant une cellule masquée pour elle-même).
    expect(congesMask(g, 3)).toEqual({ months: [["masked"], ["shown"]], cur: ["secondary", "shown"], prev: ["shown", "shown"], allCur: "nd", allPrev: "nd" });
    // Avec l'absentéisme du mois publié : l'autre motif retenu du mois est masqué en second (1 + 3 ≥ 3), et sa période avec lui.
    expect(congesMask({ ...g, current: { ...g.current, published: { ...NOTHING, months: [true] } } }, 3)).toEqual({ months: [["masked"], ["secondary"]], cur: ["secondary", "secondary"], prev: ["shown", "shown"], allCur: "nd", allPrev: "nd" });
  });
  it("congesMask : un seul motif non retenu sous le seuil ⇒ le taux tous motifs du mois est masqué, et la période avec lui ; N-1 reste", () => {
    // Motif retenu exempté (seul retenu : égal à la tuile) ; motif non retenu de 2 personnes (seuil 3) : la relation des autres motifs
    // du mois (tous motifs − absentéisme) n'a aucune autre cellule → son total, le taux tous motifs du mois, est masqué ; la période
    // le contient (n.d.). Période du motif : déduite de son mois masqué (avant : « masked »). N-1 : 0 personne.
    const all = { months: [true], allMonths: [true], all: true };
    const g = {
      current: {
        lines: [
          { type: "test_a", chosen: false, months: [v(14, 2)], total: v(14, 2) },
          { type: "test_b", chosen: true, months: [v(15, 3)], total: v(15, 3) },
        ],
        published: all,
      },
      previous: {
        lines: [
          { type: "test_a", chosen: false, months: [v(0, 0)], total: v(0, 0) },
          { type: "test_b", chosen: true, months: [v(19, 2)], total: v(19, 2) },
        ],
        published: all,
      },
    };
    expect(congesMask(g, 3)).toEqual({ months: [["masked"], ["shown"]], cur: ["secondary", "shown"], prev: ["shown", "shown"], allCur: "secondary", allPrev: "shown" });
  });
});

// Borne basse sans aucune demi-journée comptée (seulement des demi-journées incertaines) : l'effectif n'est pas dénombré. La cellule est
// « non vérifiable » (jamais « ≥ 0 », qui dirait qu'au moins une personne a une absence de ce motif ce mois-là), avec masquage
// secondaire. Cas écrits à la main.
describe("seuil de confidentialité : borne basse sans personne comptée (demi-journées seulement incertaines)", () => {
  const lb0: CongeCell = { kind: "lower_bound", half: 0, persons: 0, unlinked: 0, who: [] };
  const NV = { nd: SEUIL_NON_VERIFIABLE };

  it("masked : n.d. « non vérifiable », quel que soit le seuil ; une borne basse avec des personnes comptées garde la règle du seuil", () => {
    expect(masked(lb0, 3)).toEqual({ kind: "nd", reason: SEUIL_NON_VERIFIABLE });
    expect(masked(lb0, 1)).toEqual({ kind: "nd", reason: SEUIL_NON_VERIFIABLE });
    expect(masked(lb(4, 1), 3)).toEqual({ kind: "nd", reason: SOUS_SEUIL(3) });
  });

  it("aVenirMask : le mois en borne basse sans personne est non vérifiable ; l'autre mois de la ligne (total affiché) est masqué en second", () => {
    // Ligne : octobre ≥ 0 (aucune personne comptée), novembre 6 demi-journées (4 personnes) ; total ≥ 6 (4 personnes), affiché. Seuil 3 :
    // octobre seul masqué se lirait par différence (total − novembre) → novembre masqué en second (4 personnes ≥ 3).
    expect(aVenirMask([{ months: [lb0, v(6, 4)], total: lb(6, 4) }], 3)).toEqual({ months: [["unverifiable", "secondary"]], total: ["shown"] });
    // Ligne entièrement incertaine : mois et total non vérifiables.
    expect(aVenirMask([{ months: [lb0], total: lb0 }], 3)).toEqual({ months: [["unverifiable"]], total: ["unverifiable"] });
  });

  it("congesMask : motif non retenu en borne basse sans personne ; l'autre motif non retenu est masqué en second dans le même mois, et sa période", () => {
    // Seuil 3. Ligne 0 (non retenue) : juillet ≥ 0 (aucune personne), août 0 ; période ≥ 0 ; N-1 0. Ligne 1 (non retenue) : juillet 20
    // (4 personnes), août 7 (4) ; période 27 (4) ; N-1 30 (4). Ligne 2 : seul motif retenu, exempté. Absentéisme et taux tous motifs
    // publiés chaque mois. Juillet, autres motifs (tous motifs du mois − absentéisme du mois) : ligne 0 non vérifiable, seule masquée →
    // ligne 1 (4 personnes) masquée en second en juillet. Août : rien sous le seuil. Périodes déduites des mois : ligne 0 non vérifiable,
    // ligne 1 n.d. (juillet masqué). Avant : la ligne 1 était masquée en second dans la colonne de la période, puis son plus petit mois
    // (août, 7) par la relation de sa ligne ; c'est désormais juillet, le mois de la cellule à protéger, pour toute période qui le
    // contient. N-1 (ses propres mois) : ligne 1 à 4 personnes chaque mois, rien n'est masqué.
    const all = { months: [true, true], allMonths: [true, true], all: true };
    const g = {
      current: {
        lines: [
          { type: "test_a", chosen: false, months: [lb0, v(0, 0)], total: lb0 },
          { type: "test_b", chosen: false, months: [v(20, 4), v(7, 4)], total: v(27, 4) },
          { type: "test_c", chosen: true, months: [v(0, 0), v(4, 1)], total: v(4, 1) },
        ],
        published: all,
      },
      previous: {
        lines: [
          { type: "test_a", chosen: false, months: [v(0, 0), v(0, 0)], total: v(0, 0) },
          { type: "test_b", chosen: false, months: [v(15, 4), v(15, 4)], total: v(30, 4) },
          { type: "test_c", chosen: true, months: [v(0, 0), v(2, 1)], total: v(2, 1) },
        ],
        published: all,
      },
    };
    expect(congesMask(g, 3)).toEqual({
      months: [
        ["unverifiable", "shown"],
        ["secondary", "shown"],
        ["shown", "shown"],
      ],
      cur: ["unverifiable", "secondary", "shown"],
      prev: ["shown", "shown", "shown"],
      allCur: "shown",
      allPrev: "shown",
    });
  });

  it("buildAbsences : aucune cellule « ≥ 0 » ; la ligne incertaine est n.d. « non vérifiable » dans le tableau par motif, les demi-journées prises et les absences à venir", () => {
    // test_rare (non retenu) : seulement des demi-journées incertaines en juillet (≥ 0, aucune personne), rien en août ni en septembre.
    const conges: CongesPris = { ...CONGES, lines: CONGES.lines.map((l) => (l.type === "test_rare" ? { ...l, months: [lb0, v(0, 0), v(0, 0)], total: lb0 } : l)) };
    const motifs = {
      ...data().motifs,
      current: { ...data().motifs.current, lines: data().motifs.current.lines.map((l): MotifLineK => (l.type === "test_rare" ? { type: "test_rare", chosen: false, kind: "lower_bound", half: 0, ratio: { num: 0, den: 1820 } } : l)) },
    };
    const aVenir = { kind: "value" as const, after: "2026-09", months: ["2026-10"], lines: [{ type: "test_rtt", statut: "pose" as const, months: [lb0], total: lb0 }], nonRattachees: 0 };
    const m = buildAbsences(input({}, { conges: { current: conges, previous: CONGES_N1 }, motifs, aVenir }));
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/≥ 0(?![\d,])/);
    expect(json).not.toContain("≥ 0,00");
    const rare = (id: string) => m.tables.find((t) => t.id === id)!.rows.find((r) => r.cells[0] === absenceTypeText("test_rare"))!;
    expect(rare(TABLE_IDS.conges).cells[1]).toEqual(NV);
    expect(rare(TABLE_IDS.conges).cells[4]).toEqual(NV);
    expect(rare(TABLE_IDS.motifs).cells.slice(2, 4)).toEqual([NV, NV]);
    expect(m.tables.find((t) => t.id === TABLE_IDS.aVenir)!.rows[0].cells.slice(2)).toEqual([NV, NV]);
  });
});

describe("buildAbsences : seuil de confidentialité non défini ou illisible (addendum C)", () => {
  for (const [name, settings, reason] of [
    ["absent", settingsOf(), "seuil de confidentialité non défini (Paramètres)"],
    ["illisible", settingsOf("3"), "seuil de confidentialité illisible : à ré-enregistrer (Paramètres)"],
  ] as const) {
    it(`réglage ${name} : tableau par motif, demi-journées prises et absences à venir n.d. avec la raison et le lien Paramètres ; la tuile principale et le taux tous motifs restent`, () => {
      const m = buildAbsences(input({ settings }));
      for (const [id, table] of [
        ["motifs", TABLE_IDS.motifs],
        ["conges", TABLE_IDS.conges],
        ["a-venir", TABLE_IDS.aVenir],
      ] as const) {
        const b = m.blocks.find((x) => x.id === id)!;
        expect(b.nd).toEqual([{ reason, action: { href: LINKS.parametres, label: "Paramètres" } }]);
        expect(b.tables).toEqual([]);
        expect(b.charts).toEqual([]);
        // Forme exportable : une ligne, la raison ; aucune valeur du motif.
        const t = tableOf(m, table);
        expect(t.rows).toHaveLength(1);
        expect(t.rows[0].cells[1]).toEqual({ nd: reason });
      }
      expect(m.charts.map((c) => c.id)).toEqual([TABLE_IDS.mensuel]);
      expect(tile(m, "absenteisme").value.text).toBe("0,82 %");
      expect(texts(tableOf(m, TABLE_IDS.tousMotifs))[0][2]).toBe("3,85 %");
      expect(JSON.stringify(m.tables)).not.toContain("test_rare");
    });
  }
});

describe("buildAbsences : filtre de service, chapitre n.d.", () => {
  it("service retenu : chaque carte et chaque bloc n.d. « non filtrable par service », aucun graphique, « Prévu » conservé", () => {
    const m = buildAbsences(input({ service: { value: "S1", label: "S1" }, data: null }));
    expect(m.nd).toBeNull();
    expect(m.tiles.map((t) => t.value)).toEqual(Array(4).fill({ text: "n.d.", kind: "nd", reason: NON_FILTRABLE }));
    expect(m.charts).toEqual([]);
    for (const id of ["mensuel", "motifs", "tous-motifs", "conges", "a-venir"]) expect(m.blocks.find((b) => b.id === id)!.nd).toEqual([{ reason: NON_FILTRABLE }]);
    for (const t of m.tables) expect(t.rows[0].cells[1]).toEqual({ nd: NON_FILTRABLE });
    expect(m.blocks.find((b) => b.id === "non-disponibles")!.prevu).toHaveLength(2);
  });

  it("chapitre non calculable : n.d. avec la raison et l'action, rien d'autre", () => {
    const m = buildAbsences(input({ nd: { reason: "Aucune source RH retenue", action: { href: LINKS.donnees, label: "Données" } }, data: null }));
    expect(m.nd).toEqual({ reason: "Aucune source RH retenue", action: { href: LINKS.donnees, label: "Données" } });
    expect(m.tiles).toEqual([]);
    expect(m.tables).toEqual([]);
  });
});

describe("aucun identifiant dans le modèle (filet de sécurité)", () => {
  it("publicText : formes des raisons du moteur qui nomment une absence ou un contrat", () => {
    expect(publicText("2026-08 : absence ABS-1 rattachée au contrat C-77 inconnu du référentiel")).toBe("2026-08 : absence rattachée à un contrat inconnu du référentiel (détail dans KPI RH)");
    expect(publicText("absence ABS-2 : date de début non renseignée dans PayFit")).toBe("absence sans date de début renseignée dans PayFit (détail dans KPI RH)");
    expect(publicText("≥ : 3 demi-journée(s) incertaine(s) (absences ABS-3, ABS-4)")).toBe("≥ : 3 demi-journée(s) incertaine(s) (détail dans KPI RH)");
    expect(publicText("absences non lues pour 2026-08")).toBe("absences non lues pour 2026-08");
  });
  it("une raison brute oubliée ne passe ni dans les tableaux, ni dans le graphique, ni dans les cartes", () => {
    const raw = "2026-08 : absence ABS-1 rattachée au contrat C-77 inconnu du référentiel";
    const rows = [row("2026-07", "2025-07", ex(6, 600), ex(3, 600), 600), row("2026-08", "2025-08", ndr(raw), ex(4, 620), 620), row("2026-09", "2025-09", ex(9, 600), ex(12, 600), 600)];
    const m = buildAbsences(input({}, { rows, period: { current: ndr(raw), previous: ex(19, 1820) } }));
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/ABS-1|C-77/);
    expect(json).toContain("absence rattachée à un contrat inconnu du référentiel (détail dans KPI RH)");
  });
});

describe("aides : seuil, écart, glossaire", () => {
  it("masked : de 1 à (seuil − 1) personnes ⇒ n.d. ; aucune personne ⇒ valeur gardée ; personnes inconnues ⇒ n.d.", () => {
    expect(masked(v(10, 2), 3)).toEqual({ kind: "nd", reason: SOUS_SEUIL(3) });
    expect(SOUS_SEUIL(3)).toBe(CONF);
    // Chaque appel de v() tire de nouveaux jetons de personne : la même valeur est construite une fois.
    const three = v(10, 3);
    expect(masked(three, 3)).toEqual(three);
    const none = v(0, 0);
    expect(masked(none, 3)).toEqual(none);
    const one = lb(4, 1);
    expect(masked(one, 1)).toEqual(one);
    expect(masked(ndc("raison du moteur"), 3)).toEqual(ndc("raison du moteur"));
    expect(masked(undefined, 3)).toEqual({ kind: "nd", reason: SEUIL_NON_VERIFIABLE });
  });
  it("dayGapCell : écart de demi-journées (nombre entier signé) entre deux totaux exacts ; n.d. dès qu'un côté n'est pas exact", () => {
    expect(dayGapCell(v(9, 4), v(4, 4))).toBe(5);
    expect(dayGapCell(v(4, 4), v(9, 4))).toBe(-5);
    expect(dayGapCell(v(4, 4), v(4, 4))).toBe(0);
    expect(dayGapCell(ndc("a"), v(4, 4))).toEqual({ nd: ECART_ND.valeur });
    expect(dayGapCell(v(4, 4), ndc("b"))).toEqual({ nd: ECART_ND.n1 });
    expect(dayGapCell(lb(4, 4), v(4, 4))).toEqual({ nd: ECART_ND.borne });
    expect(dayGapCell(v(4, 4), lb(4, 4))).toEqual({ nd: ECART_ND.n1Borne });
  });
  it("rateGap : écart en points calculé par le moteur entre deux taux exacts (0,25 point → 0,0025) ; n.d. sinon, raison courte", () => {
    // 3/600 − 1,5/600 : (0,5 % − 0,25 %) = 0,25 point.
    expect(rateGap(ex(6, 1200), ex(3, 1200))).toEqual({ exact: 0.0025 });
    expect(rateGap(ndr("x"), ex(3, 1200))).toEqual({ nd: ECART_ND.valeur });
    expect(rateGap(ex(6, 1200), ndr("y"))).toEqual({ nd: ECART_ND.n1 });
    expect(rateGap(lo(6, 1200), ex(3, 1200))).toEqual({ nd: ECART_ND.borne });
    expect(rateGap(ex(6, 1200), lo(3, 1200))).toEqual({ nd: ECART_ND.n1Borne });
  });
  it("chaque identifiant de glossaire du chapitre existe", () => {
    const m = buildAbsences(input());
    const ids = new Set([
      ...ABSENCES_TERMS,
      ...m.tiles.map((t) => t.term!),
      ...m.blocks.flatMap((b) => [...(b.term ? [b.term] : []), ...b.prevu.flatMap((x) => (x.term ? [x.term] : []))]),
      ...m.tables.flatMap((t) => [...(t.terms ?? []), ...t.columns.flatMap((c) => (c.term ? [c.term] : []))]),
    ]);
    for (const id of ids) expect(glossaryEntry(id), id).toBeDefined();
  });
});

describe("AbsencesView : rendu du modèle", () => {
  const m = buildAbsences(input());
  it("« Afficher tout » : cartes, deux graphiques et leurs tableaux, identifiants de test, ancres de bloc, « Prévu » ; aucune couleur de tendance", () => {
    const out = render(m);
    for (const id of ["absenteisme", "absenteisme-n1", "douze-mois", "jours-theoriques"]) expect(out).toContain(`data-testid="cx-tile-absences-${id}"`);
    for (const id of Object.values(TABLE_IDS)) expect(out).toContain(`data-testid="cx-table-${id}"`);
    for (const id of [TABLE_IDS.mensuel, TABLE_IDS.conges]) expect(out).toContain(`data-testid="cx-chart-${id}"`);
    for (const id of ["cartes", "mensuel", "motifs", "tous-motifs", "conges", "a-venir", "non-disponibles"]) expect(out).toContain(`id="cx-absences-${id}"`);
    for (const id of [PREVU_ARRETS.id, PREVU_SOLDES.id]) expect(out).toContain(`data-testid="cx-prevu-${id}"`);
    expect(out).not.toContain("cx-prevu-absences-non-rattachees");
    expect(out).toContain(`href="${glossaryHref("demo", "croisee-arrets")}"`);
    expect(out).toContain("Motifs retenus : test_sickness");
    expect(out).toContain("Taux d'absence, tous motifs");
    expect(out).toContain('data-testid="cx-absences-limites"');
    expect(out).not.toMatch(/trend-(bad|good)/);
  });
  it("« Graphiques » : cartes et graphiques, lien vers chaque tableau exact, aucun tableau", () => {
    const out = render(m, "graphique");
    for (const id of [TABLE_IDS.mensuel, TABLE_IDS.conges]) {
      expect(out).toContain(`data-testid="cx-chart-${id}"`);
      expect(out).toContain(`href="${LINKS.tableau}#cx-table-${id}"`);
    }
    expect(out).not.toContain('data-testid="cx-table-');
    expect(out).not.toContain('id="cx-absences-motifs"');
  });
  it("« Tableaux » : cartes et tableaux, sans graphique", () => {
    const out = render(m, "tableau");
    expect(out).not.toContain('data-testid="cx-chart-');
    expect(out).toContain(`data-testid="cx-table-${TABLE_IDS.mensuel}"`);
    expect(out).toContain(`data-testid="cx-table-${TABLE_IDS.conges}"`);
  });
  it("graphique sans aucune valeur connue : la raison, sans titre répété", () => {
    const rows = ROWS.map((r) => ({ ...r, absenteeism: ndr(UNREAD), previous: { ...r.previous, absenteeism: ndr(UNREAD) } }));
    const out = render(buildAbsences(input({}, { rows })), "graphique");
    expect(out).toContain(`data-testid="cx-chart-${TABLE_IDS.mensuel}-vide"`);
    expect(out).toContain("graphique non tracé");
    expect(out.match(/Absentéisme par mois</g)!.length).toBe(1);
  });
  it("seuil non défini : la raison écrite et le lien vers les Paramètres, y compris en affichage « Graphiques »", () => {
    const out = render(buildAbsences(input({ settings: settingsOf() })));
    expect(out).toContain('data-testid="cx-absences-motifs-nd"');
    expect(out).toContain("seuil de confidentialité non défini (Paramètres)");
    expect(out).toContain(`href="${LINKS.parametres}"`);
    expect(render(buildAbsences(input({ settings: settingsOf() })), "graphique")).toContain('data-testid="cx-absences-conges-nd"');
  });
  it("chapitre n.d. : un seul état n.d. avec la raison et l'action, sans titre répété", () => {
    const out = render(buildAbsences(input({ nd: { reason: "aucune source RH retenue", action: { href: LINKS.donnees, label: "Données" } }, data: null })));
    expect(out).toContain('data-testid="cx-absences-nd"');
    expect(out).toContain("Aucune source RH retenue");
    expect(out).not.toContain("<h3");
    expect(out).not.toContain("cx-tile-absences");
  });
});

// --- Lecture des sources (loadAbsencesInput) sur un référentiel PayFit fictif -------------------------------------------------------

const edge = {
  collaborators: [{ id: "P-1" }, { id: "P-2" }, { id: "P-3" }],
  contracts: [
    { contractId: "C-1", collaboratorId: "P-1", startDate: "2025-01-01", endDate: null },
    { contractId: "C-2", collaboratorId: "P-2", startDate: "2025-01-01", endDate: null },
    { contractId: "C-3", collaboratorId: "P-3", startDate: "2025-01-01", endDate: null },
  ],
};
const full = (id: string, contract: string, from: string, to: string, type: string, status = "approved") => absence(id, contract, from, "beginning-of-day", to, "end-of-day", { type, status });
const ABS = [
  full("a1", "C-1", "2026-04-06", "2026-04-10", "test_paid_leave"),
  full("a2", "C-2", "2026-04-20", "2026-04-21", "test_paid_leave"),
  full("a3", "C-3", "2026-05-11", "2026-05-12", "test_sickness"),
  full("b1", "C-1", "2026-10-26", "2026-10-30", "test_paid_leave"),
];

type FakeOpts = { service?: { value: string | null | undefined; label: string }; settings?: CroiseeSettings; period?: boolean };
function fakeCtx(kpi: KpiContext | null, months: string[], o: FakeOpts = {}): CroiseeContext {
  const href = (patch: Record<string, string | null> = {}, hash?: string) => `/e/demo/studio-rh/masse-salariale/croisee?chapitre=${patch.chapitre ?? "absences"}${patch.affichage ? `&affichage=${patch.affichage}` : ""}${hash ? `#${hash}` : ""}`;
  const prevMonths = months.map((m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`);
  return {
    slug: "demo",
    canEdit: false,
    period: o.period === false ? null : { year: Number(months[0].slice(0, 4)), from: months[0].slice(5), to: months[months.length - 1].slice(5), years: [], last: "", months, notices: [] },
    periodNd: o.period === false ? "Aucun mois clos à la date de référence" : null,
    prevMonths,
    labels: { period: periodLabel(months), prev: periodLabel(prevMonths) },
    service: { options: [], axis: null, reason: null, ...(o.service ?? { value: undefined, label: "Tous les services" }) },
    settings: o.settings ?? SEUIL_3,
    affichage: "tout",
    href,
    load: {
      kpi: async () => {
        if (!kpi) throw new Error("lecture inattendue");
        return kpi;
      },
    },
  } as unknown as CroiseeContext;
}
const fakeKpi = (input: ReturnType<typeof kpiInput> | null): KpiContext => ({ collab: { source: { chosen: "payfit", reason: "source retenue" }, state: null }, settings: { invalid: [] }, input, readTypes: [] }) as unknown as KpiContext;

describe("loadAbsencesInput puis buildAbsences : référentiel PayFit fictif", async () => {
  const data = await payfitEdgeBuild(edge);
  const kin = kpiInput(data, readAbsences(ABS, monthRange("2024-10", "2026-10")), { absenceTypes: ["test_sickness"] });

  it("cartes, graphiques et leurs tableaux, motifs, demi-journées prises et absences à venir ; aucun nom ni identifiant dans le modèle", async () => {
    const m = buildAbsences(await loadAbsencesInput(fakeCtx(fakeKpi(kin), ["2026-04", "2026-05"])));
    expect(m.nd).toBeNull();
    expect(m.tiles).toHaveLength(4);
    for (const c of m.charts) expect(m.tables.some((t) => t.id === c.tableId)).toBe(true);
    // Avril : 3 contrats × 30 j = 90 j = 180 demi-journées ; mai : 3 × 31 j = 186 demi-journées. Maladie retenue : 4 demi-journées en mai
    // (4 / 186 = 2,150… %) ; période : 4 / 366 = 1,092… %.
    expect(texts(tableOf(m, TABLE_IDS.mensuel)).map((r) => r.slice(0, 4))).toEqual([
      ["Avril 2026", "0,00 %", "0", "180"],
      ["Mai 2026", "2,15 %", "4", "186"],
      [`Période (${periodLabel(["2026-04", "2026-05"])})`, "1,09 %", "4", "366"],
    ]);
    // Seuil 3 : congés (deux personnes) n.d. ; maladie, seul motif retenu, affichée comme la tuile (4 demi-journées, 1,09 %).
    expect(texts(tableOf(m, TABLE_IDS.motifs)).map((r) => r.slice(0, 4))).toEqual([
      ["test_paid_leave", "non", "n.d.", "n.d."],
      ["test_sickness", "oui", "4", "1,09 %"],
    ]);
    // Tous motifs : congés C-1 (10) + C-2 (4) + maladie C-3 (4) = 18 demi-journées sur 366. Avec la tuile (4), il donnerait les
    // congés (18 − 4 = 14 : 2 personnes, sous le seuil) par différence : n.d. avec la raison du seuil. N-1 : aucune absence, affiché.
    expect(texts(tableOf(m, TABLE_IDS.tousMotifs))[0].slice(1, 3)).toEqual(["n.d.", "n.d."]);
    expect(tableOf(m, TABLE_IDS.tousMotifs).rows[0].cells[1]).toEqual({ nd: CONF });
    // Demi-journées prises : congés avril (2 personnes) et période n.d. ; maladie mai 4.
    expect(texts(tableOf(m, TABLE_IDS.conges)).map((r) => r.slice(0, 4))).toEqual([
      ["test_paid_leave", "n.d.", "0", "n.d."],
      ["test_sickness", "0", "4", "4"],
    ]);
    // À venir : octobre 2026 lu, après septembre (dernier mois clos) ; b1 posée (1 personne) ⇒ n.d. sous le seuil.
    expect(texts(tableOf(m, TABLE_IDS.aVenir))).toEqual([["test_paid_leave", "Posée (statut retenu)", "n.d.", "n.d."]]);
    expect(JSON.stringify(m)).not.toMatch(/\b[CP]-\d|\b[ab][1-3]\b/);
  });

  it("seuil d'une personne : les demi-journées du motif s'affichent (avril 10 + 4 = 14, deux personnes)", async () => {
    const m = buildAbsences(await loadAbsencesInput(fakeCtx(fakeKpi(kin), ["2026-04", "2026-05"], { settings: settingsOf(1) })));
    expect(texts(tableOf(m, TABLE_IDS.conges))[0].slice(0, 4)).toEqual(["test_paid_leave", "14", "0", "14"]);
    // b1 : lun. 26 → ven. 30 octobre = 5 j = 10 demi-journées.
    expect(texts(tableOf(m, TABLE_IDS.aVenir))).toEqual([["test_paid_leave", "Posée (statut retenu)", "10", "10"]]);
  });

  it("absence sur un contrat inconnu et absence sans date : raisons avec le mois et le nombre, aucun identifiant d'absence ni de contrat", async () => {
    const X = [full("ID-777", "C-9", "2026-04-14", "2026-04-15", "test_paid_leave"), absence("ID-888", "C-2", null, null, "2026-05-20", "end-of-day", { type: "test_sickness" })];
    const k2 = kpiInput(data, readAbsences([...ABS, ...X], monthRange("2024-10", "2026-10")), { absenceTypes: ["test_sickness"] });
    const m = buildAbsences(await loadAbsencesInput(fakeCtx(fakeKpi(k2), ["2026-04", "2026-05"])));
    // Maladie retenue : ID-888 sans date de début, en cause en avril et en mai.
    expect(tile(m, "absenteisme").value).toEqual({ text: "n.d.", kind: "nd", reason: "2 mois n.d. (2026-04 → 2026-05) ; 1 absence sans date de début ou de fin dans PayFit en 2026-04 (détail dans KPI RH)" });
    // Congés : ID-777 sur un contrat inconnu en avril.
    expect(tableOf(m, TABLE_IDS.motifs).rows[0].cells[2]).toEqual({ nd: "1 absence rattachée à un contrat inconnu du référentiel en 2026-04 (détail dans KPI RH)" });
    expect(tableOf(m, TABLE_IDS.conges).rows[0].cells[1]).toEqual({ nd: "1 absence rattachée à un contrat inconnu du référentiel en 2026-04 (détail dans KPI RH)" });
    // Tous motifs : avril en cause pour le contrat inconnu (raison du premier mois), mai pour la date absente.
    expect(tableOf(m, TABLE_IDS.tousMotifs).rows[0].cells[1]).toEqual({ nd: "2 mois n.d. (2026-04 → 2026-05) ; 1 absence rattachée à un contrat inconnu du référentiel en 2026-04 (détail dans KPI RH)" });
    expect(JSON.stringify(m)).not.toMatch(/ID-\d|\bC-\d/);
  });

  it("service retenu : aucune lecture, chaque bloc n.d. « non filtrable par service »", async () => {
    const m = buildAbsences(await loadAbsencesInput(fakeCtx(null, ["2026-04"], { service: { value: "S1", label: "S1" } })));
    expect(m.tiles.every((t) => t.value.reason === NON_FILTRABLE)).toBe(true);
  });

  it("période n.d. : chapitre n.d. avec la raison du contexte et le lien Données", async () => {
    const m = buildAbsences(await loadAbsencesInput(fakeCtx(null, ["2026-04"], { period: false })));
    expect(m.nd).toEqual({ reason: "Aucun mois clos à la date de référence", action: { href: "/e/demo/donnees", label: "Données" } });
  });

  it("référentiel absent : chapitre n.d. « Référentiel RH non construit »", async () => {
    const m = buildAbsences(await loadAbsencesInput(fakeCtx(fakeKpi(null), ["2026-04"])));
    expect(m.nd?.reason).toBe("Référentiel RH non construit");
  });

  it("DSN : absences n.d. avec la raison de la source, jours théoriques calculés", async () => {
    const m = buildAbsences(await loadAbsencesInput(fakeCtx(fakeKpi(kpiInput(dsnFixtureBuild(), DSN_ABSENCES)), ["2026-04", "2026-05"])));
    expect(tile(m, "absenteisme").value).toMatchObject({ kind: "nd", reason: "arrêts non extraits de la DSN" });
    expect(tile(m, "jours-theoriques").value.kind).toBe("value");
    expect(m.blocks.find((b) => b.id === "motifs")!.nd).toEqual([{ reason: "arrêts non extraits de la DSN" }]);
    expect(m.blocks.find((b) => b.id === "a-venir")!.nd).toEqual([{ reason: "arrêts non extraits de la DSN" }]);
  });
});
