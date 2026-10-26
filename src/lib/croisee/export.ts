import { chapterDef } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/chapitres";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { ExportOption } from "@/components/ExportMenu";
import type { SourceId } from "@/lib/connectors/types";
import { dateFmt, journalReason, openMonthsText } from "@/lib/croisee/format";
import { monthEnd } from "@/lib/dates";
import { safeText } from "@/lib/export/safe-text";
import { loadSourceInputs, sourceRows, type SourceInput, type SourceRequest } from "@/lib/export/sources";
import { definitionsFor, SHEET_NAME_MAX, type ColumnKind, type ExactCell, type ExportCell, type FilterSpec, type SheetSpec, type SourceSpec, type WorkbookSpec } from "@/lib/export/xlsx";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { roundHalfUp } from "@/lib/rh/kpi/fraction";
import {
  cellKind,
  cellView,
  croiseeHref,
  DEFAULT_CHAPTER,
  isChapterId,
  roundDecimal,
  shownValue,
  sortRows,
  sortState,
  type ChapterId,
  type ChapterModel,
  type CroiseeCell,
  type CroiseeColumn,
  type CroiseeRow,
  type CroiseeTable,
  type QueryState,
  type SortDir,
  type TileSpec,
} from "@/lib/viz/croisee";
import { absencesModel } from "@/lib/viz/croisee-absences";
import { budgetModel, effetsModel } from "@/lib/viz/croisee-budget";
import { effectifsModel } from "@/lib/viz/croisee-effectifs";
import { fixeVariableModel, SERVICES_DEFAULT_SORT, SERVICES_IDS, servicesModel } from "@/lib/viz/croisee-masse";
import { paieComptaModel } from "@/lib/viz/croisee-paie";
import { syntheseModel } from "@/lib/viz/croisee-synthese";

// Exports de la Masse salariale croisée : Excel du chapitre (« Chiffres clés » des cartes, une feuille par tableau de l'écran, puis
// « Non disponibles », « Filtres », « Sources » et « Définitions ») et CSV d'un tableau. Ils partent du MÊME modèle que l'écran : la
// fonction <chapitre>Model de src/lib/viz/croisee-<chapitre>.ts, mémoïsée par contexte de requête, que le composant du chapitre
// appelle aussi (un seul calcul par affichage). Aucun calcul nouveau : mise en forme de valeurs déjà calculées. Un n.d. reste n.d.
// avec sa raison, jamais zéro ; une cellule vide est sans objet ; un texte passe par safeText (jamais pris pour une formule), un
// nombre jamais. Code serveur seulement.

// --- Modèle exportable --------------------------------------------------------------------------------------------------------------

// Ce que l'export lit d'un modèle de chapitre : le contrat commun, plus les blocs (tableaux affichés, n.d., lignes courtes), les
// mentions « Prévu » et les raisons des n.d. des cartes que la plupart des chapitres ajoutent. Les modèles des chapitres y sont
// assignables tels quels.
type NdLike = { label?: string; reason: string };
type PrevuLike = { label: string; reason: string };
export type ExportBlock = { id: string; title: string; tables: string[]; charts?: string[]; nd: NdLike[]; notes?: string[]; prevu?: PrevuLike[] };
export type ExportModel = Pick<ChapterModel, "chapter" | "tiles" | "tables" | "limits" | "nd" | "terms"> & {
  charts: { id: string; tableId: string }[];
  blocks?: ExportBlock[];
  prevu?: PrevuLike[];
  tileNd?: string[]; // raisons des n.d. des lignes de cartes, écrites une fois sous les cartes
};

// Sources lues par un chapitre (feuille « Sources ») ; budget et scénario sont des saisies de Clair.
export type SourceUse = "rh" | "journal" | "compta" | "dsn" | "budget" | "scenario";
// Ce dont dépendent les lectures d'un chapitre : un service retenu dans les filtres, et le journal de paie réellement lu.
export type UsesIn = { filtered: boolean; journal: boolean };
export type DefaultSort = { table: string; key: string; dir: SortDir };

export type ChapterExport = {
  model: (ctx: CroiseeContext) => Promise<ExportModel>; // la fonction mémoïsée du chapitre, celle qu'appelle Ch<Chapitre>.tsx
  sorted: boolean; // l'écran trie ses tableaux triables par l'adresse (tri, sens)
  defaultSort?: DefaultSort; // ordre des lignes du modèle quand l'adresse n'en demande aucun (écrit dans « Filtres »)
  uses: (u: UsesIn) => SourceUse[]; // sources réellement lues par le chargeur du chapitre
};

