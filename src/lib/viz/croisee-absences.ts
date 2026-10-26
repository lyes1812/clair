import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { ChartSeries } from "@/components/charts/shared";
import {
  allMotifsInput,
  congesAVenir,
  congesPris,
  motifInput,
  publicMonth,
  publicWindow,
  publicWindowReason,
  type AVenirLine,
  type AVenirStatut,
  type CongeCell,
  type CongesAVenir,
  type CongesPris,
} from "@/lib/croisee/conges";
import { memoPublicModel as memoByContext } from "@/lib/croisee/public";
import { confidentialiteReason, isHidden, maskReason, maskRelations, SEUIL_NON_VERIFIABLE as GROUPE_NON_DENOMBRE, type MaskCell as SharedMaskCell, type MaskRelation, type MaskStatus } from "@/lib/croisee/structure";
import { croiseeSettingReason, croiseeSettingsHref, settingValue, type CroiseeSettings } from "@/lib/croisee/settings-format";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { absenteeism, absenteeismMonth, theoreticalWindow } from "@/lib/rh/kpi/absence";
import { ABSENCE_ALL_MOTIFS_LABEL, absenceByMotif } from "@/lib/rh/kpi/absence-motifs";
import { compareWindows, delta } from "@/lib/rh/kpi/compare";
import { kpiDashboard } from "@/lib/rh/kpi/dashboard";
import { fmtHalfDays, fmtPercent } from "@/lib/rh/kpi/format";
import { lastClosedMonth, rollingWindow } from "@/lib/rh/kpi/period";
import { kpiNd, type AbsenceMotifs, type Delta, type Kind, type KpiNd, type Ratio } from "@/lib/rh/kpi/types";
import { KPI_KEYS } from "@/lib/rh-kpi-settings";
import { plainVariation, type ChapterModel, type CroiseeCell, type CroiseeChart, type CroiseeColumn, type CroiseeTable, type TileSpec } from "@/lib/viz/croisee";
import { absenceTypeText, absenteeismSeries, monthAxis, monthLongLabel, motifsRetenusLine, ratioBps, type RowIn } from "@/lib/viz/kpi";
import { capital, COLORS, monthShortYear } from "@/lib/viz/masse";
import { deltaView, kpiRefusal, nd as ndTile, rateTile, windowOf, type TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée, chapitre 03 · Absences & congés. buildAbsences est une fonction PURE : elle met en forme des résultats déjà
// calculés par le moteur des KPI RH (absentéisme, jours théoriques, absentéisme par motif, tableau de bord) et par les fonctions pures
// du chapitre (src/lib/croisee/conges.ts : pris par motif et par mois, absences posées et demandes en attente). L'écran, le CSV et
// l'Excel partent du même modèle (absencesModel, un seul calcul par requête). loadAbsencesInput lit les sources par les lecteurs du
// contexte et appelle ces fonctions : aucun nouveau moteur. Un n.d. reste n.d. (raison écrite) jusqu'au tableau et au graphique.
//
// Tuile principale : l'absentéisme du moteur (motifs retenus dans Paramètres › Définitions des KPI). Tous les motifs de la lecture
// restent dans le détail, et le « Taux d'absence, tous motifs » est un tableau à part, jamais présenté comme l'absentéisme.
//
// Seuil de confidentialité (rh.croisee.confidentialite ; absent ou illisible : blocs n.d. avec le lien vers les Paramètres) : une
// cellule par motif qui décrit de 1 à (seuil − 1) personnes est masquée, dans le tableau par motif, les demi-journées prises par motif
// et par mois et les absences posées à venir. Exception : le seul motif retenu présent dans la lecture n'est pas masqué (sa ligne égale
// la tuile Absentéisme, déjà publiée dans KPI RH). Masquage secondaire (fonction partagée maskRelations) dans chaque relation publiée :
// mois d'une ligne et son total ; motifs retenus d'un mois ou de la période et la tuile ; autres motifs de la période et (tous motifs −
// tuile) : l'ensemble masqué de chaque relation compte au moins « seuil » personnes distinctes, aucune valeur masquée ne se retrouve
// par différence. Quand les autres motifs ne peuvent pas se protéger entre eux (un seul motif non retenu sous le seuil, par exemple),
// la ligne « tous motifs » de la période (ou de N-1) est masquée, avec la même raison. Les cartes et le tableau mensuel (entreprise
// entière, mêmes valeurs que KPI RH) ne sont pas masqués.
//
// Aucun identifiant : les raisons du moteur qui nomment une absence ou un contrat sont remplacées à la lecture (conges.ts), et un
// dernier filtre (publicText) passe sur tout le modèle.

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
  // labels : libellés de la période et de N-1 du contexte (ctx.labels), repris tels quels en en-tête de colonne et dans les exports.
  period: { months: string[]; prevMonths: string[]; labels: { period: string; prev: string } } | null;
  service: { value: string | null | undefined; label: string }; // value undefined : tous les services
  settings: CroiseeSettings;
  nd: BlockNd | null; // chapitre entier non calculable (période, source RH, paramètres des KPI)
  data: AbsencesData | null; // null avec un service retenu : le référentiel RH n'est pas ventilé par service
};

