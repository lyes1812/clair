import ExcelJS from "exceljs";
import { isIsoDate } from "@/lib/dates";
import { glossaryEntry } from "@/lib/glossary";

// Export Excel générique : un classeur .xlsx construit à partir d'une description pure (aucun accès base, aucune horloge : la date
// de génération vient de l'appelant). Code SERVEUR seulement : exceljs ne doit jamais être importé par un composant client.
//
// Une cellule est un nombre ENTIER d'unité de base (centimes pour « eur », dix-millièmes pour « etp », points de base pour
// « pourcent »), une chaîne, ou { nd: raison }. Les montants sont écrits en vrais nombres (jamais en texte) pour que Excel les
// additionne ; une valeur n.d. est le texte « n.d. » avec sa raison en commentaire de cellule (et dans la colonne « Observations »
// de la feuille quand elle en a une) : jamais un zéro. Aucune formule, aucune macro.

export type ColumnKind = "text" | "eur" | "etp" | "nombre" | "pourcent" | "date";
export type NdCell = { nd: string };
export type ExportCell = number | string | NdCell;
export type ColumnSpec = { header: string; key: string; kind: ColumnKind; width?: number };
export type SheetSpec = {
  name: string;
  columns: ColumnSpec[];
  rows: ExportCell[][];
  note?: string;
  // Tableaux à unités mélangées (ETP, effectifs et montants dans la même colonne) : type d'affichage propre à chaque ligne,
  // qui remplace celui des colonnes « eur », « etp » et « nombre ». Sans effet sur les colonnes text, date et pourcent.
  rowKinds?: (ColumnKind | undefined)[];
};
export type FilterSpec = { label: string; value: string };
export type SourceSpec = { label: string; detail: string; syncedAt: string | null; status: string };
export type DefinitionSpec = { term: string; definition: string; formula?: string };
export type WorkbookSpec = {
  title: string;
  workspaceName: string;
  generatedAt: string; // instant ISO 8601 avec fuseau (« …Z »), fourni par l'appelant
  filters: FilterSpec[];
  sheets: SheetSpec[];
  sources: SourceSpec[];
  definitions: DefinitionSpec[];
};

// Formats numériques : montants « #,##0.00 » + suffixe €, ETP affichés au centième (valeur stockée exacte au dix-millième),
// pourcentages au centième de point.
export const NUM_FMT = { eur: '#,##0.00 "€"', etp: "#,##0.00", nombre: "#,##0", pourcent: "0.00%", date: "dd/mm/yyyy", datetime: "dd/mm/yyyy hh:mm" } as const;
const SCALE = { eur: 100, etp: 10_000, nombre: 1, pourcent: 10_000 } as const;
const AMOUNT_KINDS = new Set<ColumnKind>(["eur", "etp", "nombre"]);

export const SHEET_NAME_MAX = 31;
export const FIXED_SHEETS = { filters: "Filtres", sources: "Sources", definitions: "Définitions" } as const;
// Au-delà de ce nombre de colonnes, la première reste figée au défilement horizontal.
export const FREEZE_FIRST_FROM = 5;

// --- Conversions exactes -------------------------------------------------------------------------------------------------------

// num ÷ den × scale, arrondi à l'entier le plus proche (demi vers l'extérieur de zéro), en entiers exacts : passe d'un rapport
// (ETP moyen = somme ÷ nombre de mois, écart en %) à l'unité de base d'une cellule.
export function roundedRatio(num: number, den: number, scale = 1): number {
  if (!Number.isInteger(num) || !Number.isInteger(den) || !Number.isInteger(scale) || den === 0) throw new RangeError("rapport non entier ou dénominateur nul");
  let n = BigInt(num) * BigInt(scale);
  let d = BigInt(den);
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a * 2n + d) / (d * 2n);
  const r = Number(neg ? -q : q);
  if (!Number.isSafeInteger(r)) throw new RangeError("valeur hors limites");
  return r === 0 ? 0 : r;
}