// Registre des chapitres vivants : la fonction <chapitre>Model du composant du chapitre, rien d'autre (aucun second calcul). Les
// chapitres « Prévu » (09, 10) n'y figurent pas : ils n'ont aucun tableau. `uses` suit les lectures de load<Chapitre>Input.
export const CROISEE_EXPORTS: Readonly<Partial<Record<ChapterId, ChapterExport>>> = {
  // Sous un filtre de service, seul le journal (restreint au service) est lu : référentiel RH, budget et scénario, globaux, sont
  // « non filtrables ». Sans filtre, la comptabilité et la DSN ne servent qu'aux contrôles du journal : lues seulement avec lui.
  synthese: { model: syntheseModel, sorted: false, uses: (u) => (u.filtered ? ["journal"] : ["rh", "journal", "budget", "scenario", ...(u.journal ? (["compta", "dsn"] as const) : [])]) },
  effectifs: { model: effectifsModel, sorted: false, uses: () => ["rh", "journal"] },
  // Sous un filtre de service, rien n'est lu (chaque bloc est « non filtrable par service »).
  absences: { model: absencesModel, sorted: false, uses: (u) => (u.filtered ? [] : ["rh"]) },
  "fixe-variable": { model: fixeVariableModel, sorted: false, uses: () => ["journal"] },
  services: { model: servicesModel, sorted: true, defaultSort: { table: SERVICES_IDS.table, ...SERVICES_DEFAULT_SORT }, uses: () => ["journal"] },
  // Budget saisi et scénario sont globaux : non lus sous un filtre de service. Le référentiel RH n'alimente aucun chiffre affiché.
  budget: { model: budgetModel, sorted: false, uses: (u) => (u.filtered ? ["journal"] : ["journal", "budget", "scenario"]) },
  // Comptabilité et DSN ne portent pas le service du journal : non lues sous un filtre de service.
  "paie-compta": { model: paieComptaModel, sorted: false, uses: (u) => (u.filtered ? ["journal"] : ["journal", "compta", "dsn"]) },
  // Le scénario ne sert qu'à des liens : aucune valeur exportée n'en dépend.
  effets: { model: effetsModel, sorted: false, uses: () => ["journal", "rh"] },
};

export type ExportLookup = { kind: "ok"; id: ChapterId; entry: ChapterExport } | { kind: "unknown"; reason: string } | { kind: "prevu"; id: ChapterId; reason: string };

// Chapitre demandé par l'adresse : absent = Synthèse (comme la page) ; inconnu ou « Prévu » : refusé avec la raison.
export function chapterExport(raw: string | null | undefined): ExportLookup {
  const v = (raw ?? "").trim();
  const id = v === "" ? DEFAULT_CHAPTER : v;
  if (!isChapterId(id)) return { kind: "unknown", reason: `Chapitre inconnu : ${shownValue(v)}.` };
  const def = chapterDef(id);
  const found = CROISEE_EXPORTS[id];
  if (def.statut === "prevu" || !found) return { kind: "prevu", id, reason: `Chapitre ${def.num} · ${def.title} : « Prévu », aucun tableau à exporter dans cette version.` };
  return { kind: "ok", id, entry: found };
}

// Sources du chapitre pour ce contexte : filtre de service de l'adresse et journal de paie lu ou non (lecteur mémoïsé du contexte,
// déjà chargé par la page et par le chapitre).
export async function sourceUses(ctx: Pick<CroiseeContext, "service" | "load">, entry: Pick<ChapterExport, "uses">): Promise<SourceUse[]> {
  const pay = await ctx.load.payroll();
  return entry.uses({ filtered: ctx.service.value !== undefined, journal: journalReason(pay) === null });
}

// --- Tableaux de l'écran ---------------------------------------------------------------------------------------------------------

const isNd = (c: CroiseeCell | undefined): c is { nd: string } => typeof c === "object" && c !== null && "nd" in c;
const allRows = (t: CroiseeTable, rows: CroiseeRow[] = t.rows): CroiseeRow[] => [...rows, ...(t.foot ? [t.foot] : [])];

// Identifiants des tableaux affichés : ceux qu'un bloc liste, et le tableau exact de chaque graphique d'un bloc. Un modèle sans
// blocs affiche tous ses tableaux.
function shownIds(model: ExportModel): Set<string> | null {
  if (!model.blocks) return null;
  const charts = new Set(model.blocks.flatMap((b) => b.charts ?? []));
  return new Set([...model.blocks.flatMap((b) => b.tables), ...model.charts.filter((c) => charts.has(c.id)).map((c) => c.tableId)]);
}

// Tableaux de l'écran, dans l'ordre du modèle. La forme exportable d'un bloc n.d. (tableau d'une ligne, jamais affiché) n'en fait
// pas partie : sa raison va dans la feuille « Non disponibles ».
export function screenTables(model: ExportModel): CroiseeTable[] {
  const ids = shownIds(model);
  return ids ? model.tables.filter((t) => ids.has(t.id)) : model.tables;
}

export type SortQuery = { tri: string | null; sens: SortDir | null };
export type SortedTable = { table: CroiseeTable; key: string; dir: SortDir; byDefault?: boolean };

// Lignes dans l'ordre de l'écran : tri de l'adresse pour un chapitre qui trie (Services), sinon l'ordre du modèle. Le total ne bouge pas.
export function screenRows(t: CroiseeTable, sort: SortQuery | null): { rows: CroiseeRow[]; sorted: SortedTable | null } {
  const s = sort && t.columns.some((c) => c.sortable) ? sortState(t, sort.tri, sort.sens) : null;
  return s ? { rows: sortRows(t, s.key, s.dir), sorted: { table: t, key: s.key, dir: s.dir } } : { rows: t.rows, sorted: null };
}