// --- Modèle ------------------------------------------------------------------------------------------------------------------------

export type AbsencesBlockId = "cartes" | "mensuel" | "motifs" | "tous-motifs" | "conges" | "a-venir" | "non-disponibles";
export type PrevuItem = { id: string; label: string; reason: string; link?: Action; term?: string };
// Un bloc de l'écran : ses graphiques et tableaux (identifiants dans model.charts / model.tables), ses n.d. et ses mentions « Prévu ».
// Un tableau de model.tables absent de tous les blocs est la forme exportable d'un bloc n.d. (une ligne, sa raison).
export type AbsencesBlock = { id: AbsencesBlockId; title: string; term?: string; graph?: boolean; nd: BlockNd[]; charts: string[]; tables: string[]; prevu: PrevuItem[] };
export type AbsencesModel = ChapterModel & { blocks: AbsencesBlock[] };

export const NON_FILTRABLE = "non filtrable par service";
// Raison d'une cellule masquée (masquage principal ou secondaire) : la même que dans les autres chapitres (structure.ts).
export const SOUS_SEUIL = (seuil: number): string => confidentialiteReason(seuil);
export const SEUIL_NON_VERIFIABLE = GROUPE_NON_DENOMBRE;

// Indicateurs du rapport d'origine que Clair ne calcule pas : « Prévu », avec la raison de la matrice (aucune valeur reconstituée).
export const PREVU_ARRETS: Omit<PrevuItem, "link"> = {
  id: "absences-arrets",
  label: "Statistiques d'arrêts sur douze mois glissants",
  reason: "règle de regroupement de deux arrêts et durée d'un arrêt court non définies",
  term: T.arrets,
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

// Jours (demi-journées ÷ 2), écrits « 3,5 j » : une demi-journée n'est jamais arrondie (cartes seulement ; les tableaux sont en
// demi-journées, cellules numériques).
export const daysText = (half: number): string => fmtHalfDays(half);
// Demi-journées d'une cellule de congés : un nombre entier (exporté comme tel), « ≥ x » pour une borne basse, n.d. avec sa raison.
const halfDayCell = (c: CongeCell): CroiseeCell => (c.kind === "nd" ? { nd: c.reason } : c.kind === "lower_bound" ? `≥ ${nf.format(c.half)}` : c.half);
// Écart de demi-journées entre deux totaux exacts (période − N-1), nombre entier signé ; n.d. dès que l'un des deux n'est pas exact.
export function dayGapCell(cur: CongeCell, prev: CongeCell): CroiseeCell {
  if (cur.kind === "nd") return { nd: ECART_ND.valeur };
  if (prev.kind === "nd") return { nd: ECART_ND.n1 };
  if (cur.kind === "lower_bound") return { nd: ECART_ND.borne };
  if (prev.kind === "lower_bound") return { nd: ECART_ND.n1Borne };
  return cur.half - prev.half;
}

// Masquage principal d'une seule cellule : de 1 à (seuil − 1) personnes ⇒ n.d. (aucune personne : rien à protéger) ; personnes non
// dénombrées ⇒ n.d. Le n.d. du moteur garde sa raison. Le masquage secondaire est fait par maskCells.
export function masked(c: CongeCell | undefined, seuil: number): CongeCell {
  if (!c) return { kind: "nd", reason: SEUIL_NON_VERIFIABLE };
  if (c.kind === "nd") return c;
  return c.persons > 0 && c.persons < seuil ? { kind: "nd", reason: SOUS_SEUIL(seuil) } : c;
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

export const statutLabel = (s: AVenirStatut): string => (s === "pose" ? "Posée (statut retenu)" : "En attente d'approbation");

// --- Seuil de confidentialité : masquage principal et secondaire ----------------------------------------------------------------------

// Une cellule soumise au seuil : personnes concernées (null : non dénombrées), valeur affichée (null : déjà n.d. pour une autre raison),
// members : jetons des personnes (comptées une fois d'une cellule à l'autre) ; exempt : valeur déjà publiée ailleurs (seul motif retenu
// = tuile Absentéisme), jamais masquée ; onlyAsTotal : taux tous motifs, masqué seulement quand il est le dernier recours.
export type MaskCell = SharedMaskCell;

// Statuts des cellules après masquage. relations : ensembles de cellules dont la somme est publiée ; une relation donnée comme une
// liste a une somme fixe (publiée ailleurs : tuile, tableau mensuel) ; { cells, total } désigne la cellule qui porte la somme (total
// d'une ligne, taux tous motifs), masquée quand rien d'autre ne protège la relation. Règle : maskRelations (structure.ts) — l'ensemble
// masqué de chaque relation compte au moins « seuil » personnes distinctes et deux cellules qui décrivent quelqu'un ; une cellule vide
// ne protège personne ; la règle est reprise jusqu'à ce que plus rien ne change. Les cellules exemptes ne participent pas aux relations.
export function maskCells(cells: readonly MaskCell[], relations: readonly (readonly number[] | MaskRelation)[], seuil: number): MaskStatus[] {
  return maskRelations(
    cells,
    relations.map((r): MaskRelation => ("cells" in r ? r : { cells: r })),
    seuil,
  );
}

const maskCellOf = (c: CongeCell | undefined, exempt = false): MaskCell =>
  !c ? { size: null, value: 0 } : c.kind === "nd" ? { size: null, value: null } : { size: c.persons, value: c.half, exempt, ...(c.who ? { members: c.who } : {}) };

// Grille « pris par motif » : pour chaque motif, les mois de la période, le total de la période et celui de N-1 (ce sont aussi les
// colonnes du tableau par motif). published : totaux affichés ailleurs dans le chapitre (tableau mensuel des motifs retenus, tuile
// Absentéisme de la période et de N-1, taux tous motifs).
export type CongesGrid = {
  lines: { chosen: boolean; months: CongeCell[]; total: CongeCell; prev: CongeCell | undefined }[];
  exempt: number | null; // ligne du seul motif retenu présent dans la lecture
  published: { months: boolean[]; retainedCur: boolean; allCur: boolean; retainedPrev: boolean; allPrev: boolean };
};
// allCur, allPrev : statut du taux tous motifs de la période et de N-1 (« secondary » : masqué pour protéger un autre motif).
export type CongesGridMask = { months: MaskStatus[][]; cur: MaskStatus[]; prev: MaskStatus[]; allCur: MaskStatus; allPrev: MaskStatus };

export function congesMask(g: CongesGrid, seuil: number): CongesGridMask {
  const k = g.published.months.length;
  const width = k + 2;
  const at = (r: number, j: number) => r * width + j;
  const cells: MaskCell[] = g.lines.flatMap((l, r) => {
    const ex = g.exempt === r;
    return [...l.months.map((c) => maskCellOf(c, ex)), maskCellOf(l.total, ex), maskCellOf(l.prev, ex)];
  });
  // Taux tous motifs (période, N-1) : deux cellules de plus, total des « autres motifs » (ou de tous les motifs).
  const allCurAt = cells.length;
  const allPrevAt = allCurAt + 1;
  cells.push({ size: null, value: g.published.allCur ? 0 : null, onlyAsTotal: true }, { size: null, value: g.published.allPrev ? 0 : null, onlyAsTotal: true });
  const all = g.lines.map((_, r) => r);
  const retained = all.filter((r) => g.lines[r].chosen);
  const others = all.filter((r) => !g.lines[r].chosen);
  // Une ligne : ses mois ont pour somme le total de la période de la ligne (cellule masquable).
  const rel: MaskRelation[] = all.map((r) => ({ cells: Array.from({ length: k }, (_, j) => at(r, j)), total: at(r, k) }));
  g.published.months.forEach((ok, j) => {
    if (ok) rel.push({ cells: retained.map((r) => at(r, j)) });
  });
  const column = (j: number, retainedShown: boolean, allShown: boolean, allAt: number) => {
    if (retainedShown && allShown) rel.push({ cells: retained.map((r) => at(r, j)) }, { cells: others.map((r) => at(r, j)), total: allAt });
    else if (allShown) rel.push({ cells: all.map((r) => at(r, j)), total: allAt });
    else if (retainedShown) rel.push({ cells: retained.map((r) => at(r, j)) });
  };
  column(k, g.published.retainedCur, g.published.allCur, allCurAt);
  column(k + 1, g.published.retainedPrev, g.published.allPrev, allPrevAt);
  const st = maskCells(cells, rel, seuil);
  return {
    months: all.map((r) => Array.from({ length: k }, (_, j) => st[at(r, j)])),
    cur: all.map((r) => st[at(r, k)]),
    prev: all.map((r) => st[at(r, k + 1)]),
    allCur: st[allCurAt],
    allPrev: st[allPrevAt],
  };
}

// Absences posées à venir : chaque ligne (motif × statut) et son total forment une relation ; aucun total de colonne n'est affiché.
export function aVenirMask(lines: readonly Pick<AVenirLine, "months" | "total">[], seuil: number): { months: MaskStatus[][]; total: MaskStatus[] } {
  const k = lines[0]?.months.length ?? 0;
  const at = (r: number, j: number) => r * (k + 1) + j;
  const cells = lines.flatMap((l) => [...l.months.map((c) => maskCellOf(c)), maskCellOf(l.total)]);
  const st = maskCells(
    cells,
    lines.map((_, r) => ({ cells: Array.from({ length: k }, (_, j) => at(r, j)), total: at(r, k) })),
    seuil,
  );
  return { months: lines.map((_, r) => Array.from({ length: k }, (_, j) => st[at(r, j)])), total: lines.map((_, r) => st[at(r, k)]) };
}

// --- Aucun identifiant dans le modèle (filet de sécurité) --------------------------------------------------------------------------

// Formes des raisons du moteur qui nomment une absence ou un contrat : remplacées par une forme sans identifiant. Les raisons sont déjà
// rendues publiques à la lecture (conges.ts) ; ce filtre ne laisse passer aucun identifiant oublié.
const PUBLIC: [RegExp, string][] = [
  [/absence \S+ rattachée au contrat \S+ inconnu du référentiel/g, "absence rattachée à un contrat inconnu du référentiel (détail dans KPI RH)"],
  [/absence \S+ : date de (début et de fin|début|fin) non renseignée dans PayFit/g, "absence sans date de $1 renseignée dans PayFit (détail dans KPI RH)"],
  [/ \(absences [^()]*\)/g, " (détail dans KPI RH)"],
];
export const publicText = (s: string): string => PUBLIC.reduce((t, [re, by]) => t.replace(re, by), s);
function scrub<V>(x: V): V {
  if (typeof x === "string") return publicText(x) as V;
  if (Array.isArray(x)) return x.map(scrub) as V;
  if (x !== null && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, scrub(v)])) as V;
  return x;
}

