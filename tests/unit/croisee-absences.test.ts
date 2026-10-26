import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AbsencesView } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChAbsences";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { Affichage } from "@/app/e/[slug]/studio-rh/masse-salariale/components";
import { monthRange } from "@/lib/connectors/months";
import type { CongeCell, CongesPris } from "@/lib/croisee/conges";
import { readCroiseeSettings, type CroiseeSettings } from "@/lib/croisee-settings";
import { glossaryEntry } from "@/lib/glossary";
import { ABSENCE_ALL_MOTIFS_LABEL } from "@/lib/rh/kpi/absence-motifs";
import { kpiNd, type Window } from "@/lib/rh/kpi/types";
import type { KpiContext } from "@/lib/rh/kpi-context";
import { cellView, tableNdReasons, type CroiseeTable } from "@/lib/viz/croisee";
import {
  ABSENCES_TERMS,
  buildAbsences,
  dayGapCell,
  ECART_ND,
  loadAbsencesInput,
  rateGap,
  masked,
  NON_FILTRABLE,
  PREVU_ARRETS,
  PREVU_SOLDES,
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
import { periodLabel } from "@/lib/viz/synthese";
import { absence, DSN_ABSENCES, kpiInput, readAbsences } from "./helpers/kpi";
import { dsnFixtureBuild, payfitEdgeBuild } from "./helpers/rh";

// Chapitre 03 · Absences & congés : buildAbsences avec des entrées fictives écrites à la main (aucune donnée réelle), puis rendu du
// modèle et lecture des sources sur un référentiel fictif. Période juillet → septembre 2026, N-1 juillet → septembre 2025.

const MONTHS = ["2026-07", "2026-08", "2026-09"];
const PREV = ["2025-07", "2025-08", "2025-09"];
const LABEL = periodLabel(MONTHS); // « juillet → septembre 2026 »
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
const v = (half: number, persons: number): CongeCell => ({ kind: "exact", half, persons });
const ndc = (reason: string): CongeCell => ({ kind: "nd", reason });
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
    { type: "test_rare", chosen: false, months: [v(0, 0), v(0, 0), v(0, 0)], total: v(0, 0) },
    { type: "test_sickness", chosen: true, months: [v(3, 1), v(4, 1), v(12, 2)], total: v(19, 2) },
    { type: "test_unread", chosen: false, months: [v(0, 0), v(0, 0), v(0, 0)], total: v(0, 0) },
  ],
};

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
  period: { months: MONTHS, prevMonths: PREV },
  service: { value: undefined, label: "Tous les services" },
  settings: SEUIL_3,
  nd: null,
  data: data(dataOver),
  ...over,
});

const tableOf = (m: AbsencesModel, id: string): CroiseeTable => {
  const t = m.tables.find((x) => x.id === id);
  if (!t) throw new Error(`tableau ${id} absent`);
  return t;
};
// Espaces insécables des formats français (« 0,82 % », « 1 820 », « 7,5 j ») ramenées à des espaces simples pour les comparaisons.
const sp = <T,>(x: T): T => JSON.parse(JSON.stringify(x).replace(/[\u00a0\u202f]/g, " "));
// Textes affichés d'un tableau, ligne par ligne (n.d. : « n.d. »), pied compris.
const texts = (t: CroiseeTable) => sp([...t.rows, ...(t.foot ? [t.foot] : [])].map((r) => t.columns.map((c, i) => cellView(r.cells[i], c, r).text)));
const tile = (m: AbsencesModel, id: string) => sp(m.tiles.find((t) => t.id === id)!);
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const render = (m: AbsencesModel, affichage: Affichage = "tout") => unescape(renderToStaticMarkup(h(AbsencesView, { model: m, slug: "demo", affichage, tableauHref: LINKS.tableau })));

