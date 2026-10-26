import type { Affichage } from "@/app/e/[slug]/studio-rh/masse-salariale/components";
import type { ChartSeries } from "@/components/charts/shared";
import type { UnitName } from "@/components/charts/units";
import { formatDate, isIsoDate } from "@/lib/dates";
import type { ColumnKind, ExportCell } from "@/lib/export/xlsx";
import { fmtEtp4, fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";
import { costTone, type TrendTone } from "@/lib/trend";
import { euros, eurosSigned } from "@/lib/viz/masse";
import type { TileValue } from "@/lib/viz/synthese";

// Masse salariale croisée : types et utilitaires partagés par la page, les dix chapitres et les exports (écran, CSV et Excel
// viennent du même modèle). Aucun calcul métier ici : mise en forme de valeurs déjà calculées, lecture de l'adresse, ordre des
// alertes, tri d'un tableau. Montants en centimes, ETP en dix-millièmes, taux en points de base ; un n.d. reste n.d. (raison),
// jamais zéro.

export type { TileValue } from "@/lib/viz/synthese";

// --- Chapitres -----------------------------------------------------------------------------------------------------------------

export const CHAPTER_IDS = ["synthese", "effectifs", "absences", "fixe-variable", "services", "budget", "paie-compta", "effets", "restructuration", "juridique"] as const;
export type ChapterId = (typeof CHAPTER_IDS)[number];
export const isChapterId = (v: string): v is ChapterId => (CHAPTER_IDS as readonly string[]).includes(v);
export const DEFAULT_CHAPTER: ChapterId = "synthese";

// --- Adresse : seule source de vérité des choix de la page --------------------------------------------------------------------

export const QUERY_KEYS = ["chapitre", "annee", "de", "a", "service", "budget", "scenario", "affichage", "tri", "sens"] as const;
export type QueryKey = (typeof QUERY_KEYS)[number];
export type QueryState = Partial<Record<QueryKey, string | null>>;
export type SortDir = "asc" | "desc";

const AFFICHAGES: readonly Affichage[] = ["tout", "graphique", "tableau"];
const TRI = /^[a-z0-9-]{1,40}(\.[a-z0-9-]{1,40})?$/;

// Paramètres lus tels quels : année, mois, service, budget et scénario sont validés par le contexte (mois disponibles, services
// du journal, budgets et scénarios de l'espace) ; chapitre, affichage, tri et sens le sont ici. Une valeur écartée est signalée.
export type CroiseeQuery = {
  chapitre: ChapterId;
  annee: string;
  de: string;
  a: string;
  service: string;
  budget: string;
  scenario: string;
  affichage: Affichage;
  tri: string | null;
  sens: SortDir | null;
  notices: string[];
};

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
// Valeur reprise dans un avis : courte, sans caractère de contrôle.
const shown = (v: string) => {
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ");
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

export function parseQuery(sp: Search): CroiseeQuery {
  const notices: string[] = [];
  const rawChapter = one(sp.chapitre);
  const chapitre = isChapterId(rawChapter) ? rawChapter : DEFAULT_CHAPTER;
  if (rawChapter && !isChapterId(rawChapter)) notices.push(`paramètre ignoré : chapitre=${shown(rawChapter)} (chapitre inconnu : Synthèse affichée)`);
  const rawAff = one(sp.affichage);
  const affichage = (AFFICHAGES as readonly string[]).includes(rawAff) ? (rawAff as Affichage) : "tout";
  if (rawAff && affichage !== rawAff) notices.push(`paramètre ignoré : affichage=${shown(rawAff)} (valeurs : ${AFFICHAGES.join(", ")})`);
  const rawTri = one(sp.tri);
  const tri = TRI.test(rawTri) ? rawTri : null;
  if (rawTri && !tri) notices.push(`paramètre ignoré : tri=${shown(rawTri)} (colonne inconnue)`);
  const rawSens = one(sp.sens);
  const sens = rawSens === "asc" || rawSens === "desc" ? rawSens : null;
  if (rawSens && !sens) notices.push(`paramètre ignoré : sens=${shown(rawSens)} (valeurs : asc, desc)`);
  return { chapitre, annee: one(sp.annee), de: one(sp.de), a: one(sp.a), service: one(sp.service), budget: one(sp.budget), scenario: one(sp.scenario), affichage, tri, sens, notices };
}

// Adresse d'une vue : paramètres dans un ordre fixe, valeurs vides et affichage « tout » omis.
export function croiseeHref(base: string, state: QueryState, hash?: string): string {
  const p = new URLSearchParams();
  for (const k of QUERY_KEYS) {
    const v = state[k];
    if (v === null || v === undefined || v === "") continue;
    if (k === "affichage" && v === "tout") continue;
    p.set(k, v);
  }
  const qs = p.toString();
  return `${base}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}

// --- Cartes --------------------------------------------------------------------------------------------------------------------

// Ligne de variation d'une carte (« N-1 : … », « Écart : … ») : texte déjà mis en forme, n.d. avec sa raison. Le ton n'est
// appliqué que si la carte porte un coût (TileSpec.cost) : jamais de rouge ni de vert sur un effectif, un ETP ou un taux.
export type TileVariation = { label: string; text: string | null; reason?: string | null; tone: TrendTone };
export type SparkSpec = { label: string; values: (number | null)[] };
export type TileSpec = {
  id: string; // unique dans le chapitre : data-testid cx-tile-<chapitre>-<id>
  label: string;
  term?: string; // identifiant du glossaire (« ? »)
  sub?: string; // une ligne : période ou repère de la valeur
  value: TileValue; // { text, kind: value | lower | nd, reason }
  cost?: boolean; // la valeur et ses variations sont des montants de coût : ton rouge / vert permis
  valueTone?: TrendTone; // ton de la valeur elle-même quand elle est un écart de coût (écart au budget)
  variations?: TileVariation[];
  note?: string;
  spark?: SparkSpec | null;
  main?: boolean; // valeur en bleu (carte de masse)
};

export const costVariation = (label: string, deltaCents: number | null, text: string | null, reason: string | null = null): TileVariation => ({ label, text, reason, tone: costTone(deltaCents) });
export const plainVariation = (label: string, text: string | null, reason: string | null = null): TileVariation => ({ label, text, reason, tone: "flat" });
export const variationTone = (tile: Pick<TileSpec, "cost">, v: TileVariation): TrendTone => (tile.cost ? v.tone : "flat");

// Mini-série d'une carte : un nombre fini reste lui-même, tout le reste (n.d., absent, non fini) devient null, jamais 0.
export function sparkValues(values: readonly (number | { nd: string } | null | undefined)[]): (number | null)[] {
  return values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
}
// Une mini-courbe n'est tracée qu'avec deux mois connus consécutifs au moins (des points isolés ne font pas une tendance), même règle
// que Sparkline : sans cela, aucune image n'est annoncée.
export function sparkDrawable(values: readonly (number | null)[]): boolean {
  const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
  const known = values.filter(ok);
  if (known.length < 2 || !Number.isFinite(Math.max(...known) - Math.min(...known))) return false;
  return values.some((v, i) => ok(v) && ok(values[i + 1]));
}

// --- Alertes « À surveiller » ----------------------------------------------------------------------------------------------------

export const ALERT_LEVELS = ["defavorable", "a-completer", "repere"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];
export const ALERT_LEVEL_LABELS: Record<AlertLevel, string> = { defavorable: "Défavorable", "a-completer": "À compléter", repere: "Repère" };
export type AlertSpec = { id: string; level: AlertLevel; label: string; text: string; href?: string; linkLabel?: string };

// Ordre d'affichage : défavorable, à compléter, repère ; l'ordre d'origine est conservé dans un même niveau. Aucun plafond.
export function sortAlerts(list: readonly AlertSpec[]): AlertSpec[] {
  return list.map((a, i) => ({ a, i })).sort((x, y) => ALERT_LEVELS.indexOf(x.a.level) - ALERT_LEVELS.indexOf(y.a.level) || x.i - y.i).map((x) => x.a);
}

// --- Tableaux ----------------------------------------------------------------------------------------------------------------------

// Un même modèle pour l'écran, le CSV et l'Excel (src/lib/export/xlsx.ts) : une cellule est un entier d'unité de base (centimes,
// dix-millièmes d'ETP, points de base), une valeur exacte { exact } dans l'unité affichée (euros, ETP, fraction d'un pourcentage),
// un texte, { nd: raison }, ou « » (sans objet).
export type CroiseeCell = ExportCell;
export type CroiseeColumn = {
  key: string;
  header: string;
  kind: ColumnKind; // text | eur | etp | nombre | pourcent | date
  width?: number;
  signed?: boolean; // écart : signe « + » écrit
  costTrend?: boolean; // écart d'un coût : ton rouge (hausse) / vert (baisse) ; jamais sur un effectif, un ETP ou un taux
  points?: boolean; // colonne « pourcent » qui porte un écart de taux, en points
  term?: string; // identifiant du glossaire de l'en-tête
  sortable?: boolean;
};
export type CroiseeRow = {
  cells: CroiseeCell[];
  style?: "subtotal" | "child";
  kind?: ColumnKind; // unité propre à la ligne (tableaux à unités mêlées), remplace eur / etp / nombre de la colonne
  href?: string; // lien de la première cellule (filtre par service, détail d'un mois)
};
export type CroiseeTable = {
  id: string; // data-testid cx-table-<id>
  title: string;
  columns: CroiseeColumn[];
  rows: CroiseeRow[];
  foot?: CroiseeRow; // ligne de total
  notes?: string[]; // limites de lecture, une ligne chacune
  terms?: string[]; // identifiants du glossaire repris dans la feuille « Définitions » de l'export
};

export type CellView = { text: string; nd: string | null; na: boolean; tone: TrendTone; numeric: boolean };

const group = new Intl.NumberFormat("fr-FR");
const two = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const minus = (s: string) => s.replace(/^[-−]/, "−");
const plus = (signed: boolean | undefined, v: number) => (signed && v > 0 ? "+" : "");
const BASE_KINDS = new Set<ColumnKind>(["eur", "etp", "nombre"]);

// Unité effective d'une cellule : celle de la ligne remplace eur / etp / nombre de la colonne (même règle que l'export Excel).
export const cellKind = (col: CroiseeColumn, row?: Pick<CroiseeRow, "kind">): ColumnKind => (row?.kind && BASE_KINDS.has(col.kind) ? row.kind : col.kind);

// Texte d'une cellule selon sa nature. n.d. → « n.d. » et sa raison ; « » ou absente → sans objet (« — ») ; jamais un zéro inventé.
export function cellView(cell: CroiseeCell | undefined, col: CroiseeColumn, row?: Pick<CroiseeRow, "kind">): CellView {
  const kind = cellKind(col, row);
  const numeric = kind !== "text" && kind !== "date";
  const view = (text: string, tone: TrendTone = "flat"): CellView => ({ text, nd: null, na: false, tone: col.costTrend ? tone : "flat", numeric });
  if (cell === undefined || cell === "") return { text: "—", nd: null, na: true, tone: "flat", numeric };
  if (typeof cell === "object" && "nd" in cell) return { text: "n.d.", nd: cell.nd, na: false, tone: "flat", numeric };
  if (typeof cell === "string") return view(kind === "date" && isIsoDate(cell) ? formatDate(cell) : cell);
  if (typeof cell === "object") {
    const x = cell.exact;
    if (!Number.isFinite(x)) return { text: "n.d.", nd: "valeur non finie", na: false, tone: "flat", numeric };
    if (!numeric) return { text: "n.d.", nd: "valeur numérique dans une colonne de texte", na: false, tone: "flat", numeric };
    const sign = plus(col.signed, x);
    if (kind === "eur") return view(`${sign}${euros(Math.round(x * 100))}`, costTone(x));
    if (kind === "pourcent") return view(`${sign}${minus(two.format(x * 100))}${col.points ? " pts" : " %"}`, costTone(x));
    return view(`${sign}${minus(two.format(x))}`, costTone(x));
  }
  if (!Number.isSafeInteger(cell)) return { text: "n.d.", nd: "valeur hors de l'unité de base", na: false, tone: "flat", numeric };
  const sign = plus(col.signed, cell);
  if (kind === "eur") return view(col.signed ? eurosSigned(cell) : euros(cell), costTone(cell));
  if (kind === "etp") return view(`${sign}${fmtEtp4(cell)}`, costTone(cell));
  if (kind === "nombre") return view(`${sign}${minus(group.format(cell))}`, costTone(cell));
  if (kind === "pourcent") return view(col.points ? `${sign}${fmtFixed({ num: cell, den: 100 })} pts` : `${sign}${fmtPercent({ num: cell, den: 10000 })}`, costTone(cell));
  return view(String(cell));
}

// Raisons des n.d. d'un tableau, une fois chacune, dans l'ordre de lecture : listées sous le tableau (jamais seulement au survol).
export function tableNdReasons(t: CroiseeTable): string[] {
  const seen = new Set<string>();
  for (const r of [...t.rows, ...(t.foot ? [t.foot] : [])]) for (const c of r.cells) if (typeof c === "object" && "nd" in c) seen.add(c.nd);
  return [...seen];
}

// --- Tri d'un tableau par l'adresse (tri=<tableau>.<colonne>, sens=asc|desc) -----------------------------------------------------

export const defaultDir = (col: CroiseeColumn): SortDir => (col.kind === "text" || col.kind === "date" ? "asc" : "desc");

// Tri demandé pour ce tableau, ou null (colonne absente, non triable, ou tri d'un autre tableau).
export function sortState(t: CroiseeTable, tri: string | null, sens: SortDir | null): { key: string; dir: SortDir } | null {
  if (!tri) return null;
  const [a, b] = tri.split(".");
  const key = b === undefined ? a : a === t.id ? b : null;
  const col = key ? t.columns.find((c) => c.key === key && c.sortable) : undefined;
  return col ? { key: col.key, dir: sens ?? defaultDir(col) } : null;
}

const sortValue = (c: CroiseeCell | undefined): number | string | null => {
  if (c === undefined || c === "") return null;
  if (typeof c === "number") return c;
  if (typeof c === "string") return c;
  return "nd" in c ? null : c.exact;
};
const text = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

// Lignes triées sur une colonne ; les n.d. et les cellules sans objet passent toujours en dernier ; ordre d'origine à égalité.
// La ligne de total (foot) n'est jamais triée.
export function sortRows(t: CroiseeTable, key: string, dir: SortDir): CroiseeRow[] {
  const i = t.columns.findIndex((c) => c.key === key);
  if (i < 0) return t.rows;
  const k = dir === "asc" ? 1 : -1;
  return t.rows
    .map((r, n) => ({ r, n, v: sortValue(r.cells[i]) }))
    .sort((x, y) => {
      if (x.v === null || y.v === null) return x.v === y.v ? x.n - y.n : x.v === null ? 1 : -1;
      const d = typeof x.v === "number" && typeof y.v === "number" ? x.v - y.v : text.compare(String(x.v), String(y.v));
      return d === 0 ? x.n - y.n : d * k;
    })
    .map((x) => x.r);
}

// Adresse d'un en-tête triable : l'adresse courante avec tri et sens remplacés, ancrée sur le tableau.
export function sortHref(base: string, tableId: string, key: string, dir: SortDir): string {
  const [path, query = ""] = base.split("#")[0].split("?");
  const p = new URLSearchParams(query);
  p.set("tri", `${tableId}.${key}`);
  p.set("sens", dir);
  return `${path}?${p.toString()}#cx-table-${tableId}`;
}

// --- Graphiques et modèle de chapitre -----------------------------------------------------------------------------------------------

// Graphique d'un chapitre : séries déjà calculées (null = n.d. avec raison), unité nommée (jamais de fonction), et le tableau exact
// qui l'accompagne (tableId).
export type CroiseeChart = {
  id: string;
  title: string;
  kind: "barres" | "courbe" | "cascade" | "anneau";
  unit: UnitName; // eur (centimes) | etp (dix-millièmes) | nombre | bps (points de base)
  categories: string[];
  categoryTitles?: string[];
  series: ChartSeries[];
  mode?: "grouped" | "stacked";
  trend?: "cost"; // cascade en euros : hausse de coût rouge, baisse verte
  tableId: string;
};

// Ce que rend un chapitre vivant, construit par une fonction pure build<Chapitre>(…) de src/lib/viz/croisee-<chapitre>.ts : l'écran
// et les exports partent du même modèle.
export type ChapterModel = {
  chapter: ChapterId;
  tiles: TileSpec[];
  alerts: AlertSpec[];
  tables: CroiseeTable[];
  charts: CroiseeChart[];
  limits: string[]; // limites de lecture, une ligne chacune
  nd: { reason: string; action?: { href: string; label: string } } | null; // chapitre entier non calculable
  terms: string[];
};
