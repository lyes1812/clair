import { createHash } from "node:crypto";

// Lecteur FEC (fichier des écritures comptables, art. A47 A-1 du LPF ; BOI-CF-IOR-60-40-20), réécrit d'après le
// lecteur Codex. Lecture seule : aucune certification fiscale, aucun retraitement. Montants en centimes exacts.
export const FEC_MAX_BYTES = 32 * 1024 * 1024;
const MAX_ROWS = 300_000;
const MAX_CELL = 8192;
const MAX_COLUMNS = 100;

export const FEC_FIELDS = [
  "JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib", "PieceRef",
  "PieceDate", "EcritureLib", "Debit", "Credit", "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise",
] as const;

export type FecRejectedRow = { line: number; reason: string };

export class FecError extends Error {
  constructor(
    public readonly code: "empty" | "too_large" | "encoding" | "headers" | "limit" | "row",
    message: string,
    // F02 : lignes illisibles et nombre de lignes de données, quand le refus vient de leur proportion.
    public readonly rows?: { rejected: FecRejectedRow[]; dataRows: number },
  ) {
    super(message);
    this.name = "FecError";
  }
}

// F02 : au-delà de 0,1 % de lignes illisibles, le fichier est refusé ; en deçà, elles sont listées et écartées.
export const FEC_MAX_REJECTED_PERMILLE = 1;

export type FecLine = {
  line: number;
  journalCode: string;
  journalLabel: string;
  entryNumber: string;
  entryDate: string;
  accountId: string;
  accountName: string;
  auxiliaryAccount: string | null;
  auxiliaryLabel: string | null;
  pieceRef: string;
  pieceDate: string;
  label: string;
  debitCents: number;
  creditCents: number;
  validationDate: string;
  // Lettrage (EcritureLet, DateLet) : null quand le champ est vide dans le fichier ; aucun lettrage n'est déduit.
  lettering: string | null;
  letteringDate: string | null;
  currency: string | null;
};

export type FecParseResult = {
  hash: string;
  sizeBytes: number;
  encoding: FecEncoding;
  delimiter: "tab" | "pipe";
  amountFormat: "debit-credit" | "montant-sens";
  lines: FecLine[];
  firstDate: string;
  lastDate: string;
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean;
  entryCount: number;
  unbalancedEntries: number;
  /** Écritures déséquilibrées (JournalCode + EcritureNum) avec leur écart débit − crédit, 20 au plus. */
  unbalancedSample: { journal: string; number: string; gapCents: number }[];
  journals: { code: string; label: string; lines: number }[];
  /** Lignes de données non vides du fichier, lignes illisibles comprises. */
  dataRows: number;
  rejectedRows: FecRejectedRow[];
  /** Écritures écartées parce qu'une de leurs lignes est illisible, et lignes lisibles écartées avec elles. */
  excludedEntries: number;
  excludedLines: number;
  warnings: string[];
};

export type FecEncoding = "utf-8" | "iso-8859-15" | "windows-1252";

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

function isoDate(v: string): string | null {
  if (!/^\d{8}$/.test(v) || v.startsWith("0000")) return null;
  const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

function cents(v: string, where: string, warnings: Set<string>): bigint {
  const m = /^([+-]?)(\d+)(?:([.,])(\d{1,2}))?$/.exec(v.trim());
  if (!m) throw new FecError("row", `${where} : montant invalide.`);
  if (m[3] === ".") warnings.add("Séparateur décimal « . » rencontré (la norme attend « , »).");
  if (m[1] === "+") warnings.add("Signe « + » explicite rencontré sur un montant.");
  const magnitude = BigInt(m[2]) * 100n + BigInt((m[4] ?? "").padEnd(2, "0") || "0");
  return m[1] === "-" ? -magnitude : magnitude;
}

function toNumber(v: bigint, where: string): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) throw new FecError("row", `${where} : montant hors limites.`);
  return Number(v);
}

