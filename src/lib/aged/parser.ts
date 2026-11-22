import ExcelJS from "exceljs";
import { decodeBankBytes } from "@/lib/bank/parser";
import { decimalToCents, isoFromParts, normalizeLabel } from "@/lib/bank/model";

// Balance âgée fournisseurs (Cap 13, lot L3) : CSV ou XLSX exporté du logiciel comptable. Les colonnes sont reconnues sur
// la ligne d'en-tête (fournisseur, compte auxiliaire, n° de facture, date de facture, date d'échéance, montant restant dû).
// Les tranches d'âge éventuelles du fichier ne sont jamais lues : Clair les recalcule.

export const AGED_MAX_BYTES = 10 * 1024 * 1024;
export const AGED_MAX_FILES = 1;
const MAX_ROWS = 50_000;

export class AgedError extends Error {
  constructor(message: string) { super(message); this.name = "AgedError"; }
}

export type AgedInvoice = {
  line: number;
  supplier: string;
  auxiliary: string | null;
  invoice: string;
  invoiceDate: string;
  /** null : échéance absente du fichier (exigibilité n.d. tant qu'elle n'est pas saisie). */
  dueDate: string | null;
  /** Montant TTC restant dû, en centimes ; négatif pour un avoir. */
  amountCents: number;
};

export type AgedField = "supplier" | "auxiliary" | "invoice" | "invoiceDate" | "dueDate" | "amount";
export type AgedProfile = { format: "csv" | "xlsx"; columns: Partial<Record<AgedField, string>>; ignored: string[] };
export type AgedParseResult = { invoices: AgedInvoice[]; profile: AgedProfile; encoding: string; warnings: string[] };

export const AGED_FIELD_LABELS: Record<AgedField, string> = {
  supplier: "Fournisseur", auxiliary: "Compte auxiliaire", invoice: "N° de facture", invoiceDate: "Date de facture", dueDate: "Date d'échéance", amount: "Montant restant dû",
};

// En-têtes reconnus, après normalisation (majuscules, sans accents ni ponctuation). L'ordre compte : premier trouvé.
const HEADERS: [AgedField, RegExp][] = [
  ["auxiliary", /^(COMPTE( AUXILIAIRE| TIERS)?|N COMPTE|NO COMPTE|NUMERO DE COMPTE|CODE (TIERS|FOURNISSEUR)|AUXILIAIRE|COMPTE AUX)$/],
  ["supplier", /^(FOURNISSEUR|NOM( DU)? FOURNISSEUR|TIERS|NOM|RAISON SOCIALE|LIBELLE( DU)? (TIERS|COMPTE))$/],
  ["invoice", /^(N FACTURE|NO FACTURE|NUMERO( DE)? FACTURE|FACTURE|N PIECE|NO PIECE|PIECE|REFERENCE|REF FACTURE)$/],
  ["invoiceDate", /^(DATE( DE( LA)?)? FACTURE|DATE( DE)? PIECE|DATE)$/],
  ["dueDate", /^(DATE( D)? ?ECHEANCE|ECHEANCE|DATE LIMITE( DE PAIEMENT)?)$/],
  ["amount", /^(MONTANT )?(TTC )?(RESTANT DU|RESTE A PAYER|SOLDE|MONTANT RESTANT( DU)?|MONTANT TTC RESTANT DU|RESTANT)( TTC)?$|^MONTANT( TTC)?$/],
];
const REQUIRED: AgedField[] = ["supplier", "invoice", "invoiceDate", "amount"];

function profileOf(header: string[]): { map: Map<AgedField, number>; columns: AgedProfile["columns"]; ignored: string[] } {
  const map = new Map<AgedField, number>();
  const columns: AgedProfile["columns"] = {};
  const ignored: string[] = [];
  header.forEach((raw, i) => {
    const h = normalizeLabel(raw);
    const hit = HEADERS.find(([field, re]) => !map.has(field) && re.test(h));
    if (hit) { map.set(hit[0], i); columns[hit[0]] = raw.trim(); } else if (raw.trim()) ignored.push(raw.trim());
  });
  return { map, columns, ignored };
}

function dateOf(raw: unknown): string | null {
  if (raw instanceof Date) return isoFromParts(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  const v = String(raw ?? "").trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) return isoFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v);
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function amountOf(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    const cents = Math.round(raw * 100);
    // Une cellule numérique avec plus de deux décimales n'est pas un montant en euros et centimes.
    return Math.abs(cents - raw * 100) < 1e-6 && Number.isSafeInteger(cents) ? cents : null;
  }
  return decimalToCents(String(raw ?? ""), "auto");
}