// Forme commune d'un agrégat ou d'un écart déjà calculé (valeur = num ÷ den ; n.d. avec raison ; sans objet).
export type Rational = { kind: "value"; num: number; den: number } | { kind: "nd"; reason: string } | { kind: "na" };
// Cellule d'une valeur rationnelle : eur → centimes (num ÷ den), etp → dix-millièmes d'ETP, nombre → entier. n.d. reste n.d., sans objet
// donne une cellule vide.
export function rationalCell(r: Rational, unit: "eur" | "etp" | "nombre"): ExportCell {
  if (r.kind === "nd") return { nd: r.reason };
  if (r.kind === "na") return "";
  return roundedRatio(r.num, r.den, unit === "etp" ? SCALE.etp : 1);
}
// Cellule d'un écart en pourcentage : points de base. Écart n.d. → n.d. ; départ nul → n.d. (le pourcentage n'est pas défini).
export function percentCell(d: { kind: "value"; pct: { num: number; den: number } | null } | { kind: "nd"; reason: string } | { kind: "na" }): ExportCell {
  if (d.kind === "nd") return { nd: d.reason };
  if (d.kind === "na") return "";
  return d.pct ? roundedRatio(d.pct.num, d.pct.den, SCALE.pourcent) : { nd: "valeur de départ nulle" };
}

// --- Dates (Europe/Paris) ------------------------------------------------------------------------------------------------------

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const parseInstant = (s: string): Date | null => {
  if (!INSTANT.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const PARIS = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function parisParts(d: Date) {
  const p = Object.fromEntries(PARIS.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) };
}
const two = (n: number) => String(n).padStart(2, "0");
// « 15/01/2026 10:12 », heure de Paris ; une chaîne qui n'est pas un instant ISO avec fuseau est rendue telle quelle.
export function formatParis(iso: string): string {
  const d = parseInstant(iso);
  if (!d) return iso;
  const p = parisParts(d);
  return `${two(p.d)}/${two(p.mo)}/${p.y} ${two(p.h)}:${two(p.mi)}`;
}
// Excel n'a pas de fuseau : la date écrite porte l'heure de Paris telle qu'on la lit (heure murale en UTC).
function dateValue(s: string): { value: Date; fmt: string } | null {
  if (isIsoDate(s)) return { value: new Date(`${s}T00:00:00Z`), fmt: NUM_FMT.date };
  const d = parseInstant(s);
  if (!d) return null;
  const p = parisParts(d);
  return { value: new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)), fmt: NUM_FMT.datetime };
}

// --- Noms de feuilles ----------------------------------------------------------------------------------------------------------

