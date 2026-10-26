import { chapterDef } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/chapitres";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { dateFmt, openMonthsText } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { ExportOption } from "@/components/ExportMenu";
import type { SourceId } from "@/lib/connectors/types";
import { formatDate, isIsoDate } from "@/lib/dates";
import { safeText } from "@/lib/export/safe-text";
import { loadSourceInputs, sourceRows, type SourceInput, type SourceRequest } from "@/lib/export/sources";
import { definitionsFor, type ColumnKind, type ExportCell, type FilterSpec, type SheetSpec, type SourceSpec, type WorkbookSpec } from "@/lib/export/xlsx";
import { CROISEE_TERMS as T } from "@/lib/glossary/croisee";
import { roundHalfUp } from "@/lib/rh/kpi/fraction";
import {
  cellKind,
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
} from "@/lib/viz/croisee";
import { buildAbsences, loadAbsencesInput } from "@/lib/viz/croisee-absences";
import { buildBudget, buildEffets, loadBudgetInput, loadEffetsInput } from "@/lib/viz/croisee-budget";
import { buildEffectifs, loadEffectifsInput } from "@/lib/viz/croisee-effectifs";
import { buildFixeVariable, buildServices, loadFixeVariableInput, loadServicesInput, SERVICES_IDS } from "@/lib/viz/croisee-masse";
import { buildPaieCompta, loadPaieComptaInput } from "@/lib/viz/croisee-paie";
import { buildSynthese, loadSyntheseInput } from "@/lib/viz/croisee-synthese";

// Exports de la Masse salariale croisée : Excel du chapitre (une feuille par tableau de l'écran, puis « Non disponibles », « Filtres »,
// « Sources » et « Définitions ») et CSV d'un tableau. Ils partent du MÊME modèle que l'écran : la paire load…Input / build… de
// chaque chapitre vivant (src/lib/viz/croisee-<chapitre>.ts), avec les mêmes paramètres d'adresse et le même tri. Aucun calcul
// nouveau : mise en forme de cellules déjà calculées. Un n.d. reste n.d. avec sa raison, jamais zéro ; une cellule vide est sans
// objet ; un texte passe par safeText (jamais pris pour une formule), un nombre jamais. Code serveur seulement.

// --- Modèle exportable --------------------------------------------------------------------------------------------------------------

// Ce que l'export lit d'un modèle de chapitre : le contrat commun, plus les blocs (tableaux affichés, n.d., lignes courtes) et les
// mentions « Prévu » que la plupart des chapitres ajoutent. Les modèles des chapitres y sont assignables tels quels.
type NdLike = { label?: string; reason: string };
type PrevuLike = { label: string; reason: string };
export type ExportBlock = { id: string; title: string; tables: string[]; charts?: string[]; nd: NdLike[]; notes?: string[]; prevu?: PrevuLike[] };
export type ExportModel = Pick<ChapterModel, "chapter" | "tiles" | "tables" | "limits" | "nd" | "terms"> & {
  charts: { id: string; tableId: string }[];
  blocks?: ExportBlock[];
  prevu?: PrevuLike[];
};

// Sources lues par un chapitre (feuille « Sources ») ; budget et scénario sont des saisies de Clair.
export type SourceUse = "rh" | "journal" | "compta" | "dsn" | "budget" | "scenario";

export type ChapterExport = {
  load: (ctx: CroiseeContext) => Promise<unknown>;
  build: (input: never) => ExportModel;
  model: (ctx: CroiseeContext) => Promise<ExportModel>;
  sorted: boolean; // l'écran trie ses tableaux triables par l'adresse (tri, sens)
  uses: (ctx: Pick<CroiseeContext, "service">) => SourceUse[];
};

// model : build(await load(ctx)), mémoïsé par contexte (une requête) : un second appel sur la même page ne refait pas le calcul.
function entry<I>(load: (ctx: CroiseeContext) => Promise<I>, build: (input: I) => ExportModel, uses: ChapterExport["uses"], sorted = false): ChapterExport {
  const memo = new WeakMap<CroiseeContext, Promise<ExportModel>>();
  const model = (ctx: CroiseeContext) => {
    let p = memo.get(ctx);
    if (!p) memo.set(ctx, (p = load(ctx).then(build)));
    return p;
  };
  return { load, build, model, sorted, uses };
}