const cellText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim());

function readRows(rows: unknown[][], format: AgedProfile["format"], encoding: string): AgedParseResult {
  const headerIndex = rows.findIndex((r) => {
    const { map } = profileOf(r.map(cellText));
    return REQUIRED.every((f) => map.has(f));
  });
  if (headerIndex < 0 || headerIndex > 20) {
    throw new AgedError(`En-tête non reconnu : colonnes ${REQUIRED.map((f) => AGED_FIELD_LABELS[f]).join(", ")} attendues (échéance et compte auxiliaire si disponibles).`);
  }
  const { map, columns, ignored } = profileOf(rows[headerIndex].map(cellText));
  const warnings: string[] = [];
  if (!map.has("dueDate")) warnings.push("Aucune colonne d'échéance : l'exigibilité de chaque facture sera n.d. tant qu'une échéance n'est pas saisie.");
  if (ignored.length) warnings.push(`Colonnes non lues : ${ignored.join(", ")}. Les tranches d'âge sont recalculées par Clair.`);
  const invoices: AgedInvoice[] = [];
  const get = (r: unknown[], f: AgedField) => (map.has(f) ? r[map.get(f)!] : undefined);
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    if (r.every((c) => cellText(c) === "")) continue;
    const supplier = cellText(get(r, "supplier"));
    // Lignes de total ou de sous-total : ignorées, Clair refait ses totaux.
    if (/^(SOUS )?TOTAL\b/.test(normalizeLabel(supplier)) || (supplier === "" && cellText(get(r, "invoice")) === "")) continue;
    if (invoices.length >= MAX_ROWS) throw new AgedError(`Plus de ${MAX_ROWS} factures : fichier non pris en charge.`);
    const invoice = cellText(get(r, "invoice"));
    if (!supplier || !invoice) throw new AgedError(`Ligne ${line} : fournisseur ou n° de facture absent.`);
    const invoiceDate = dateOf(get(r, "invoiceDate"));
    if (!invoiceDate) throw new AgedError(`Ligne ${line} : date de facture illisible (JJ/MM/AAAA attendu).`);
    const dueRaw = get(r, "dueDate");
    const dueDate = cellText(dueRaw) === "" ? null : dateOf(dueRaw);
    if (cellText(dueRaw) !== "" && !dueDate) throw new AgedError(`Ligne ${line} : date d'échéance illisible (JJ/MM/AAAA attendu).`);
    const amountCents = amountOf(get(r, "amount"));
    if (amountCents === null) throw new AgedError(`Ligne ${line} : montant restant dû illisible.`);
    invoices.push({ line, supplier, auxiliary: cellText(get(r, "auxiliary")) || null, invoice, invoiceDate, dueDate, amountCents });
  }
  if (!invoices.length) throw new AgedError("Aucune facture dans le fichier.");
  if (invoices.some((x) => x.dueDate === null) && map.has("dueDate")) warnings.push(`${invoices.filter((x) => x.dueDate === null).length} facture(s) sans échéance : exigibilité n.d. tant qu'elle n'est pas saisie.`);
  return { invoices, profile: { format, columns, ignored }, encoding, warnings };
}

function splitCsv(text: string): string[][] {
  const lines = text.split(/\r\n|\n|\r/);
  const head = lines.find((l) => l.trim()) ?? "";
  const sep = [";", "\t", ","].map((s) => [s, head.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  return lines.map((l) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (quoted) {
        if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === sep) { out.push(cur); cur = ""; } else cur += c;
    }
    out.push(cur);
    return out;
  });
}

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;

export async function parseAgedFile(bytes: Uint8Array): Promise<AgedParseResult> {
  if (bytes.byteLength === 0) throw new AgedError("Fichier vide.");
  if (bytes.byteLength > AGED_MAX_BYTES) throw new AgedError("Fichier trop volumineux (10 Mo au plus).");
  if (isZip(bytes)) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer); }
    catch { throw new AgedError("Classeur XLSX illisible."); }
    const ws = wb.worksheets[0];
    if (!ws) throw new AgedError("Classeur sans feuille.");
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const values = (row.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && !(v instanceof Date) && "result" in v ? (v as { result: unknown }).result : v));
      rows[n - 1] = values;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return readRows(rows, "xlsx", "xlsx");
  }
  if (/^\s*</.test(new TextDecoder().decode(bytes.slice(0, 64)))) throw new AgedError("Format non lu : la balance âgée est attendue en CSV ou XLSX.");
  const { text, encoding } = decodeBankBytes(bytes);
  return readRows(splitCsv(text), "csv", encoding);
}