// --- Construction du modèle -------------------------------------------------------------------------------------------------------

export function buildAbsences(input: AbsencesInput): AbsencesModel {
  return scrub(buildChapter(input));
}

function buildChapter(input: AbsencesInput): AbsencesModel {
  const empty: AbsencesModel = { chapter: "absences", tiles: [], alerts: [], tables: [], charts: [], limits: [], nd: null, terms: ABSENCES_TERMS, blocks: [] };
  const p = input.period;
  const filtered = input.service.value !== undefined;
  const d = input.data;
  if (input.nd || !p || p.months.length === 0 || (!filtered && !d)) {
    const nd = input.nd ?? { reason: p && p.months.length ? "référentiel RH non construit" : "aucun mois disponible", action: { href: input.links.donnees, label: "Données" } };
    return { ...empty, nd: { reason: nd.reason, action: nd.action } };
  }
  const { months, prevMonths } = p;
  const label = p.labels.period;
  const prevLabel = p.labels.prev;
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
  const titles = { cur: "Absentéisme", prev: "Absentéisme N-1", roll: "Absentéisme, douze mois glissants", th: "Jours théoriques" };
  const cTitle = "Demi-journées prises par motif et par mois";
  const aBase = "Absences posées et demandes en attente";

  // --- Filtre de service : le référentiel RH ne porte pas le service ; rien n'est lu, chaque bloc est n.d. (aucun chiffre de toute
  // l'entreprise présenté sous un filtre).
  if (filtered || !d) {
    tiles.push(
      { id: "absenteisme", label: titles.cur, term: TERMS.absenteisme, sub: label, value: ndTile(NON_FILTRABLE) },
      { id: "absenteisme-n1", label: titles.prev, term: TERMS.nMoinsUn, sub: prevLabel, value: ndTile(NON_FILTRABLE) },
      { id: "douze-mois", label: titles.roll, term: TERMS.absenteisme, value: ndTile(NON_FILTRABLE) },
      { id: "jours-theoriques", label: titles.th, term: TERMS.absenteisme, sub: label, value: ndTile(NON_FILTRABLE) },
    );
    block({ id: "cartes", title: "Absentéisme" });
    const why = { reason: NON_FILTRABLE };
    ndBlock("mensuel", "Absentéisme par mois", TABLE_IDS.mensuel, why, { term: TERMS.absenteisme, graph: true });
    ndBlock("motifs", "Absences par motif", TABLE_IDS.motifs, why, { term: TERMS.parMotif });
    ndBlock("tous-motifs", ABSENCE_ALL_MOTIFS_LABEL, TABLE_IDS.tousMotifs, why, { term: TERMS.tousMotifs });
    ndBlock("conges", cTitle, TABLE_IDS.conges, why, { term: T.congesPris, graph: true });
    ndBlock("a-venir", aBase, TABLE_IDS.aVenir, why, { term: T.congesPris });
    block({ id: "non-disponibles", title: "Indicateurs non disponibles", term: T.prevu, prevu: prevuItems(input) });
    return { ...empty, tiles, tables, blocks, limits: limitsOf(null) };
  }

  // --- Cartes (entreprise entière, mêmes valeurs que KPI RH : non soumises au seuil)
  const cur = d.period.current;
  const prev = d.period.previous;
  const dv = deltaView(delta(cur, prev, (x) => x.ratio, "points", prevLabel));
  tiles.push({
    id: "absenteisme",
    label: titles.cur,
    term: TERMS.absenteisme,
    sub: label,
    value: rateTile(cur),
    variations: [plainVariation("Écart", dv.text, dv.reason)],
    note: motifsRetenusLine(d.absenceTypes),
    spark: { label: "Absentéisme par mois, douze mois glissants", values: d.rolling.months.map(bpsOf) },
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

  // --- Absentéisme par mois (motifs retenus) : graphique (barres groupées N et N-1) et son tableau exact
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
  const mc = d.motifs.current;
  const mp = d.motifs.previous;
  const cc = d.conges.current;

  // Masquage de la grille « pris par motif » (mois, période, N-1), partagé par le tableau par motif, le graphique et le tableau des
  // demi-journées prises : une valeur masquée l'est partout.
  const grid = (() => {
    if (seuil === null || cc.lines.length === 0) return null;
    const chosen = cc.lines.flatMap((l, i) => (l.chosen ? [i] : []));
    const rowOf = new Map(d.rows.map((x) => [x.month, x]));
    const prevOf = new Map(d.conges.previous.lines.map((l) => [l.type, l.total]));
    const mask = congesMask(
      {
        lines: cc.lines.map((l) => ({ chosen: l.chosen, months: l.months, total: l.total, prev: prevOf.get(l.type) })),
        exempt: chosen.length === 1 ? chosen[0] : null,
        published: {
          months: months.map((m) => (rowOf.get(m)?.absenteeism.kind ?? "nd") !== "nd"),
          retainedCur: cur.kind !== "nd",
          allCur: mc.all.kind !== "nd",
          retainedPrev: prev.kind !== "nd",
          allPrev: mp.all.kind !== "nd",
        },
      },
      seuil,
    );
    const index = new Map(cc.lines.map((l, i) => [l.type, i]));
    // Cellule après masquage : masquée ⇒ n.d. avec la raison du seuil ; sinon la cellule elle-même.
    const shown = (c: CongeCell | undefined, st: MaskStatus | undefined): CongeCell => (!c || st === undefined ? { kind: "nd", reason: SEUIL_NON_VERIFIABLE } : isHidden(st) ? { kind: "nd", reason: maskReason(st, seuil)! } : c);
    return { mask, index, prevOf, shown };
  })();

  // --- Absences par motif (tous les motifs de la lecture, retenus ou non ; N-1 par un second appel du moteur)
  const mTitle = "Absences par motif";
  if (seuil === null) ndBlock("motifs", mTitle, TABLE_IDS.motifs, seuilNd, { term: TERMS.parMotif });
  else if (mc.lines.length === 0) ndBlock("motifs", mTitle, TABLE_IDS.motifs, { reason: mc.emptyReason ?? "aucun motif dans la lecture" }, { term: TERMS.parMotif });
  else {
    // Un côté du tableau (période ou N-1) : le taux du moteur, ou n.d. (raison du moteur, motif absent, ou seuil).
    const side = (l: MotifLineK | undefined, st: MaskStatus | undefined): { half: CroiseeCell; rate: CroiseeCell; gap: RateK } => {
      const nd = (reason: string) => ({ half: { nd: reason }, rate: { nd: reason }, gap: { kind: "nd", nd: kpiNd("month-nd", reason) } as RateK });
      if (!l) return nd("motif absent de la lecture");
      const rk = lineRate(l);
      if (rk.kind === "nd") return nd(rk.nd.reason);
      if (st === undefined || st === "nd") return nd(SEUIL_NON_VERIFIABLE);
      if (isHidden(st)) return nd(maskReason(st, seuil)!);
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
        const i = grid?.index.get(l.type);
        const a = side(l, i === undefined ? undefined : grid!.mask.cur[i]);
        const b = side(
          mp.lines.find((x) => x.type === l.type),
          i === undefined ? undefined : grid!.mask.prev[i],
        );
        return { cells: [absenceTypeText(l.type), l.chosen ? "oui" : "non", a.half, a.rate, b.half, b.rate, rateGap(a.gap, b.gap)] };
      }),
      terms: [TERMS.parMotif, TERMS.motifsRetenus, T.confidentialite],
    });
    block({ id: "motifs", title: mTitle, term: TERMS.parMotif, tables: [TABLE_IDS.motifs] });
  }

  // --- Taux d'absence, tous motifs : un autre calcul que l'absentéisme, à part (entreprise entière). Il n'est masqué que lorsque, avec
  // la tuile, il donnerait par différence la somme d'autres motifs masqués qui ne peuvent pas se protéger entre eux (un seul motif non
  // retenu sous le seuil, par exemple) : période et N-1 chacun selon sa relation, avec la raison du seuil.
  const allShown = (r: RateK, st: MaskStatus | undefined): RateK =>
    r.kind !== "nd" && st !== undefined && isHidden(st) && seuil !== null ? { kind: "nd", nd: kpiNd("month-nd", maskReason(st, seuil)!) } : r;
  const all = allShown(mc.all, grid?.mask.allCur);
  const allPrev = allShown(mp.all, grid?.mask.allPrev);
  tables.push({
    id: TABLE_IDS.tousMotifs,
    title: ABSENCE_ALL_MOTIFS_LABEL,
    columns: [text("indicateur", "Indicateur"), num("demi-journees", `Demi-journées ${label}`), pct("taux", `Taux ${label}`), num("demi-journees-n1", `Demi-journées ${prevLabel}`), pct("taux-n1", `Taux ${prevLabel}`), points("ecart", "Écart (points)")],
    rows: [{ cells: [ABSENCE_ALL_MOTIFS_LABEL, halfOfRate(all), rateCell(all), halfOfRate(allPrev), rateCell(allPrev), rateGap(all, allPrev)] }],
    terms: [TERMS.tousMotifs, T.confidentialite],
  });
  block({ id: "tous-motifs", title: ABSENCE_ALL_MOTIFS_LABEL, term: TERMS.tousMotifs, tables: [TABLE_IDS.tousMotifs] });

  // --- Demi-journées prises par motif et par mois (congés compris : aucun motif n'est classé par son nom) : graphique empilé et son
  // tableau exact, mêmes cellules masquées.
  if (seuil === null) ndBlock("conges", cTitle, TABLE_IDS.conges, seuilNd, { term: T.congesPris, graph: true });
  else if (cc.lines.length === 0 || !grid) ndBlock("conges", cTitle, TABLE_IDS.conges, { reason: cc.emptyReason ?? "aucun motif dans la lecture" }, { term: T.congesPris, graph: true });
  else {
    const { mask, prevOf, shown } = grid;
    const rows = cc.lines.map((l, i) => {
      const monthsShown = l.months.map((c, j) => shown(c, mask.months[i][j]));
      const total = shown(l.total, mask.cur[i]);
      const prevTotal = shown(prevOf.get(l.type), mask.prev[i]);
      return { type: l.type, monthsShown, total, prevTotal };
    });
    const ax = monthAxis(months);
    const series: ChartSeries[] = rows.map((x, i) => {
      const pts = x.monthsShown.map(congePoint);
      return { key: `motif-${i + 1}`, name: absenceTypeText(x.type), values: pts.map((q) => q.value), reasons: pts.map((q) => q.reason), color: `var(--chart-${(i % 8) + 1})` };
    });
    charts.push({ id: TABLE_IDS.conges, title: cTitle, kind: "barres", unit: "nombre", categories: ax.categories, categoryTitles: ax.titles, series, mode: "stacked", tableId: TABLE_IDS.conges });
    tables.push({
      id: TABLE_IDS.conges,
      title: cTitle,
      columns: [
        text("motif", "Motif"),
        ...months.map((m) => num(m, capital(monthShortYear(m)))),
        num("periode", `Demi-journées ${label}`),
        num("n1", `Demi-journées ${prevLabel}`, { term: TERMS.nMoinsUn }),
        num("ecart", "Écart (demi-journées)", { signed: true }),
      ],
      rows: rows.map((x) => ({ cells: [absenceTypeText(x.type), ...x.monthsShown.map(halfDayCell), halfDayCell(x.total), halfDayCell(x.prevTotal), dayGapCell(x.total, x.prevTotal)] })),
      terms: [T.congesPris, T.confidentialite, TERMS.parMotif],
    });
    block({ id: "conges", title: cTitle, term: T.congesPris, graph: true, charts: [TABLE_IDS.conges] });
  }

  // --- Absences posées et demandes en attente, après le dernier mois clos
  const av = d.aVenir;
  const aTitle = av.kind === "value" ? `${aBase} après ${fin(av.after)} (demi-journées)` : aBase;
  if (seuil === null) ndBlock("a-venir", aTitle, TABLE_IDS.aVenir, seuilNd, { term: T.congesPris });
  else if (av.kind === "nd") ndBlock("a-venir", aTitle, TABLE_IDS.aVenir, { reason: av.reason }, { term: T.congesPris });
  else {
    const st = aVenirMask(av.lines, seuil);
    const cell = (c: CongeCell, x: MaskStatus): CroiseeCell => halfDayCell(isHidden(x) ? { kind: "nd", reason: maskReason(x, seuil)! } : c);
    const n = av.nonRattachees;
    tables.push({
      id: TABLE_IDS.aVenir,
      title: aTitle,
      columns: [text("motif", "Motif"), text("statut", "Statut"), ...av.months.map((m) => num(m, capital(monthShortYear(m)))), num("total", "Total")],
      rows: av.lines.map((l, i) => ({ cells: [absenceTypeText(l.type), statutLabel(l.statut), ...l.months.map((c, j) => cell(c, st.months[i][j])), cell(l.total, st.total[i])] })),
      notes: [
        ...(av.lines.length === 0 ? [`Aucune absence posée ni demande en attente dans les mois lus après ${fin(av.after)}.`] : []),
        ...(n > 0 ? [`${nf.format(n)} absence${n > 1 ? "s" : ""} posée${n > 1 ? "s" : ""} ou en attente hors des mois lus (date absente, mois non lu ou contrat inconnu) : jours non comptés.`] : []),
      ],
      terms: [T.congesPris, T.confidentialite],
    });
    block({ id: "a-venir", title: aTitle, term: T.congesPris, tables: [TABLE_IDS.aVenir] });
  }

  // --- Indicateurs non disponibles
  block({ id: "non-disponibles", title: "Indicateurs non disponibles", term: T.prevu, prevu: prevuItems(input) });

  return { chapter: "absences", tiles, alerts: [], tables, charts, limits: limitsOf(d), nd: null, terms: ABSENCES_TERMS, blocks };
}