// Tri de chaque tableau de l'écran, repris dans la feuille « Filtres » : celui de l'adresse, sinon le tri par défaut du chapitre
// (ordre dans lequel le modèle range déjà ses lignes).
export const sortedTables = (model: ExportModel, sort: SortQuery | null, byDefault: DefaultSort | null = null): SortedTable[] =>
  screenTables(model).flatMap((t) => {
    const s = screenRows(t, sort).sorted;
    if (s) return [s];
    return byDefault && byDefault.table === t.id ? [{ table: t, key: byDefault.key, dir: byDefault.dir, byDefault: true }] : [];
  });

// --- Cellules ---------------------------------------------------------------------------------------------------------------------

// Cellule du classeur : la cellule du modèle telle quelle (buildWorkbook écrit les centimes en euros, les dix-millièmes en ETP, les
// points de base en pourcentage, une valeur exacte sans arrondi, un texte par safeText) ; « » = sans objet ; jamais un zéro inventé.
// Une valeur que l'écran ne sait pas écrire est n.d. avec la raison que donne l'écran (cellView).
export function exportCell(cell: CroiseeCell | undefined, col: CroiseeColumn, row?: Pick<CroiseeRow, "kind">): ExportCell {
  if (cell === undefined || cell === "") return "";
  if (isNd(cell)) return cell;
  const why = cellView(cell, col, row).nd;
  return why !== null ? { nd: why } : cell;
}

// Nombre décimal français sans séparateur de milliers ni unité, signe moins ASCII : 123456 en centièmes → « 1234,56 ».
function plain(units: bigint | number, decimals: number): string {
  const u = BigInt(units);
  const neg = u < 0n;
  const a = neg ? -u : u;
  const scale = 10n ** BigInt(decimals);
  const frac = decimals ? `,${(a % scale).toString().padStart(decimals, "0")}` : "";
  return `${neg ? "-" : ""}${a / scale}${frac}`;
}

// Cellule CSV, avant guillemets : le nombre que l'écran affiche, avec le même arrondi (cellView), en décimal français (comme le CSV de
// l'écart budgétaire) : euros au centime, ETP au centième, pourcentage et points au centième (5,34 pour 5,34 %), nombre entier.
// n.d. (ou valeur que l'écran ne sait pas écrire) → « n.d. (raison de l'écran) » ; sans objet → vide ; texte → le texte de l'écran
// (date ISO → jj/mm/aaaa) passé par safeText.
export function csvCell(cell: CroiseeCell | undefined, col: CroiseeColumn, row?: Pick<CroiseeRow, "kind">): string {
  if (cell === undefined || cell === "") return "";
  const view = cellView(cell, col, row);
  if (view.nd !== null) return `n.d. (${view.nd})`;
  if (typeof cell === "string") return safeText(view.text);
  const kind = cellKind(col, row);
  if (typeof cell === "object") return plain(roundDecimal((cell as ExactCell).exact, kind === "pourcent" ? 4 : 2)!, 2); // n.d. écarté par cellView
  if (kind === "eur" || kind === "pourcent") return plain(cell, 2); // centimes ; points de base ou centièmes de point
  if (kind === "etp") return plain(roundHalfUp({ num: cell, den: 10_000 }, 2), 2);
  return String(cell); // nombre entier ; un entier dans une colonne de texte s'écrit tel quel, comme à l'écran
}

export const CSV_BOM = "\uFEFF";
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

// Colonne ajoutée au CSV seulement (après la première), même valeur sur chaque ligne : début et fin de la période, que le CSV, sans
// feuille « Filtres », ne dirait pas autrement.
export type CsvLead = { column: CroiseeColumn; value: CroiseeCell };