// UTF-8 d'abord ; sinon Windows-1252 si un octet de la plage 0x80–0x9F apparaît (€, –, Œ… ; caractères de contrôle
// en ISO-8859-15), ISO-8859-15 dans les autres cas.
function decode(bytes: Uint8Array): { text: string; encoding: FecEncoding; bom: boolean } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const bom = text.charCodeAt(0) === 0xfeff;
    return { text: bom ? text.slice(1) : text, encoding: "utf-8", bom };
  } catch {
    const cp1252 = bytes.some((b) => b >= 0x80 && b <= 0x9f);
    return cp1252
      ? { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252", bom: false }
      : { text: new TextDecoder("iso-8859-15").decode(bytes), encoding: "iso-8859-15", bom: false };
  }
}

function cellsOf(line: string, delimiter: string, number: number): string[] {
  if (CONTROL.test(line.replace(/\t/g, ""))) throw new FecError("row", `Ligne ${number} : caractère de contrôle.`);
  const cells = line.split(delimiter);
  if (cells.length > MAX_COLUMNS || cells.some((c) => c.length > MAX_CELL)) throw new FecError("limit", `Ligne ${number} : cellule ou nombre de colonnes hors limites.`);
  return cells;
}

type Pending = FecLine & { entryKey: string };

export function parseFec(bytes: Uint8Array): FecParseResult {
  if (bytes.byteLength === 0) throw new FecError("empty", "Fichier vide.");
  if (bytes.byteLength > FEC_MAX_BYTES) throw new FecError("too_large", "Fichier trop volumineux (32 Mo au plus).");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { text, encoding, bom } = decode(bytes);
  const warnings = new Set<string>();
  if (bom) warnings.add("Marque d'ordre des octets (BOM) UTF-8 ignorée.");
  if (encoding === "iso-8859-15") warnings.add("Fichier lu en ISO-8859-15 (Latin-9) : il n'est pas en UTF-8.");
  if (encoding === "windows-1252") warnings.add("Fichier lu en Windows-1252 : il n'est pas en UTF-8.");
  if (/^\s*</.test(text)) throw new FecError("headers", "FEC au format XML : non lu en V1. Exporte le FEC au format texte (colonnes séparées par tabulation ou « | »).");

  const rawLines = text.split(/\r\n|\n|\r/);
  if (rawLines[rawLines.length - 1] === "") rawLines.pop();
  if (rawLines.length === 0) throw new FecError("empty", "Fichier vide.");

  const headerLine = rawLines[0];
  const delimiter = ["\t", "|"].find((sep) => headerLine.startsWith(FEC_FIELDS.slice(0, 11).join(sep) + sep));
  if (!delimiter) throw new FecError("headers", "En-tête FEC non reconnu : les 18 colonnes de la norme, séparées par tabulation ou « | », sont attendues.");
  const headers = cellsOf(headerLine, delimiter, 1).map((h) => h.trim());
  const montantSens = headers[11] === "Montant" && headers[12] === "Sens";
  const expected = FEC_FIELDS.map((f, i) => (montantSens && i === 11 ? "Montant" : montantSens && i === 12 ? "Sens" : f));
  if (headers.length < 18 || expected.some((f, i) => headers[i] !== f) || new Set(headers).size !== headers.length) {
    throw new FecError("headers", "En-tête FEC non conforme : ordre ou nom des 18 colonnes de la norme.");
  }
  if (headers.length > 18) warnings.add(`${headers.length - 18} colonne(s) supplémentaire(s) ignorée(s).`);

  // Première passe : lecture ligne à ligne ; une ligne illisible est rejetée avec sa raison (F02), sans arrêter la lecture.
  const pending: Pending[] = [];
  const rejected: FecRejectedRow[] = [];
  const brokenEntries = new Set<string>();
  let dataRows = 0;
  for (let n = 1; n < rawLines.length; n++) {
    const number = n + 1;
    if (rawLines[n] === "") continue;
    dataRows += 1;
    if (dataRows > MAX_ROWS) throw new FecError("limit", `Plus de ${MAX_ROWS} lignes : fichier non pris en charge.`);
    try {
      pending.push(readRow(cellsOf(rawLines[n], delimiter, number), number, headers.length, montantSens, warnings));
    } catch (e) {
      if (!(e instanceof FecError) || e.code !== "row") throw e;
      rejected.push({ line: number, reason: e.message });
      const cells = rawLines[n].split(delimiter);
      if (cells[0]?.trim() && cells[2]?.trim()) brokenEntries.add(entryKeyOf(cells[0].trim(), cells[2].trim()));
    }
  }
  if (rejected.length && rejected.length * 1000 > dataRows * FEC_MAX_REJECTED_PERMILLE) {
    const first = rejected[0].reason;
    throw new FecError("row", rejected.length === 1 ? first : `${first} (et ${rejected.length - 1} autre(s) ligne(s) illisible(s))`, { rejected, dataRows });
  }

  // Seconde passe : les écritures touchées par une ligne illisible sont écartées en entier, pour ne pas fausser l'équilibre.
  const lines: FecLine[] = [];
  let excludedLines = 0;
  const entries = new Map<string, { journal: string; number: string; diff: bigint }>();
  const journals = new Map<string, { label: string; lines: number }>();
  let totalDebit = 0n;
  let totalCredit = 0n;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let previousValidation: string | null = null;
  let validationOrder = true;
  for (const { entryKey, ...l } of pending) {
    if (brokenEntries.has(entryKey)) { excludedLines += 1; continue; }
    if (previousValidation !== null && l.validationDate < previousValidation) validationOrder = false;
    previousValidation = l.validationDate;
    if (firstDate === null || l.entryDate < firstDate) firstDate = l.entryDate;
    if (lastDate === null || l.entryDate > lastDate) lastDate = l.entryDate;
    totalDebit += BigInt(l.debitCents);
    totalCredit += BigInt(l.creditCents);
    const e = entries.get(entryKey) ?? { journal: l.journalCode, number: l.entryNumber, diff: 0n };
    e.diff += BigInt(l.debitCents) - BigInt(l.creditCents);
    entries.set(entryKey, e);
    const j = journals.get(l.journalCode) ?? { label: l.journalLabel, lines: 0 };
    j.lines += 1;
    journals.set(l.journalCode, j);
    lines.push(l);
  }
  if (lines.length === 0) throw new FecError("empty", "Aucune écriture lisible dans le fichier.");
  if (!validationOrder) warnings.add("Dates de validation non croissantes.");
  const unbalanced = [...entries.values()].filter((e) => e.diff !== 0n);

  return {
    hash,
    sizeBytes: bytes.byteLength,
    encoding,
    delimiter: delimiter === "\t" ? "tab" : "pipe",
    amountFormat: montantSens ? "montant-sens" : "debit-credit",
    lines,
    firstDate: firstDate!,
    lastDate: lastDate!,
    totalDebitCents: toNumber(totalDebit, "Total débit"),
    totalCreditCents: toNumber(totalCredit, "Total crédit"),
    balanced: totalDebit === totalCredit && unbalanced.length === 0,
    entryCount: entries.size,
    unbalancedEntries: unbalanced.length,
    unbalancedSample: unbalanced.slice(0, 20).map((e) => ({ journal: e.journal, number: e.number, gapCents: toNumber(e.diff, "Écart") })),
    journals: [...journals].map(([code, j]) => ({ code, label: j.label, lines: j.lines })).sort((a, b) => a.code.localeCompare(b.code)),
    dataRows,
    rejectedRows: rejected,
    excludedEntries: brokenEntries.size,
    excludedLines,
    warnings: [...warnings],
  };
}