// Point du graphique empilé : une valeur exacte est tracée ; une borne basse ou un n.d. (moteur ou seuil) ne l'est pas, avec sa raison.
function congePoint(c: CongeCell): { value: number | null; reason: string | null } {
  if (c.kind === "nd") return { value: null, reason: c.reason };
  if (c.kind === "lower_bound") return { value: null, reason: `borne basse (≥ ${nf.format(c.half)} demi-journées) : source incomplète, non tracée comme valeur exacte` };
  return { value: c.half, reason: null };
}

function prevuItems(input: AbsencesInput): PrevuItem[] {
  return [{ ...PREVU_ARRETS }, { ...PREVU_SOLDES, link: { href: input.links.paieCompta, label: "Paie & comptabilité" } }];
}

// Limites de la lecture, une ligne chacune (le détail est au glossaire).
function limitsOf(d: AbsencesData | null): string[] {
  return [
    "Absentéisme et jours théoriques : entreprise entière, non soumis au seuil de confidentialité (mêmes valeurs que KPI RH).",
    "Seuil de confidentialité : motifs et absences posées, avec masquage secondaire ; un motif retenu seul n'est pas masqué (il égale la tuile Absentéisme) ; le taux tous motifs est masqué quand il donnerait par différence un motif masqué.",
    "Motifs tels que la source les nomme : aucun motif n'est classé en congé payé, RTT ou repos.",
    "Une demi-journée couverte par deux motifs compte dans chacun : la somme des motifs (et une barre empilée) peut dépasser le taux tous motifs.",
    ...(d?.source === "payfit" ? ["Absences posées et demandes en attente : statut lu à la date de la lecture PayFit, jours des mois lus seulement."] : []),
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
    period: p ? { months: p.months, prevMonths: ctx.prevMonths, labels: { period: ctx.labels.period, prev: ctx.labels.prev } } : null,
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
  // Raisons publiques (aucun identifiant d'absence ni de contrat), chacune calculée sur l'entrée qui a produit le résultat.
  const allIn = allMotifsInput(input);
  const motifs = (m: AbsenceMotifs): MotifsK => ({
    label: m.label,
    lines: m.lines.map((l) => (l.kind === "nd" ? { ...l, nd: { ...l.nd, reason: publicWindowReason(motifInput(input, l.type), l.nd) } } : l)),
    all: publicWindow(allIn, m.all),
    emptyReason: m.emptyReason,
  });
  const data: AbsencesData = {
    source: input.data.build.source,
    absenceTypes: input.params.absenceTypes,
    rows: dash.rows.map((x) => ({ ...x, absenteeism: publicMonth(input, x.absenteeism), previous: { ...x.previous, absenteeism: publicMonth(input, x.previous.absenteeism) } })),
    period: { current: publicWindow(input, absenteeism(input, w)), previous: publicWindow(input, absenteeism(input, pw)) },
    theoretical: { current: dash.theoretical, previous: theoreticalWindow(input, pw) },
    rolling: {
      from: roll.window.from,
      to: roll.window.to,
      prevFrom: roll.previousWindow.from,
      prevTo: roll.previousWindow.to,
      current: publicWindow(input, roll.current),
      previous: publicWindow(input, roll.previous),
      months: roll.window.months.map((m) => absenteeismMonth(input, m)),
    },
    motifs: { current: motifs(dash.motifs ?? absenceByMotif(input, w)), previous: motifs(absenceByMotif(input, pw)) },
    conges: { current: congesPris(input, w), previous: congesPris(input, pw) },
    aVenir: after ? congesAVenir(input, after) : { kind: "nd", reason: "aucun mois clos dans la source retenue" },
  };
  return { ...base, nd: null, data };
}

// Un seul calcul par requête : le composant du chapitre et l'export appellent cette fonction.
export const absencesModel = memoByContext((ctx: CroiseeContext) => loadAbsencesInput(ctx).then(buildAbsences));