const FORBIDDEN_IN_SHEET_NAME = /[\\/?*[\]:]/g;
function cleanSheetName(raw: string): string {
  const s = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(FORBIDDEN_IN_SHEET_NAME, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .trim();
  return s.slice(0, SHEET_NAME_MAX).trim() || "Feuille";
}
// Nom valide (≤ 31 caractères, sans caractère interdit) et unique sans tenir compte de la casse : « Écart », « Écart (2) »…
function uniqueSheetName(raw: string, taken: Set<string>): string {
  const base = cleanSheetName(raw);
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = base.slice(0, SHEET_NAME_MAX - suffix.length).trimEnd() + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

// --- Glossaire -----------------------------------------------------------------------------------------------------------------

// Définitions de l'onglet « Définitions », lues dans l'index du glossaire ; un identifiant inconnu est ignoré et listé dans `unknown`.
export function definitionsFor(ids: readonly string[]): { definitions: DefinitionSpec[]; unknown: string[] } {
  const seen = new Set<string>();
  const definitions: DefinitionSpec[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = glossaryEntry(id);
    if (!e) unknown.push(id);
    else definitions.push({ term: e.term, definition: e.definition, ...(e.formula ? { formula: e.formula } : {}) });
  }
  return { definitions, unknown };
}

// --- Mise en forme -------------------------------------------------------------------------------------------------------------

const INK = "FF111827";
const MUTED = "FF5B6475"; // gris-bleu, 5,9:1 sur blanc
const BLUE = "FF155CFF";
const RULE = "FFD5DAE5";
const FONT = {
  body: { name: "Calibri", size: 11, color: { argb: INK } },
  nd: { name: "Calibri", size: 11, italic: true, color: { argb: MUTED } },
  head: { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } },
  title: { name: "Calibri", size: 14, bold: true, color: { argb: INK } },
  meta: { name: "Calibri", size: 10, color: { argb: MUTED } },
  note: { name: "Calibri", size: 10, italic: true, color: { argb: MUTED } },
} satisfies Record<string, Partial<ExcelJS.Font>>;
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
const BORDER: Partial<ExcelJS.Borders> = { bottom: { style: "hair", color: { argb: RULE } } };
const DEFAULT_WIDTH: Record<ColumnKind, number> = { text: 14, eur: 18, etp: 14, nombre: 14, pourcent: 14, date: 18 };

const isNd = (v: unknown): v is NdCell => typeof v === "object" && v !== null && typeof (v as NdCell).nd === "string";
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const isObservations = (c: ColumnSpec) => c.key === "observations" || fold(c.header) === "observations";

type Line = { text: string; style: "title" | "meta" | "note" };
type Table = { lines: Line[]; columns: ColumnSpec[]; rows: ExportCell[][]; rowKinds?: (ColumnKind | undefined)[]; where: string };

// Écrit une cellule ; renvoie la raison quand la valeur est n.d.
function writeCell(cell: ExcelJS.Cell, v: ExportCell | undefined, kind: ColumnKind, where: string, header: string): string | null {
  const numeric = kind !== "text";
  cell.font = FONT.body;
  cell.border = BORDER;
  cell.alignment = numeric ? { horizontal: "right", vertical: "top" } : { horizontal: "left", vertical: "top", wrapText: true };
  if (v === undefined || v === "") return null; // cellule vide : valeur sans objet, jamais un zéro
  if (isNd(v)) {
    cell.value = "n.d.";
    cell.font = FONT.nd;
    cell.alignment = { horizontal: "right", vertical: "top" };
    cell.note = v.nd;
    return v.nd;
  }
  if (typeof v === "string") {
    const date = kind === "date" ? dateValue(v) : null;
    if (date) {
      cell.value = date.value;
      cell.numFmt = date.fmt;
    } else cell.value = v;
    return null;
  }
  if (!Number.isSafeInteger(v)) throw new RangeError(`${where} : colonne « ${header} », une valeur n'est pas un entier d'unité de base`);
  if (kind === "text" || kind === "date") {
    cell.value = String(v);
    return null;
  }
  cell.value = v === 0 ? 0 : v / SCALE[kind]; // division exacte (arrondie une seule fois par le calcul flottant, à 2 ou 4 décimales)
  cell.numFmt = NUM_FMT[kind];
  return null;
}

function writeTable(ws: ExcelJS.Worksheet, t: Table): void {
  const { columns, rows, where } = t;
  t.lines.forEach((l, i) => {
    const c = ws.getCell(i + 1, 1);
    c.value = l.text;
    c.font = FONT[l.style];
    c.alignment = { vertical: "middle" };
  });
  const headerRow = t.lines.length + 1;
  columns.forEach((col, i) => {
    const c = ws.getCell(headerRow, i + 1);
    c.value = col.header;
    c.font = FONT.head;
    c.fill = HEAD_FILL;
    c.alignment = { horizontal: col.kind === "text" ? "left" : "right", vertical: "middle", wrapText: true };
  });

  const obs = columns.findIndex(isObservations);
  rows.forEach((raw, r) => {
    const rowNo = headerRow + 1 + r;
    if (raw.length > columns.length) throw new RangeError(`${where} : la ligne ${r + 1} a plus de cellules que de colonnes`);
    const reasons = new Map<string, string[]>(); // raison → colonnes concernées
    const note = (reason: string, header: string) => reasons.set(reason, [...(reasons.get(reason) ?? []), header]);
    columns.forEach((col, i) => {
      if (i === obs) return;
      const kind = t.rowKinds?.[r] && AMOUNT_KINDS.has(col.kind) ? t.rowKinds[r]! : col.kind;
      const reason = writeCell(ws.getCell(rowNo, i + 1), raw[i], kind, `${where}, ligne ${r + 1}`, col.header);
      if (reason !== null) note(reason, col.header);
    });
    if (obs >= 0) {
      const own = raw[obs];
      const parts: string[] = [];
      if (typeof own === "string" && own !== "") parts.push(own);
      else if (typeof own === "number") parts.push(String(own));
      else if (isNd(own)) note(own.nd, columns[obs].header);
      for (const [reason, heads] of reasons) parts.push(`${heads.join(", ")} : ${reason}`);
      writeCell(ws.getCell(rowNo, obs + 1), parts.join(" ; "), "text", `${where}, ligne ${r + 1}`, columns[obs].header);
    }
  });

  columns.forEach((col, i) => {
    let width = col.width;
    if (width === undefined) {
      width = DEFAULT_WIDTH[col.kind];
      if (col.kind === "text") {
        const longest = (s: string) => Math.max(0, ...s.split("\n").map((x) => x.length));
        const content = Math.max(longest(col.header), ...rows.slice(0, 500).map((row) => (typeof row[i] === "string" ? longest(row[i] as string) : 0)));
        width = Math.min(60, Math.max(isObservations(col) ? 30 : 12, content + 2));
      }
    }
    ws.getColumn(i + 1).width = width;
  });

  // En-tête figée (titre compris), première colonne figée sur un tableau large, filtre automatique sur toute la plage.
  const freezeFirst = columns.length >= FREEZE_FIRST_FROM;
  ws.views = [{ state: "frozen", xSplit: freezeFirst ? 1 : 0, ySplit: headerRow, topLeftCell: `${freezeFirst ? "B" : "A"}${headerRow + 1}`, showGridLines: false }];
  if (columns.length > 0) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + rows.length, column: columns.length } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

const textCols = (...cols: [string, string, number?][]): ColumnSpec[] => cols.map(([header, key, width]) => ({ header, key, kind: "text", ...(width ? { width } : {}) }));

// --- Classeur ------------------------------------------------------------------------------------------------------------------

export async function buildWorkbook(spec: WorkbookSpec): Promise<Buffer> {
  const generated = parseInstant(spec.generatedAt);
  if (!generated) throw new RangeError("generatedAt : instant ISO 8601 avec fuseau attendu");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Clair";
  wb.lastModifiedBy = "Clair";
  wb.title = spec.title;
  wb.created = generated;
  wb.modified = generated;

  const taken = new Set<string>(["history", ...Object.values(FIXED_SHEETS).map((n) => n.toLowerCase())]);
  const meta: Line = { text: `${spec.workspaceName} · exporté le ${formatParis(spec.generatedAt)}`, style: "meta" };
  const filterLine = spec.filters.map((f) => `${f.label} : ${f.value}`).join(" · ");
  for (const sheet of spec.sheets) {
    const name = uniqueSheetName(sheet.name, taken);
    const lines: Line[] = [{ text: spec.sheets.length > 1 ? `${spec.title} — ${name}` : spec.title, style: "title" }, meta];
    if (filterLine) lines.push({ text: filterLine, style: "meta" });
    if (sheet.note) lines.push({ text: sheet.note, style: "note" });
    writeTable(wb.addWorksheet(name), { lines, columns: sheet.columns, rows: sheet.rows, rowKinds: sheet.rowKinds, where: `feuille « ${name} »` });
  }

  const head = (title: string, note?: string): Line[] => [{ text: `${spec.title} — ${title}`, style: "title" }, meta, ...(note ? [{ text: note, style: "note" as const }] : [])];
  writeTable(wb.addWorksheet(FIXED_SHEETS.filters), {
    lines: head("paramètres de l'export", spec.filters.length === 0 ? "Aucun filtre appliqué." : undefined),
    columns: textCols(["Paramètre", "parametre", 34], ["Valeur", "valeur", 80]),
    rows: spec.filters.map((f) => [f.label, f.value]),
    where: `feuille « ${FIXED_SHEETS.filters} »`,
  });
  writeTable(wb.addWorksheet(FIXED_SHEETS.sources), {
    lines: head("sources des données"),
    columns: [...textCols(["Source", "source", 30], ["Détail", "detail", 60]), { header: "Dernière synchronisation", key: "synchro", kind: "date", width: 24 }, ...textCols(["Statut", "statut", 26], ["Observations", "observations", 40])],
    rows: spec.sources.map((s) => [s.label, s.detail, s.syncedAt === null ? { nd: "aucune synchronisation enregistrée" } : s.syncedAt, s.status, ""]),
    where: `feuille « ${FIXED_SHEETS.sources} »`,
  });
  writeTable(wb.addWorksheet(FIXED_SHEETS.definitions), {
    lines: head("définitions"),
    columns: textCols(["Terme", "terme", 34], ["Définition", "definition", 90], ["Formule", "formule", 50]),
    rows: spec.definitions.map((d) => [d.term, d.definition, d.formula ?? ""]),
    where: `feuille « ${FIXED_SHEETS.definitions} »`,
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