// CSV d'un tableau : marque d'ordre des octets, séparateur point-virgule, fin de ligne Windows, champs entre guillemets ; en-têtes,
// lignes (dans l'ordre de l'écran) puis le total ; mêmes colonnes et mêmes cellules que l'écran, plus les colonnes `lead`.
export function tableCsv(t: CroiseeTable, rows: CroiseeRow[] = t.rows, lead: CsvLead[] = []): string {
  const [first, ...rest] = t.columns;
  const cols = [first, ...lead.map((l) => l.column), ...rest];
  const lines = [cols.map((c) => quote(safeText(c.header))).join(";")];
  for (const r of allRows(t, rows)) {
    const cells = [r.cells[0], ...lead.map((l) => l.value), ...rest.map((_, i) => r.cells[i + 1])];
    lines.push(cols.map((c, i) => quote(csvCell(cells[i], c, r))).join(";"));
  }
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

// Début et fin de la période (premier jour du premier mois, dernier jour du dernier mois) : colonnes du CSV des services.
export function periodLead(p: { months: readonly string[] }): CsvLead[] {
  if (p.months.length === 0) return [];
  return [
    { column: { key: "debut", header: "Début de période", kind: "date" }, value: `${p.months[0]}-01` },
    { column: { key: "fin", header: "Fin de période", kind: "date" }, value: monthEnd(p.months[p.months.length - 1]) },
  ];
}

// --- Chiffres clés : les cartes du chapitre en vrais nombres -----------------------------------------------------------------------

export const KEY_FIGURES_ID = "chiffres-cles";
export const KEY_FIGURES_TITLE = "Chiffres clés";
// Nombre décimal d'une carte (ETP, points, jours, moyenne) : format à deux décimales (« #,##0.00 », celui des ETP) ; l'unité est
// écrite dans la colonne « Unité ».
const DECIMAL: ColumnKind = "etp";
export const LOWER_BOUND = "borne basse : au moins cette valeur";
export const ND_WITHOUT_REASON = "raison non précisée par le chapitre";
const KEY_COLUMNS: CroiseeColumn[] = [
  { key: "carte", header: "Carte", kind: "text" },
  { key: "ligne", header: "Ligne", kind: "text" },
  { key: "valeur", header: "Valeur", kind: "nombre", width: 20 },
  { key: "unite", header: "Unité", kind: "text" },
  { key: "nature", header: "Nature", kind: "text" },
  { key: "periode", header: "Période ou repère", kind: "text" },
  { key: "observations", header: "Observations", kind: "text" },
];

export type TileNumber = { cell: CroiseeCell; kind: ColumnKind; unit: string; lower: boolean };
const UNIT_NAMES: Record<string, string> = { "€": "€", "%": "%", pt: "points", pts: "points", ETP: "ETP", personne: "personnes", personnes: "personnes", j: "jours", contrat: "contrats", contrats: "contrats" };
const NUMBER_TEXT = /^(≥ )?([+−-])?(\d{1,3}(?: \d{3})+|\d+)(?:,(\d+))?(?: (€|%|pts?|ETP|personnes?|j|contrats?))?$/;
const signed = (neg: boolean, n: number): number => (neg && n !== 0 ? -n : n);

// Nombre écrit sur une carte (texte déjà mis en forme par le chapitre), relu tel qu'il est affiché : « 1 234,56 € » → 123 456
// centimes ; « 12,34 % » → 1 234 points de base ; « +0,25 pts » → 0,25 (points) ; « ≥ 12,50 » → 12,5, borne basse ; « 1 234 » →
// 1 234. Tout autre texte (deux nombres, mot, date) → null : il est repris tel quel, jamais converti.
export function tileNumber(text: string): TileNumber | null {
  const m = NUMBER_TEXT.exec(text.replace(/[\s\u00a0\u202f]+/g, " ").trim());
  if (!m) return null;
  const [, ge, sign, intPart, dec = "", u = ""] = m;
  const neg = sign === "−" || sign === "-";
  const digits = intPart.replace(/ /g, "");
  const base = { unit: UNIT_NAMES[u] ?? "", lower: Boolean(ge) };
  if (u === "€" || u === "%") {
    if (dec.length > 2) return null;
    const units = Number(digits) * 100 + Number(dec.padEnd(2, "0"));
    return Number.isSafeInteger(units) ? { ...base, cell: signed(neg, units), kind: u === "€" ? "eur" : "pourcent" } : null;
  }
  if (dec === "") {
    const n = Number(digits);
    return Number.isSafeInteger(n) ? { ...base, cell: signed(neg, n), kind: "nombre" } : null;
  }
  const x = Number(`${digits}.${dec}`);
  return Number.isFinite(x) ? { ...base, cell: { exact: signed(neg, x) }, kind: DECIMAL } : null;
}

// Lignes d'une valeur de carte : un nombre (avec son unité) quand le texte en est un ; « A (B) » donne deux lignes quand A et B sont
// des nombres (« Évolution » et « Évolution (%) ») ; ce qui suit « · » va dans « Observations » ; tout autre texte est repris tel quel.
// n.d. → « n.d. » et la raison de la carte.
function figureRows(card: string, line: string, text: string | null, reason: string | null | undefined, o: { sub?: string; note?: string; lower?: boolean } = {}): CroiseeRow[] {
  const row = (label: string, value: CroiseeCell, n: TileNumber | null, obs: string[], first: boolean): CroiseeRow => ({
    cells: [card, label, value, n?.unit ?? "", n?.lower || (first && o.lower) ? LOWER_BOUND : "", first ? (o.sub ?? "") : "", unique(obs).join(" ; ")],
    ...(n ? { kind: n.kind } : {}),
  });
  const note = o.note ? [o.note] : [];
  if (text === null) return [row(line, { nd: reason?.trim() || ND_WITHOUT_REASON }, null, note, true)];
  const [head, ...rest] = text.split(" · ");
  const paren = /^(.*\S) \(([^()]+)\)$/.exec(head);
  const a = paren ? tileNumber(paren[1]) : null;
  if (paren && a) {
    const b = tileNumber(paren[2]);
    const rows = [row(line, a.cell, a, [...(b ? [] : [paren[2]]), ...rest, ...note], true)];
    if (b) rows.push(row(`${line} (${b.unit || "valeur"})`, b.cell, b, [], false));
    return rows;
  }
  const n = tileNumber(head);
  return [n ? row(line, n.cell, n, [...rest, ...note], true) : row(line, text, null, note, true)];
}

// Tableau « Chiffres clés » : une ligne par valeur de carte (libellé, valeur, période) puis une par ligne de variation, en vrais
// nombres, n.d. avec sa raison. null sans carte.
export function keyFiguresTable(tiles: readonly TileSpec[]): CroiseeTable | null {
  if (tiles.length === 0) return null;
  const rows = tiles.flatMap((t) => [
    ...figureRows(t.label, "Valeur", t.value.kind === "nd" ? null : t.value.text, t.value.reason, { sub: t.sub, note: t.note, lower: t.value.kind === "lower" }),
    ...(t.variations ?? []).flatMap((v) => figureRows(t.label, v.label, v.text, v.reason)),
  ]);
  return {
    id: KEY_FIGURES_ID,
    title: KEY_FIGURES_TITLE,
    columns: KEY_COLUMNS,
    rows,
    notes: ["Cartes du chapitre, valeurs telles qu'affichées (même arrondi) ; les tableaux du chapitre portent les valeurs exactes."],
  };
}

// --- Classeur ----------------------------------------------------------------------------------------------------------------------

export const ND_SHEET = "Non disponibles";
const FORBIDDEN_IN_SHEET_NAME = /[\\/?*[\]:]/g;
const POINTS_NOTE = "Écarts de taux en points : 0,25 point s'écrit 0,25 %.";
const ND_STATE = "Non disponible (n.d.)";
const unique = (list: string[]) => [...new Set(list.filter((s) => s.trim() !== ""))];

// Nom de feuille (31 caractères au plus, sans \ / ? * [ ] :) tiré du titre du tableau, coupé à la fin d'un mot.
export function sheetName(title: string): string {
  const clean = title.replace(FORBIDDEN_IN_SHEET_NAME, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= SHEET_NAME_MAX) return clean;
  const cut = clean.slice(0, SHEET_NAME_MAX);
  const space = cut.lastIndexOf(" ");
  return (space >= 12 ? cut.slice(0, space) : cut).replace(/[\s,;.·–-]+$/, "");
}

// Feuille d'un tableau : mêmes colonnes, mêmes lignes (dans l'ordre de l'écran) et même total que l'écran ; unité propre à chaque
// ligne pour les tableaux à unités mêlées. Note : titre complet s'il ne tient pas dans le nom de feuille, lignes courtes du tableau
// et de son bloc.
export function tableSheet(t: CroiseeTable, rows: CroiseeRow[] = t.rows, blockNotes: string[] = []): SheetSpec {
  const all = allRows(t, rows);
  const name = sheetName(t.title);
  const note = unique([name !== t.title ? `Tableau : ${t.title}.` : "", ...(t.notes ?? []), ...blockNotes, t.columns.some((c) => c.points) ? POINTS_NOTE : ""]).join(" ");
  return {
    name,
    columns: t.columns.map((c) => ({ header: c.header, key: c.key, kind: c.kind, ...(c.width ? { width: c.width } : {}) })),
    rows: all.map((r) => t.columns.map((c, i) => exportCell(r.cells[i], c, r))),
    rowKinds: all.map((r) => r.kind),
    ...(note ? { note } : {}),
  };
}

// Feuille « Non disponibles » : blocs n.d. et mentions « Prévu » du chapitre, raisons des n.d. des cartes (tileNd), puis la raison
// d'une forme exportable de bloc n.d. non affichée ; aucun chiffre. Une raison des cartes ou d'un tableau caché n'est ajoutée que si
// aucune ligne ne la donne déjà.
export function unavailableRows(model: ExportModel): string[][] {
  const rows: string[][] = [];
  const said = new Set<string>();
  const nd = (bloc: string, element: string, reason: string) => {
    rows.push([bloc, element, ND_STATE, reason]);
    said.add(reason);
  };
  const blocks = model.blocks ?? [];
  for (const b of blocks) {
    for (const n of b.nd) nd(b.title, n.label ?? "", n.reason);
    for (const p of b.prevu ?? []) rows.push([b.title, p.label, "Prévu", p.reason]);
  }
  for (const p of model.prevu ?? []) rows.push(["Chapitre", p.label, "Prévu", p.reason]);
  // Lignes des cartes (« libellés : raison », une par raison) : libellés et raison séparés.
  for (const line of model.tileNd ?? []) {
    const at = line.indexOf(" : ");
    const [element, reason] = at > 0 ? [line.slice(0, at), line.slice(at + 3)] : ["", line];
    if (!said.has(reason)) nd("Cartes", element, reason);
  }
  const ids = shownIds(model);
  if (ids) {
    for (const t of model.tables.filter((x) => !ids.has(x.id))) {
      for (const c of t.rows.flatMap((r) => r.cells)) if (isNd(c) && !said.has(c.nd)) nd(t.title, "", c.nd);
    }
  }
  return rows;
}

// Identifiants du glossaire de la feuille « Définitions » : ceux des tableaux (et de leurs en-têtes), des cartes et du chapitre, puis
// ceux de toute la page croisée.
export function exportTermIds(model: ExportModel, tables: CroiseeTable[] = screenTables(model)): string[] {
  return unique([
    ...tables.flatMap((t) => [...(t.terms ?? []), ...t.columns.flatMap((c) => (c.term ? [c.term] : []))]),
    ...model.tiles.flatMap((t) => (t.term ? [t.term] : [])),
    ...model.terms,
    T.vueEnsemble,
    T.periodeFiltres,
    T.unites,
    T.nd,
    ...(model.prevu?.length || model.blocks?.some((b) => b.prevu?.length) ? [T.prevu] : []),
    T.export,
  ]);
}

export type WorkbookIn = {
  title: string;
  workspaceName: string;
  generatedAt: string; // instant ISO avec fuseau, fourni par l'appelant
  model: ExportModel;
  sort: SortQuery | null;
  filters: FilterSpec[];
  sources: SourceSpec[];
};

// Description du classeur (pure) : « Chiffres clés » (cartes), une feuille par tableau de l'écran, « Non disponibles » s'il y a lieu,
// puis les feuilles fixes de buildWorkbook. Renvoie aussi les identifiants de glossaire inconnus.
export function chapterWorkbook(x: WorkbookIn): { spec: WorkbookSpec; unknownTerms: string[] } {
  const tables = screenTables(x.model);
  const key = keyFiguresTable(x.model.tiles);
  const sheets: SheetSpec[] = [
    ...(key ? [tableSheet(key)] : []),
    ...tables.map((t) => {
      const notes = (x.model.blocks ?? []).filter((b) => b.tables.includes(t.id) || x.model.charts.some((c) => c.tableId === t.id && (b.charts ?? []).includes(c.id))).flatMap((b) => b.notes ?? []);
      return tableSheet(t, screenRows(t, x.sort).rows, notes);
    }),
  ];
  const nd = unavailableRows(x.model);
  if (nd.length > 0) {
    sheets.push({
      name: ND_SHEET,
      columns: [
        { header: "Bloc", key: "bloc", kind: "text", width: 40 },
        { header: "Élément", key: "element", kind: "text", width: 34 },
        { header: "État", key: "etat", kind: "text", width: 22 },
        { header: "Raison", key: "raison", kind: "text", width: 80 },
      ],
      rows: nd,
      note: "Blocs non calculés, raisons des n.d. des cartes et indicateurs « Prévu » du chapitre.",
    });
  }
  const { definitions, unknown } = definitionsFor(exportTermIds(x.model, tables));
  return { spec: { title: x.title, workspaceName: x.workspaceName, generatedAt: x.generatedAt, filters: x.filters, sheets, sources: x.sources, definitions }, unknownTerms: unknown };
}

// --- Filtres -----------------------------------------------------------------------------------------------------------------------

export type FilterCtx = Pick<CroiseeContext, "chapter" | "period" | "periodNd" | "labels" | "service" | "budget" | "scenario" | "openMonths" | "notices">;
const ndValue = (reason: string | null, fallback: string) => `n.d. — ${reason ?? fallback}`;

// Ligne « Service » : le service retenu et son axe ; au chapitre 05, qui montre tous les services quel que soit le filtre, le service
// retenu est cité sans restreindre les chiffres.
function serviceValue(ctx: Pick<FilterCtx, "chapter" | "service">): string {
  const s = ctx.service;
  if (ctx.chapter.id === "services" && s.value !== undefined) return `Tous les services (le service « ${s.label} » retenu ne restreint pas ce chapitre)`;
  return s.axis ? `${s.label} (axe analytique « ${s.axis} »)` : s.reason ? `${s.label} — ventilation par service n.d. : ${s.reason}` : s.label;
}

// Feuille « Filtres » : chapitre, période, N-1, service (et son axe), budget et scénario quand le chapitre les lit, mois non clos,
// paramètres d'adresse écartés, tri des tableaux, limites de la lecture du chapitre (une ligne chacune).
export function croiseeFilters(ctx: FilterCtx, model: Pick<ExportModel, "limits">, uses: SourceUse[], sorted: SortedTable[] = []): FilterSpec[] {
  const out: FilterSpec[] = [{ label: "Chapitre", value: `${ctx.chapter.num} · ${ctx.chapter.title}` }];
  if (ctx.period) out.push({ label: "Période", value: ctx.labels.period }, { label: "N-1", value: ctx.labels.prev });
  else out.push({ label: "Période", value: ndValue(ctx.periodNd, "aucun mois disponible") });
  out.push({ label: "Service", value: serviceValue(ctx) });
  if (uses.includes("budget")) {
    const b = ctx.budget;
    out.push({ label: "Budget saisi", value: b.selected ? `« ${b.selected.name} » · modifié le ${dateFmt.format(b.selected.updatedAt)} · ${b.explicit ? "choisi dans les filtres" : "par défaut, le plus récent de l'année"}` : ndValue(b.reason, "aucun budget saisi") });
  }
  if (uses.includes("scenario")) {
    const sc = ctx.scenario.selected?.scenario;
    out.push({ label: "Scénario", value: sc ? `« ${sc.name} » · ${sc.status === "fige" ? "figé" : "brouillon"} · ${ctx.scenario.explicit ? "choisi dans les filtres" : "par défaut, le plus récent qui couvre l'année"}` : ndValue(ctx.scenario.reason, "aucun scénario") });
  }
  if (ctx.openMonths.length > 0) out.push({ label: "Mois non clos (montants provisoires)", value: openMonthsText(ctx) });
  if (ctx.notices.length > 0) out.push({ label: "Paramètres ignorés", value: ctx.notices.join(" ; ") });
  for (const x of sorted) {
    const col = x.table.columns.find((c) => c.key === x.key);
    out.push({ label: `Tri du tableau « ${x.table.title} »`, value: `${col?.header ?? x.key}, ordre ${x.dir === "asc" ? "croissant" : "décroissant"}${x.byDefault ? " (par défaut)" : ""}` });
  }
  for (const l of model.limits) out.push({ label: "Limite de la lecture", value: l });
  return out;
}

// --- Sources -----------------------------------------------------------------------------------------------------------------------

const RH_USAGE = { payfit: "référentiel Collaborateurs : contrats, quotités et absences", dsn: "référentiel Collaborateurs : contrats et quotités déclarés" } as const;
export const JOURNAL_USAGE = "journal comptable de paie (masse, brut, cotisations, services)";

// Feuille « Sources » : source RH retenue (les deux si aucune ne l'est), journal de paie PayFit, DSN de contrôle, comptabilité
// retenue, et les saisies de Clair (budget, scénario). Dates de lecture lues par sources.ts, pour l'espace du contexte. Journal non
// lu (lecture PayFit absente ou incomplète, ou source RH = DSN) : ligne « n.d. » avec la raison de la page (journalReason), avec la
// dernière lecture PayFit mais jamais de « lecture appliquée » (aucun chiffre n'en est tiré).
export async function croiseeSources(ctx: Pick<CroiseeContext, "workspace" | "load">, uses: SourceUse[]): Promise<SourceSpec[]> {
  const usage = new Map<SourceId, string[]>();
  const add = (p: SourceId, u: string) => usage.set(p, [...(usage.get(p) ?? []), u]);
  const extra: SourceInput[] = [];
  const pay = uses.includes("rh") || uses.includes("journal") ? await ctx.load.payroll() : null;
  if (pay && uses.includes("rh")) {
    for (const p of pay.source ? [pay.source] : (["payfit", "dsn"] as const)) add(p, RH_USAGE[p]);
  }
  const journalNd = pay && uses.includes("journal") ? journalReason(pay) : null;
  if (pay && uses.includes("journal") && journalNd === null) add("payfit", JOURNAL_USAGE);
  if (uses.includes("dsn")) add("dsn", "contrôle : brut déclaré");
  if (uses.includes("compta")) {
    const c = await ctx.load.compta();
    if (c.source) add(c.source, "comptabilité : charges de personnel (rapprochement avec le journal de paie)");
    else extra.push({ label: "Comptabilité", usage: `charges de personnel — n.d. : ${c.reason}`, last: null, applied: null, neverStatus: "Aucune source comptable retenue" });
  }
  const saisies = [uses.includes("budget") ? "budget saisi" : null, uses.includes("scenario") ? "scénario" : null].filter((x): x is string => x !== null);
  if (saisies.length) extra.push({ label: "Hypothèses budgétaires", usage: `${saisies.join(" et ")} retenus dans les filtres`, last: null, applied: null, neverStatus: "Saisie dans Clair" });
  const requests: SourceRequest[] = [...usage].map(([provider, u]) => ({ provider, usage: u.join(" ; ") }));
  if (journalNd !== null) requests.push({ provider: "payfit", usage: `${JOURNAL_USAGE} — n.d. : ${journalNd}` });
  const loaded = await loadSourceInputs(ctx.workspace.id, requests);
  const rows = journalNd === null ? loaded : loaded.map((s, i) => (i === requests.length - 1 ? { ...s, applied: null, neverStatus: "Jamais synchronisée" } : s));
  return sourceRows([...rows, ...extra]);
}

// --- Adresses, noms de fichiers et menu « Exporter » ------------------------------------------------------------------------------

type HrefCtx = Pick<CroiseeContext, "base" | "state">;

// Adresse d'un export : les choix de la page (période, service, budget, scénario, tri ; jamais l'affichage), puis le format.
export function exportHref(ctx: HrefCtx, patch: QueryState, extra: Record<string, string>): string {
  const href = croiseeHref(`${ctx.base}/export`, { ...ctx.state, affichage: null, ...patch });
  const [path, qs = ""] = href.split("?");
  const p = new URLSearchParams(qs);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return `${path}?${p.toString()}`;
}

export const SERVICES_EXPORT_LABEL = "Exporter les services (CSV)";
export type MenuCtx = HrefCtx & Pick<CroiseeContext, "chapter" | "service" | "period">;

// Options du menu « Exporter » : l'Excel du chapitre en premier (cartes et tableaux de l'écran), puis le CSV de chaque tableau de
// l'écran ; rien de cela pour un modèle n.d. ou absent (échec du calcul). « Exporter les services » (CSV du tableau par service,
// chapitre 05) est proposé dans chaque chapitre dès qu'un axe de service est retenu et qu'une période existe, quel que soit l'état
// du modèle du chapitre courant (il est calculé par la route, sur le chapitre 05).
export function exportOptions(ctx: MenuCtx, model: ExportModel | null): ExportOption[] {
  const out: ExportOption[] = [];
  if (model && !model.nd) {
    const tables = screenTables(model);
    if (tables.length > 0 || model.tiles.length > 0) out.push({ label: "Excel du chapitre (.xlsx)", href: exportHref(ctx, {}, { format: "xlsx" }), testid: "cx-export-xlsx" });
    for (const t of tables) {
      const services = model.chapter === "services" && t.id === SERVICES_IDS.table;
      out.push({ label: services ? SERVICES_EXPORT_LABEL : `CSV · ${t.title}`, href: exportHref(ctx, {}, { format: "csv", tableau: t.id }), testid: services ? "cx-export-services" : `cx-export-csv-${t.id}` });
    }
  }
  if (ctx.chapter.id !== "services" && ctx.service.axis && ctx.period) {
    out.push({ label: SERVICES_EXPORT_LABEL, href: exportHref(ctx, { chapitre: "services", tri: null, sens: null }, { format: "csv", tableau: SERVICES_IDS.table }), testid: "cx-export-services" });
  }
  return out;
}

// Menu de la page : rien pour un chapitre « Prévu » ou sans période ; sinon le modèle du chapitre (la fonction mémoïsée que le
// chapitre affiché appelle ensuite : un seul calcul) donne la liste exacte des tableaux. Un modèle qui ne se construit pas ne donne
// que « Exporter les services » s'il y a lieu : le chapitre, qui attend le même calcul, affiche l'erreur à sa place.
export async function croiseeExportOptions(ctx: CroiseeContext): Promise<ExportOption[]> {
  const found = chapterExport(ctx.chapter.id);
  if (found.kind !== "ok" || !ctx.period) return [];
  const model = await found.entry.model(ctx).catch(() => null);
  return exportOptions(ctx, model);
}

// Nom de fichier : « masse-salariale-croisee-<chapitre ou tableau>-<année>-<premier mois>-<dernier mois> ».
export function exportFileName(ctx: Pick<CroiseeContext, "chapter" | "period">, tableId?: string): string {
  const id = ctx.chapter.id;
  const what = tableId ? (tableId.startsWith(id) ? tableId : `${id}-${tableId}`) : id;
  const p = ctx.period;
  return `masse-salariale-croisee-${what}${p ? `-${p.year}-${p.from}-${p.to}` : ""}`;
}

// --- Export d'un chapitre ---------------------------------------------------------------------------------------------------------

export type ExportResult =
  | { kind: "xlsx"; spec: WorkbookSpec; file: string; unknownTerms: string[] }
  | { kind: "csv"; body: string; file: string }
  | { kind: "refused"; status: 404 | 422; reason: string };

// Classeur du chapitre ou CSV d'un tableau, depuis le modèle du chapitre (même fonction mémoïsée, mêmes paramètres d'adresse que
// l'écran). Chapitre non calculable : refus 422 avec la raison ; tableau absent de l'écran : 404 ; forme exportable d'un bloc n.d. :
// 422. Le CSV des services porte en plus le début et la fin de la période.
export async function croiseeExport(ctx: CroiseeContext, found: ChapterExport, req: { format: "xlsx" | "csv"; tableau?: string; generatedAt: string }): Promise<ExportResult> {
  const model = await found.model(ctx);
  if (model.nd) return { kind: "refused", status: 422, reason: `n.d. — ${model.nd.reason}` };
  const sort: SortQuery | null = found.sorted ? { tri: ctx.query.tri, sens: ctx.query.sens } : null;
  if (req.format === "csv") {
    const t = screenTables(model).find((x) => x.id === req.tableau);
    if (!t) {
      const hidden = model.tables.find((x) => x.id === req.tableau);
      const why = hidden?.rows.flatMap((r) => r.cells).find(isNd);
      return why ? { kind: "refused", status: 422, reason: `n.d. — ${why.nd}` } : { kind: "refused", status: 404, reason: `Tableau introuvable dans ce chapitre : ${shownValue(req.tableau ?? "")}.` };
    }
    const lead = model.chapter === "services" && t.id === SERVICES_IDS.table && ctx.period ? periodLead(ctx.period) : [];
    return { kind: "csv", body: tableCsv(t, screenRows(t, sort).rows, lead), file: exportFileName(ctx, t.id) };
  }
  const uses = await sourceUses(ctx, found);
  const { spec, unknownTerms } = chapterWorkbook({
    title: `Masse salariale croisée — ${ctx.chapter.num} ${ctx.chapter.title}`,
    workspaceName: ctx.workspace.name,
    generatedAt: req.generatedAt,
    model,
    sort,
    filters: croiseeFilters(ctx, model, uses, sortedTables(model, sort, found.defaultSort ?? null)),
    sources: await croiseeSources(ctx, uses),
  });
  return { kind: "xlsx", spec, file: exportFileName(ctx), unknownTerms };
}
