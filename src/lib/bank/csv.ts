import { BankError, decimalToCents, isoFromParts, normalizeLabel, type BankMovement, type BankStatement, type CsvProfile } from "./model";

// Relevé CSV exporté de la banque. Le profil de colonnes est reconnu sur la ligne d'en-tête (date, libellé, montant
// ou débit/crédit, solde si présent) et affiché dans l'aperçu : appliquer le dépôt vaut confirmation du profil.
// Les lignes avant l'en-tête et après la dernière opération sont ignorées ; une ligne illisible au milieu des
// opérations refuse le fichier, pour qu'aucun mouvement ne soit perdu en silence.

const HEADER_SCAN = 30;
const suffix = / (EUR|EUROS|EN EUROS|E)$/;
const COLS = {
  date: ["DATE", "DATE OPERATION", "DATE D OPERATION", "DATE DE L OPERATION", "DATE COMPTABLE", "DATE DE COMPTABILISATION", "DATE OPE"],
  valueDate: ["DATE VALEUR", "DATE DE VALEUR"],
  label: ["LIBELLE", "LIBELLE OPERATION", "LIBELLE DE L OPERATION", "LIBELLE SIMPLIFIE", "DESCRIPTION", "INTITULE", "DETAIL", "OPERATION", "NATURE DE L OPERATION"],
  amount: ["MONTANT", "MONTANT OPERATION", "MONTANT DE L OPERATION"],
  debit: ["DEBIT", "MONTANT DEBIT"],
  credit: ["CREDIT", "MONTANT CREDIT"],
  balance: ["SOLDE", "SOLDE COMPTABLE", "SOLDE APRES OPERATION"],
} as const;