describe("buildAbsences : cartes", () => {
  const m = buildAbsences(input());
  it("quatre cartes : absentéisme (tuile principale du moteur, motifs retenus en une ligne), N-1, douze mois glissants, jours théoriques", () => {
    expect(m.nd).toBeNull();
    expect(m.tiles.map((t) => t.id)).toEqual(["absenteisme", "absenteisme-n1", "douze-mois", "jours-theoriques"]);
    const a = tile(m, "absenteisme");
    // 15 / 1 820 = 0,824… % → « 0,82 % » ; écart (15 − 19) / 1 820 × 100 = −0,219… point → « −0,22 pts ».
    expect(a).toMatchObject({ label: "Absentéisme", term: "absenteeism", sub: LABEL, value: { text: "0,82 %", kind: "value" }, note: "Motifs retenus : test_sickness", main: true });
    expect(a.variations).toEqual([{ label: "Écart", text: "−0,22 pts", reason: null, tone: "flat" }]);
    expect(a.cost).toBeUndefined();
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
    expect(m.charts).toHaveLength(1);
    const c = m.charts[0];
    expect(c).toMatchObject({ id: TABLE_IDS.mensuel, kind: "barres", unit: "bps", mode: "grouped", tableId: TABLE_IDS.mensuel, categories: ["juil.", "août", "sept."] });
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
    const s = m.charts[0].series[0];
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

describe("buildAbsences : motifs, tous motifs, congés (seuil de confidentialité : 3 personnes)", () => {
  const m = buildAbsences(input());

  it("tableau par motif : tous les motifs de la lecture, retenu oui / non, demi-journées et taux N et N-1, écart en points ; sous le seuil = n.d.", () => {
    const t = tableOf(m, TABLE_IDS.motifs);
    expect(t.columns.map((c) => c.header)).toEqual(["Motif", "Retenu dans l'absentéisme", `Demi-journées ${LABEL}`, `Taux ${LABEL}`, `Demi-journées ${PREV_LABEL}`, `Taux ${PREV_LABEL}`, "Écart (points)"]);
    expect(texts(t)).toEqual([
      // 5 et 4 personnes : affiché. 60/1 820 = 3,30 % ; 50/1 820 = 2,75 % ; écart 10/1 820 × 100 = 0,549… point.
      ["test_paid_leave", "non", "60", "3,30 %", "50", "2,75 %", "+0,55 pts"],
      // 1 personne en N : n.d. ; aucune personne en N-1 (rien à protéger) : 0 affiché ; écart n.d.
      ["test_rare", "non", "n.d.", "n.d.", "0", "0,00 %", "n.d."],
      // 3 personnes en N (= seuil) : affiché ; 2 personnes en N-1 : n.d.
      ["test_sickness", "oui", "15", "0,82 %", "n.d.", "n.d.", "n.d."],
      // Motif n.d. dans le moteur : sa raison, avant tout seuil.
      ["test_unread", "non", "n.d.", "n.d.", "0", "0,00 %", "n.d."],
    ]);
    expect(t.rows[1].cells[2]).toEqual({ nd: SOUS_SEUIL });
    expect(t.rows[1].cells[6]).toEqual({ nd: ECART_ND.valeur });
    expect(t.rows[2].cells[4]).toEqual({ nd: SOUS_SEUIL });
    expect(t.rows[2].cells[6]).toEqual({ nd: ECART_ND.n1 });
    expect(t.rows[3].cells[2]).toEqual({ nd: UNREAD });
    expect(t.rows[3].cells[6]).toEqual({ nd: ECART_ND.valeur });
  });

  it("« Taux d'absence, tous motifs » : tableau à part, jamais l'absentéisme ; non soumis au seuil", () => {
    const t = tableOf(m, TABLE_IDS.tousMotifs);
    expect(t.title).toBe("Taux d'absence, tous motifs");
    // 70/1 820 = 3,846… % ; 62/1 820 = 3,406… % ; écart 8/1 820 × 100 = 0,439… point.
    expect(texts(t)).toEqual([["Taux d'absence, tous motifs", "70", "3,85 %", "62", "3,41 %", "+0,44 pts"]]);
    expect(m.blocks.find((b) => b.id === "tous-motifs")!.tables).toEqual([TABLE_IDS.tousMotifs]);
    expect(t.title.toLowerCase()).not.toContain("absentéisme");
  });

  it("jours pris par motif et par mois : demi-journées → jours, seuil par cellule, N-1 et écart en jours", () => {
    const t = tableOf(m, TABLE_IDS.conges);
    expect(t.columns.map((c) => c.header)).toEqual(["Motif", "Juil. 2026", "Août 2026", "Sept. 2026", `Période (${LABEL})`, `N-1 (${PREV_LABEL})`, "Écart"]);
    expect(texts(t)).toEqual([
      // 20 demi-journées = 10 j (3 personnes) ; 30 = 15 j ; 10 demi-journées pour 1 personne : n.d. ; 60 = 30 j, 50 = 25 j, écart +5 j.
      ["test_paid_leave", "10 j", "15 j", "n.d.", "30 j", "25 j", "+5 j"],
      ["test_rare", "0 j", "n.d.", "0 j", "n.d.", "0 j", "n.d."],
      ["test_sickness", "n.d.", "0 j", "n.d.", "7,5 j", "n.d.", "n.d."],
      ["test_unread", "0 j", "n.d.", "0 j", "n.d.", "0 j", "n.d."],
    ]);
    expect(t.rows[0].cells[3]).toEqual({ nd: SOUS_SEUIL });
    expect(t.rows[2].cells[6]).toEqual({ nd: ECART_ND.n1 });
    expect(t.rows[3].cells[2]).toEqual({ nd: UNREAD });
    // Aucun classement « congé payé / RTT / repos » : les motifs de la source, tels quels.
    expect(JSON.stringify(t)).not.toMatch(/RTT|congés payés|Repos/);
  });

  it("congés posés et demandes en attente : jours par mois lu, sans nom ; jours non rattachés en « Prévu »", () => {
    const t = tableOf(m, TABLE_IDS.aVenir);
    expect(t.title).toBe("Congés posés et demandes en attente après septembre 2026");
    expect(texts(t)).toEqual([
      ["test_paid_leave", "Posé (statut retenu)", "6 j", "6 j"],
      ["test_paid_leave", "En attente d'approbation", "n.d.", "n.d."],
    ]);
    const b = m.blocks.find((x) => x.id === "a-venir")!;
    expect(b.prevu).toEqual([{ id: "absences-non-rattachees", label: "Jours posés ou en attente hors des mois lus", reason: "2 absences dont tout ou partie des jours ne se rattache à aucun mois lu (date absente, mois non lu ou contrat inconnu)" }]);
  });

  it("à venir sans aucune absence : un tableau sans ligne et la phrase qui le dit (jamais un zéro inventé) ; à venir n.d. : la raison", () => {
    const empty = buildAbsences(input({}, { aVenir: { kind: "value", after: "2026-09", months: ["2026-10"], lines: [], nonRattachees: 0 } }));
    const t = tableOf(empty, TABLE_IDS.aVenir);
    expect(t.rows).toEqual([]);
    expect(t.notes).toEqual(["Aucun congé posé ni demande en attente dans les mois lus après septembre 2026."]);
    expect(empty.blocks.find((x) => x.id === "a-venir")!.prevu).toEqual([]);
    const nd = buildAbsences(input({}, { aVenir: { kind: "nd", reason: "aucun mois lu après 2026-09 (mois lus : 2024-10 → 2026-09)" } }));
    expect(nd.blocks.find((x) => x.id === "a-venir")!.nd).toEqual([{ reason: "aucun mois lu après 2026-09 (mois lus : 2024-10 → 2026-09)" }]);
    expect(tableOf(nd, TABLE_IDS.aVenir).rows[0].cells[1]).toEqual({ nd: "aucun mois lu après 2026-09 (mois lus : 2024-10 → 2026-09)" });
  });

  it("statistiques d'arrêts et soldes : « Prévu » avec la raison de la matrice, aucun chiffre", () => {
    const b = m.blocks.find((x) => x.id === "non-disponibles")!;
    expect(b.prevu.map((x) => [x.id, x.label, x.reason])).toEqual([
      [PREVU_ARRETS.id, "Statistiques d'arrêts sur douze mois glissants", "règle de regroupement de deux arrêts et durée d'un arrêt court non paramétrées"],
      [PREVU_SOLDES.id, "Soldes de congés et de RTT en jours", "non restitués par l'API PayFit ni par la DSN ; leur valeur en euros figure dans la provision de congés payés"],
    ]);
    expect(b.prevu[1].link).toEqual({ href: LINKS.paieCompta, label: "Paie & comptabilité" });
  });
});

describe("buildAbsences : seuil de confidentialité non défini ou illisible (addendum C)", () => {
  for (const [name, settings, reason] of [
    ["absent", settingsOf(), "seuil de confidentialité non défini (Paramètres)"],
    ["illisible", settingsOf("3"), "seuil de confidentialité illisible : à ré-enregistrer (Paramètres)"],
  ] as const) {
    it(`réglage ${name} : tableau par motif, congés pris et congés à venir n.d. avec la raison et le lien Paramètres ; la tuile principale et le taux tous motifs restent`, () => {
      const m = buildAbsences(input({ settings }));
      for (const [id, table] of [
        ["motifs", TABLE_IDS.motifs],
        ["conges", TABLE_IDS.conges],
        ["a-venir", TABLE_IDS.aVenir],
      ] as const) {
        const b = m.blocks.find((x) => x.id === id)!;
        expect(b.nd).toEqual([{ reason, action: { href: LINKS.parametres, label: "Paramètres" } }]);
        expect(b.tables).toEqual([]);
        // Forme exportable : une ligne, la raison ; aucune valeur du motif.
        const t = tableOf(m, table);
        expect(t.rows).toHaveLength(1);
        expect(t.rows[0].cells[1]).toEqual({ nd: reason });
      }
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

describe("aides : seuil, écart de jours, glossaire", () => {
  it("masked : moins de personnes que le seuil ⇒ n.d. ; aucune personne ⇒ valeur gardée ; personnes inconnues ⇒ n.d.", () => {
    expect(masked(v(10, 2), 3)).toEqual({ kind: "nd", reason: SOUS_SEUIL });
    expect(masked(v(10, 3), 3)).toEqual(v(10, 3));
    expect(masked(v(0, 0), 3)).toEqual(v(0, 0));
    expect(masked({ kind: "lower_bound", half: 4, persons: 1 }, 1)).toEqual({ kind: "lower_bound", half: 4, persons: 1 });
    expect(masked(ndc("raison du moteur"), 3)).toEqual(ndc("raison du moteur"));
    expect(masked(undefined, 3)).toEqual({ kind: "nd", reason: SEUIL_NON_VERIFIABLE });
  });
  it("dayGapCell : écart en jours entre deux totaux exacts ; n.d. dès qu'un côté n'est pas exact", () => {
    expect(sp(dayGapCell(v(9, 4), v(4, 4)))).toBe("+2,5 j");
    expect(sp(dayGapCell(v(4, 4), v(9, 4)))).toBe("−2,5 j");
    expect(sp(dayGapCell(v(4, 4), v(4, 4)))).toBe("0 j");
    expect(dayGapCell(ndc("a"), v(4, 4))).toEqual({ nd: ECART_ND.valeur });
    expect(dayGapCell(v(4, 4), ndc("b"))).toEqual({ nd: ECART_ND.n1 });
    expect(dayGapCell({ kind: "lower_bound", half: 4, persons: 4 }, v(4, 4))).toEqual({ nd: ECART_ND.borne });
    expect(dayGapCell(v(4, 4), { kind: "lower_bound", half: 4, persons: 4 })).toEqual({ nd: ECART_ND.n1Borne });
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
    const ids = new Set([...ABSENCES_TERMS, ...m.tiles.map((t) => t.term!), ...m.blocks.flatMap((b) => (b.term ? [b.term] : [])), ...m.tables.flatMap((t) => [...(t.terms ?? []), ...t.columns.flatMap((c) => (c.term ? [c.term] : []))])]);
    for (const id of ids) expect(glossaryEntry(id), id).toBeDefined();
  });
});

describe("AbsencesView : rendu du modèle", () => {
  const m = buildAbsences(input());
  it("« Afficher tout » : cartes, graphique et tableaux, identifiants de test, ancres de bloc, « Prévu » ; aucune couleur de tendance", () => {
    const out = render(m);
    for (const id of ["absenteisme", "absenteisme-n1", "douze-mois", "jours-theoriques"]) expect(out).toContain(`data-testid="cx-tile-absences-${id}"`);
    for (const id of Object.values(TABLE_IDS)) expect(out).toContain(`data-testid="cx-table-${id}"`);
    expect(out).toContain(`data-testid="cx-chart-${TABLE_IDS.mensuel}"`);
    for (const id of ["cartes", "mensuel", "motifs", "tous-motifs", "conges", "a-venir", "non-disponibles"]) expect(out).toContain(`id="cx-absences-${id}"`);
    for (const id of [PREVU_ARRETS.id, PREVU_SOLDES.id, "absences-non-rattachees"]) expect(out).toContain(`data-testid="cx-prevu-${id}"`);
    expect(out).toContain("Motifs retenus : test_sickness");
    expect(out).toContain("Taux d'absence, tous motifs");
    expect(out).toContain('data-testid="cx-absences-limites"');
    expect(out).not.toMatch(/trend-(bad|good)/);
  });
  it("« Graphiques » : cartes et graphique, lien vers le tableau exact, aucun tableau", () => {
    const out = render(m, "graphique");
    expect(out).toContain(`data-testid="cx-chart-${TABLE_IDS.mensuel}"`);
    expect(out).toContain(`href="${LINKS.tableau}#cx-table-${TABLE_IDS.mensuel}"`);
    expect(out).not.toContain('data-testid="cx-table-');
    expect(out).not.toContain('id="cx-absences-motifs"');
  });
  it("« Tableaux » : cartes et tableaux, sans graphique", () => {
    const out = render(m, "tableau");
    expect(out).not.toContain(`data-testid="cx-chart-${TABLE_IDS.mensuel}"`);
    expect(out).toContain(`data-testid="cx-table-${TABLE_IDS.mensuel}"`);
  });
  it("seuil non défini : la raison écrite et le lien vers les Paramètres", () => {
    const out = render(buildAbsences(input({ settings: settingsOf() })));
    expect(out).toContain('data-testid="cx-absences-motifs-nd"');
    expect(out).toContain("seuil de confidentialité non défini (Paramètres)");
    expect(out).toContain(`href="${LINKS.parametres}"`);
  });
  it("chapitre n.d. : un seul état n.d. avec la raison et l'action", () => {
    const out = render(buildAbsences(input({ nd: { reason: "aucune source RH retenue", action: { href: LINKS.donnees, label: "Données" } }, data: null })));
    expect(out).toContain('data-testid="cx-absences-nd"');
    expect(out).toContain("Aucune source RH retenue");
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
  return {
    slug: "demo",
    canEdit: false,
    period: o.period === false ? null : { year: Number(months[0].slice(0, 4)), from: months[0].slice(5), to: months[months.length - 1].slice(5), years: [], last: "", months, notices: [] },
    periodNd: o.period === false ? "Aucun mois clos à la date de référence" : null,
    prevMonths: months.map((m) => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`),
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

  it("cartes, graphique et son tableau, motifs, congés et congés à venir ; aucun nom ni identifiant dans le modèle", async () => {
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
    // Seuil 3 : chaque motif touche une ou deux personnes ⇒ n.d. ; le taux tous motifs, non soumis au seuil, reste.
    const motifs = texts(tableOf(m, TABLE_IDS.motifs));
    expect(motifs.map((r) => r.slice(0, 4))).toEqual([
      ["test_paid_leave", "non", "n.d.", "n.d."],
      ["test_sickness", "oui", "n.d.", "n.d."],
    ]);
    // Tous motifs : congés C-1 (10) + C-2 (4) + maladie C-3 (4) = 18 demi-journées sur 366 = 4,918… %.
    expect(texts(tableOf(m, TABLE_IDS.tousMotifs))[0].slice(1, 3)).toEqual(["18", "4,92 %"]);
    // À venir : octobre 2026 lu, après septembre (dernier mois clos) ; b1 posé (1 personne) ⇒ n.d. sous le seuil.
    expect(texts(tableOf(m, TABLE_IDS.aVenir))).toEqual([["test_paid_leave", "Posé (statut retenu)", "n.d.", "n.d."]]);
    const json = JSON.stringify(m);
    for (const x of ["C-1", "C-2", "C-3", "P-1", "P-2", "P-3", "a1", "b1"]) expect(json.includes(`"${x}"`), x).toBe(false);
  });

  it("seuil d'une personne : les congés du motif s'affichent (avril 5 + 2 j = 7 j, deux personnes)", async () => {
    const m = buildAbsences(await loadAbsencesInput(fakeCtx(fakeKpi(kin), ["2026-04", "2026-05"], { settings: settingsOf(1) })));
    expect(texts(tableOf(m, TABLE_IDS.conges))[0].slice(0, 4)).toEqual(["test_paid_leave", "7 j", "0 j", "7 j"]);
    expect(texts(tableOf(m, TABLE_IDS.aVenir))).toEqual([["test_paid_leave", "Posé (statut retenu)", "5 j", "5 j"]]);
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
