import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { congesAVenir, congesPris, type AVenirStatut, type CongeCell, type CongesAVenir, type CongesPris } from "@/lib/croisee/conges";
import { croiseeSettingReason, croiseeSettingsHref, settingValue, type CroiseeSettings } from "@/lib/croisee-settings";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { absenteeism, absenteeismMonth, theoreticalWindow } from "@/lib/rh/kpi/absence";
import { ABSENCE_ALL_MOTIFS_LABEL, absenceByMotif } from "@/lib/rh/kpi/absence-motifs";
import { compareWindows, delta } from "@/lib/rh/kpi/compare";
import { kpiDashboard } from "@/lib/rh/kpi/dashboard";
import { fmtHalfDays, fmtPercent } from "@/lib/rh/kpi/format";
import { lastClosedMonth, rollingWindow } from "@/lib/rh/kpi/period";
import { kpiNd, type Delta, type Kind, type KpiNd, type Ratio } from "@/lib/rh/kpi/types";
import { KPI_KEYS } from "@/lib/rh-kpi-settings";
import { plainVariation, type ChapterModel, type CroiseeCell, type CroiseeChart, type CroiseeColumn, type CroiseeTable, type TileSpec } from "@/lib/viz/croisee";
import { absenceTypeText, absenteeismSeries, monthAxis, monthLongLabel, motifsRetenusLine, ratioBps, type RowIn } from "@/lib/viz/kpi";
import { capital, COLORS, monthShortYear } from "@/lib/viz/masse";
import { deltaView, kpiRefusal, nd as ndTile, periodLabel, rateTile, windowOf, type TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée, chapitre 03 · Absences & congés. buildAbsences est une fonction PURE : elle met en forme des résultats déjà
// calculés par le moteur des KPI RH (absentéisme, jours théoriques, absentéisme par motif, tableau de bord) et par les fonctions pures
// du chapitre (src/lib/croisee/conges.ts : congés pris par motif et par mois, congés posés et demandes en attente). L'écran, le CSV et
// l'Excel partent du même modèle. loadAbsencesInput lit les sources par les lecteurs du contexte et appelle ces fonctions : aucun
// nouveau moteur. Un n.d. reste n.d. (raison écrite) jusqu'au tableau et au graphique ; aucun nom de personne.
//
// Tuile principale : l'absentéisme du moteur (motifs retenus dans Paramètres › Définitions des KPI). Tous les motifs de la lecture
// restent dans le détail, et le « Taux d'absence, tous motifs » est un tableau à part, jamais présenté comme l'absentéisme.
// Seuil de confidentialité (rh.croisee.confidentialite) : le tableau par motif et les congés par motif sont des données de santé
// potentielles ; une cellule dont le nombre de personnes concernées est inférieur au seuil est n.d. ; sans seuil défini, ces blocs sont
// n.d. avec la raison et le lien vers les Paramètres.

// --- Entrée ------------------------------------------------------------------------------------------------------------------------

export type Action = { href: string; label: string };
export type BlockNd = { label?: string; reason: string; action?: Action };

// Formes minimales des résultats du moteur (les types du moteur y sont assignables).
type NdK = { kind: "nd"; nd: KpiNd };
export type RateK = { kind: Kind; ratio: Ratio } | NdK; // absentéisme d'un mois ou d'une période
export type HalfK = { kind: "exact"; half: number } | NdK; // jours théoriques, en demi-journées
export type MotifLineK = { type: string; chosen: boolean } & ({ kind: Kind; half: number; ratio: Ratio } | { kind: "nd"; half: null; ratio: null; nd: KpiNd });
export type MotifsK = { label: string; lines: MotifLineK[]; all: RateK; emptyReason: string | null };
// Ligne du tableau de bord des KPI (kpiDashboard) : absentéisme du mois, du même mois un an plus tôt, jours théoriques du mois.
export type AbsRow = RowIn & { absenteeism: RateK; previous: RowIn["previous"] & { absenteeism: RateK }; theoretical: HalfK };

export type AbsencesData = {
  source: "payfit" | "dsn";
  absenceTypes: string[]; // motifs retenus (Paramètres › Définitions des KPI)
  rows: AbsRow[]; // mois de la période
  period: { current: RateK; previous: RateK }; // absentéisme de la période et des mêmes mois un an plus tôt
  theoretical: { current: HalfK; previous: HalfK };
  // Douze mois glissants à fin de période, et les douze mois qui précèdent d'un an (N-1) ; months : absentéisme de chaque mois.
  rolling: { from: string; to: string; prevFrom: string; prevTo: string; current: RateK; previous: RateK; months: RateK[] };
  motifs: { current: MotifsK; previous: MotifsK }; // absenceByMotif, période et N-1
  conges: { current: CongesPris; previous: CongesPris };
  aVenir: CongesAVenir;
};

export type AbsencesInput = {
  links: { parametres: string; parametresKpi: string; donnees: string; tableau: string; paieCompta: string };
  period: { months: string[]; prevMonths: string[] } | null;
  service: { value: string | null | undefined; label: string }; // value undefined : tous les services
  settings: CroiseeSettings;
  nd: BlockNd | null; // chapitre entier non calculable (période, source RH, paramètres des KPI)
  data: AbsencesData | null; // null avec un service retenu : le référentiel RH n'est pas ventilé par service
};

// --- Modèle ------------------------------------------------------------------------------------------------------------------------

export type AbsencesBlockId = "cartes" | "mensuel" | "motifs" | "tous-motifs" | "conges" | "a-venir" | "non-disponibles";
export type PrevuItem = { id: string; label: string; reason: string; link?: Action };
// Un bloc de l'écran : ses graphiques et tableaux (identifiants dans model.charts / model.tables), ses n.d. et ses mentions « Prévu ».
// Un tableau de model.tables absent de tous les blocs est la forme exportable d'un bloc n.d. (une ligne, sa raison).
export type AbsencesBlock = { id: AbsencesBlockId; title: string; term?: string; graph?: boolean; nd: BlockNd[]; charts: string[]; tables: string[]; prevu: PrevuItem[] };
export type AbsencesModel = ChapterModel & { blocks: AbsencesBlock[] };

export const NON_FILTRABLE = "non filtrable par service";
export const SOUS_SEUIL = "sous le seuil de confidentialité";
export const SEUIL_NON_VERIFIABLE = "personnes concernées non dénombrées : seuil de confidentialité non vérifiable";

// Indicateurs du rapport d'origine que Clair ne calcule pas : « Prévu », avec la raison de la matrice (aucune valeur reconstituée).
export const PREVU_ARRETS: Omit<PrevuItem, "link"> = {
  id: "absences-arrets",
  label: "Statistiques d'arrêts sur douze mois glissants",
  reason: "règle de regroupement de deux arrêts et durée d'un arrêt court non paramétrées",
};
export const PREVU_SOLDES: Omit<PrevuItem, "link"> = {
  id: "absences-soldes",
  label: "Soldes de congés et de RTT en jours",
  reason: "non restitués par l'API PayFit ni par la DSN ; leur valeur en euros figure dans la provision de congés payés",
};

const TERMS = {
  absenteisme: "absenteeism",
  motifsRetenus: "kpi-types-absence",
  parMotif: "absence-par-motif",
  tousMotifs: "absence-all-motifs",
  nMoinsUn: T.nMoinsUn,
} as const;
export const ABSENCES_TERMS: string[] = [TERMS.absenteisme, TERMS.motifsRetenus, TERMS.parMotif, TERMS.tousMotifs, TERMS.nMoinsUn, T.congesPris, T.confidentialite, T.arrets, T.prevu];

export const TABLE_IDS = {
  mensuel: "absences-mensuel",
  motifs: "absences-motifs",
  tousMotifs: "absences-tous-motifs",
  conges: "absences-conges-pris",
  aVenir: "absences-conges-a-venir",
} as const;

// --- Petites mises en forme (aucun calcul) -----------------------------------------------------------------------------------------

const nf = new Intl.NumberFormat("fr-FR");
const fin = (m: string) => monthLongLabel(m);

// Cellules : un n.d. reste { nd: raison } ; une borne basse s'écrit « ≥ x » (jamais une valeur exacte) ; zéro seulement s'il est réel.
const rateCell = (r: RateK): CroiseeCell =>
  r.kind === "nd" ? { nd: r.nd.reason } : r.ratio.den <= 0 ? { nd: "dénominateur nul : taux non défini" } : r.kind === "lower_bound" ? `≥ ${fmtPercent(r.ratio)}` : { exact: r.ratio.num / r.ratio.den };
const halfOfRate = (r: RateK): CroiseeCell => (r.kind === "nd" ? { nd: r.nd.reason } : r.kind === "lower_bound" ? `≥ ${nf.format(r.ratio.num)}` : r.ratio.num);
const halfCell = (h: HalfK): CroiseeCell => (h.kind === "nd" ? { nd: h.nd.reason } : h.half);
// Raisons courtes d'un écart non calculé : la raison détaillée est déjà celle de la cellule n.d. voisine (jamais répétée mois par mois).
export const ECART_ND = {
  valeur: "valeur n.d. : écart non calculable",
  n1: "N-1 n.d. : écart non calculable",
  borne: "valeur en borne basse (« ≥ ») : écart non calculable",
  n1Borne: "N-1 en borne basse (« ≥ ») : écart non calculable",
} as const;
// Écart en points entre deux taux exacts, calculé par le moteur (delta) ; fraction d'un pourcentage dans la cellule (0,25 point → 0,0025),
// « +0,25 pts » à l'écran. n.d. dès que l'un des deux taux n'est pas exact.
export function rateGap(cur: RateK, prev: RateK): CroiseeCell {
  if (cur.kind === "nd") return { nd: ECART_ND.valeur };
  if (prev.kind === "nd") return { nd: ECART_ND.n1 };
  if (cur.kind === "lower_bound") return { nd: ECART_ND.borne };
  if (prev.kind === "lower_bound") return { nd: ECART_ND.n1Borne };
  const d: Delta = delta(cur, prev, (x) => x.ratio, "points", "N-1");
  return d.kind === "nd" ? { nd: d.nd.reason } : { exact: d.value.num / (d.value.den * 100) };
}
const lineRate = (l: MotifLineK): RateK => (l.kind === "nd" ? { kind: "nd", nd: l.nd } : { kind: l.kind, ratio: l.ratio });

// Jours (demi-journées ÷ 2), écrits « 3,5 j » : une demi-journée n'est jamais arrondie.
export const daysText = (half: number): string => fmtHalfDays(half);
const dayCell = (c: CongeCell): CroiseeCell => (c.kind === "nd" ? { nd: c.reason } : c.kind === "lower_bound" ? `≥ ${daysText(c.half)}` : daysText(c.half));
// Écart de jours entre deux totaux exacts (période − N-1) ; n.d. dès que l'un des deux n'est pas exact.
export function dayGapCell(cur: CongeCell, prev: CongeCell): CroiseeCell {
  if (cur.kind === "nd") return { nd: ECART_ND.valeur };
  if (prev.kind === "nd") return { nd: ECART_ND.n1 };
  if (cur.kind === "lower_bound") return { nd: ECART_ND.borne };
  if (prev.kind === "lower_bound") return { nd: ECART_ND.n1Borne };
  const d = cur.half - prev.half;
  return d === 0 ? fmtHalfDays(0) : `${d > 0 ? "+" : "−"}${fmtHalfDays(Math.abs(d))}`;
}

// Seuil de confidentialité appliqué à une cellule de congés : moins de personnes concernées que le seuil ⇒ n.d. (aucune personne
// concernée : rien à protéger, la valeur reste). Le n.d. du moteur garde sa raison.
export function masked(c: CongeCell | undefined, seuil: number): CongeCell {
  if (!c) return { kind: "nd", reason: SEUIL_NON_VERIFIABLE };
  if (c.kind === "nd") return c;
  return c.persons > 0 && c.persons < seuil ? { kind: "nd", reason: SOUS_SEUIL } : c;
}

const bpsOf = (r: RateK): number | null => (r.kind === "exact" && r.ratio.den > 0 ? ratioBps(r.ratio) : null);
const halfTile = (h: HalfK): TileValue => (h.kind === "nd" ? ndTile(h.nd.reason) : { text: fmtHalfDays(h.half), kind: "value", reason: null });
const absText = (r: RateK): { text: string | null; reason: string | null } =>
  r.kind === "nd" ? { text: null, reason: r.nd.reason } : { text: `${r.kind === "lower_bound" ? "≥ " : ""}${fmtHalfDays(r.ratio.num)}`, reason: null };
const tileText = (v: TileValue): { text: string | null; reason: string | null } => (v.kind === "nd" ? { text: null, reason: v.reason } : { text: v.text, reason: null });

const text = (key: string, header: string, extra: Partial<CroiseeColumn> = {}): CroiseeColumn => ({ key, header, kind: "text", ...extra });
const num = (key: string, header: string, extra: Partial<CroiseeColumn> = {}): CroiseeColumn => ({ key, header, kind: "nombre", ...extra });
const pct = (key: string, header: string, extra: Partial<CroiseeColumn> = {}): CroiseeColumn => ({ key, header, kind: "pourcent", ...extra });
const points = (key: string, header: string): CroiseeColumn => ({ key, header, kind: "pourcent", points: true, signed: true });

// Forme exportable d'un bloc n.d. : une ligne, la raison (jamais un tableau vide qui se lirait comme « aucun »).
export function ndTable(id: string, title: string, reason: string): CroiseeTable {
  return { id, title, columns: [text("bloc", "Bloc"), text("valeur", "Valeur")], rows: [{ cells: [title, { nd: reason }] }] };
}

export const statutLabel = (s: AVenirStatut): string => (s === "pose" ? "Posé (statut retenu)" : "En attente d'approbation");

// --- Construction du modèle -------------------------------------------------------------------------------------------------------

export function buildAbsences(input: AbsencesInput): AbsencesModel {
  const empty: AbsencesModel = { chapter: "absences", tiles: [], alerts: [], tables: [], charts: [], limits: [], nd: null, terms: ABSENCES_TERMS, blocks: [] };
  const p = input.period;
  const filtered = input.service.value !== undefined;
  const d = input.data;
  if (input.nd || !p || p.months.length === 0 || (!filtered && !d)) {
    const nd = input.nd ?? { reason: p && p.months.length ? "référentiel RH non construit" : "aucun mois disponible", action: { href: input.links.donnees, label: "Données" } };
    return { ...empty, nd: { reason: nd.reason, action: nd.action } };
  }
  const { months, prevMonths } = p;
  const label = periodLabel(months);
  const prevLabel = periodLabel(prevMonths);
  const tiles: TileSpec[] = [];
  const tables: CroiseeTable[] = [];
  const charts: CroiseeChart[] = [];
  const blocks: AbsencesBlock[] = [];
  const block = (b: Partial<AbsencesBlock> & Pick<AbsencesBlock, "id" | "title">): AbsencesBlock => {
    const out: AbsencesBlock = { nd: [], charts: [], tables: [], prevu: [], ...b };
    blocks.push(out);
    return out;
  };
  // Bloc n.d. : la raison (avec son action) et la forme exportable du tableau qu'il aurait porté.
  const ndBlock = (id: AbsencesBlockId, title: string, tableId: string, nd: BlockNd, extra: Partial<AbsencesBlock> = {}) => {
    tables.push(ndTable(tableId, title, nd.reason));
    return block({ id, title, ...extra, nd: [nd] });
  };

  // --- Cartes
  const titles = { cur: "Absentéisme", prev: "Absentéisme N-1", roll: "Absentéisme, douze mois glissants", th: "Jours théoriques" };
  if (filtered || !d) {
    tiles.push(
      { id: "absenteisme", label: titles.cur, term: TERMS.absenteisme, sub: label, value: ndTile(NON_FILTRABLE) },
      { id: "absenteisme-n1", label: titles.prev, term: TERMS.nMoinsUn, sub: prevLabel, value: ndTile(NON_FILTRABLE) },
      { id: "douze-mois", label: titles.roll, term: TERMS.absenteisme, value: ndTile(NON_FILTRABLE) },
      { id: "jours-theoriques", label: titles.th, term: TERMS.absenteisme, sub: label, value: ndTile(NON_FILTRABLE) },
    );
    block({ id: "cartes", title: "Absentéisme" });
    const graphNd = { reason: NON_FILTRABLE };
    ndBlock("mensuel", "Absentéisme par mois", TABLE_IDS.mensuel, graphNd, { term: TERMS.absenteisme, graph: true });
    ndBlock("motifs", "Absences par motif", TABLE_IDS.motifs, graphNd, { term: TERMS.parMotif });
    ndBlock("tous-motifs", ABSENCE_ALL_MOTIFS_LABEL, TABLE_IDS.tousMotifs, graphNd, { term: TERMS.tousMotifs });
    ndBlock("conges", "Jours pris par motif et par mois", TABLE_IDS.conges, graphNd, { term: T.congesPris });
    ndBlock("a-venir", "Congés posés et demandes en attente", TABLE_IDS.aVenir, graphNd, { term: T.congesPris });
    block({ id: "non-disponibles", title: "Indicateurs non disponibles", term: T.prevu, prevu: prevuItems(input) });
    return { ...empty, tiles, tables, blocks, limits: limitsOf(null) };
  }

  const cur = d.period.current;
  const prev = d.period.previous;
  const dPeriod = delta(cur, prev, (x) => x.ratio, "points", prevLabel);
  const dv = deltaView(dPeriod);
  tiles.push({
    id: "absenteisme",
    label: titles.cur,
    term: TERMS.absenteisme,
    sub: label,
    value: rateTile(cur),
    variations: [plainVariation("Écart", dv.text, dv.reason)],
    note: motifsRetenusLine(d.absenceTypes),
    spark: { label: "Absentéisme par mois, douze mois glissants", values: d.rolling.months.map(bpsOf) },
    main: true,
  });
  tiles.push({ id: "absenteisme-n1", label: titles.prev, term: TERMS.nMoinsUn, sub: prevLabel, value: rateTile(prev) });
  const r = d.rolling;
  const dRoll = deltaView(delta(r.current, r.previous, (x) => x.ratio, "points", `${fin(r.prevFrom)} → ${fin(r.prevTo)}`));
  const rp = tileText(rateTile(r.previous));
  tiles.push({
    id: "douze-mois",
    label: titles.roll,
    term: TERMS.absenteisme,
    sub: `${fin(r.from)} → ${fin(r.to)}`,
    value: rateTile(r.current),
    variations: [plainVariation("N-1", rp.text, rp.reason), plainVariation("Écart", dRoll.text, dRoll.reason)],
  });
  const abs = absText(cur);
  const thPrev = tileText(halfTile(d.theoretical.previous));
  tiles.push({
    id: "jours-theoriques",
    label: titles.th,
    term: TERMS.absenteisme,
    sub: label,
    value: halfTile(d.theoretical.current),
    variations: [plainVariation("Jours d'absence (motifs retenus)", abs.text, abs.reason), plainVariation("N-1", thPrev.text, thPrev.reason)],
  });
  const cartes = block({ id: "cartes", title: "Absentéisme" });
  if (d.absenceTypes.length === 0) cartes.nd.push({ label: "Absentéisme", reason: "motifs d'absence non choisis (Paramètres › Définitions des KPI)", action: { href: input.links.parametresKpi, label: "Paramètres" } });

  // --- Absentéisme par mois : graphique (barres groupées N et N-1) et son tableau exact
  const axis = monthAxis(months, prevMonths);
  const series = absenteeismSeries(d.rows).map((s, i) => ({ ...s, color: i === 0 ? COLORS.now : COLORS.before }));
  charts.push({ id: TABLE_IDS.mensuel, title: "Absentéisme par mois", kind: "barres", unit: "bps", categories: axis.categories, categoryTitles: axis.titles, series, mode: "grouped", tableId: TABLE_IDS.mensuel });
  tables.push({
    id: TABLE_IDS.mensuel,
    title: "Absentéisme par mois",
    columns: [
      text("mois", "Mois"),
      pct("taux", "Absentéisme", { term: TERMS.absenteisme }),
      num("absence", "Demi-journées d'absence"),
      num("theoriques", "Demi-journées théoriques"),
      pct("taux-n1", "Absentéisme N-1", { term: TERMS.nMoinsUn }),
      points("ecart", "Écart (points)"),
    ],
    rows: d.rows.map((row) => ({
      cells: [
        capital(monthLongLabel(row.month)),
        rateCell(row.absenteeism),
        halfOfRate(row.absenteeism),
        halfCell(row.theoretical),
        rateCell(row.previous.absenteeism),
        rateGap(row.absenteeism, row.previous.absenteeism),
      ],
    })),
    foot: { cells: [`Période (${label})`, rateCell(cur), halfOfRate(cur), halfCell(d.theoretical.current), rateCell(prev), rateGap(cur, prev)] },
    terms: [TERMS.absenteisme, TERMS.motifsRetenus, TERMS.nMoinsUn],
  });
  block({ id: "mensuel", title: "Absentéisme par mois", term: TERMS.absenteisme, graph: true, charts: [TABLE_IDS.mensuel] });

  // --- Seuil de confidentialité : réglage de la Masse salariale croisée, sans valeur par défaut (absent ou illisible : n.d.).
  const s = input.settings.confidentialite;
  const seuil = settingValue(s);
  const seuilNd: BlockNd = { reason: croiseeSettingReason("confidentialite", s) ?? "seuil de confidentialité non défini (Paramètres)", action: { href: input.links.parametres, label: "Paramètres" } };

  // --- Absences par motif (tous les motifs de la lecture, retenus ou non ; N-1 par un second appel du moteur)
  const mTitle = "Absences par motif";
  const mc = d.motifs.current;
  const mp = d.motifs.previous;
  if (seuil === null) ndBlock("motifs", mTitle, TABLE_IDS.motifs, seuilNd, { term: TERMS.parMotif });
  else if (mc.lines.length === 0) ndBlock("motifs", mTitle, TABLE_IDS.motifs, { reason: mc.emptyReason ?? "aucun motif dans la lecture" }, { term: TERMS.parMotif });
  else {
    const persons = (c: CongesPris, type: string) => c.lines.find((l) => l.type === type)?.total;
    // Un côté du tableau (période ou N-1) : le taux du moteur, ou n.d. (raison du moteur, motif absent, ou sous le seuil).
    const side = (l: MotifLineK | undefined, who: CongeCell | undefined): { half: CroiseeCell; rate: CroiseeCell; gap: RateK } => {
      const nd = (reason: string) => ({ half: { nd: reason }, rate: { nd: reason }, gap: { kind: "nd", nd: kpiNd("month-nd", reason) } as RateK });
      if (!l) return nd("motif absent de la lecture");
      const rk = lineRate(l);
      if (rk.kind === "nd") return nd(rk.nd.reason);
      const m = masked(who, seuil);
      if (m.kind === "nd") return nd(m.reason);
      return { half: halfOfRate(rk), rate: rateCell(rk), gap: rk };
    };
    tables.push({
      id: TABLE_IDS.motifs,
      title: mTitle,
      columns: [
        text("motif", "Motif"),
        text("retenu", "Retenu dans l'absentéisme", { term: TERMS.motifsRetenus }),
        num("demi-journees", `Demi-journées ${label}`),
        pct("taux", `Taux ${label}`),
        num("demi-journees-n1", `Demi-journées ${prevLabel}`),
        pct("taux-n1", `Taux ${prevLabel}`),
        points("ecart", "Écart (points)"),
      ],
      rows: mc.lines.map((l) => {
        const a = side(l, persons(d.conges.current, l.type));
        const b = side(
          mp.lines.find((x) => x.type === l.type),
          persons(d.conges.previous, l.type),
        );
        return { cells: [absenceTypeText(l.type), l.chosen ? "oui" : "non", a.half, a.rate, b.half, b.rate, rateGap(a.gap, b.gap)] };
      }),
      terms: [TERMS.parMotif, TERMS.motifsRetenus, T.confidentialite],
    });
    block({ id: "motifs", title: mTitle, term: TERMS.parMotif, tables: [TABLE_IDS.motifs] });
  }

  // --- Taux d'absence, tous motifs : un autre calcul que l'absentéisme, à part (non soumis au seuil : entreprise entière)
  const all = mc.all;
  const allPrev = mp.all;
  tables.push({
    id: TABLE_IDS.tousMotifs,
    title: ABSENCE_ALL_MOTIFS_LABEL,
    columns: [text("indicateur", "Indicateur"), num("demi-journees", `Demi-journées ${label}`), pct("taux", `Taux ${label}`), num("demi-journees-n1", `Demi-journées ${prevLabel}`), pct("taux-n1", `Taux ${prevLabel}`), points("ecart", "Écart (points)")],
    rows: [{ cells: [ABSENCE_ALL_MOTIFS_LABEL, halfOfRate(all), rateCell(all), halfOfRate(allPrev), rateCell(allPrev), rateGap(all, allPrev)] }],
    terms: [TERMS.tousMotifs],
  });
  block({ id: "tous-motifs", title: ABSENCE_ALL_MOTIFS_LABEL, term: TERMS.tousMotifs, tables: [TABLE_IDS.tousMotifs] });

  // --- Jours pris par motif et par mois (congés compris : aucun motif n'est classé par son nom)
  const cTitle = "Jours pris par motif et par mois";
  const cc = d.conges.current;
  if (seuil === null) ndBlock("conges", cTitle, TABLE_IDS.conges, seuilNd, { term: T.congesPris });
  else if (cc.lines.length === 0) ndBlock("conges", cTitle, TABLE_IDS.conges, { reason: cc.emptyReason ?? "aucun motif dans la lecture" }, { term: T.congesPris });
  else {
    tables.push({
      id: TABLE_IDS.conges,
      title: cTitle,
      columns: [
        text("motif", "Motif"),
        ...months.map((m) => num(m, capital(monthShortYear(m)))),
        num("periode", `Période (${label})`),
        num("n1", `N-1 (${prevLabel})`, { term: TERMS.nMoinsUn }),
        num("ecart", "Écart"),
      ],
      rows: cc.lines.map((l) => {
        const total = masked(l.total, seuil);
        const prevTotal = masked(d.conges.previous.lines.find((x) => x.type === l.type)?.total, seuil);
        return { cells: [absenceTypeText(l.type), ...l.months.map((c) => dayCell(masked(c, seuil))), dayCell(total), dayCell(prevTotal), dayGapCell(total, prevTotal)] };
      }),
      terms: [T.congesPris, T.confidentialite, TERMS.parMotif],
    });
    block({ id: "conges", title: cTitle, term: T.congesPris, tables: [TABLE_IDS.conges] });
  }

  // --- Congés posés et demandes en attente, après le dernier mois clos
  const av = d.aVenir;
  const aTitle = av.kind === "value" ? `Congés posés et demandes en attente après ${fin(av.after)}` : "Congés posés et demandes en attente";
  if (seuil === null) ndBlock("a-venir", aTitle, TABLE_IDS.aVenir, seuilNd, { term: T.congesPris });
  else if (av.kind === "nd") ndBlock("a-venir", aTitle, TABLE_IDS.aVenir, { reason: av.reason }, { term: T.congesPris });
  else {
    tables.push({
      id: TABLE_IDS.aVenir,
      title: aTitle,
      columns: [text("motif", "Motif"), text("statut", "Statut"), ...av.months.map((m) => num(m, capital(monthShortYear(m)))), num("total", "Total")],
      rows: av.lines.map((l) => ({ cells: [absenceTypeText(l.type), statutLabel(l.statut), ...l.months.map((c) => dayCell(masked(c, seuil))), dayCell(masked(l.total, seuil))] })),
      notes: av.lines.length === 0 ? [`Aucun congé posé ni demande en attente dans les mois lus après ${fin(av.after)}.`] : [],
      terms: [T.congesPris, T.confidentialite],
    });
    const prevu: PrevuItem[] =
      av.nonRattachees > 0
        ? [{ id: "absences-non-rattachees", label: "Jours posés ou en attente hors des mois lus", reason: `${nf.format(av.nonRattachees)} absence${av.nonRattachees > 1 ? "s" : ""} dont tout ou partie des jours ne se rattache à aucun mois lu (date absente, mois non lu ou contrat inconnu)` }]
        : [];
    block({ id: "a-venir", title: aTitle, term: T.congesPris, tables: [TABLE_IDS.aVenir], prevu });
  }

  // --- Indicateurs non disponibles
  block({ id: "non-disponibles", title: "Indicateurs non disponibles", term: T.prevu, prevu: prevuItems(input) });

  return { chapter: "absences", tiles, alerts: [], tables, charts, limits: limitsOf(d), nd: null, terms: ABSENCES_TERMS, blocks };
}

function prevuItems(input: AbsencesInput): PrevuItem[] {
  return [
    { ...PREVU_ARRETS, link: { href: input.links.parametres, label: "Paramètres" } },
    { ...PREVU_SOLDES, link: { href: input.links.paieCompta, label: "Paie & comptabilité" } },
  ];
}

// Limites de la lecture, une ligne chacune (le détail est au glossaire).
function limitsOf(d: AbsencesData | null): string[] {
  return [
    "Absentéisme, jours théoriques et taux tous motifs : entreprise entière, non soumis au seuil de confidentialité (mêmes valeurs que KPI RH).",
    "Motifs tels que la source les nomme : aucun motif n'est classé en congé payé, RTT ou repos.",
    "Une demi-journée couverte par deux motifs compte dans chacun : la somme des motifs peut dépasser le taux tous motifs.",
    ...(d?.source === "payfit" ? ["Congés posés et demandes en attente : statut lu à la date de la lecture PayFit, jours des mois lus seulement."] : []),
  ];
}

// --- Lecture des sources (serveur) -------------------------------------------------------------------------------------------------

export async function loadAbsencesInput(ctx: CroiseeContext): Promise<AbsencesInput> {
  const slug = ctx.slug;
  const p = ctx.period;
  const base: Omit<AbsencesInput, "nd" | "data"> = {
    links: {
      parametres: croiseeSettingsHref(slug),
      parametresKpi: `/e/${slug}/parametres#kpi`,
      donnees: `/e/${slug}/donnees`,
      tableau: ctx.href({ affichage: "tableau" }),
      paieCompta: ctx.href({ chapitre: "paie-compta", tri: null, sens: null }),
    },
    period: p ? { months: p.months, prevMonths: ctx.prevMonths } : null,
    service: { value: ctx.service.value, label: ctx.service.label },
    settings: ctx.settings,
  };
  const donnees: Action = { href: base.links.donnees, label: ctx.canEdit ? "Choisir ou lire une source dans Données" : "Données" };
  if (!p) return { ...base, nd: { reason: ctx.periodNd ?? "aucun mois disponible", action: donnees }, data: null };
  // Le référentiel RH et les absences ne portent pas le service (code analytique du journal de paie) : rien n'est lu, chaque bloc
  // est n.d. « non filtrable par service ».
  if (ctx.service.value !== undefined) return { ...base, nd: null, data: null };

  const kpi = await ctx.load.kpi();
  const input = kpi.input;
  const refusal = kpiRefusal({
    chosen: Boolean(kpi.collab.source.chosen),
    sourceReason: kpi.collab.source.reason,
    unavailable: kpi.collab.state?.kind === "unavailable" ? kpi.collab.state.reason : null,
    hasInput: Boolean(input),
    invalid: kpi.settings.invalid.map((k) => KPI_KEYS[k]),
  });
  if (!input || refusal) {
    const action = kpi.settings.invalid.length > 0 ? { href: base.links.parametresKpi, label: "Paramètres des KPI" } : donnees;
    return { ...base, nd: { reason: capital(refusal ?? "référentiel RH non construit"), action }, data: null };
  }

  const months = p.months;
  const w = windowOf(months);
  const pw = windowOf(ctx.prevMonths);
  const dash = kpiDashboard(input, w);
  const to = months[months.length - 1];
  const roll = compareWindows(input, rollingWindow(to), absenteeism, (a) => a.ratio, "points");
  const after = lastClosedMonth(input.data, input.openMonths);
  const data: AbsencesData = {
    source: input.data.build.source,
    absenceTypes: input.params.absenceTypes,
    rows: dash.rows,
    period: { current: absenteeism(input, w), previous: absenteeism(input, pw) },
    theoretical: { current: dash.theoretical, previous: theoreticalWindow(input, pw) },
    rolling: {
      from: roll.window.from,
      to: roll.window.to,
      prevFrom: roll.previousWindow.from,
      prevTo: roll.previousWindow.to,
      current: roll.current,
      previous: roll.previous,
      months: roll.window.months.map((m) => absenteeismMonth(input, m)),
    },
    motifs: { current: dash.motifs ?? absenceByMotif(input, w), previous: absenceByMotif(input, pw) },
    conges: { current: congesPris(input, w), previous: congesPris(input, pw) },
    aVenir: after ? congesAVenir(input, after) : { kind: "nd", reason: "aucun mois clos dans la source retenue" },
  };
  return { ...base, nd: null, data };
}