// F03 : une écriture est identifiée par JournalCode + EcritureNum.
const entryKeyOf = (journal: string, number: string) => `${journal}\u0000${number}`;

function readRow(v: string[], number: number, columns: number, montantSens: boolean, warnings: Set<string>): Pending {
  if (v.length !== columns) throw new FecError("row", `Ligne ${number} : ${v.length} colonnes au lieu de ${columns}.`);
  for (const i of [0, 1, 2, 4, 5, 8, 10]) if (!v[i].trim()) throw new FecError("row", `Ligne ${number} : ${FEC_FIELDS[i]} obligatoire.`);
  const accountId = v[4].trim();
  if (!/^\d{3}\S*$/.test(accountId)) throw new FecError("row", `Ligne ${number} : CompteNum invalide.`);
  const entryDate = isoDate(v[3].trim());
  const pieceDate = isoDate(v[9].trim());
  const validationDate = isoDate(v[15].trim());
  if (!entryDate || !pieceDate || !validationDate) throw new FecError("row", `Ligne ${number} : date invalide (AAAAMMJJ attendu).`);
  const letteringDate = v[14].trim() === "" ? null : isoDate(v[14].trim());
  if (v[14].trim() !== "" && !letteringDate) throw new FecError("row", `Ligne ${number} : DateLet invalide.`);
  let debit: bigint;
  let credit: bigint;
  if (montantSens) {
    const amount = cents(v[11], `Ligne ${number}, Montant`, warnings);
    const sens = v[12].trim();
    if (!["D", "C", "+1", "-1"].includes(sens)) throw new FecError("row", `Ligne ${number} : Sens invalide (D, C, +1 ou -1).`);
    debit = sens === "D" || sens === "+1" ? amount : 0n;
    credit = sens === "C" || sens === "-1" ? amount : 0n;
  } else {
    debit = cents(v[11], `Ligne ${number}, Debit`, warnings);
    credit = cents(v[12], `Ligne ${number}, Credit`, warnings);
    if (debit !== 0n && credit !== 0n) throw new FecError("row", `Ligne ${number} : débit et crédit tous deux renseignés.`);
  }
  const deviseAmount = v[16].trim();
  const currency = v[17].trim();
  if (deviseAmount !== "" && !/^[+-]?\d+(?:[.,]\d+)?$/.test(deviseAmount)) throw new FecError("row", `Ligne ${number} : Montantdevise invalide.`);
  if (currency !== "" && currency !== "EUR") warnings.add(/^[A-Z]{3}$/.test(currency) ? `Devise ${currency} rencontrée : montants conservés tels quels, en euros selon la norme.` : "Idevise non reconnu.");
  if ((deviseAmount === "") !== (currency === "")) warnings.add("Montantdevise et Idevise incohérents (l'un renseigné sans l'autre).");
  const journalCode = v[0].trim();
  return {
    entryKey: entryKeyOf(journalCode, v[2].trim()),
    line: number,
    journalCode,
    journalLabel: v[1].trim(),
    entryNumber: v[2].trim(),
    entryDate,
    accountId,
    accountName: v[5].trim(),
    auxiliaryAccount: v[6].trim() || null,
    auxiliaryLabel: v[7].trim() || null,
    pieceRef: v[8].trim(),
    pieceDate,
    label: v[10].trim(),
    debitCents: toNumber(debit, `Ligne ${number}`),
    creditCents: toNumber(credit, `Ligne ${number}`),
    validationDate,
    lettering: v[13].trim() || null,
    letteringDate,
    currency: currency || null,
  };
}

// Nom de fichier normalisé : <SIREN>FEC<AAAAMMJJ de clôture>.txt ; renvoie null si la convention n'est pas suivie.
export function parseFecFilename(filename: string): { siren: string; closingDate: string } | null {
  const m = /^(\d{9})FEC(\d{8})(?:\.[A-Za-z0-9]+)?$/.exec(filename.trim());
  if (!m) return null;
  const closingDate = isoDate(m[2]);
  return closingDate ? { siren: m[1], closingDate } : null;
}