export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === "\"" && line[i + 1] === "\"") { cur += "\""; i++; }
      else if (ch === "\"") quoted = false;
      else cur += ch;
    } else if (ch === "\"" && cur.trim() === "") { quoted = true; cur = ""; }
    else if (ch === delimiter) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function csvDate(raw: string): string | null {
  const v = raw.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) return isoFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? isoFromParts(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

function column(headers: string[], names: readonly string[]): number | null {
  const at = headers.findIndex((h) => (names as readonly string[]).includes(h) || (names as readonly string[]).includes(h.replace(suffix, "")));
  return at === -1 ? null : at;
}

/** Profil proposé à partir de la ligne d'en-tête ; null si aucune ligne des 30 premières ne convient. */
export function detectCsvProfile(lines: string[]): Omit<CsvProfile, "order"> | null {
  for (let i = 0; i < Math.min(lines.length, HEADER_SCAN); i++) {
    for (const delimiter of [";", "\t", ","] as const) {
      const raw = splitCsvLine(lines[i], delimiter);
      if (raw.length < 3) continue;
      const headers = raw.map(normalizeLabel);
      const date = column(headers, COLS.date);
      const label = column(headers, COLS.label);
      const amount = column(headers, COLS.amount);
      const debit = column(headers, COLS.debit);
      const credit = column(headers, COLS.credit);
      if (date === null || label === null || (amount === null && (debit === null || credit === null))) continue;
      return {
        delimiter, headerLine: i + 1, headers: raw,
        columns: { date, valueDate: column(headers, COLS.valueDate), label, amount, debit: amount === null ? debit : null, credit: amount === null ? credit : null, balance: column(headers, COLS.balance) },
      };
    }
  }
  return null;
}

type Row = { line: number; date: string; valueDate: string | null; label: string; amount: number; balance: number | null };

function breaksOf(rows: Row[]) {
  const out: { line: number; gapCents: number }[] = [];
  for (let k = 1; k < rows.length; k++) {
    const gap = rows[k].balance! - (rows[k - 1].balance! + rows[k].amount);
    if (gap !== 0) out.push({ line: rows[k].line, gapCents: gap });
  }
  return out;
}

export function parseBankCsv(text: string, account: { identifier: string; identifierKind: "iban" | "national" }): { statement: BankStatement; profile: CsvProfile; warnings: string[] } {
  const lines = text.split(/\r\n|\n|\r/);
  const detected = detectCsvProfile(lines);
  if (!detected) throw new BankError("CSV : ligne d'en-tête non reconnue (colonnes date, libellé et montant, ou débit et crédit, attendues).");
  const { columns: c, delimiter } = detected;
  const warnings: string[] = [];
  const rows: Row[] = [];
  const skipped: number[] = [];
  for (let i = detected.headerLine; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitCsvLine(lines[i], delimiter);
    const date = csvDate(cells[c.date] ?? "");
    if (!date) { skipped.push(i + 1); continue; }
    if (skipped.length && rows.length) throw new BankError(`CSV : ligne ${skipped[0]} illisible entre deux opérations (date attendue).`);
    if (skipped.length) { warnings.push(`${skipped.length} ligne(s) ignorée(s) entre l'en-tête et la première opération.`); skipped.length = 0; }
    let amount: number | null;
    if (c.amount !== null) amount = decimalToCents(cells[c.amount] ?? "");
    else {
      const d = (cells[c.debit!] ?? "").trim() ? decimalToCents(cells[c.debit!]) : 0;
      const k = (cells[c.credit!] ?? "").trim() ? decimalToCents(cells[c.credit!]) : 0;
      if (d === null || k === null) amount = null;
      else if (d !== 0 && k !== 0) throw new BankError(`CSV : ligne ${i + 1}, débit et crédit renseignés ensemble.`);
      else amount = d !== 0 ? -Math.abs(d) : Math.abs(k);
    }
    if (amount === null) throw new BankError(`CSV : ligne ${i + 1}, montant illisible.`);
    const balanceRaw = c.balance !== null ? (cells[c.balance] ?? "").trim() : "";
    const balance = balanceRaw ? decimalToCents(balanceRaw) : null;
    if (balanceRaw && balance === null) throw new BankError(`CSV : ligne ${i + 1}, solde illisible.`);
    const label = (cells[c.label] ?? "").trim() || "(sans libellé)";
    rows.push({ line: i + 1, date, valueDate: c.valueDate !== null ? csvDate(cells[c.valueDate] ?? "") : null, label, amount, balance });
  }
  if (skipped.length) warnings.push(`${skipped.length} ligne(s) de pied de fichier ignorée(s).`);
  if (!rows.length) throw new BankError("CSV : aucune opération lue.");

  // Ordre du fichier : déduit des dates, et du solde ligne à ligne quand toutes les dates sont égales.
  const withBalance = c.balance !== null && rows.every((r) => r.balance !== null);
  if (c.balance !== null && !withBalance) warnings.push("Colonne de solde incomplète : soldes non lus, continuité non contrôlée.");
  let order: CsvProfile["order"] = rows[0].date > rows[rows.length - 1].date ? "reverse" : "chronological";
  if (rows[0].date === rows[rows.length - 1].date && withBalance && rows.length > 1) {
    order = breaksOf([...rows].reverse()).length < breaksOf(rows).length ? "reverse" : "chronological";
  }
  const chrono = order === "reverse" ? [...rows].reverse() : rows;
  for (let k = 1; k < chrono.length; k++) {
    if (chrono[k].date < chrono[k - 1].date) throw new BankError(`CSV : dates non ordonnées (ligne ${chrono[k].line}).`);
  }
  const first = chrono[0];
  const last = chrono[chrono.length - 1];
  const movements: BankMovement[] = chrono.map((r) => ({ bookingDate: r.date, valueDate: r.valueDate, amountCents: r.amount, label: r.label, counterparty: null, reference: null }));
  const statement: BankStatement = {
    identifier: account.identifier, identifierKind: account.identifierKind, bank: null, currency: "EUR",
    from: first.date, to: last.date,
    opening: withBalance ? { date: first.date, cents: first.balance! - first.amount } : null,
    closing: withBalance ? { date: last.date, cents: last.balance! } : null,
    movements, rowBreaks: withBalance ? breaksOf(chrono) : null,
  };
  return { statement, profile: { ...detected, order }, warnings };
}