// Registre des chapitres vivants : la même paire de fonctions que le composant du chapitre (Ch<Chapitre>.tsx). Les chapitres
// « Prévu » (09, 10) n'y figurent pas : ils n'ont aucun tableau.
export const CROISEE_EXPORTS: Readonly<Partial<Record<ChapterId, ChapterExport>>> = {
  // La Synthèse ne lit la comptabilité (repère journal ≠ comptabilité) que sans filtre de service.
  synthese: entry(loadSyntheseInput, buildSynthese, (c) => ["rh", "journal", "budget", "scenario", ...(c.service.value === undefined ? (["compta"] as const) : [])]),
  effectifs: entry(loadEffectifsInput, buildEffectifs, () => ["rh", "journal"]),
  absences: entry(loadAbsencesInput, buildAbsences, () => ["rh"]),
  "fixe-variable": entry(loadFixeVariableInput, buildFixeVariable, () => ["journal"]),
  services: entry(loadServicesInput, buildServices, () => ["journal"], true),
  budget: entry(loadBudgetInput, buildBudget, () => ["journal", "rh", "budget", "scenario"]),
  "paie-compta": entry(loadPaieComptaInput, buildPaieCompta, () => ["journal", "compta", "dsn"]),
  effets: entry(loadEffetsInput, buildEffets, () => ["journal", "rh", "scenario"]),
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

// --- Tableaux de l'écran ---------------------------------------------------------------------------------------------------------

const isNd = (c: CroiseeCell | undefined): c is { nd: string } => typeof c === "object" && c !== null && "nd" in c;
const allRows = (t: CroiseeTable, rows: CroiseeRow[] = t.rows): CroiseeRow[] => [...rows, ...(t.foot ? [t.foot] : [])];

// Identifiants des tableaux affichés : ceux qu'un bloc liste, et le tableau exact de chaque graphique d'un bloc. Un modèle sans
// blocs (Synthèse) affiche tous ses tableaux.
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
export type SortedTable = { table: CroiseeTable; key: string; dir: SortDir };

// Lignes dans l'ordre de l'écran : tri de l'adresse pour un chapitre qui trie (Services), sinon l'ordre du modèle. Le total ne bouge pas.
export function screenRows(t: CroiseeTable, sort: SortQuery | null): { rows: CroiseeRow[]; sorted: SortedTable | null } {
  const s = sort && t.columns.some((c) => c.sortable) ? sortState(t, sort.tri, sort.sens) : null;
  return s ? { rows: sortRows(t, s.key, s.dir), sorted: { table: t, key: s.key, dir: s.dir } } : { rows: t.rows, sorted: null };
}

// Tableaux de l'écran que le tri de l'adresse réordonne (repris dans la feuille « Filtres »).
export const sortedTables = (model: ExportModel, sort: SortQuery | null): SortedTable[] => screenTables(model).flatMap((t) => screenRows(t, sort).sorted ?? []);

// --- Cellules ---------------------------------------------------------------------------------------------------------------------

// Valeur que l'écran ne sait pas écrire (cellView l'affiche n.d. avec cette raison) : même raison dans l'Excel et le CSV.
function invalidReason(cell: CroiseeCell, kind: ColumnKind): string | null {
  if (typeof cell === "number") return Number.isSafeInteger(cell) ? null : "valeur hors de l'unité de base";
  if (typeof cell !== "object" || "nd" in cell) return null;
  if (!Number.isFinite(cell.exact)) return "valeur non finie";
  if (kind === "text" || kind === "date") return "valeur numérique dans une colonne de texte";
  return roundDecimal(cell.exact, kind === "pourcent" ? 4 : 2) === null ? "valeur hors limites" : null;
}

// Cellule du classeur : la cellule du modèle telle quelle (buildWorkbook écrit les centimes en euros, les dix-millièmes en ETP, les
// points de base en pourcentage, une valeur exacte sans arrondi, un texte par safeText) ; « » = sans objet ; jamais un zéro inventé.
export function exportCell(cell: CroiseeCell | undefined, col: CroiseeColumn, row?: Pick<CroiseeRow, "kind">): ExportCell {
  if (cell === undefined || cell === "") return "";
  const why = invalidReason(cell, cellKind(col, row));
  return why ? { nd: why } : cell;
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
// n.d. → « n.d. (raison) » ; sans objet → vide ; texte → safeText ; date ISO → jj/mm/aaaa.
export function csvCell(cell: CroiseeCell | undefined, col: CroiseeColumn, row?: Pick<CroiseeRow, "kind">): string {
  const kind = cellKind(col, row);
  if (cell === undefined || cell === "") return "";
  if (isNd(cell)) return `n.d. (${cell.nd})`;
  if (typeof cell === "string") return safeText(kind === "date" && isIsoDate(cell) ? formatDate(cell) : cell);
  const why = invalidReason(cell, kind);
  if (why) return `n.d. (${why})`;
  if (typeof cell === "object") return plain(roundDecimal(cell.exact, kind === "pourcent" ? 4 : 2)!, 2);
  if (kind === "eur" || kind === "pourcent") return plain(cell, 2); // centimes ; points de base ou centièmes de point
  if (kind === "etp") return plain(roundHalfUp({ num: cell, den: 10_000 }, 2), 2);
  return String(cell); // nombre entier ; un entier dans une colonne de texte s'écrit tel quel, comme à l'écran
}

export const CSV_BOM = "\uFEFF";
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

// CSV d'un tableau : marque d'ordre des octets, séparateur point-virgule, fin de ligne Windows, champs entre guillemets ; en-têtes,
// lignes (dans l'ordre de l'écran) puis le total ; mêmes colonnes et mêmes cellules que l'écran.
export function tableCsv(t: CroiseeTable, rows: CroiseeRow[] = t.rows): string {
  const lines = [t.columns.map((c) => quote(safeText(c.header))).join(";")];
  for (const r of allRows(t, rows)) lines.push(t.columns.map((c, i) => quote(csvCell(r.cells[i], c, r))).join(";"));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

// --- Classeur ----------------------------------------------------------------------------------------------------------------------

export const ND_SHEET = "Non disponibles";
const SHEET_NAME_MAX = 31;
const FORBIDDEN_IN_SHEET_NAME = /[\\/?*[\]:]/g;
const POINTS_NOTE = "Écarts de taux en points : 0,25 point s'écrit 0,25 %.";
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

// Feuille « Non disponibles » : blocs n.d. et mentions « Prévu » du chapitre, avec leur raison (aucun chiffre). Une forme exportable
// de bloc n.d. qui n'est pas affichée n'y ajoute sa raison que si aucun bloc ne la donne déjà.
export function unavailableRows(model: ExportModel): string[][] {
  const rows: string[][] = [];
  const blocks = model.blocks ?? [];
  for (const b of blocks) {
    for (const n of b.nd) rows.push([b.title, n.label ?? "", "Non disponible (n.d.)", n.reason]);
    for (const p of b.prevu ?? []) rows.push([b.title, p.label, "Prévu", p.reason]);
  }
  for (const p of model.prevu ?? []) rows.push(["Chapitre", p.label, "Prévu", p.reason]);
  const ids = shownIds(model);
  if (ids) {
    const said = new Set(blocks.flatMap((b) => b.nd.map((n) => n.reason)));
    for (const t of model.tables.filter((x) => !ids.has(x.id))) {
      for (const c of t.rows.flatMap((r) => r.cells)) {
        if (!isNd(c) || said.has(c.nd)) continue;
        said.add(c.nd);
        rows.push([t.title, "", "Non disponible (n.d.)", c.nd]);
      }
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

// Description du classeur (pure) : une feuille par tableau de l'écran, « Non disponibles » s'il y a lieu, puis les feuilles fixes
// de buildWorkbook. Renvoie aussi les identifiants de glossaire inconnus.
export function chapterWorkbook(x: WorkbookIn): { spec: WorkbookSpec; unknownTerms: string[] } {
  const tables = screenTables(x.model);
  const sheets: SheetSpec[] = tables.map((t) => {
    const notes = (x.model.blocks ?? []).filter((b) => b.tables.includes(t.id) || x.model.charts.some((c) => c.tableId === t.id && (b.charts ?? []).includes(c.id))).flatMap((b) => b.notes ?? []);
    return tableSheet(t, screenRows(t, x.sort).rows, notes);
  });
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
      note: "Blocs non calculés et indicateurs « Prévu » du chapitre, avec leur raison.",
    });
  }
  const { definitions, unknown } = definitionsFor(exportTermIds(x.model, tables));
  return { spec: { title: x.title, workspaceName: x.workspaceName, generatedAt: x.generatedAt, filters: x.filters, sheets, sources: x.sources, definitions }, unknownTerms: unknown };
}

// --- Filtres -----------------------------------------------------------------------------------------------------------------------

export type FilterCtx = Pick<CroiseeContext, "chapter" | "period" | "periodNd" | "labels" | "service" | "budget" | "scenario" | "openMonths" | "notices">;
const ndValue = (reason: string | null, fallback: string) => `n.d. — ${reason ?? fallback}`;

// Feuille « Filtres » : chapitre, période, N-1, service (et son axe), budget et scénario quand le chapitre les lit, mois non clos,
// paramètres d'adresse écartés, tri du tableau, limites de la lecture du chapitre (une ligne chacune).
export function croiseeFilters(ctx: FilterCtx, model: Pick<ExportModel, "limits">, uses: SourceUse[], sorted: SortedTable[] = []): FilterSpec[] {
  const out: FilterSpec[] = [{ label: "Chapitre", value: `${ctx.chapter.num} · ${ctx.chapter.title}` }];
  if (ctx.period) out.push({ label: "Période", value: ctx.labels.period }, { label: "N-1", value: ctx.labels.prev });
  else out.push({ label: "Période", value: ndValue(ctx.periodNd, "aucun mois disponible") });
  const s = ctx.service;
  out.push({ label: "Service", value: s.axis ? `${s.label} (axe analytique « ${s.axis} »)` : s.reason ? `${s.label} — ventilation par service n.d. : ${s.reason}` : s.label });
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
    out.push({ label: `Tri du tableau « ${x.table.title} »`, value: `${col?.header ?? x.key}, ordre ${x.dir === "asc" ? "croissant" : "décroissant"}` });
  }
  for (const l of model.limits) out.push({ label: "Limite de la lecture", value: l });
  return out;
}

// --- Sources -----------------------------------------------------------------------------------------------------------------------

const RH_USAGE = { payfit: "référentiel Collaborateurs : contrats, quotités et absences", dsn: "référentiel Collaborateurs : contrats et quotités déclarés" } as const;

// Feuille « Sources » : source RH retenue (les deux si aucune ne l'est), journal de paie PayFit, DSN de contrôle, comptabilité
// retenue, et les saisies de Clair (budget, scénario). Dates de lecture lues par sources.ts, pour l'espace du contexte.
export async function croiseeSources(ctx: Pick<CroiseeContext, "workspace" | "load">, uses: SourceUse[]): Promise<SourceSpec[]> {
  const usage = new Map<SourceId, string[]>();
  const add = (p: SourceId, u: string) => usage.set(p, [...(usage.get(p) ?? []), u]);
  const extra: SourceInput[] = [];
  if (uses.includes("rh")) {
    const rh = (await ctx.load.payroll()).source;
    for (const p of rh ? [rh] : (["payfit", "dsn"] as const)) add(p, RH_USAGE[p]);
  }
  if (uses.includes("journal")) add("payfit", "journal comptable de paie (masse, brut, cotisations, services)");
  if (uses.includes("dsn")) add("dsn", "contrôle : brut déclaré");
  if (uses.includes("compta")) {
    const c = await ctx.load.compta();
    if (c.source) add(c.source, "comptabilité : charges de personnel (rapprochement avec le journal de paie)");
    else extra.push({ label: "Comptabilité", usage: `charges de personnel — n.d. : ${c.reason}`, last: null, applied: null, neverStatus: "Aucune source comptable retenue" });
  }
  const saisies = [uses.includes("budget") ? "budget saisi" : null, uses.includes("scenario") ? "scénario" : null].filter((x): x is string => x !== null);
  if (saisies.length) extra.push({ label: "Hypothèses budgétaires", usage: `${saisies.join(" et ")} retenus dans les filtres`, last: null, applied: null, neverStatus: "Saisie dans Clair" });
  const requests: SourceRequest[] = [...usage].map(([provider, u]) => ({ provider, usage: u.join(" ; ") }));
  return sourceRows([...(await loadSourceInputs(ctx.workspace.id, requests)), ...extra]);
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

// Options du menu « Exporter » : l'Excel du chapitre en premier, puis le CSV de chaque tableau de l'écran. « Exporter les services »
// (CSV du tableau par service, chapitre 05) est proposé dans chaque chapitre dès qu'un axe de service est retenu.
export function exportOptions(ctx: HrefCtx & Pick<CroiseeContext, "service">, model: ExportModel): ExportOption[] {
  const tables = screenTables(model);
  if (model.nd || tables.length === 0) return [];
  const out: ExportOption[] = [{ label: "Excel du chapitre (.xlsx)", href: exportHref(ctx, {}, { format: "xlsx" }), testid: "cx-export-xlsx" }];
  for (const t of tables) {
    const services = model.chapter === "services" && t.id === SERVICES_IDS.table;
    out.push({ label: services ? SERVICES_EXPORT_LABEL : `CSV · ${t.title}`, href: exportHref(ctx, {}, { format: "csv", tableau: t.id }), testid: services ? "cx-export-services" : `cx-export-csv-${t.id}` });
  }
  if (model.chapter !== "services" && ctx.service.axis) {
    out.push({ label: SERVICES_EXPORT_LABEL, href: exportHref(ctx, { chapitre: "services", tri: null, sens: null }, { format: "csv", tableau: SERVICES_IDS.table }), testid: "cx-export-services" });
  }
  return out;
}

// Menu de la page : rien pour un chapitre « Prévu » ou sans période ; sinon le modèle du chapitre (mêmes lecteurs mémoïsés que le
// chapitre affiché) donne la liste exacte des tableaux. Un modèle qui ne se construit pas ne donne aucun menu : le chapitre, qui
// appelle les mêmes fonctions, affiche l'erreur à sa place (elle n'est pas levée deux fois).
export async function croiseeExportOptions(ctx: CroiseeContext): Promise<ExportOption[]> {
  const found = chapterExport(ctx.chapter.id);
  if (found.kind !== "ok" || !ctx.period) return [];
  const model = await found.entry.model(ctx).catch(() => null);
  return model ? exportOptions(ctx, model) : [];
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

// Classeur du chapitre ou CSV d'un tableau, depuis le modèle du chapitre (mêmes lecteurs, mêmes paramètres d'adresse que l'écran).
// Chapitre non calculable : refus 422 avec la raison ; tableau absent de l'écran : 404 ; forme exportable d'un bloc n.d. : 422.
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
    return { kind: "csv", body: tableCsv(t, screenRows(t, sort).rows), file: exportFileName(ctx, t.id) };
  }
  const uses = found.uses(ctx);
  const { spec, unknownTerms } = chapterWorkbook({
    title: `Masse salariale croisée — ${ctx.chapter.num} ${ctx.chapter.title}`,
    workspaceName: ctx.workspace.name,
    generatedAt: req.generatedAt,
    model,
    sort,
    filters: croiseeFilters(ctx, model, uses, sortedTables(model, sort)),
    sources: await croiseeSources(ctx, uses),
  });
  return { kind: "xlsx", spec, file: exportFileName(ctx), unknownTerms };
}
